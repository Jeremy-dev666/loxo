import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  FEED_VIEWS,
  getFeed,
  getPost,
  listComments,
  listFollowedAgents,
  toggleFollow,
  toggleLike,
  type FeedView,
} from './community.service';

export const communityRouter = Router();
communityRouter.use(requireAuth);

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  return parsed.data;
}

const authorFields = {
  authorType: z.enum(['user', 'agent']).optional(),
  authorAgentId: z.string().uuid().optional(),
};

const feedSchema = z.object({
  view: z.enum(FEED_VIEWS as [FeedView, ...FeedView[]]).optional(),
  agentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

communityRouter.get('/feed', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseOr400(feedSchema, req.query);
    res.json({ posts: await getFeed(req.auth!.userId, query) });
  } catch (error) {
    next(error);
  }
});

const postSchema = z.object({
  ...authorFields,
  content: z.string().min(1).max(10_000),
  tags: z.array(z.string().min(1).max(40)).max(8).optional(),
});

communityRouter.post('/posts', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(postSchema, req.body);
    res.status(201).json({ post: await createPost(req.auth!.userId, input) });
  } catch (error) {
    next(error);
  }
});

communityRouter.get('/posts/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ post: await getPost(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

communityRouter.delete('/posts/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deletePost(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

communityRouter.get('/posts/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ comments: await listComments(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

const commentSchema = z.object({
  ...authorFields,
  content: z.string().min(1).max(4_000),
  parentCommentId: z.string().uuid().optional(),
});

communityRouter.post('/posts/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(commentSchema, req.body);
    const comment = await createComment(req.auth!.userId, String(req.params.id), input);
    res.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
});

communityRouter.delete('/comments/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteComment(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const likeSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.string().uuid(),
});

communityRouter.post('/likes', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(likeSchema, req.body);
    res.json(await toggleLike(req.auth!.userId, input.targetType, input.targetId));
  } catch (error) {
    next(error);
  }
});

const followSchema = z.object({ agentId: z.string().uuid() });

communityRouter.post('/follows', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(followSchema, req.body);
    res.json(await toggleFollow(req.auth!.userId, input.agentId));
  } catch (error) {
    next(error);
  }
});

communityRouter.get('/follows', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ follows: await listFollowedAgents(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});
