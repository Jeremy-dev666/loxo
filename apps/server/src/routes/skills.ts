import type { FastifyInstance } from 'fastify'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { skills, reviews, submissions, issues, projects } from '../db/schema'
import { authHook } from '../middleware/auth'

interface CreateSkillBody {
    title: string
    content: string
}

interface UpdateSkillBody {
    title?: string
    content?: string
}

interface DistillSkillBody {
    title: string
    // Optional override; defaults to the review's comment when omitted.
    content?: string
}

// Reviews carry a userId, but it identifies the reviewer, not the owner of the
// underlying work. Ownership is derived through the project, matching the rest
// of the domain.
async function findOwnedReview(reviewId: string, userId: string) {
    const [row] = await db
        .select({ review: reviews })
        .from(reviews)
        .innerJoin(submissions, eq(reviews.submissionId, submissions.id))
        .innerJoin(issues, eq(submissions.issueId, issues.id))
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(eq(reviews.id, reviewId), eq(projects.userId, userId)))
    return row?.review
}

export async function skillRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get('/skills', async (req) => {
        return db
            .select()
            .from(skills)
            .where(eq(skills.userId, req.userId!))
            .orderBy(desc(skills.createdAt))
    })

    app.post<{ Body: CreateSkillBody }>('/skills', async (req, reply) => {
        const { title, content } = req.body
        if (!title?.trim()) {
            return reply.code(400).send({ error: 'Title is required' })
        }
        if (!content?.trim()) {
            return reply.code(400).send({ error: 'Content is required' })
        }

        const [skill] = await db
            .insert(skills)
            .values({ userId: req.userId!, title: title.trim(), content: content.trim() })
            .returning()

        return reply.code(201).send(skill)
    })

    app.get<{ Params: { id: string } }>('/skills/:id', async (req, reply) => {
        const [skill] = await db
            .select()
            .from(skills)
            .where(and(eq(skills.id, req.params.id), eq(skills.userId, req.userId!)))

        if (!skill) {
            return reply.code(404).send({ error: 'Skill not found' })
        }
        return skill
    })

    app.patch<{ Params: { id: string }; Body: UpdateSkillBody }>('/skills/:id', async (req, reply) => {
        const { title, content } = req.body

        if (title !== undefined && !title.trim()) {
            return reply.code(400).send({ error: 'Title cannot be empty' })
        }
        if (content !== undefined && !content.trim()) {
            return reply.code(400).send({ error: 'Content cannot be empty' })
        }

        const [skill] = await db
            .update(skills)
            .set({
                ...(title !== undefined && { title: title.trim() }),
                ...(content !== undefined && { content: content.trim() }),
                updatedAt: new Date(),
            })
            .where(and(eq(skills.id, req.params.id), eq(skills.userId, req.userId!)))
            .returning()

        if (!skill) {
            return reply.code(404).send({ error: 'Skill not found' })
        }
        return skill
    })

    app.delete<{ Params: { id: string } }>('/skills/:id', async (req, reply) => {
        const [skill] = await db
            .delete(skills)
            .where(and(eq(skills.id, req.params.id), eq(skills.userId, req.userId!)))
            .returning()

        if (!skill) {
            return reply.code(404).send({ error: 'Skill not found' })
        }
        return reply.code(204).send()
    })

    // Distill a reusable skill from review feedback. Content defaults to the
    // review's comment, keeping a link back to the source review.
    app.post<{ Params: { id: string }; Body: DistillSkillBody }>(
        '/reviews/:id/skills',
        async (req, reply) => {
            const { title, content } = req.body
            if (!title?.trim()) {
                return reply.code(400).send({ error: 'Title is required' })
            }

            const review = await findOwnedReview(req.params.id, req.userId!)
            if (!review) {
                return reply.code(404).send({ error: 'Review not found' })
            }

            const body = content?.trim() || review.comment?.trim()
            if (!body) {
                return reply
                    .code(400)
                    .send({ error: 'Content is required (review has no comment to distill)' })
            }

            const [skill] = await db
                .insert(skills)
                .values({
                    userId: req.userId!,
                    sourceReviewId: review.id,
                    title: title.trim(),
                    content: body,
                })
                .returning()

            return reply.code(201).send(skill)
        },
    )
}
