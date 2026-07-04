import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agents,
  communityComments,
  communityFollows,
  communityLikes,
  communityPosts,
  users,
  type CommunityComment,
  type CommunityPost,
  type PostAuthorType,
} from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { getAgent } from '../agents/agents.service';

export type FeedView = 'latest' | 'home' | 'trending' | 'following' | 'agent';
export const FEED_VIEWS: FeedView[] = ['latest', 'home', 'trending', 'following', 'agent'];

export interface PostView extends CommunityPost {
  isLiked: boolean;
}

export interface CommentView extends CommunityComment {
  isLiked: boolean;
  replies: CommentView[];
}

interface AuthorInput {
  authorType?: PostAuthorType;
  authorAgentId?: string;
}

/**
 * Authorship is server-derived (never trusted from the request body): a
 * `user` author is the signed-in account; an `agent` author must be an agent
 * that account owns.
 */
async function resolveAuthor(
  userId: string,
  input: AuthorInput
): Promise<{ authorType: PostAuthorType; authorAgentId: string | null; authorName: string }> {
  if (input.authorType === 'agent') {
    if (!input.authorAgentId) {
      throw badRequest('invalid_author', 'authorAgentId is required to post as an agent');
    }
    const agent = await getAgent(userId, input.authorAgentId); // 404s on foreign agents
    return { authorType: 'agent', authorAgentId: agent.id, authorName: agent.name };
  }

  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { authorType: 'user', authorAgentId: null, authorName: user?.username ?? 'User' };
}

async function likedIdSet(
  userId: string,
  targetType: 'post' | 'comment',
  targetIds: string[]
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const rows = await db
    .select({ targetId: communityLikes.targetId })
    .from(communityLikes)
    .where(
      and(
        eq(communityLikes.userId, userId),
        eq(communityLikes.targetType, targetType),
        inArray(communityLikes.targetId, targetIds)
      )
    );
  return new Set(rows.map((r) => r.targetId));
}

// ---------------------------------------------------------------------------
// Posts

export interface CreatePostInput extends AuthorInput {
  content: string;
  tags?: string[];
}

export async function createPost(userId: string, input: CreatePostInput): Promise<PostView> {
  const author = await resolveAuthor(userId, input);
  const [post] = await db
    .insert(communityPosts)
    .values({
      userId,
      ...author,
      content: input.content.trim(),
      tags: input.tags ?? [],
    })
    .returning();
  return { ...post!, isLiked: false };
}

export interface FeedQuery {
  view?: FeedView;
  agentId?: string;
  limit?: number;
  offset?: number;
}

const HOME_SCORE = sql`(${communityPosts.likeCount} * 2 + ${communityPosts.commentCount} * 3)`;
const TRENDING_SCORE = sql`(${communityPosts.likeCount} * 3 + ${communityPosts.commentCount} * 5)`;

export async function getFeed(userId: string, query: FeedQuery = {}): Promise<PostView[]> {
  const view = query.view ?? 'latest';
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  const visible = eq(communityPosts.isDeleted, false);
  let rows: CommunityPost[];

  switch (view) {
    case 'home':
      rows = await db
        .select()
        .from(communityPosts)
        .where(visible)
        .orderBy(desc(HOME_SCORE), desc(communityPosts.createdAt))
        .limit(limit)
        .offset(offset);
      break;
    case 'trending':
      rows = await db
        .select()
        .from(communityPosts)
        .where(visible)
        .orderBy(desc(TRENDING_SCORE), desc(communityPosts.createdAt))
        .limit(limit)
        .offset(offset);
      break;
    case 'following': {
      const followed = await db
        .select({ agentId: communityFollows.agentId })
        .from(communityFollows)
        .where(eq(communityFollows.userId, userId));
      const agentIds = followed.map((f) => f.agentId);
      if (agentIds.length === 0) return [];
      rows = await db
        .select()
        .from(communityPosts)
        .where(and(visible, inArray(communityPosts.authorAgentId, agentIds)))
        .orderBy(desc(communityPosts.createdAt))
        .limit(limit)
        .offset(offset);
      break;
    }
    case 'agent': {
      if (!query.agentId) throw badRequest('invalid_input', 'agentId is required for the agent view');
      rows = await db
        .select()
        .from(communityPosts)
        .where(and(visible, eq(communityPosts.authorAgentId, query.agentId)))
        .orderBy(desc(communityPosts.createdAt))
        .limit(limit)
        .offset(offset);
      break;
    }
    default:
      rows = await db
        .select()
        .from(communityPosts)
        .where(visible)
        .orderBy(desc(communityPosts.createdAt))
        .limit(limit)
        .offset(offset);
  }

  const liked = await likedIdSet(userId, 'post', rows.map((p) => p.id));
  return rows.map((post) => ({ ...post, isLiked: liked.has(post.id) }));
}

export async function getPost(userId: string, postId: string): Promise<PostView> {
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(and(eq(communityPosts.id, postId), eq(communityPosts.isDeleted, false)))
    .limit(1);
  if (!post) throw notFound('Post not found');
  const liked = await likedIdSet(userId, 'post', [post.id]);
  return { ...post, isLiked: liked.has(post.id) };
}

/** Soft delete; only the owning account may delete, whatever persona posted it. */
export async function deletePost(userId: string, postId: string): Promise<void> {
  const updated = await db
    .update(communityPosts)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(
      and(
        eq(communityPosts.id, postId),
        eq(communityPosts.userId, userId),
        eq(communityPosts.isDeleted, false)
      )
    )
    .returning({ id: communityPosts.id });
  if (updated.length === 0) throw notFound('Post not found');
}

// ---------------------------------------------------------------------------
// Comments

export interface CreateCommentInput extends AuthorInput {
  content: string;
  parentCommentId?: string;
}

export async function createComment(
  userId: string,
  postId: string,
  input: CreateCommentInput
): Promise<CommentView> {
  await getPost(userId, postId);

  if (input.parentCommentId) {
    const [parent] = await db
      .select({ postId: communityComments.postId, parentCommentId: communityComments.parentCommentId })
      .from(communityComments)
      .where(and(eq(communityComments.id, input.parentCommentId), eq(communityComments.isDeleted, false)))
      .limit(1);
    if (!parent || parent.postId !== postId) throw notFound('Parent comment not found');
    if (parent.parentCommentId) {
      throw badRequest('too_deep', 'Comments support two levels; reply to the top-level comment');
    }
  }

  const author = await resolveAuthor(userId, input);
  const [comment] = await db
    .insert(communityComments)
    .values({
      postId,
      userId,
      ...author,
      content: input.content.trim(),
      parentCommentId: input.parentCommentId ?? null,
    })
    .returning();

  await db
    .update(communityPosts)
    .set({ commentCount: sql`${communityPosts.commentCount} + 1`, updatedAt: new Date() })
    .where(eq(communityPosts.id, postId));

  return { ...comment!, isLiked: false, replies: [] };
}

export async function listComments(userId: string, postId: string): Promise<CommentView[]> {
  await getPost(userId, postId);
  const rows = await db
    .select()
    .from(communityComments)
    .where(and(eq(communityComments.postId, postId), eq(communityComments.isDeleted, false)))
    .orderBy(communityComments.createdAt);

  const liked = await likedIdSet(userId, 'comment', rows.map((c) => c.id));
  const toView = (c: CommunityComment): CommentView => ({ ...c, isLiked: liked.has(c.id), replies: [] });

  const topLevel = rows.filter((c) => c.parentCommentId === null).map(toView);
  const byId = new Map(topLevel.map((c) => [c.id, c]));
  for (const row of rows) {
    if (!row.parentCommentId) continue;
    byId.get(row.parentCommentId)?.replies.push(toView(row));
  }
  return topLevel;
}

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const updated = await db
    .update(communityComments)
    .set({ isDeleted: true })
    .where(
      and(
        eq(communityComments.id, commentId),
        eq(communityComments.userId, userId),
        eq(communityComments.isDeleted, false)
      )
    )
    .returning({ postId: communityComments.postId });
  if (updated.length === 0) throw notFound('Comment not found');

  await db
    .update(communityPosts)
    .set({ commentCount: sql`GREATEST(${communityPosts.commentCount} - 1, 0)`, updatedAt: new Date() })
    .where(eq(communityPosts.id, updated[0]!.postId));
}

// ---------------------------------------------------------------------------
// Likes

export async function toggleLike(
  userId: string,
  targetType: 'post' | 'comment',
  targetId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const table = targetType === 'post' ? communityPosts : communityComments;
  const [target] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, targetId), eq(table.isDeleted, false)))
    .limit(1);
  if (!target) throw notFound(`${targetType === 'post' ? 'Post' : 'Comment'} not found`);

  const deleted = await db
    .delete(communityLikes)
    .where(
      and(
        eq(communityLikes.userId, userId),
        eq(communityLikes.targetType, targetType),
        eq(communityLikes.targetId, targetId)
      )
    )
    .returning({ id: communityLikes.id });

  const delta = deleted.length > 0 ? sql`GREATEST(${table.likeCount} - 1, 0)` : sql`${table.likeCount} + 1`;
  if (deleted.length === 0) {
    await db.insert(communityLikes).values({ userId, targetType, targetId });
  }
  const [updated] = await db
    .update(table)
    .set({ likeCount: delta })
    .where(eq(table.id, targetId))
    .returning({ likeCount: table.likeCount });

  return { liked: deleted.length === 0, likeCount: updated!.likeCount };
}

// ---------------------------------------------------------------------------
// Follows

export async function toggleFollow(
  userId: string,
  agentId: string
): Promise<{ following: boolean; followerCount: number }> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) throw notFound('Agent not found');

  const deleted = await db
    .delete(communityFollows)
    .where(and(eq(communityFollows.userId, userId), eq(communityFollows.agentId, agentId)))
    .returning({ id: communityFollows.id });
  if (deleted.length === 0) {
    await db.insert(communityFollows).values({ userId, agentId });
  }

  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(communityFollows)
    .where(eq(communityFollows.agentId, agentId));
  return { following: deleted.length === 0, followerCount: count?.value ?? 0 };
}

export interface FollowedAgent {
  agentId: string;
  agentName: string;
  followedAt: Date;
}

export async function listFollowedAgents(userId: string): Promise<FollowedAgent[]> {
  const rows = await db
    .select({
      agentId: communityFollows.agentId,
      agentName: agents.name,
      followedAt: communityFollows.createdAt,
    })
    .from(communityFollows)
    .innerJoin(agents, eq(communityFollows.agentId, agents.id))
    .where(eq(communityFollows.userId, userId))
    .orderBy(desc(communityFollows.createdAt));
  return rows;
}
