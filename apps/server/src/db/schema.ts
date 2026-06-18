import { pgTable, pgEnum, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'

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
