import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { agents } from '../db/schema'
import { authHook } from '../middleware/auth'

const AGENT_STATUSES = ['active', 'inactive'] as const
type AgentStatus = (typeof AGENT_STATUSES)[number]

interface CreateAgentBody {
    name: string
    role: string
    systemPrompt?: string
    model?: string
}

interface UpdateAgentBody {
    name?: string
    role?: string
    systemPrompt?: string | null
    model?: string
    status?: AgentStatus
}

export async function agentRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get<{ Querystring: { status?: AgentStatus } }>('/', async (req, reply) => {
        const { status } = req.query
        if (status !== undefined && !AGENT_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${AGENT_STATUSES.join(', ')}` })
        }

        const conditions = [eq(agents.userId, req.userId!)]
        if (status) {
            conditions.push(eq(agents.status, status))
        }

        return db
            .select()
            .from(agents)
            .where(and(...conditions))
            .orderBy(desc(agents.createdAt))
    })

    app.post<{ Body: CreateAgentBody }>('/', async (req, reply) => {
        const { name, role, systemPrompt, model } = req.body
        if (!name?.trim()) {
            return reply.code(400).send({ error: 'Name is required' })
        }
        if (!role?.trim()) {
            return reply.code(400).send({ error: 'Role is required' })
        }

        const [agent] = await db
            .insert(agents)
            .values({
                userId: req.userId!,
                name: name.trim(),
                role: role.trim(),
                systemPrompt,
                ...(model?.trim() && { model: model.trim() }),
            })
            .returning()

        return reply.code(201).send(agent)
    })

    app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [agent] = await db
            .select()
            .from(agents)
            .where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)))

        if (!agent) {
            return reply.code(404).send({ error: 'Agent not found' })
        }
        return agent
    })

    app.patch<{ Params: { id: string }; Body: UpdateAgentBody }>('/:id', async (req, reply) => {
        const { name, role, systemPrompt, model, status } = req.body

        if (name !== undefined && !name.trim()) {
            return reply.code(400).send({ error: 'Name cannot be empty' })
        }
        if (role !== undefined && !role.trim()) {
            return reply.code(400).send({ error: 'Role cannot be empty' })
        }
        if (model !== undefined && !model.trim()) {
            return reply.code(400).send({ error: 'Model cannot be empty' })
        }
        if (status !== undefined && !AGENT_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${AGENT_STATUSES.join(', ')}` })
        }

        const [agent] = await db
            .update(agents)
            .set({
                ...(name !== undefined && { name: name.trim() }),
                ...(role !== undefined && { role: role.trim() }),
                ...(systemPrompt !== undefined && { systemPrompt }),
                ...(model !== undefined && { model: model.trim() }),
                ...(status !== undefined && { status }),
                updatedAt: new Date(),
            })
            .where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)))
            .returning()

        if (!agent) {
            return reply.code(404).send({ error: 'Agent not found' })
        }
        return agent
    })

    app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const [agent] = await db
            .delete(agents)
            .where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)))
            .returning()

        if (!agent) {
            return reply.code(404).send({ error: 'Agent not found' })
        }
        return reply.code(204).send()
    })
}
