import type { FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
    interface FastifyRequest {
        userId?: string
    }
}

export async function authHook(req: FastifyRequest, reply: FastifyReply) {
    try {
        const decoded = await req.jwtVerify<{ userId: string }>()
        req.userId = decoded.userId
    } catch {
        reply.code(401).send({ error: 'Invalid or expired token' })
    }
}
