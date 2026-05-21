import { Router } from 'express';
import { db } from '../db';
import { agents } from '../db/schema';

const router = Router();

// 获取所有 agent 配置
router.get('/', async (_req, res) => {
    const allAgents = await db.select().from(agents);
    res.json(allAgents);
});

export default router;
