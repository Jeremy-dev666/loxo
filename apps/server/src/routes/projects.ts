import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { goals, projects } from '../db/schema'
import { authHook } from '../middleware/auth'

const PROJECT_STATUSES = ['active', 'completed', 'archived'] as const
type ProjectStatus = (typeof PROJECT_STATUSES)[number]

interface CreateProjectBody {
    name: string
    description?: string
    goalId?: string
}

interface UpdateProjectBody {
    name?: string
    description?: string | null
    goalId?: string | null
    status?: ProjectStatus
}

async function goalBelongsToUser(goalId: string, userId: string) {
    const [goal] = await db
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    return Boolean(goal)
}

export async function projectRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get<{ Querystring: { goalId?: string } }>('/', async (req) => {
        const conditions = [eq(projects.userId, req.userId!)]
        if (req.query.goalId) {
            conditions.push(eq(projects.goalId, req.query.goalId))
        }

        return db
            .select()
            .from(projects)
            .where(and(...conditions))
            .orderBy(desc(projects.createdAt))
    })

    app.post<{ Body: CreateProjectBody }>('/', async (req, reply) => {
        const { name, description, goalId } = req.body
        if (!name?.trim()) {
            return reply.code(400).send({ error: 'Name is required' })
        }
        if (goalId && !(await goalBelongsToUser(goalId, req.userId!))) {
            return reply.code(404).send({ error: 'Goal not found' })
        }

        const [project] = await db
            .insert(projects)
            .values({ userId: req.userId!, name: name.trim(), description, goalId })
            .returning()

        return reply.code(201).send(project)
    })

    app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [project] = await db
            .select()
            .from(projects)
            .where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)))

        if (!project) {
            return reply.code(404).send({ error: 'Project not found' })
        }
        return project
    })

    app.patch<{ Params: { id: string }; Body: UpdateProjectBody }>('/:id', async (req, reply) => {
        const { name, description, goalId, status } = req.body

        if (name !== undefined && !name.trim()) {
            return reply.code(400).send({ error: 'Name cannot be empty' })
        }
        if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${PROJECT_STATUSES.join(', ')}` })
        }
        if (goalId != null && !(await goalBelongsToUser(goalId, req.userId!))) {
            return reply.code(404).send({ error: 'Goal not found' })
        }

        const [project] = await db
            .update(projects)
            .set({
                ...(name !== undefined && { name: name.trim() }),
                ...(description !== undefined && { description }),
                ...(goalId !== undefined && { goalId }),
                ...(status !== undefined && { status }),
                updatedAt: new Date(),
            })
            .where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)))
            .returning()

        if (!project) {
            return reply.code(404).send({ error: 'Project not found' })
        }
        return project
    })

    app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [project] = await db
            .delete(projects)
            .where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)))
            .returning()

        if (!project) {
            return reply.code(404).send({ error: 'Project not found' })
        }
        return reply.code(204).send()
    })
}
