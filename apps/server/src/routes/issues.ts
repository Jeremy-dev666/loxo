import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { agents, issues, projects } from '../db/schema'
import { authHook } from '../middleware/auth'

const ISSUE_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
type IssueStatus = (typeof ISSUE_STATUSES)[number]

const ISSUE_PRIORITIES = ['low', 'medium', 'high'] as const
type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

interface CreateIssueBody {
    projectId: string
    title: string
    description?: string
    priority?: IssuePriority
    assigneeAgentId?: string | null
}

interface UpdateIssueBody {
    title?: string
    description?: string | null
    status?: IssueStatus
    priority?: IssuePriority
    assigneeAgentId?: string | null
}

async function projectBelongsToUser(projectId: string, userId: string) {
    const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    return Boolean(project)
}

async function agentBelongsToUser(agentId: string, userId: string) {
    const [agent] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    return Boolean(agent)
}

// Issues have no userId column — ownership is derived from the parent project.
async function findOwnedIssue(issueId: string, userId: string) {
    const [row] = await db
        .select({ issue: issues })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(eq(issues.id, issueId), eq(projects.userId, userId)))
    return row?.issue
}

export async function issueRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get<{ Querystring: { projectId?: string; status?: IssueStatus } }>('/', async (req, reply) => {
        const { projectId, status } = req.query
        if (status !== undefined && !ISSUE_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${ISSUE_STATUSES.join(', ')}` })
        }

        const conditions = [eq(projects.userId, req.userId!)]
        if (projectId) {
            conditions.push(eq(issues.projectId, projectId))
        }
        if (status) {
            conditions.push(eq(issues.status, status))
        }

        const rows = await db
            .select({ issue: issues })
            .from(issues)
            .innerJoin(projects, eq(issues.projectId, projects.id))
            .where(and(...conditions))
            .orderBy(desc(issues.createdAt))

        return rows.map((row) => row.issue)
    })

    app.post<{ Body: CreateIssueBody }>('/', async (req, reply) => {
        const { projectId, title, description, priority, assigneeAgentId } = req.body
        if (!title?.trim()) {
            return reply.code(400).send({ error: 'Title is required' })
        }
        if (!projectId) {
            return reply.code(400).send({ error: 'projectId is required' })
        }
        if (priority !== undefined && !ISSUE_PRIORITIES.includes(priority)) {
            return reply.code(400).send({ error: `Priority must be one of: ${ISSUE_PRIORITIES.join(', ')}` })
        }
        if (!(await projectBelongsToUser(projectId, req.userId!))) {
            return reply.code(404).send({ error: 'Project not found' })
        }
        if (assigneeAgentId != null && !(await agentBelongsToUser(assigneeAgentId, req.userId!))) {
            return reply.code(404).send({ error: 'Agent not found' })
        }

        const [issue] = await db
            .insert(issues)
            .values({ projectId, title: title.trim(), description, priority, assigneeAgentId })
            .returning()

        return reply.code(201).send(issue)
    })

    app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const issue = await findOwnedIssue(req.params.id, req.userId!)
        if (!issue) {
            return reply.code(404).send({ error: 'Issue not found' })
        }
        return issue
    })

    app.patch<{ Params: { id: string }; Body: UpdateIssueBody }>('/:id', async (req, reply) => {
        const { title, description, status, priority, assigneeAgentId } = req.body

        if (title !== undefined && !title.trim()) {
            return reply.code(400).send({ error: 'Title cannot be empty' })
        }
        if (status !== undefined && !ISSUE_STATUSES.includes(status)) {
            return reply.code(400).send({ error: `Status must be one of: ${ISSUE_STATUSES.join(', ')}` })
        }
        if (priority !== undefined && !ISSUE_PRIORITIES.includes(priority)) {
            return reply.code(400).send({ error: `Priority must be one of: ${ISSUE_PRIORITIES.join(', ')}` })
        }
        if (assigneeAgentId != null && !(await agentBelongsToUser(assigneeAgentId, req.userId!))) {
            return reply.code(404).send({ error: 'Agent not found' })
        }

        const existing = await findOwnedIssue(req.params.id, req.userId!)
        if (!existing) {
            return reply.code(404).send({ error: 'Issue not found' })
        }

        const [issue] = await db
            .update(issues)
            .set({
                ...(title !== undefined && { title: title.trim() }),
                ...(description !== undefined && { description }),
                ...(status !== undefined && { status }),
                ...(priority !== undefined && { priority }),
                ...(assigneeAgentId !== undefined && { assigneeAgentId }),
                updatedAt: new Date(),
            })
            .where(eq(issues.id, req.params.id))
            .returning()

        return issue
    })

    app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
        const existing = await findOwnedIssue(req.params.id, req.userId!)
        if (!existing) {
            return reply.code(404).send({ error: 'Issue not found' })
        }

        await db.delete(issues).where(eq(issues.id, req.params.id))
        return reply.code(204).send()
    })
}
