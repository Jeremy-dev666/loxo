import { Router } from 'express';
import { db } from '../db';
import { conversations, conversationParticipants, messages, agents } from '../db/schema';
import { eq, and, lt, desc } from 'drizzle-orm';

const router = Router();

// 创建会话（自动加入所有 agent）
router.post('/', async (req, res) => {
    const userId = req.user!.userId;
    const { title } = req.body;

    // 插入会话
    const [conversation] = await db.insert(conversations).values({
        title: title || 'New Conversation',
        type: 'group',
    }).returning();

    // 把当前用户加入会话
    await db.insert(conversationParticipants).values({
        conversationId: conversation.id,
        participantId: userId,
        participantType: 'user',
    });

    // 查询所有 agent，全部加入会话
    const allAgents = await db.select().from(agents);
    if (allAgents.length > 0) {
        await db.insert(conversationParticipants).values(
            allAgents.map((agent) => ({
                conversationId: conversation.id,
                participantId: agent.id,
                participantType: 'agent' as const,
            }))
        );
    }

    res.status(201).json(conversation);
});

// 获取当前用户的会话列表
router.get('/', async (req, res) => {
    const userId = req.user!.userId;

    // 查询用户参与的会话 ID
    const participations = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(
            and(
                eq(conversationParticipants.participantId, userId),
                eq(conversationParticipants.participantType, 'user'),
            )
        );

    if (participations.length === 0) {
        res.json([]);
        return;
    }

    const conversationIds = participations.map((p) => p.conversationId);

    // 查询会话详情
    const result = await db
        .select()
        .from(conversations)
        .where(
            // drizzle-orm inArray
            eq(conversations.status, 'active')
        );

    // 过滤出用户参与的会话
    const userConversations = result.filter((c) => conversationIds.includes(c.id));

    res.json(userConversations);
});

// 获取会话消息（游标分页）
router.get('/:id/messages', async (req, res) => {
    const conversationId = req.params.id;
    const before = req.query.before ? parseInt(req.query.before as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const conditions = [eq(messages.conversationId, conversationId)];
    if (before !== undefined) {
        conditions.push(lt(messages.sequenceNumber, before));
    }

    const result = await db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.sequenceNumber))
        .limit(limit);

    // 返回时按 sequenceNumber 升序（旧 → 新）
    res.json(result.reverse());
});

export default router;
