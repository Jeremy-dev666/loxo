import { apiFetch } from './api';

export type FeedView = 'latest' | 'home' | 'trending' | 'following' | 'agent';
export const FEED_VIEWS: Array<{ id: FeedView; label: string }> = [
  { id: 'latest', label: 'Latest' },
  { id: 'home', label: 'Home' },
  { id: 'trending', label: 'Trending' },
  { id: 'following', label: 'Following' },
];

export interface CommunityPost {
  id: string;
  userId: string;
  authorType: 'user' | 'agent';
  authorAgentId: string | null;
  authorName: string;
  content: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  createdAt: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  authorType: 'user' | 'agent';
  authorAgentId: string | null;
  authorName: string;
  content: string;
  parentCommentId: string | null;
  likeCount: number;
  isLiked: boolean;
  replies: CommunityComment[];
  createdAt: string;
}

export interface FollowedAgent {
  agentId: string;
  agentName: string;
  followedAt: string;
}

export const fetchFeed = (view: FeedView, agentId?: string) =>
  apiFetch<{ posts: CommunityPost[] }>(
    `/api/community/feed?view=${view}${agentId ? `&agentId=${agentId}` : ''}`
  ).then((r) => r.posts);

export const fetchPost = (id: string) =>
  apiFetch<{ post: CommunityPost }>(`/api/community/posts/${id}`).then((r) => r.post);

export const createPost = (input: {
  content: string;
  tags?: string[];
  authorType?: 'user' | 'agent';
  authorAgentId?: string;
}) =>
  apiFetch<{ post: CommunityPost }>('/api/community/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.post);

export const deletePost = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/community/posts/${id}`, { method: 'DELETE' });

export const fetchComments = (postId: string) =>
  apiFetch<{ comments: CommunityComment[] }>(`/api/community/posts/${postId}/comments`).then(
    (r) => r.comments
  );

export const createComment = (
  postId: string,
  input: {
    content: string;
    parentCommentId?: string;
    authorType?: 'user' | 'agent';
    authorAgentId?: string;
  }
) =>
  apiFetch<{ comment: CommunityComment }>(`/api/community/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.comment);

export const toggleLike = (targetType: 'post' | 'comment', targetId: string) =>
  apiFetch<{ liked: boolean; likeCount: number }>('/api/community/likes', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId }),
  });

export const toggleFollow = (agentId: string) =>
  apiFetch<{ following: boolean; followerCount: number }>('/api/community/follows', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });

export const fetchFollows = () =>
  apiFetch<{ follows: FollowedAgent[] }>('/api/community/follows').then((r) => r.follows);
