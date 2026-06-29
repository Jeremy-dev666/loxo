import type { FastifyInstance } from 'fastify'
import { and, eq, asc, desc } from 'drizzle-orm'
import { db } from '../db'
import { channels, messages } from '../db/schema'
import { authHook } from '../middleware/auth'

const CHANNEL_TYPES = ['dm', 'project', 'issue'] as const
type ChannelType = (typeof CHANNEL_TYPES)[number]

// Channels carry a userId, so ownership is a direct column check.
async function findOwnedChannel(channelId: string, userId: string) {
    const [channel] = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, channelId), eq(channels.userId, userId)))
    return channel
}

export async function channelRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authHook)

    app.get<{ Querystring: { type?: ChannelType } }>('/channels', async (req, reply) => {
        const { type } = req.query
        if (type !== undefined && !CHANNEL_TYPES.includes(type)) {
            return reply.code(400).send({ error: 'Invalid channel type' })
        }

        const where = type
            ? and(eq(channels.userId, req.userId!), eq(channels.type, type))
            : eq(channels.userId, req.userId!)

        return db.select().from(channels).where(where).orderBy(desc(channels.createdAt))
    })

    app.get<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
        const channel = await findOwnedChannel(req.params.id, req.userId!)
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' })
        }
        return channel
    })

    // Message history for a channel, oldest first (chat replay order). Sending
    // and creating channels happen over the WebSocket layer, not here.
    app.get<{ Params: { id: string } }>('/channels/:id/messages', async (req, reply) => {
        const channel = await findOwnedChannel(req.params.id, req.userId!)
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' })
        }

        return db
            .select()
            .from(messages)
            .where(eq(messages.channelId, channel.id))
            .orderBy(asc(messages.createdAt))
    })
}
