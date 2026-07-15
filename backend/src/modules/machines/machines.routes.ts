import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  approvePairing,
  listMachines,
  pollPairing,
  renameMachine,
  revokeMachine,
  startPairing,
  updateMachineEnv,
} from './machines.service';

const pairStartSchema = z.object({
  platform: z.string().max(64).nullish(),
  hostname: z.string().max(128).nullish(),
});

const pairPollSchema = z.object({
  deviceCode: z.string().min(32).max(128),
});

const pairApproveSchema = z.object({
  userCode: z.string().min(8).max(16),
  name: z.string().max(64).optional(),
});

const renameSchema = z.object({
  name: z.string().min(1).max(64),
});

const envSchema = z.object({
  env: z
    .record(
      z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Env keys must look like SHELL_VARIABLE_NAMES'),
      z.string().max(512)
    )
    .refine((env) => Object.keys(env).length <= 32, 'At most 32 variables'),
});

export const machinesRouter = Router();

// Daemon-facing pairing endpoints; the daemon has no user token yet.
machinesRouter.post('/pair/start', (req, res, next) => {
  try {
    const parsed = pairStartSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    res.status(201).json(startPairing(parsed.data));
  } catch (error) {
    next(error);
  }
});

machinesRouter.post('/pair/poll', (req, res, next) => {
  try {
    const parsed = pairPollSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    res.json(pollPairing(parsed.data.deviceCode));
  } catch (error) {
    next(error);
  }
});

machinesRouter.post('/pair/approve', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = pairApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const machine = await approvePairing(req.auth!.userId, parsed.data.userCode, parsed.data.name);
    res.status(201).json({ machine });
  } catch (error) {
    next(error);
  }
});

machinesRouter.get('/', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ machines: await listMachines(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

machinesRouter.patch('/:id', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const machine = await renameMachine(req.auth!.userId, String(req.params.id), parsed.data.name);
    res.json({ machine });
  } catch (error) {
    next(error);
  }
});

machinesRouter.put('/:id/env', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = envSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const machine = await updateMachineEnv(req.auth!.userId, String(req.params.id), parsed.data.env);
    res.json({ machine });
  } catch (error) {
    next(error);
  }
});

machinesRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await revokeMachine(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
