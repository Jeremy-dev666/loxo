import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  confirmSessionWorkflowDraft,
  executeRoundtableTurn,
  generateSessionWorkflowDraft,
  getSessionState,
  postSessionMessage,
  stopSession,
  updateSessionNote,
  WHITEBOARD_COLUMNS,
  type RoundtableMember,
  type WhiteboardColumn,
  type WhiteboardNote,
} from './roundtable.service';

export const roundtableRouter = Router();
roundtableRouter.use(requireAuth);

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  return parsed.data;
}

const memberSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1).max(80),
  role: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
});

const sessionIdSchema = z.string().min(1).max(120);

const turnSchema = z.object({
  agentId: z.string().uuid(),
  prompt: z.string().min(1).max(20_000),
  sessionTitle: z.string().max(120).optional(),
  topic: z.string().max(400).optional(),
  members: z.array(memberSchema).max(16).default([]),
  messages: z
    .array(z.object({ senderName: z.string().optional(), content: z.string().optional() }))
    .max(80)
    .default([]),
  notes: z
    .array(
      z.object({
        column: z.string().optional(),
        text: z.string().optional(),
        authorName: z.string().optional(),
      })
    )
    .max(60)
    .default([]),
});

roundtableRouter.post('/turn', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(turnSchema, req.body);
    res.json(await executeRoundtableTurn(req.auth!.userId, input));
  } catch (error) {
    next(error);
  }
});

const messageSchema = z.object({
  title: z.string().max(120).optional(),
  userMessage: z.object({
    content: z.string().min(1).max(20_000),
    senderName: z.string().max(80).optional(),
  }),
  members: z.array(memberSchema).max(16).default([]),
  messages: z
    .array(
      z.object({
        id: z.string().max(80),
        senderId: z.string().max(80),
        senderName: z.string().max(80),
        content: z.string().max(20_000),
        sentAt: z.string().max(40),
      })
    )
    .max(160)
    .optional(),
  notes: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        column: z.string().optional(),
        text: z.string().max(2000).optional(),
        authorName: z.string().max(80).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        createdAt: z.string().max(40).optional(),
        updatedAt: z.string().max(40).optional(),
      })
    )
    .max(80)
    .optional(),
});

roundtableRouter.post('/sessions/:sessionId/messages', (req: AuthedRequest, res, next) => {
  try {
    const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
    const input = parseOr400(messageSchema, req.body);
    res.json(
      postSessionMessage(req.auth!.userId, sessionId, {
        ...input,
        members: input.members as RoundtableMember[],
        messages: input.messages ?? [],
        notes: (input.notes ?? []) as never,
      })
    );
  } catch (error) {
    next(error);
  }
});

roundtableRouter.get('/sessions/:sessionId', (req: AuthedRequest, res, next) => {
  try {
    const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
    res.json(getSessionState(req.auth!.userId, sessionId));
  } catch (error) {
    next(error);
  }
});

roundtableRouter.post('/sessions/:sessionId/stop', (req: AuthedRequest, res, next) => {
  try {
    const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
    res.json(stopSession(req.auth!.userId, sessionId));
  } catch (error) {
    next(error);
  }
});

const noteSeedSchema = z.object({
  id: z.string().max(80).optional(),
  column: z.string().optional(),
  text: z.string().max(2000).optional(),
  authorName: z.string().max(80).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  createdAt: z.string().max(40).optional(),
  updatedAt: z.string().max(40).optional(),
});

const draftRequestSchema = z.object({
  title: z.string().max(120).optional(),
  members: z.array(memberSchema).max(16).optional(),
  notes: z.array(noteSeedSchema).max(80).optional(),
  feedback: z.string().max(4000).optional(),
  previousDraftId: z.string().max(80).optional(),
});

roundtableRouter.post('/sessions/:sessionId/workflow-drafts', async (req: AuthedRequest, res, next) => {
  try {
    const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
    const input = parseOr400(draftRequestSchema, req.body);
    res.json(
      await generateSessionWorkflowDraft(req.auth!.userId, sessionId, {
        ...input,
        members: input.members as RoundtableMember[] | undefined,
        notes: input.notes as WhiteboardNote[] | undefined,
      })
    );
  } catch (error) {
    next(error);
  }
});

const draftConfirmSchema = z.object({
  name: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  teamId: z.string().uuid().optional(),
});

roundtableRouter.post(
  '/sessions/:sessionId/workflow-drafts/:draftId/confirm',
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
      const input = parseOr400(draftConfirmSchema, req.body);
      res.json(
        await confirmSessionWorkflowDraft(req.auth!.userId, sessionId, String(req.params.draftId), input)
      );
    } catch (error) {
      next(error);
    }
  }
);

const notePatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  column: z.enum(WHITEBOARD_COLUMNS).optional(),
  text: z.string().min(1).max(2000).optional(),
});

roundtableRouter.patch('/sessions/:sessionId/notes/:noteId', (req: AuthedRequest, res, next) => {
  try {
    const sessionId = parseOr400(sessionIdSchema, req.params.sessionId);
    const patch = parseOr400(notePatchSchema, req.body);
    res.json({
      note: updateSessionNote(req.auth!.userId, sessionId, String(req.params.noteId), {
        ...patch,
        column: patch.column as WhiteboardColumn | undefined,
      }),
    });
  } catch (error) {
    next(error);
  }
});
