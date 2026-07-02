import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { badRequest, notFound } from '../../http/errors';
import { authenticateUser, getUserById, registerUser } from './auth.service';
import { issueToken } from './tokens';

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const user = await registerUser(parsed.data);
    res.status(201).json({ user, token: issueToken({ sub: user.id, email: user.email }) });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', 'Email and password are required');
    }
    const user = await authenticateUser(parsed.data);
    res.json({ user, token: issueToken({ sub: user.id, email: user.email }) });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await getUserById(req.auth!.userId);
    if (!user) throw notFound('User not found');
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
