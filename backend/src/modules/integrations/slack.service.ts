import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config';
import { openSecret, sealSecret } from '../../crypto/secretbox';
import { db } from '../../db/client';
import {
  agents,
  slackConversationLinks,
  slackIntegrations,
  teams,
  type Agent,
  type SlackIntegration,
  type SlackIntegrationScope,
  type Team,
} from '../../db/schema';
import { HttpError, badRequest, notFound } from '../../http/errors';
import { getAgent } from '../agents/agents.service';
import { runChatTurn } from '../chat/chat.service';
import { createConversation } from '../chat/conversations.service';
import { getExecution, type ExecutionDetail } from '../workflows/execution-store';
import { startExecution } from '../workflows/executor';
import { getTeam } from '../teams/teams.service';
import { getSlackClient } from './slack-api';

const SIGNATURE_VERSION = 'v0';
const REPLAY_WINDOW_SECONDS = 300;
const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const HANDLED_EVENT_TYPES = new Set(['app_mention', 'message']);

const processedEventIds = new Map<string, number>();

export interface SlackWebhookOutcome {
  challenge?: string;
  accepted?: boolean;
  ignored?: boolean;
  reason?: string;
}

export interface SlackRequestHeaders {
  timestamp: string | undefined;
  signature: string | undefined;
  retryNum: string | undefined;
}

interface SlackEventContext {
  scope: SlackIntegrationScope;
  subjectId: string;
  eventId: string;
  channel: string;
  senderId: string;
  threadTs: string;
  text: string;
}

interface ResolvedCredentials {
  botToken: string;
  signingSecret: string;
  channelId: string | null;
}

// --- webhook URL -----------------------------------------------------------

function publicBaseUrl(): string {
  const configured = (
    process.env.SLACK_PUBLIC_BASE_URL ??
    process.env.PUBLIC_BACKEND_URL ??
    ''
  ).trim();
  return (configured || `http://localhost:${config.port}`).replace(/\/+$/, '');
}

/**
 * Path token gating the public callback route. Derived from SECRETS_KEY so it
 * is stable per subject without storing anything; authenticity of the payload
 * itself is established by the Slack signature check.
 */
export function webhookToken(scope: SlackIntegrationScope, subjectId: string): string {
  return crypto
    .createHmac('sha256', config.secretsKey())
    .update(`${scope}:${subjectId}`)
    .digest('base64url')
    .slice(0, 32);
}

function verifyWebhookToken(
  scope: SlackIntegrationScope,
  subjectId: string,
  token: string
): boolean {
  const expected = Buffer.from(webhookToken(scope, subjectId));
  const actual = Buffer.from(token || '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// --- signature verification ------------------------------------------------

/**
 * Slack request signature: `v0=HMAC_SHA256(secret, "v0:{timestamp}:{body}")`.
 * Requests older than the replay window are rejected regardless of signature.
 */
export function verifySlackSignature(
  signingSecret: string,
  headers: SlackRequestHeaders,
  rawBody: Buffer
): void {
  const timestamp = Number(headers.timestamp);
  if (!headers.timestamp || !Number.isFinite(timestamp)) {
    throw new HttpError(401, 'invalid_signature', 'Missing Slack request timestamp');
  }
  if (Math.abs(Date.now() / 1000 - timestamp) > REPLAY_WINDOW_SECONDS) {
    throw new HttpError(401, 'invalid_signature', 'Slack request timestamp outside replay window');
  }

  const base = `${SIGNATURE_VERSION}:${headers.timestamp}:${rawBody.toString('utf8')}`;
  const expected = `${SIGNATURE_VERSION}=${crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(headers.signature ?? '');
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new HttpError(401, 'invalid_signature', 'Slack signature mismatch');
  }
}

// --- credentials -----------------------------------------------------------

async function findIntegration(
  scope: SlackIntegrationScope,
  subjectId: string
): Promise<SlackIntegration | null> {
  const [row] = await db
    .select()
    .from(slackIntegrations)
    .where(and(eq(slackIntegrations.scope, scope), eq(slackIntegrations.subjectId, subjectId)))
    .limit(1);
  return row ?? null;
}

function envBotToken(): string {
  return (process.env.SLACK_BOT_TOKEN ?? '').trim();
}

function envSigningSecret(): string {
  return (process.env.SLACK_SIGNING_SECRET ?? '').trim();
}

/** Per-subject credentials win over workspace-wide env fallbacks. */
function resolveCredentials(integration: SlackIntegration | null): ResolvedCredentials | null {
  const botToken = integration ? openSecret(integration.botTokenEncrypted) : envBotToken();
  const signingSecret = integration
    ? openSecret(integration.signingSecretEncrypted)
    : envSigningSecret();
  if (!botToken || !signingSecret) return null;
  return { botToken, signingSecret, channelId: integration?.channelId ?? null };
}

// --- event intake ----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Strips <@U123> mention tokens Slack embeds in message text. */
function cleanEventText(raw: string): string {
  return raw
    .replace(/<@[A-Z0-9]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEventContext(
  scope: SlackIntegrationScope,
  subjectId: string,
  body: Record<string, unknown>
): SlackEventContext | null {
  const event = isRecord(body.event) ? body.event : null;
  if (!event) return null;
  if (!HANDLED_EVENT_TYPES.has(str(event.type))) return null;
  // Bot echoes and message edits/deletes (subtyped events) would loop or duplicate.
  if (str(event.bot_id) || str(event.subtype)) return null;

  const text = cleanEventText(str(event.text));
  const channel = str(event.channel);
  const ts = str(event.ts);
  if (!text || !channel || !ts) return null;

  return {
    scope,
    subjectId,
    eventId: str(body.event_id) || ts,
    channel,
    senderId: str(event.user) || 'unknown',
    threadTs: str(event.thread_ts) || ts,
    text,
  };
}

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  for (const [key, seenAt] of processedEventIds) {
    if (now - seenAt > EVENT_DEDUPE_TTL_MS) processedEventIds.delete(key);
  }
  if (processedEventIds.has(eventId)) return true;
  processedEventIds.set(eventId, now);
  return false;
}

export function resetSlackEventDedupeForTests(): void {
  processedEventIds.clear();
}

/**
 * Events API intake. Verifies the path token and request signature, answers
 * url_verification, dedupes retries, then processes the message off the
 * request cycle — Slack expects a 200 within three seconds.
 */
export async function acceptSlackEvent(
  scope: SlackIntegrationScope,
  subjectId: string,
  token: string,
  rawBody: Buffer | undefined,
  headers: SlackRequestHeaders,
  body: unknown
): Promise<SlackWebhookOutcome> {
  if (!verifyWebhookToken(scope, subjectId, token)) {
    throw new HttpError(403, 'invalid_webhook_token', 'Webhook URL token is invalid');
  }

  const integration = await findIntegration(scope, subjectId);
  const credentials = resolveCredentials(integration);
  if (!credentials) {
    throw badRequest(
      'slack_not_configured',
      'Save a Slack bot token and signing secret for this subject first'
    );
  }
  if (integration && !integration.enabled) {
    return { ignored: true, reason: 'Integration is disabled' };
  }

  verifySlackSignature(credentials.signingSecret, headers, rawBody ?? Buffer.alloc(0));

  const payload = isRecord(body) ? body : null;
  if (!payload) {
    throw badRequest('invalid_payload', 'Slack event payload must be a JSON object');
  }

  const challenge = str(payload.challenge);
  if (str(payload.type) === 'url_verification' && challenge) {
    return { challenge };
  }

  const context = parseEventContext(scope, subjectId, payload);
  if (!context) {
    return { ignored: true, reason: 'Unsupported event type or empty message' };
  }

  // Slack retries (X-Slack-Retry-Num) reuse the event_id, so dedupe covers both
  // redelivery and duplicate subscriptions (app_mention + message for one post).
  if (isDuplicateEvent(context.eventId)) {
    return { accepted: true, reason: 'duplicate' };
  }

  if (credentials.channelId && context.channel !== credentials.channelId) {
    return { ignored: true, reason: 'Channel does not match the configured filter' };
  }

  void processSlackEvent(context, credentials).catch((error: unknown) => {
    console.error('Slack event processing failed:', error);
  });

  return { accepted: true };
}

// --- message processing ----------------------------------------------------

async function replyInThread(
  credentials: ResolvedCredentials,
  context: SlackEventContext,
  text: string
): Promise<void> {
  try {
    await getSlackClient().postMessage({
      botToken: credentials.botToken,
      channel: context.channel,
      text,
      threadTs: context.threadTs,
    });
  } catch (error) {
    console.error('Slack reply failed:', error);
  }
}

async function processSlackEvent(
  context: SlackEventContext,
  credentials: ResolvedCredentials
): Promise<void> {
  if (context.scope === 'agent') {
    await processAgentEvent(context, credentials);
    return;
  }
  await processTeamEvent(context, credentials);
}

async function findSubjectAgent(agentId: string): Promise<Agent | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  return row ?? null;
}

async function findSubjectTeam(teamId: string): Promise<Team | null> {
  const [row] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return row ?? null;
}

function slackSessionKey(context: SlackEventContext): string {
  const source = [context.scope, context.subjectId, context.channel, context.senderId].join(':');
  return `slack_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 28)}`;
}

async function getOrCreateLinkedConversation(agent: Agent, context: SlackEventContext) {
  const sessionKey = slackSessionKey(context);
  const [link] = await db
    .select()
    .from(slackConversationLinks)
    .where(eq(slackConversationLinks.sessionKey, sessionKey))
    .limit(1);
  if (link) return link.conversationId;

  const conversation = await createConversation(
    agent.userId,
    agent.id,
    `Slack · ${context.channel}`
  );
  await db
    .insert(slackConversationLinks)
    .values({ sessionKey, conversationId: conversation.id })
    .onConflictDoNothing();
  return conversation.id;
}

async function processAgentEvent(
  context: SlackEventContext,
  credentials: ResolvedCredentials
): Promise<void> {
  const agent = await findSubjectAgent(context.subjectId);
  if (!agent) {
    await replyInThread(credentials, context, 'This agent no longer exists in SwarmDev.');
    return;
  }

  const conversationId = await getOrCreateLinkedConversation(agent, context);
  try {
    const outcome = await runChatTurn(agent.userId, conversationId, context.text, {
      source: 'slack',
    });
    await replyInThread(credentials, context, outcome.reply.content);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Agent turn failed unexpectedly';
    console.error('Slack agent turn failed:', error);
    await replyInThread(credentials, context, `Agent run failed: ${message}`);
  }
}

function pollIntervalMs(): number {
  const value = Number(process.env.SLACK_TEAM_POLL_MS);
  return Number.isFinite(value) && value > 0 ? value : 1200;
}

function teamTimeoutMs(): number {
  const value = Number(process.env.SLACK_TEAM_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 600_000;
}

async function waitForExecution(
  userId: string,
  executionId: string
): Promise<ExecutionDetail | null> {
  const deadline = Date.now() + teamTimeoutMs();
  while (Date.now() < deadline) {
    const execution = await getExecution(userId, executionId);
    if (execution && !['queued', 'running'].includes(execution.status)) {
      return execution;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs()));
  }
  return null;
}

function formatExecutionReply(teamName: string, execution: ExecutionDetail): string {
  const lines = [`Team "${teamName}" finished with status: ${execution.status}.`];

  if (execution.finalOutput?.trim()) {
    lines.push('', execution.finalOutput.trim());
  }
  if (execution.error) {
    lines.push('', `Error: ${execution.error}`);
  }

  const artifacts = execution.artifacts.slice(0, 8);
  if (artifacts.length > 0) {
    lines.push('', 'Files produced:');
    for (const artifact of artifacts) {
      lines.push(`• ${artifact.path}`);
    }
  }

  lines.push('', `Execution ID: ${execution.id}`);
  return lines.join('\n');
}

async function processTeamEvent(
  context: SlackEventContext,
  credentials: ResolvedCredentials
): Promise<void> {
  const team = await findSubjectTeam(context.subjectId);
  if (!team) {
    await replyInThread(credentials, context, 'This team no longer exists in SwarmDev.');
    return;
  }

  let view;
  try {
    view = await getTeam(team.userId, team.id);
  } catch {
    await replyInThread(credentials, context, 'This team no longer exists in SwarmDev.');
    return;
  }

  await replyInThread(
    credentials,
    context,
    `Task received — team "${team.name}" is on it: ${context.text}`
  );

  try {
    const execution = await startExecution({
      userId: team.userId,
      teamId: team.id,
      task: context.text,
      workflow: view.workflow,
    });

    const finished = await waitForExecution(team.userId, execution.id);
    if (!finished) {
      await replyInThread(
        credentials,
        context,
        `The team is still working. Execution ID: ${execution.id} — check the team page in SwarmDev for progress.`
      );
      return;
    }

    await replyInThread(credentials, context, formatExecutionReply(team.name, finished));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await replyInThread(credentials, context, `Team execution failed: ${message}`);
  }
}

// --- config CRUD -----------------------------------------------------------

export interface SlackConfigInput {
  botToken: string;
  signingSecret: string;
  channelId?: string;
  enabled?: boolean;
}

export interface SlackConfigView {
  id: string;
  scope: SlackIntegrationScope;
  subjectId: string;
  botTokenMasked: string;
  signingSecretMasked: string;
  channelId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlackWebhookInfo {
  scope: SlackIntegrationScope;
  subjectId: string;
  subjectName: string;
  requestUrl: string;
  configured: boolean;
  envStatus: {
    botTokenConfigured: boolean;
    signingSecretConfigured: boolean;
    publicBaseConfigured: boolean;
  };
}

function maskSecret(value: string): string {
  if (!value) return '';
  return `${value.slice(0, 4)}****`;
}

function toConfigView(row: SlackIntegration): SlackConfigView {
  return {
    id: row.id,
    scope: row.scope,
    subjectId: row.subjectId,
    botTokenMasked: maskSecret(openSecret(row.botTokenEncrypted)),
    signingSecretMasked: maskSecret(openSecret(row.signingSecretEncrypted)),
    channelId: row.channelId,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Throws notFound unless the subject exists and belongs to the user. */
async function assertSubjectOwnership(
  userId: string,
  scope: SlackIntegrationScope,
  subjectId: string
): Promise<string> {
  if (scope === 'agent') {
    const agent = await getAgent(userId, subjectId);
    return agent.name;
  }
  const team = await getTeam(userId, subjectId);
  return team.name;
}

export async function getSlackWebhookInfo(
  userId: string,
  scope: SlackIntegrationScope,
  subjectId: string
): Promise<SlackWebhookInfo> {
  const subjectName = await assertSubjectOwnership(userId, scope, subjectId);
  const integration = await findIntegration(scope, subjectId);
  const token = webhookToken(scope, subjectId);

  return {
    scope,
    subjectId,
    subjectName,
    requestUrl: `${publicBaseUrl()}/api/integrations/slack/${scope}/${subjectId}/${token}`,
    configured: Boolean(integration),
    envStatus: {
      botTokenConfigured: Boolean(integration) || Boolean(envBotToken()),
      signingSecretConfigured: Boolean(integration) || Boolean(envSigningSecret()),
      publicBaseConfigured: Boolean(
        (process.env.SLACK_PUBLIC_BASE_URL ?? process.env.PUBLIC_BACKEND_URL ?? '').trim()
      ),
    },
  };
}

export async function getSlackConfig(
  userId: string,
  scope: SlackIntegrationScope,
  subjectId: string
): Promise<SlackConfigView | null> {
  await assertSubjectOwnership(userId, scope, subjectId);
  const integration = await findIntegration(scope, subjectId);
  if (!integration || integration.userId !== userId) return null;
  return toConfigView(integration);
}

export async function saveSlackConfig(
  userId: string,
  scope: SlackIntegrationScope,
  subjectId: string,
  input: SlackConfigInput
): Promise<SlackConfigView> {
  await assertSubjectOwnership(userId, scope, subjectId);

  const botToken = input.botToken?.trim();
  const signingSecret = input.signingSecret?.trim();
  if (!botToken || !signingSecret) {
    throw badRequest('missing_credentials', 'botToken and signingSecret are required');
  }

  const values = {
    botTokenEncrypted: sealSecret(botToken),
    signingSecretEncrypted: sealSecret(signingSecret),
    channelId: input.channelId?.trim() || null,
    enabled: input.enabled ?? true,
    updatedAt: new Date(),
  };

  const existing = await findIntegration(scope, subjectId);
  if (existing) {
    if (existing.userId !== userId) throw notFound('Subject not found');
    const [updated] = await db
      .update(slackIntegrations)
      .set(values)
      .where(eq(slackIntegrations.id, existing.id))
      .returning();
    return toConfigView(updated!);
  }

  const [created] = await db
    .insert(slackIntegrations)
    .values({ userId, scope, subjectId, ...values })
    .returning();
  return toConfigView(created!);
}

export async function deleteSlackConfig(
  userId: string,
  scope: SlackIntegrationScope,
  subjectId: string
): Promise<void> {
  await db
    .delete(slackIntegrations)
    .where(
      and(
        eq(slackIntegrations.userId, userId),
        eq(slackIntegrations.scope, scope),
        eq(slackIntegrations.subjectId, subjectId)
      )
    );
}
