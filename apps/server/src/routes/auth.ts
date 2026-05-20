import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'swarmdev-dev-secret';

// 用户注册
router.post('/register', async (req, res) => {
    const { email, userName, password } = req.body;

    // 检查邮箱是否已存在
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
        return res.status(400).json({ error: 'Email already exists' });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 插入用户
    const [user] = await db.insert(users).values({
        email,
        userName,
        passwordHash,
    }).returning();

    // 生成 JWT
    // jwt.sign(payload, secretkey, configuration(optional))
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: user.id, email: user.email, userName: user.userName } });
});

// 登录
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // 查找用户
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
        return res.status(401).json({ error: 'User does not exist' });
    }

    // 验证密码
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    // 生成 JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: user.id, email: user.email, userName: user.userName } });
});

export default router;