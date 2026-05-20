import { pgTable, uuid, varchar, text, timestamp, real, jsonb, integer } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    userName: varchar('user_name', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const agents = pgTable('agents', {
    id: uuid('id').primaryKey().defaultRandom(),
    role: varchar('role', { length: 50 }).notNull().unique(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    description: text('description').notNull(),
    avatar: varchar('avatar', { length: 255 }),
    systemPrompt: text('system_prompt').notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    temperature: real('temperature').default(0.7),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
})

export const conversations = pgTable('conversations', {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }),
    type: varchar('type', { length: 20 }).notNull(),                                          // directed | group
    status: varchar('status', { length: 20 }).default('active'),                              // active | archived
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
})

export const conversationParticipants = pgTable('conversation_participants', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
    participantId: uuid('participant_id').notNull(),                                          // user.id | agent.id
    participantType: varchar('participant_type', { length: 10 }).notNull(),                   // 'user' | 'agent'
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
    senderId: uuid('sender_id').notNull(),                                                    // user.id | agent.id
    senderType: varchar('sender_type', { length: 10 }).notNull(),                             // 'user' | 'agent' | 'system'
    messageType: varchar('message_type', { length: 20 }).notNull(),                           // 'text' | 'code' | 'artifact'
    content: text('content').notNull(),
    metadata: jsonb('metadata').default({}),                                                  
    sequenceNumber: integer('sequence_number').notNull(),                                     // message sequence
    createdAt: timestamp('created_at').defaultNow().notNull(),
});