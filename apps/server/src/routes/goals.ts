import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { goals } from '../db/schema'
import { authHook } from '../middleware/auth'

const GOAL_STATUSES = ['active', 'completed', 'archived'] as const
type GoalStatus = (typeof GOAL_STATUSES)[number]

interface CreateGoalBody {
    title: string
    description?: string
}

interface UpdateGoalBody {
    title?: string
    description?: string | null
    status?: GoalStatus
}

export async function goalRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get('/', async (req) => {
        return db
            .select()
            .from(goals)
            .where(eq(goals.userId, req.userId!))
            .orderBy(desc(goals.createdAt))
    })

    app.post<{ Body: CreateGoalBody }>('/', async (req, reply) => {
        const { title, description } = req.body
        if (!title?.trim()) {
            return reply.code(400).send({ error: 'Title is required' })
        }

        const [goal] = await db
            .insert(goals)
            .values({ userId: req.userId!, title: title.trim(), description })
            .returning()

        return reply.code(201).send(goal)
    })

    app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [goal] = await db
            .select()
            .from(goals)
            .where(and(eq(goals.id, req.params.id), eq(goals.userId, req.userId!)))

        if (!goal) {
            return reply.code(404).send({ error: 'Goal not found' })
        }
        return goal
    })

    app.patch<{ Params: { id: string }; Body: UpdateGoalBody }>('/:id', async (req, reply) => {
        const { title, description, status } = req.body

        if (title !== undefined && !title.trim()) {
            return reply.code(400).send({ error: 'Title cannot be empty' })
        }
        if (status !== undefined && !GOAL_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${GOAL_STATUSES.join(', ')}` })
        }

        const [goal] = await db
            .update(goals)
            .set({
                ...(title !== undefined && { title: title.trim() }),
                ...(description !== undefined && { description }),
                ...(status !== undefined && { status }),
                updatedAt: new Date(),
            })
            .where(and(eq(goals.id, req.params.id), eq(goals.userId, req.userId!)))
            .returning()

        if (!goal) {
            return reply.code(404).send({ error: 'Goal not found' })
        }
        return goal
    })

    app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [goal] = await db
            .delete(goals)
            .where(and(eq(goals.id, req.params.id), eq(goals.userId, req.userId!)))
            .returning()

        if (!goal) {
            return reply.code(404).send({ error: 'Goal not found' })
        }
        return reply.code(204).send()
    })
}
