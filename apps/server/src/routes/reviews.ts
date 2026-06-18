import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { agents, issues, projects, submissions, reviews } from '../db/schema'
import { authHook } from '../middleware/auth'

const REVIEW_DECISIONS = ['approve', 'request_changes'] as const
type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

// Maps a review decision to the resulting submission status it drives.
const STATUS_BY_DECISION = {
    approve: 'approved',
    request_changes: 'changes_requested',
} as const

interface CreateSubmissionBody {
    content: string
    agentId?: string
}

interface CreateReviewBody {
    decision: ReviewDecision
    comment?: string
}

// Issues carry no userId — ownership is derived through the parent project.
async function findOwnedIssue(issueId: string, userId: string) {
    const [row] = await db
        .select({ id: issues.id })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(eq(issues.id, issueId), eq(projects.userId, userId)))
    return row
}

// Submissions inherit ownership through issue -> project.
async function findOwnedSubmission(submissionId: string, userId: string) {
    const [row] = await db
        .select({ submission: submissions })
        .from(submissions)
        .innerJoin(issues, eq(submissions.issueId, issues.id))
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(eq(submissions.id, submissionId), eq(projects.userId, userId)))
    return row?.submission
}

async function agentBelongsToUser(agentId: string, userId: string) {
    const [agent] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    return Boolean(agent)
}

export async function reviewRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    // --- Submissions (an agent's work for an issue) ---

    app.get<{ Params: { id: string } }>('/issues/:id/submissions', async (req, reply) => {
        if (!(await findOwnedIssue(req.params.id, req.userId!))) {
            return reply.code(404).send({ error: 'Issue not found' })
        }

        return db
            .select()
            .from(submissions)
            .where(eq(submissions.issueId, req.params.id))
            .orderBy(desc(submissions.createdAt))
    })

    app.post<{ Params: { id: string }; Body: CreateSubmissionBody }>(
        '/issues/:id/submissions',
        async (req, reply) => {
            const { content, agentId } = req.body
            if (!content?.trim()) {
                return reply.code(400).send({ error: 'Content is required' })
            }
            if (!(await findOwnedIssue(req.params.id, req.userId!))) {
                return reply.code(404).send({ error: 'Issue not found' })
            }
            if (agentId != null && !(await agentBelongsToUser(agentId, req.userId!))) {
                return reply.code(404).send({ error: 'Agent not found' })
            }

            const [submission] = await db
                .insert(submissions)
                .values({ issueId: req.params.id, content: content.trim(), agentId })
                .returning()

            return reply.code(201).send(submission)
        },
    )

    // --- Reviews (a user's verdict on a submission) ---

    app.get<{ Params: { id: string } }>('/submissions/:id/reviews', async (req, reply) => {
        if (!(await findOwnedSubmission(req.params.id, req.userId!))) {
            return reply.code(404).send({ error: 'Submission not found' })
        }

        return db
            .select()
            .from(reviews)
            .where(eq(reviews.submissionId, req.params.id))
            .orderBy(desc(reviews.createdAt))
    })

    app.post<{ Params: { id: string }; Body: CreateReviewBody }>(
        '/submissions/:id/reviews',
        async (req, reply) => {
            const { decision, comment } = req.body
            if (!REVIEW_DECISIONS.includes(decision)) {
                return reply.code(400).send({ error: `Decision must be one of: ${REVIEW_DECISIONS.join(', ')}` })
            }
            if (!(await findOwnedSubmission(req.params.id, req.userId!))) {
                return reply.code(404).send({ error: 'Submission not found' })
            }

            // Record the review and sync the submission's status in one transaction.
            const review = await db.transaction(async (tx) => {
                const [created] = await tx
                    .insert(reviews)
                    .values({ submissionId: req.params.id, userId: req.userId!, decision, comment })
                    .returning()

                await tx
                    .update(submissions)
                    .set({ status: STATUS_BY_DECISION[decision], updatedAt: new Date() })
                    .where(eq(submissions.id, req.params.id))

                return created
            })

            return reply.code(201).send(review)
        },
    )
}
