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

export const issueStatusEnum = pgEnum('issue_status', ['todo', 'in_progress', 'in_review', 'done'])

export const issuePriorityEnum = pgEnum('issue_priority', ['low', 'medium', 'high'])

export const issues = pgTable('issues', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .notNull()
        .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: issueStatusEnum('status').default('todo').notNull(),
    priority: issuePriorityEnum('priority').default('medium').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
