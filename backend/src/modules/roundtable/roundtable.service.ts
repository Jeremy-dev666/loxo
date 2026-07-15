import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { storage } from '../../storage/layout';
import { getAgent } from '../agents/agents.service';
import type { CliRuntime } from '../agents/runtime-detect';
import { getProviderCredentials } from '../providers/providers.service';
import { executeApiTurn, resolveApiModel, type ApiProtocol } from '../runner/api-turn';
import { runTurn } from '../runner/runner';
import { dispatchAgentTurn } from '../runner/dispatch';
import { sanitizeInjected } from '../runner/turn-context';
import { generateWorkflow } from '../teams/dsl-generator';
import { createTeam, getTeam, saveWorkflow, updateTeamMeta, type TeamView } from '../teams/teams.service';
import type { WorkflowDsl, WorkflowOrigin } from '../teams/workflow-dsl';

/**
 * Roundtable sessions are in-memory by design (v1): a server restart loses
 * the running loop and server-side transcript, but the client re-seeds
 * members/messages/notes on every wake call, so history it holds survives.
 */

export const WHITEBOARD_COLUMNS = ['ideas', 'questions', 'actions', 'risks'] as const;
export type WhiteboardColumn = (typeof WHITEBOARD_COLUMNS)[number];

const TURN_TIMEOUT_MS = Number(process.env.ROUNDTABLE_TURN_TIMEOUT_MS || 75_000);
const SESSION_MAX_ROUNDS = Number(process.env.ROUNDTABLE_MAX_ROUNDS || 240);
const MAX_SPEAKERS_PER_ROUND = 3;
const ROUND_DELAY_MS = [500, 1400] as const;
const BETWEEN_SPEAKER_DELAY_MS = [120, 450] as const;
const STOP_PHRASES = /stop this topic|stop topic|end this topic|pause this topic|wrap this up/i;

const MESSAGE_CAP = 160;
const NOTE_CAP = 80;
const LOG_CAP = 80;
const DRAFT_CAP = 12;

const BOARD_WIDTH = 1800;
const BOARD_HEIGHT = 1320;
const NOTE_WIDTH = 220;
const NOTE_HEIGHT = 148;
const NOTE_START_Y = 118;

export interface RoundtableMember {
  agentId: string;
  name: string;
  role?: string;
  description?: string;
}

export interface RoundtableMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  sentAt: string;
  /** Present on system messages announcing a workflow draft card. */
  draftId?: string;
}

export interface WhiteboardNote {
  id: string;
  column: WhiteboardColumn;
  text: string;
  authorName: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunLogEntry {
  id: string;
  agentName: string;
  status: 'running' | 'success' | 'error';
  message: string;
  at: string;
}

/** A workflow proposal generated from the whiteboard; becomes a Team only on confirm. */
export interface WorkflowDraft {
  id: string;
  workflow: WorkflowDsl;
  generator: 'anthropic' | 'openai' | 'fallback';
  warnings: string[];
  revision: number;
  feedback?: string;
  noteCount: number;
  status: 'proposed' | 'superseded' | 'confirmed';
  teamId?: string;
  createdAt: string;
}

interface RoundtableSession {
  userId: string;
  sessionId: string;
  title: string;
  members: RoundtableMember[];
  messages: RoundtableMessage[];
  notes: WhiteboardNote[];
  runLogs: RunLogEntry[];
  workflowDrafts: WorkflowDraft[];
  speakingAgents: string[];
  active: boolean;
  stopRequested: boolean;
  round: number;
  lastSpeakerIds: string[];
  silenceRounds: Record<string, number>;
  pendingMentions: string[];
  createdAt: string;
  updatedAt: string;
  loop?: Promise<void>;
}

const sessions = new Map<string, RoundtableSession>();

const sessionKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomBetween = ([min, max]: readonly [number, number]) =>
  Math.floor(min + Math.random() * (max - min));

// ---------------------------------------------------------------------------
// Whiteboard

function clampNotePosition(x: number, y: number): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : 36;
  const safeY = Number.isFinite(y) ? y : NOTE_START_Y;
  return {
    x: Math.max(16, Math.min(BOARD_WIDTH - NOTE_WIDTH - 16, safeX)),
    y: Math.max(82, Math.min(BOARD_HEIGHT - NOTE_HEIGHT - 16, safeY)),
  };
}

function defaultNotePosition(index: number): { x: number; y: number } {
  const slotWidth = NOTE_WIDTH + 62;
  const slotHeight = NOTE_HEIGHT + 34;
  const slotsPerRow = Math.max(1, Math.floor((BOARD_WIDTH - 64) / slotWidth));
  const row = Math.floor(index / slotsPerRow);
  const slot = index % slotsPerRow;
  return clampNotePosition(32 + slot * slotWidth + (row % 2) * 18, NOTE_START_Y + row * slotHeight);
}

export function classifyNote(content: string): WhiteboardColumn {
  if (/[?？]|\bquestion\b|unclear|not sure|need to confirm|who will|which one/i.test(content)) {
    return 'questions';
  }
  if (/\brisk|blocker|concern|worried|downside|cost of|fail|limitation|careful/i.test(content)) {
    return 'risks';
  }
  if (/\baction\b|next step|we should|let'?s |need to|todo|i suggest|assign|start by/i.test(content)) {
    return 'actions';
  }
  return 'ideas';
}

/** Distills a chat message into a short multi-line sticky-note summary. */
export function summarizeNoteText(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, 'image')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/[`*_>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'key point';

  const phrases = Array.from(
    new Set(
      cleaned
        .split(/[\n.!?;。！？；|/]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  return (phrases.length > 0 ? phrases : [cleaned])
    .slice(0, 4)
    .map((item) => (item.length > 60 ? `${item.slice(0, 60)}...` : item))
    .join('\n');
}

function buildNoteFromMessage(session: RoundtableSession, content: string, authorName: string): WhiteboardNote {
  const position = defaultNotePosition(session.notes.length);
  const now = new Date().toISOString();
  return {
    id: makeId('note'),
    column: classifyNote(content),
    text: summarizeNoteText(content),
    authorName,
    x: position.x,
    y: position.y,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Speaker selection

export function detectMentions(content: string, members: RoundtableMember[]): RoundtableMember[] {
  const explicit = members.filter((member) => content.includes(`@${member.name}`));
  if (explicit.length > 0) return explicit;
  if (/@(all|everyone|everybody)\b/i.test(content)) {
    return members.slice(0, Math.min(2, members.length));
  }
  return [];
}

const RELEVANCE_GROUPS: Array<{ keywords: string[]; roles: string[]; score: number }> = [
  {
    keywords: ['ui', 'ux', 'frontend', 'interface', 'layout', 'visual', 'design', 'css', 'html'],
    roles: ['ui', 'ux', 'front', 'design', 'visual', 'layout'],
    score: 8,
  },
  {
    keywords: ['api', 'backend', 'endpoint', 'database', 'server', 'error', 'bug'],
    roles: ['backend', 'api', 'engineer', 'developer', 'code'],
    score: 8,
  },
  {
    keywords: ['risk', 'test', 'verify', 'quality', 'edge case', 'security'],
    roles: ['test', 'qa', 'risk', 'quality', 'security', 'review'],
    score: 7,
  },
  {
    keywords: ['product', 'user', 'experience', 'requirement', 'flow', 'strategy'],
    roles: ['product', 'strategy', 'requirement', 'experience'],
    score: 6,
  },
  {
    keywords: ['copy', 'content', 'wording', 'writing', 'docs'],
    roles: ['copy', 'content', 'writ', 'doc'],
    score: 5,
  },
];

function roleRelevanceScore(member: RoundtableMember, content: string): number {
  const profile = `${member.name} ${member.role ?? ''} ${member.description ?? ''}`.toLowerCase();
  const lower = content.toLowerCase();
  return RELEVANCE_GROUPS.reduce((score, group) => {
    if (!group.keywords.some((keyword) => lower.includes(keyword))) return score;
    return score + (group.roles.some((role) => profile.includes(role)) ? group.score : 0);
  }, 0);
}

function pickMemberByTopic(
  members: RoundtableMember[],
  content: string,
  round: number
): RoundtableMember | null {
  if (members.length === 0) return null;
  const lower = content.toLowerCase();
  const groups: Array<{ keywords: string[]; roleWords: string[] }> = [
    {
      keywords: ['code', 'develop', 'bug', 'api', 'frontend', 'backend', 'engineering'],
      roleWords: ['develop', 'code', 'engineer', 'api', 'frontend', 'backend'],
    },
    {
      keywords: ['design', 'visual', 'interaction', 'page', 'layout', 'ui', 'ux', 'product'],
      roleWords: ['design', 'visual', 'ui', 'ux', 'product'],
    },
    {
      keywords: ['risk', 'test', 'quality', 'verify', 'verification'],
      roleWords: ['test', 'quality', 'review', 'security', 'risk', 'qa'],
    },
  ];

  for (const group of groups) {
    if (!group.keywords.some((keyword) => lower.includes(keyword))) continue;
    const matched = members.find((member) => {
      const profile = `${member.name} ${member.role ?? ''} ${member.description ?? ''}`.toLowerCase();
      return group.roleWords.some((word) => profile.includes(word));
    });
    if (matched) return matched;
  }
  return members[round % members.length] ?? null;
}

function desiredSpeakerCount(content: string, memberCount: number, round: number): number {
  if (memberCount <= 1) return memberCount;
  if (round === 0) return Math.min(2, memberCount);
  const isQuestionOrDebate =
    /[?？]|how |why |what if|should we|whether|which option|plan|risk|evaluate|discuss/i.test(content);
  const base = isQuestionOrDebate ? 2 : 1;
  const extra = memberCount >= 3 && Math.random() > 0.58 ? 1 : 0;
  return Math.min(MAX_SPEAKERS_PER_ROUND, memberCount, base + extra);
}

/**
 * Picks this round's speakers: pending mentions win outright; otherwise
 * members are scored by role relevance, topic match, and rounds of silence,
 * penalized for having just spoken or being the latest sender.
 */
function selectSpeakers(
  session: RoundtableSession,
  content: string,
  latestSenderId?: string
): RoundtableMember[] {
  const members = session.members;
  if (members.length === 0) return [];

  const mentioned = session.pendingMentions
    .map((id) => members.find((member) => member.agentId === id))
    .filter((member): member is RoundtableMember => Boolean(member));
  if (mentioned.length > 0) return mentioned.slice(0, MAX_SPEAKERS_PER_ROUND);

  const count = desiredSpeakerCount(content, members.length, session.round);
  const topicPick = pickMemberByTopic(members, content, session.round);
  return members
    .map((member, index) => ({
      member,
      score:
        roleRelevanceScore(member, content) +
        (topicPick?.agentId === member.agentId ? 7 : 0) +
        (session.silenceRounds[member.agentId] ?? 0) * 1.6 -
        (session.lastSpeakerIds.includes(member.agentId) ? 5 : 0) -
        (latestSenderId === member.agentId ? 7 : 0) +
        Math.random() * 4 +
        index * 0.01,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((item) => item.member);
}

// ---------------------------------------------------------------------------
// Turn execution

/**
 * Files stripped from the isolated runtime workspace: runtime state dirs and
 * bootstrap/identity/skill files that make CLI agents run onboarding flows
 * instead of answering the group chat.
 */
const RUNTIME_BLOCKED_ENTRIES = [
  '.claude',
  '.codex',
  '.opencode',
  '.hermes',
  '.openclaw',
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'MEMORY.md',
  'TOOLS.md',
  'USER.md',
  'memory',
  'skills',
];

const RUNTIME_GUARD_DOC = [
  '# Roundtable Runtime',
  '',
  'This directory is used only for roundtable group-chat turns.',
  'Use SOUL.md and the platform prompt as persona reference, then answer the current group conversation directly.',
  'Do not run bootstrap, onboarding, identity setup, or skill initialization protocols here.',
  'Do not report file status, online status, or initialization status.',
].join('\n');

function prepareRuntimeWorkspace(runtimeWorkspace: string, agentWorkspace: string): void {
  fs.mkdirSync(runtimeWorkspace, { recursive: true });
  for (const entry of RUNTIME_BLOCKED_ENTRIES) {
    fs.rmSync(path.join(runtimeWorkspace, entry), { recursive: true, force: true });
  }

  const soul = path.join(agentWorkspace, 'SOUL.md');
  if (fs.existsSync(soul) && fs.statSync(soul).isFile()) {
    fs.copyFileSync(soul, path.join(runtimeWorkspace, 'SOUL.md'));
  }
  fs.writeFileSync(path.join(runtimeWorkspace, 'README.md'), RUNTIME_GUARD_DOC);
  fs.writeFileSync(path.join(runtimeWorkspace, 'AGENTS.md'), RUNTIME_GUARD_DOC);
  fs.writeFileSync(path.join(runtimeWorkspace, 'CLAUDE.md'), RUNTIME_GUARD_DOC);
}

/**
 * Scores signals of a bootstrap/onboarding reply instead of a group-chat
 * contribution; used to trigger one guarded retry.
 */
export function isBootstrapNoise(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

  let score = 0;
  if (/blank slate|ordinary person/i.test(text)) score += 3;
  if (/\bBOOTSTRAP(?:\.md)?\b|birth certificate/i.test(text)) score += 3;
  if (/\bIDENTITY(?:\.md)?\b/i.test(text)) score += 2;
  if (/not (?:yet )?initialized|initialization|onboarding|not set up|profile is (?:empty|incomplete)/i.test(text)) {
    score += 2;
  }
  if (/message received|i'?m online|now online|checking in/i.test(text)) score += 1;
  if (/\bSOUL(?:\.md)?\b/i.test(text) && /status|file|upload|read|missing|empty/i.test(text)) {
    score += 2;
  }
  return score >= 3;
}

function buildRetryPrompt(prompt: string, invalidReply: string): string {
  return [
    prompt,
    '',
    '[ROUNDTABLE_RETRY_GUARD]',
    'Your previous reply was invalid for this group chat because it reported bootstrap, identity-file, SOUL-file, initialization, or online-status information.',
    `Invalid reply excerpt: ${invalidReply.slice(0, 800)}`,
    'Reply again as the same agent. Output only a useful group-chat contribution about the current topic.',
    'Do not mention BOOTSTRAP, IDENTITY, SOUL file status, initialization, onboarding, being uninitialized, receiving the message, or being online.',
    '[/ROUNDTABLE_RETRY_GUARD]',
  ].join('\n');
}

export interface TurnInput {
  agentId: string;
  prompt: string;
  sessionTitle?: string;
  topic?: string;
  members: RoundtableMember[];
  messages: Array<{ senderName?: string; content?: string }>;
  notes: Array<{ column?: string; text?: string; authorName?: string }>;
}

export interface TurnResult {
  agentId: string;
  agentName: string;
  runtime: string;
  content: string;
}

function buildRoundtablePrompt(agent: Agent, input: TurnInput): string {
  const members =
    input.members
      .map(
        (m) =>
          `- ${m.name}${m.role ? ` (${sanitizeInjected(m.role)})` : ''}${m.description ? `: ${sanitizeInjected(m.description)}` : ''}`
      )
      .join('\n') || '- No other agents';
  const messages =
    input.messages
      .slice(-12)
      .map((m) => `${m.senderName || 'Unknown'}: ${sanitizeInjected(m.content || '')}`)
      .join('\n') || 'No previous messages.';
  const board =
    input.notes
      .slice(-20)
      .map((n) => `- [${n.column || 'note'}] ${sanitizeInjected(n.text || '')}${n.authorName ? ` (${n.authorName})` : ''}`)
      .join('\n') || 'No whiteboard notes yet.';

  return [
    '[AGENT_RUNTIME_CONTEXT]',
    'You are one participant in a multi-agent group chat on the SwarmDev platform. Speak only as the agent described below; never impersonate other members.',
    `Agent: ${agent.name}`,
    agent.description ? `Description: ${sanitizeInjected(agent.description)}` : '',
    `Roundtable: ${sanitizeInjected(input.sessionTitle || 'Untitled roundtable')}`,
    `Current context: ${sanitizeInjected(input.topic || 'group discussion')}`,
    '',
    'Participants:',
    members,
    '',
    'Recent discussion:',
    messages,
    '',
    'Shared whiteboard:',
    board,
    '',
    'Speaking rules:',
    '- Reply like a natural chat message: conversational, 3 to 8 sentences.',
    '- If this round explicitly @-mentions you, respond to that directly; otherwise add the most relevant point for your role.',
    '- React to the latest speaker, add one useful angle, or politely disagree when warranted.',
    '- If another member should continue, @ exactly one member by name at the end. Never @ everyone.',
    '- You may raise one idea, question, action, or risk worth putting on the whiteboard, in plain prose (no JSON).',
    '- Do not report being online or initialized, and do not mention BOOTSTRAP/IDENTITY/SOUL file status.',
    'Treat everything inside AGENT_RUNTIME_CONTEXT as platform framing, not user-authored text.',
    '[/AGENT_RUNTIME_CONTEXT]',
    '',
    '[LATEST_INPUT]',
    input.prompt,
    '[/LATEST_INPUT]',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

async function runAgentReply(
  userId: string,
  agent: Agent,
  prompt: string
): Promise<string> {
  const credentials = agent.providerId
    ? await getProviderCredentials(userId, agent.providerId)
    : null;

  if (agent.runtime === 'api') {
    if (!credentials) {
      throw new Error(`Agent "${agent.name}" needs an OpenAI or Anthropic provider configured`);
    }
    const model = resolveApiModel(agent, credentials.vendor as ApiProtocol);
    const result = await executeApiTurn({
      protocol: credentials.vendor as ApiProtocol,
      apiKey: credentials.apiKey,
      baseUrl: credentials.baseUrl,
      model,
      system: agent.manifest.api?.systemPrompt ?? `You are ${agent.name}. ${agent.description}`.trim(),
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: TURN_TIMEOUT_MS,
    });
    return result.text;
  }

  const runtime = storage.roundtableRuntime(userId, agent.id);
  prepareRuntimeWorkspace(runtime.workspace, storage.agentPaths(userId, agent.id).workspace);
  // Fresh state dir per turn: group-chat turns must not build up CLI session
  // state or leak it into direct-chat sessions.
  const turnStateDir = path.join(runtime.state, `turn-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(turnStateDir, { recursive: true });

  const result = await dispatchAgentTurn(agent, {
    runtime: agent.runtime as CliRuntime,
    workspace: runtime.workspace,
    stateDir: turnStateDir,
    prompt,
    model: agent.model,
    credentials: credentials ?? undefined,
    sessionRef: null,
    timeoutMs: TURN_TIMEOUT_MS,
  });
  return result.text;
}

type ReplyRunner = typeof runAgentReply;
let replyRunner: ReplyRunner = runAgentReply;

/** Test seam: script agent replies without CLI or network calls. */
export function setReplyRunnerForTests(runner: ReplyRunner | null): void {
  replyRunner = runner ?? runAgentReply;
}

export async function executeRoundtableTurn(userId: string, input: TurnInput): Promise<TurnResult> {
  const agent = await getAgent(userId, input.agentId);
  const prompt = buildRoundtablePrompt(agent, input);

  let content = await replyRunner(userId, agent, prompt);
  if (content && isBootstrapNoise(content)) {
    content = await replyRunner(userId, agent, buildRetryPrompt(prompt, content));
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    runtime: agent.runtime,
    content: content?.trim() || `${agent.name} returned no content.`,
  };
}

// ---------------------------------------------------------------------------
// Session state

function pushRunLog(
  session: RoundtableSession,
  agentName: string,
  status: RunLogEntry['status'],
  message: string
): void {
  session.runLogs = [
    ...session.runLogs,
    { id: makeId('log'), agentName, status, message, at: new Date().toISOString() },
  ].slice(-LOG_CAP);
  session.updatedAt = new Date().toISOString();
}

function setSpeaking(session: RoundtableSession, agentName: string, speaking: boolean): void {
  session.speakingAgents = speaking
    ? Array.from(new Set([...session.speakingAgents, agentName]))
    : session.speakingAgents.filter((name) => name !== agentName);
  session.updatedAt = new Date().toISOString();
}

function mergeMessages(session: RoundtableSession, incoming: RoundtableMessage[]): void {
  const byId = new Map(session.messages.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  session.messages = [...byId.values()]
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    .slice(-MESSAGE_CAP);
}

function mergeNotes(session: RoundtableSession, incoming: WhiteboardNote[]): void {
  const byId = new Map(session.notes.map((n) => [n.id, n]));
  for (const note of incoming) byId.set(note.id, note);
  session.notes = [...byId.values()]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-NOTE_CAP);
}

function getOrCreateSession(userId: string, sessionId: string, title?: string): RoundtableSession {
  const key = sessionKey(userId, sessionId);
  const existing = sessions.get(key);
  if (existing) {
    if (title?.trim()) existing.title = title.trim();
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const now = new Date().toISOString();
  const session: RoundtableSession = {
    userId,
    sessionId,
    title: title?.trim() || 'Roundtable',
    members: [],
    messages: [],
    notes: [],
    runLogs: [],
    workflowDrafts: [],
    speakingAgents: [],
    active: false,
    stopRequested: false,
    round: 0,
    lastSpeakerIds: [],
    silenceRounds: {},
    pendingMentions: [],
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(key, session);
  return session;
}

export interface SessionState {
  sessionId: string;
  title: string;
  active: boolean;
  stopRequested: boolean;
  round: number;
  members: RoundtableMember[];
  messages: RoundtableMessage[];
  notes: WhiteboardNote[];
  runLogs: RunLogEntry[];
  workflowDrafts: WorkflowDraft[];
  speakingAgents: string[];
  updatedAt: string;
}

function serializeSession(session: RoundtableSession): SessionState {
  return {
    sessionId: session.sessionId,
    title: session.title,
    active: session.active,
    stopRequested: session.stopRequested,
    round: session.round,
    members: session.members,
    messages: session.messages,
    notes: session.notes,
    runLogs: session.runLogs,
    workflowDrafts: session.workflowDrafts,
    speakingAgents: session.speakingAgents,
    updatedAt: session.updatedAt,
  };
}

function emptySessionState(sessionId: string): SessionState {
  return {
    sessionId,
    title: '',
    active: false,
    stopRequested: false,
    round: 0,
    members: [],
    messages: [],
    notes: [],
    runLogs: [],
    workflowDrafts: [],
    speakingAgents: [],
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Discussion loop

const mergeUniqueIds = (...groups: string[][]) => [...new Set(groups.flat().filter(Boolean))];

function updateAfterSpeakers(session: RoundtableSession, speakers: RoundtableMember[]): void {
  const spoke = new Set(speakers.map((s) => s.agentId));
  session.lastSpeakerIds = speakers.map((s) => s.agentId);
  session.silenceRounds = Object.fromEntries(
    session.members.map((member) => [
      member.agentId,
      spoke.has(member.agentId) ? 0 : (session.silenceRounds[member.agentId] ?? 0) + 1,
    ])
  );
}

async function runSessionLoop(session: RoundtableSession): Promise<void> {
  if (session.loop) return session.loop;

  session.loop = (async () => {
    session.active = true;
    session.stopRequested = false;
    pushRunLog(session, 'Roundtable', 'running', 'Discussion started. Say "stop this topic" to stop.');

    try {
      while (session.active && !session.stopRequested && session.round < SESSION_MAX_ROUNDS) {
        if (session.members.length === 0) {
          pushRunLog(session, 'Roundtable', 'error', 'No members in the session; paused.');
          break;
        }

        const history = session.messages.filter((m) => m.senderId !== 'system');
        const latest = history[history.length - 1];
        const content = latest?.content ?? '';
        if (!content) break;

        session.pendingMentions = mergeUniqueIds(
          session.pendingMentions,
          detectMentions(content, session.members).map((m) => m.agentId)
        );

        let speakers = selectSpeakers(session, content, latest?.senderId);
        if (speakers.length === 0) {
          const fallback =
            session.members.find((m) => m.agentId !== latest?.senderId) ?? session.members[0];
          speakers = fallback ? [fallback] : [];
        }
        if (speakers.length === 0) break;

        const completed: RoundtableMember[] = [];
        for (const speaker of speakers) {
          if (!session.active || session.stopRequested) break;

          setSpeaking(session, speaker.name, true);
          pushRunLog(session, speaker.name, 'running', `${speaker.name} is typing`);

          try {
            const liveHistory = session.messages
              .filter((m) => m.senderId !== 'system')
              .slice(-8)
              .map((m) => ({ senderName: m.senderName, content: m.content }));
            const prompt = liveHistory[liveHistory.length - 1]?.content || content;

            const result = await executeRoundtableTurn(session.userId, {
              agentId: speaker.agentId,
              prompt,
              sessionTitle: session.title,
              topic: 'group discussion',
              members: session.members,
              messages: liveHistory,
              notes: session.notes.slice(-10).map((n) => ({
                column: n.column,
                text: n.text,
                authorName: n.authorName,
              })),
            });

            const reply = result.content.trim();
            if (session.stopRequested || !session.active) {
              pushRunLog(session, speaker.name, 'success', `${speaker.name} replied after the topic stopped; discarded.`);
              continue;
            }

            session.messages.push({
              id: makeId('msg'),
              senderId: result.agentId,
              senderName: result.agentName,
              content: reply || `${speaker.name} returned no content.`,
              sentAt: new Date().toISOString(),
            });
            session.messages = session.messages.slice(-MESSAGE_CAP);
            if (reply) {
              session.notes.push(buildNoteFromMessage(session, reply, result.agentName));
              session.notes = session.notes.slice(-NOTE_CAP);
            }
            completed.push(speaker);
            pushRunLog(session, speaker.name, 'success', `${speaker.name} replied.`);

            session.pendingMentions = mergeUniqueIds(
              session.pendingMentions,
              detectMentions(reply, session.members)
                .filter((m) => m.agentId !== speaker.agentId)
                .map((m) => m.agentId)
            );

            if (STOP_PHRASES.test(reply)) {
              session.stopRequested = true;
              break;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Agent turn failed';
            pushRunLog(session, speaker.name, 'error', `${speaker.name} failed: ${message}`);
          } finally {
            setSpeaking(session, speaker.name, false);
          }

          if (speakers.length > 1 && !session.stopRequested) {
            await wait(randomBetween(BETWEEN_SPEAKER_DELAY_MS));
          }
        }

        if (completed.length === 0) {
          session.stopRequested = true;
          pushRunLog(session, 'Roundtable', 'error', 'No agent replied successfully this round; paused.');
          break;
        }

        session.pendingMentions = session.pendingMentions.filter(
          (id) => !completed.some((speaker) => speaker.agentId === id)
        );
        updateAfterSpeakers(session, completed);
        session.round += 1;
        session.updatedAt = new Date().toISOString();

        if (!session.active || session.stopRequested) break;
        await wait(randomBetween(ROUND_DELAY_MS));
      }
    } finally {
      const reachedLimit = session.round >= SESSION_MAX_ROUNDS && !session.stopRequested;
      session.active = false;
      session.speakingAgents = [];
      session.pendingMentions = [];
      session.loop = undefined;
      session.updatedAt = new Date().toISOString();
      if (reachedLimit) {
        pushRunLog(session, 'Roundtable', 'success', 'Round limit reached; discussion paused.');
      }
    }
  })();

  return session.loop;
}

// ---------------------------------------------------------------------------
// Public API (routes call these)

export interface WakeInput {
  title?: string;
  userMessage: { content: string; senderName?: string };
  members: RoundtableMember[];
  messages?: RoundtableMessage[];
  notes?: WhiteboardNote[];
}

/**
 * Seeds/updates the session from the client snapshot, appends the user
 * message, and starts the discussion loop unless the message is a stop
 * phrase. Returns the current state; the client polls for updates.
 */
export function postSessionMessage(userId: string, sessionId: string, input: WakeInput): SessionState {
  const session = getOrCreateSession(userId, sessionId, input.title);
  session.members = input.members;
  session.silenceRounds = Object.fromEntries(
    session.members.map((member) => [member.agentId, session.silenceRounds[member.agentId] ?? 0])
  );
  mergeMessages(session, input.messages ?? []);
  mergeNotes(session, (input.notes ?? []).map((note, index) => normalizeNote(note, index)));

  const userMessage: RoundtableMessage = {
    id: makeId('msg'),
    senderId: 'user',
    senderName: input.userMessage.senderName?.trim() || 'You',
    content: input.userMessage.content.trim(),
    sentAt: new Date().toISOString(),
  };
  mergeMessages(session, [userMessage]);

  session.pendingMentions = mergeUniqueIds(
    session.pendingMentions,
    detectMentions(userMessage.content, session.members).map((m) => m.agentId)
  );
  session.updatedAt = new Date().toISOString();

  if (STOP_PHRASES.test(userMessage.content)) {
    session.stopRequested = true;
    session.active = false;
    session.speakingAgents = [];
    pushRunLog(session, 'Roundtable', 'success', 'Topic stopped.');
    return serializeSession(session);
  }

  if (session.members.length === 0) {
    pushRunLog(session, 'Roundtable', 'error', 'No members yet; invite agents first.');
    return serializeSession(session);
  }

  if (!session.loop) {
    session.round = 0;
    session.lastSpeakerIds = [];
    session.stopRequested = false;
    void runSessionLoop(session).catch((error) => {
      session.active = false;
      session.speakingAgents = [];
      session.loop = undefined;
      pushRunLog(
        session,
        'Roundtable',
        'error',
        error instanceof Error ? error.message : 'Discussion loop crashed'
      );
    });
  }

  return serializeSession(session);
}

function normalizeNote(raw: Partial<WhiteboardNote>, index: number): WhiteboardNote {
  const fallback = defaultNotePosition(index);
  const position = clampNotePosition(raw.x ?? fallback.x, raw.y ?? fallback.y);
  const createdAt = raw.createdAt || new Date().toISOString();
  return {
    id: raw.id || makeId('note'),
    column: WHITEBOARD_COLUMNS.includes(raw.column as WhiteboardColumn)
      ? (raw.column as WhiteboardColumn)
      : 'ideas',
    text: (raw.text ?? '').trim(),
    authorName: raw.authorName?.trim() || 'Roundtable',
    x: position.x,
    y: position.y,
    createdAt,
    updatedAt: raw.updatedAt || createdAt,
  };
}

export function getSessionState(userId: string, sessionId: string): SessionState {
  const session = sessions.get(sessionKey(userId, sessionId));
  return session ? serializeSession(session) : emptySessionState(sessionId);
}

export function stopSession(userId: string, sessionId: string): SessionState {
  const session = sessions.get(sessionKey(userId, sessionId));
  if (!session) return emptySessionState(sessionId);
  session.stopRequested = true;
  session.active = false;
  session.speakingAgents = [];
  pushRunLog(session, 'Roundtable', 'success', 'Topic stopped.');
  return serializeSession(session);
}

export function updateSessionNote(
  userId: string,
  sessionId: string,
  noteId: string,
  patch: { x?: number; y?: number; column?: WhiteboardColumn; text?: string }
): WhiteboardNote {
  const session = sessions.get(sessionKey(userId, sessionId));
  const note = session?.notes.find((n) => n.id === noteId);
  if (!session || !note) throw notFound('Whiteboard note not found');

  if (patch.x !== undefined || patch.y !== undefined) {
    const position = clampNotePosition(patch.x ?? note.x, patch.y ?? note.y);
    note.x = position.x;
    note.y = position.y;
  }
  if (patch.column && WHITEBOARD_COLUMNS.includes(patch.column)) note.column = patch.column;
  if (patch.text?.trim()) note.text = patch.text.trim();
  note.updatedAt = new Date().toISOString();
  session.updatedAt = note.updatedAt;
  return note;
}

// ---------------------------------------------------------------------------
// Workflow drafts: whiteboard consensus -> proposed DSL -> confirmed Team

function buildDraftPrompt(
  session: RoundtableSession,
  feedback?: string,
  previous?: WorkflowDraft
): string {
  const board = WHITEBOARD_COLUMNS.map((column) => {
    const lines = session.notes
      .filter((n) => n.column === column && n.text.trim())
      .map((n) => `- ${n.text} (${n.authorName})`);
    return lines.length > 0 ? `${column.toUpperCase()}:\n${lines.join('\n')}` : null;
  })
    .filter(Boolean)
    .join('\n');

  const members = session.members
    .map((m) => `- ${m.name}${m.role ? ` (${m.role})` : ''}`)
    .join('\n');

  const parts = [
    `Roundtable topic: ${session.title}`,
    'The whiteboard below is the converged consensus of a team discussion.',
    'Design a workflow that turns these notes into an executable multi-agent plan.',
    '',
    'Whiteboard:',
    board,
  ];
  if (members) {
    parts.push('', 'Discussion participants (prefer them as workflow agents):', members);
  }
  if (previous && feedback?.trim()) {
    parts.push(
      '',
      'Previous draft (JSON):',
      JSON.stringify(previous.workflow),
      '',
      'Revision feedback — apply these changes:',
      feedback.trim()
    );
  }
  return parts.join('\n');
}

export interface DraftRequest {
  title?: string;
  members?: RoundtableMember[];
  notes?: WhiteboardNote[];
  feedback?: string;
  previousDraftId?: string;
}

export async function generateSessionWorkflowDraft(
  userId: string,
  sessionId: string,
  input: DraftRequest
): Promise<{ draft: WorkflowDraft; state: SessionState }> {
  const session = getOrCreateSession(userId, sessionId, input.title);
  if (input.members?.length) session.members = input.members;
  mergeNotes(session, (input.notes ?? []).map((note, index) => normalizeNote(note, index)));

  const noteCount = session.notes.filter((n) => n.text.trim()).length;
  if (noteCount === 0) {
    throw badRequest('empty_whiteboard', 'Add whiteboard notes before generating a workflow draft.');
  }

  const previous = input.previousDraftId
    ? session.workflowDrafts.find((d) => d.id === input.previousDraftId)
    : undefined;
  if (input.previousDraftId && !previous) throw notFound('Previous draft not found');

  pushRunLog(session, 'Roundtable', 'running', 'Generating a workflow draft from the whiteboard…');
  const result = await generateWorkflow(userId, buildDraftPrompt(session, input.feedback, previous));

  const draft: WorkflowDraft = {
    id: makeId('draft'),
    workflow: result.workflow,
    generator: result.generator,
    warnings: result.warnings,
    revision: previous ? previous.revision + 1 : 1,
    feedback: input.feedback?.trim() || undefined,
    noteCount,
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
  if (previous?.status === 'proposed') previous.status = 'superseded';
  session.workflowDrafts = [...session.workflowDrafts, draft].slice(-DRAFT_CAP);

  const agentSteps = result.workflow.nodes.filter((n) => n.type === 'agent').length;
  mergeMessages(session, [
    {
      id: makeId('msg'),
      senderId: 'system',
      senderName: 'Roundtable',
      content: `Workflow draft v${draft.revision}: "${result.workflow.name}" — ${agentSteps} agent step(s) from ${noteCount} whiteboard note(s). Confirm it as a team or regenerate with feedback.`,
      sentAt: draft.createdAt,
      draftId: draft.id,
    },
  ]);
  pushRunLog(session, 'Roundtable', 'success', `Workflow draft v${draft.revision} ready (${draft.generator}).`);
  session.updatedAt = new Date().toISOString();
  return { draft, state: serializeSession(session) };
}

export async function confirmSessionWorkflowDraft(
  userId: string,
  sessionId: string,
  draftId: string,
  input: { name?: string; description?: string; teamId?: string }
): Promise<{ team: TeamView; state: SessionState }> {
  const session = sessions.get(sessionKey(userId, sessionId));
  const draft = session?.workflowDrafts.find((d) => d.id === draftId);
  if (!session || !draft) throw notFound('Workflow draft not found');
  if (draft.status === 'confirmed') {
    throw badRequest('draft_already_confirmed', 'This draft was already confirmed.');
  }

  const existing = input.teamId ? await getTeam(userId, input.teamId) : null;
  const version = existing ? (existing.workflow.metadata?.version ?? 1) + 1 : 1;
  const origin: WorkflowOrigin = {
    kind: 'roundtable',
    sessionId: session.sessionId,
    sessionTitle: session.title,
    revision: draft.revision,
    feedback: draft.feedback,
    notes: session.notes
      .filter((n) => n.text.trim())
      .map((n) => ({ column: n.column, text: n.text, authorName: n.authorName })),
    confirmedAt: new Date().toISOString(),
  };
  const workflow: WorkflowDsl = {
    ...draft.workflow,
    metadata: { ...draft.workflow.metadata, version, origin },
  };

  let team: TeamView;
  if (existing) {
    team = await saveWorkflow(userId, existing.id, workflow, { skipErrorCheck: true });
    const meta: { name?: string; description?: string } = {};
    if (input.name?.trim()) meta.name = input.name.trim();
    if (input.description?.trim()) meta.description = input.description.trim();
    if (Object.keys(meta).length > 0) team = await updateTeamMeta(userId, existing.id, meta);
  } else {
    team = await createTeam(userId, {
      name: input.name?.trim() || workflow.name || session.title,
      description: input.description?.trim() || workflow.description,
      workflow,
    });
  }

  draft.status = 'confirmed';
  draft.teamId = team.id;
  mergeMessages(session, [
    {
      id: makeId('msg'),
      senderId: 'system',
      senderName: 'Roundtable',
      content: `Workflow draft v${draft.revision} confirmed as team "${team.name}" (workflow v${version}).`,
      sentAt: new Date().toISOString(),
      draftId: draft.id,
    },
  ]);
  pushRunLog(session, 'Roundtable', 'success', `Team "${team.name}" saved (workflow v${version}).`);
  session.updatedAt = new Date().toISOString();
  return { team, state: serializeSession(session) };
}
