import { pgTable, pgEnum, uuid, varchar, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    userName: varchar('user_name', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const goalStatusEnum = pgEnum('goal_status', ['active', 'completed', 'archived'])

export const goals = pgTable('goals', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: goalStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const projectStatusEnum = pgEnum('project_status', ['active', 'completed', 'archived'])

export const projects = pgTable('projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    // A project may exist without a goal; deleting a goal detaches its projects.
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: projectStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const agentStatusEnum = pgEnum('agent_status', ['active', 'inactive'])

export const agents = pgTable('agents', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    role: varchar('role', { length: 255 }).notNull(),
    systemPrompt: text('system_prompt'),
    model: varchar('model', { length: 100 }).notNull().default('claude-opus-4-8'),
    status: agentStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const issueStatusEnum = pgEnum('issue_status', ['todo', 'in_progress', 'in_review', 'done'])

export const issuePriorityEnum = pgEnum('issue_priority', ['low', 'medium', 'high'])

export const issues = pgTable('issues', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .notNull()
        .references(() => projects.id, { onDelete: 'cascade' }),
    // A user-level agent assigned to this issue; detached if the agent is deleted.
    assigneeAgentId: uuid('assignee_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: issueStatusEnum('status').default('todo').notNull(),
    priority: issuePriorityEnum('priority').default('medium').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const submissionStatusEnum = pgEnum('submission_status', [
    'pending',
    'approved',
    'changes_requested',
])

// An agent's submitted work for an issue. Multiple submissions form the review history.
export const submissions = pgTable('submissions', {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
        .notNull()
        .references(() => issues.id, { onDelete: 'cascade' }),
    // The submitting agent; detached (not deleted) if the agent is removed.
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    status: submissionStatusEnum('status').default('pending').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const reviewDecisionEnum = pgEnum('review_decision', ['approve', 'request_changes'])

// A user's review of a submission. Its decision drives the submission's status.
export const reviews = pgTable('reviews', {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
        .notNull()
        .references(() => submissions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    decision: reviewDecisionEnum('decision').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

// A reusable skill distilled from review feedback. Owned at the user level so it
// can be reused across any of the user's agents.
export const skills = pgTable('skills', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    // The review this skill was distilled from; detached (not deleted) if the review goes away.
    sourceReviewId: uuid('source_review_id').references(() => reviews.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const channelTypeEnum = pgEnum('channel_type', ['dm', 'project', 'issue'])

// A messaging channel. Owned at the user level so ownership checks stay uniform
// with the rest of the domain. The target columns are populated per type:
//   dm      -> agentId (a 1:1 conversation with one of the user's agents)
//   project -> projectId (a project room)
//   issue   -> issueId (a comment thread on an issue)
export const channels = pgTable('channels', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    type: channelTypeEnum('type').notNull(),
    // The agent on the other side of a dm; detached if the agent is deleted.
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const messageSenderTypeEnum = pgEnum('message_sender_type', ['user', 'agent', 'system'])

// A message in a channel. senderId is a bare uuid disambiguated by senderType
// (it points at users or agents); system messages have no sender.
export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
        .notNull()
        .references(() => channels.id, { onDelete: 'cascade' }),
    senderType: messageSenderTypeEnum('sender_type').notNull(),
    senderId: uuid('sender_id'),
    content: text('content').notNull(),
    // Optional threaded reply; detached if the parent message is removed.
    replyTo: uuid('reply_to').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})
