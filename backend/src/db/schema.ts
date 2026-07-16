import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { RuntimeProbe } from '@swarmdev/shared';
import type { WorkflowDsl } from '../modules/teams/workflow-dsl';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Monotonic per-user issue number source; incremented inside the create-issue transaction. */
  issueCounter: integer('issue_counter').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;

/**
 * Model provider credentials, scoped per user. `apiKeyEncrypted` holds an
 * AES-256-GCM envelope, never plaintext.
 */
export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  vendor: text('vendor').notNull(), // anthropic | openai | openclaw | hermes
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  baseUrl: text('base_url'),
  models: jsonb('models').$type<string[]>().notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Provider = typeof providers.$inferSelect;

export const agentGroups = pgTable('agent_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#38bdf8'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AgentGroup = typeof agentGroups.$inferSelect;

/** Optional packaging metadata read from agent.json at import time. */
export interface AgentManifest {
  name?: string;
  version?: string;
  description?: string;
  capabilities?: string[];
  /** API-hosted agents: protocol and defaults recorded at deploy time. */
  api?: {
    protocol?: 'openai' | 'anthropic';
    model?: string;
    systemPrompt?: string;
    catalogId?: string;
  };
  /** Team-template provenance; drives duplicate detection at adopt time. */
  template?: {
    id?: string;
    roleCode?: string;
  };
}

/**
 * Workspace/baseline/state paths are derived from (userId, agentId) via the
 * storage layout and intentionally not stored.
 */
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  runtime: text('runtime').notNull(), // claude-code | codex | opencode | hermes | openclaw | api
  manifest: jsonb('manifest').$type<AgentManifest>().notNull().default({}),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  groupId: uuid('group_id').references(() => agentGroups.id, { onDelete: 'set null' }),
  providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: text('model'),
  avatarFile: text('avatar_file'),
  sourceListingId: uuid('source_listing_id').references((): AnyPgColumn => marketListings.id, {
    onDelete: 'set null',
  }),
  status: text('status').notNull().default('idle'), // idle | busy | error | offline
  /** Where turns execute: on this server, via provider API, or on a paired machine. */
  execution: text('execution').notNull().default('server'), // server | api | machine
  machineId: uuid('machine_id').references((): AnyPgColumn => machines.id, {
    onDelete: 'set null',
  }),
  machineWorkdir: text('machine_workdir'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New conversation'),
  /** CLI-side session id (e.g. claude-code --resume); cleared on provider/model change. */
  runnerSessionRef: text('runner_session_ref'),
  lastMessagePreview: text('last_message_preview').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;

export interface MessageMeta {
  runtime?: string;
  durationMs?: number;
  error?: boolean;
  source?: string;
}

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  meta: jsonb('meta').$type<MessageMeta>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Message = typeof messages.$inferSelect;

/**
 * Team row is an index; the canvas graph and workflow DSL live in a JSON
 * manifest file under the user's storage (deliberate design: complex graph
 * structures stay out of the relational schema).
 */
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Team = typeof teams.$inferSelect;

/**
 * Project workspace: a durable directory agents collaborate in, bound to
 * teams/agents via join tables (deliberate deviation from JSON-array
 * columns). `updatedAt` is the recency key maintained by touchProject.
 */
export type ProjectKind = 'normal' | 'default';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** 'default' marks the per-user fallback project; created lazily, cannot be deleted. */
    kind: text('kind').$type<ProjectKind>().notNull().default('normal'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one default project per user; makes lazy creation race-safe.
    uniqueIndex('projects_user_default')
      .on(t.userId)
      .where(sql`${t.kind} = 'default'`),
  ]
);

export type Project = typeof projects.$inferSelect;

export const projectTeams = pgTable(
  'project_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_teams_project_team').on(t.projectId, t.teamId)]
);

export type ProjectTeam = typeof projectTeams.$inferSelect;

export const projectAgents = pgTable(
  'project_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_agents_project_agent').on(t.projectId, t.agentId)]
);

export type ProjectAgent = typeof projectAgents.$inferSelect;

export type WorkflowExecutionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type WorkflowNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

/**
 * Primary execution record. The DSL is snapshotted at start so history stays
 * readable after the team manifest changes.
 */
export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  task: text('task').notNull(),
  status: text('status').$type<WorkflowExecutionStatus>().notNull().default('queued'),
  mode: text('mode').notNull(), // dag | state-machine
  dryRun: boolean('dry_run').notNull().default(false),
  workflow: jsonb('workflow').$type<WorkflowDsl>().notNull(),
  finalOutput: text('final_output'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowExecution = typeof workflowExecutions.$inferSelect;

export const workflowNodeStates = pgTable(
  'workflow_node_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    status: text('status').$type<WorkflowNodeStatus>().notNull().default('pending'),
    runCount: integer('run_count').notNull().default(0),
    output: text('output').notNull().default(''),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('workflow_node_states_execution_node').on(t.executionId, t.nodeId)]
);

export type WorkflowNodeState = typeof workflowNodeStates.$inferSelect;

/** Append-only event log; `seq` is assigned by the executor per execution. */
export const workflowEvents = pgTable(
  'workflow_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    nodeId: text('node_id'),
    message: text('message').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workflow_events_execution_seq').on(t.executionId, t.seq)]
);

export type WorkflowEvent = typeof workflowEvents.$inferSelect;

/** Files a node produced: workspace diffs and the per-run node-output log. */
export const workflowArtifacts = pgTable('workflow_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  runCount: integer('run_count').notNull().default(1),
  kind: text('kind').notNull(), // workspace-file | node-output
  label: text('label').notNull().default(''), // created | updated | output
  path: text('path').notNull(), // relative to the run root
  size: integer('size').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowArtifact = typeof workflowArtifacts.$inferSelect;

export type DeliverableStatus = 'pending' | 'accepted' | 'revision' | 'superseded';

/**
 * Reviewable file a project workflow produced. Registering a new deliverable
 * for the same project+path supersedes the previous pending one.
 */
export const deliverables = pgTable('deliverables', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  filePath: text('file_path').notNull(),
  status: text('status').$type<DeliverableStatus>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

export type Deliverable = typeof deliverables.$inferSelect;

export type MemoScope = 'agent' | 'team' | 'project';
export type MemoSource = 'retro' | 'review';

/**
 * Distilled learning from a workflow run or a deliverable review, scoped to
 * the agent/team/project it belongs to. subjectId is polymorphic (no FK);
 * rows are pruned with their owner via the users cascade.
 */
export const memos = pgTable('memos', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').$type<MemoScope>().notNull(),
  subjectId: uuid('subject_id').notNull(),
  source: text('source').$type<MemoSource>().notNull(),
  content: text('content').notNull(),
  executionId: uuid('execution_id').references(() => workflowExecutions.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Memo = typeof memos.$inferSelect;

export type MarketVisibility = 'public' | 'unlisted' | 'private';
export type MarketListingStatus = 'active' | 'disabled';

/**
 * Marketplace listing. Files live under
 * marketplace/agents/<listingId>/versions/<version>/source in storage.
 * `sourceAgentId` is the provenance link that blocks duplicate publishes of
 * the same agent; it survives as null if the source agent is deleted.
 */
export const marketListings = pgTable('market_listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sourceAgentId: uuid('source_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Runtime a downloaded clone is created with. */
  runtime: text('runtime').notNull(),
  latestVersion: text('latest_version').notNull().default('1.0.0'),
  visibility: text('visibility').$type<MarketVisibility>().notNull().default('public'),
  status: text('status').$type<MarketListingStatus>().notNull().default('active'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  /** Original avatar reference (data: URL, /api path, or http URL) used to (re)fill the cache. */
  avatarSource: text('avatar_source').notNull().default(''),
  isOfficial: boolean('is_official').notNull().default(false),
  downloadCount: integer('download_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MarketListing = typeof marketListings.$inferSelect;

export const marketListingVersions = pgTable(
  'market_listing_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => marketListings.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    checksum: text('checksum').notNull().default(''),
    changelog: text('changelog').notNull().default(''),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('market_listing_versions_listing_version').on(t.listingId, t.version)]
);

export type MarketListingVersion = typeof marketListingVersions.$inferSelect;

export type PostAuthorType = 'user' | 'agent';

/**
 * Community post. `userId` is the owning account and is always server-derived;
 * `authorType`+`authorAgentId` say which persona it was posted as. Author
 * name is snapshotted so posts survive agent deletion/renames.
 */
export const communityPosts = pgTable('community_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  authorType: text('author_type').$type<PostAuthorType>().notNull().default('user'),
  authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  likeCount: integer('like_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityPost = typeof communityPosts.$inferSelect;

/** Two levels only: a comment either is top-level or replies to a top-level comment. */
export const communityComments = pgTable('community_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => communityPosts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  authorType: text('author_type').$type<PostAuthorType>().notNull().default('user'),
  authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  parentCommentId: uuid('parent_comment_id'),
  likeCount: integer('like_count').notNull().default(0),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityComment = typeof communityComments.$inferSelect;

export const communityLikes = pgTable(
  'community_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(), // post | comment
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('community_likes_user_target').on(t.userId, t.targetType, t.targetId)]
);

export type CommunityLike = typeof communityLikes.$inferSelect;

/**
 * Follows are user→agent only (a deliberate simplification of the dual
 * follower/following subject model): the follower is always the signed-in
 * account, so the "following" feed is unambiguous.
 */
export const communityFollows = pgTable(
  'community_follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('community_follows_user_agent').on(t.userId, t.agentId)]
);

export type CommunityFollow = typeof communityFollows.$inferSelect;

export type SlackIntegrationScope = 'agent' | 'team';

/**
 * Slack Events API binding for an agent or team. Bot token and signing
 * secret are AES-256-GCM envelopes, never plaintext. `subjectId` is an agent
 * or team id depending on scope, so it carries no FK; the owning module
 * removes rows when the subject is deleted.
 */
export const slackIntegrations = pgTable(
  'slack_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<SlackIntegrationScope>().notNull(),
    subjectId: uuid('subject_id').notNull(),
    botTokenEncrypted: text('bot_token_encrypted').notNull(),
    signingSecretEncrypted: text('signing_secret_encrypted').notNull(),
    /** Optional filter: only handle events from this Slack channel. */
    channelId: text('channel_id'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('slack_integrations_scope_subject').on(t.scope, t.subjectId)]
);

export type SlackIntegration = typeof slackIntegrations.$inferSelect;

/**
 * Maps a Slack (subject, channel, sender) session key to the conversation it
 * reuses, so a Slack thread keeps one chat history per sender.
 */
export const slackConversationLinks = pgTable(
  'slack_conversation_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionKey: text('session_key').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('slack_conversation_links_session_key').on(t.sessionKey)]
);

export type SlackConversationLink = typeof slackConversationLinks.$inferSelect;

/** Synced from the manifest on save; answers "which teams use this agent". */
export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TeamMember = typeof teamMembers.$inferSelect;

/**
 * Paired daemon hosts that execute machine-bound agents. `tokenHash` is the
 * SHA-256 of the machine token; the plaintext is shown once at pairing.
 */
export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform'),
  hostname: text('hostname'),
  tokenHash: text('token_hash').notNull().unique(),
  /** Last runtime probe reported by the daemon on connect. */
  runtimes: jsonb('runtimes').$type<RuntimeProbe[]>().notNull().default([]),
  /** AES-256-GCM envelope of a JSON env-var map injected into runtime processes. */
  envEncrypted: text('env_encrypted'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Machine = typeof machines.$inferSelect;

export type GoalStatus = 'active' | 'achieved' | 'archived';

/**
 * The "why" axis of work. Goals form an optional hierarchy via parentGoalId;
 * issues attach to a goal independently of their project (two parallel axes).
 */
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<GoalStatus>().notNull().default('active'),
  parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Goal = typeof goals.$inferSelect;

export type IssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

/**
 * Unit of work. Status transitions are enforced by a static transition table
 * in the issues service, never by direct writes. Assignee and reviewer are
 * each a single principal: agent or user, checked at the database level.
 * issueNumber is unique per user and drawn from users.issueCounter.
 */
export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    issueNumber: integer('issue_number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<IssueStatus>().notNull().default('backlog'),
    assigneeAgentId: uuid('assignee_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewerAgentId: uuid('reviewer_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Position within a kanban column; fractional values allow reorder without renumbering. */
    boardOrder: doublePrecision('board_order').notNull().default(0),
    /**
     * Execution lock: the run currently working this issue. Wake admission
     * acquires it with a conditional UPDATE, so the same issue is never
     * executed by two runs at once regardless of trigger source.
     */
    activeRunId: uuid('active_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('issues_user_number').on(t.userId, t.issueNumber),
    index('issues_user_status').on(t.userId, t.status),
    index('issues_project_status').on(t.projectId, t.status),
    index('issues_assignee_agent').on(t.assigneeAgentId, t.status),
    check(
      'issues_assignee_single_principal',
      sql`NOT (${t.assigneeAgentId} IS NOT NULL AND ${t.assigneeUserId} IS NOT NULL)`
    ),
    check(
      'issues_reviewer_single_principal',
      sql`NOT (${t.reviewerAgentId} IS NOT NULL AND ${t.reviewerUserId} IS NOT NULL)`
    ),
  ]
);

export type Issue = typeof issues.$inferSelect;

export type IssueCommentAuthorType = 'human' | 'agent';

/**
 * Issue activity timeline. Author columns mirror the dual-principal pattern;
 * rows are pruned with their issue, author links survive as null for display.
 */
export const issueComments = pgTable(
  'issue_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorType: text('author_type').$type<IssueCommentAuthorType>().notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_comments_issue_created').on(t.issueId, t.createdAt)]
);

export type IssueComment = typeof issueComments.$inferSelect;

export type RunTrigger = 'assignment' | 'manual' | 'comment' | 'chat' | 'workflow' | 'review';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * One admitted wake-up of an agent. Every trigger source funnels through the
 * wake admission service, which creates exactly one row per admitted wake-up.
 * Queued rows double as the wait queue for an issue's execution lock and are
 * promoted oldest-first when the lock releases.
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Display snapshot; run history survives agent deletion. */
    agentName: text('agent_name').notNull(),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
    trigger: text('trigger').$type<RunTrigger>().notNull(),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    /** Why the agent was woken; rendered into the turn prompt. */
    reason: text('reason').notNull().default(''),
    output: text('output').notNull().default(''),
    error: text('error'),
    sessionRef: text('session_ref'),
    model: text('model'),
    /** Usage accounting; populated by lanes that report it. */
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('runs_issue_status').on(t.issueId, t.status),
    index('runs_agent_status').on(t.agentId, t.status),
    index('runs_user_created').on(t.userId, t.createdAt),
  ]
);

export type Run = typeof runs.$inferSelect;

export type ReviewDecision = 'approved' | 'changes_requested';

/**
 * Structured verdict on an issue in review. Every decision carries a body;
 * the body is also posted to the issue timeline so the assignee's next run
 * reads the feedback naturally. Reviewer mirrors the dual-principal pattern.
 */
export const issueReviews = pgTable(
  'issue_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    reviewerType: text('reviewer_type').$type<'human' | 'agent'>().notNull(),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerAgentId: uuid('reviewer_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    /** Review run that produced this verdict, when an agent reviewed. */
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    decision: text('decision').$type<ReviewDecision>().notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('issue_reviews_issue_created').on(t.issueId, t.createdAt),
    check(
      'issue_reviews_single_principal',
      sql`NOT (${t.reviewerAgentId} IS NOT NULL AND ${t.reviewerUserId} IS NOT NULL)`
    ),
  ]
);

export type IssueReview = typeof issueReviews.$inferSelect;
