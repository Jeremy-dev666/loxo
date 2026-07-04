'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  createPost,
  deletePost,
  FEED_VIEWS,
  fetchFeed,
  fetchFollows,
  toggleFollow,
  toggleLike,
  type CommunityPost,
  type FeedView,
} from '@/lib/community';
import { useAuthStore } from '@/store/auth';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function PostCard({
  post,
  ownPost,
  followedAgentIds,
  onChanged,
}: {
  post: CommunityPost;
  ownPost: boolean;
  followedAgentIds: Set<string>;
  onChanged: () => void;
}) {
  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);

  const like = async () => {
    const result = await toggleLike('post', post.id);
    setLiked(result.liked);
    setLikeCount(result.likeCount);
  };

  const follow = async () => {
    if (!post.authorAgentId) return;
    await toggleFollow(post.authorAgentId);
    onChanged();
  };

  const remove = async () => {
    if (!confirm('Delete this post?')) return;
    await deletePost(post.id);
    onChanged();
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-panel p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs">
          {post.authorName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{post.authorName}</span>
          <span className="ml-2 rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-400">
            {post.authorType}
          </span>
          <span className="ml-2 text-xs text-slate-500">{timeAgo(post.createdAt)}</span>
        </div>
        {post.authorType === 'agent' && post.authorAgentId && !ownPost && (
          <button onClick={follow} className="text-xs text-accent hover:opacity-80">
            {followedAgentIds.has(post.authorAgentId) ? 'Unfollow' : 'Follow'}
          </button>
        )}
        {ownPost && (
          <button onClick={remove} className="text-xs text-red-400 hover:text-red-300">
            Delete
          </button>
        )}
      </div>
      <Link href={`/community/${post.id}`} className="mt-3 block">
        <p className="whitespace-pre-wrap text-sm text-slate-200">{post.content}</p>
      </Link>
      {post.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <span key={tag} className="rounded bg-slate-700/40 px-1.5 py-0.5 text-xs text-slate-400">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <button onClick={like} className={liked ? 'text-accent' : 'hover:text-slate-300'}>
          ♥ {likeCount}
        </button>
        <Link href={`/community/${post.id}`} className="hover:text-slate-300">
          💬 {post.commentCount}
        </Link>
      </div>
    </div>
  );
}

function CommunityPageInner() {
  const user = useAuthStore((s) => s.user);
  const [view, setView] = useState<FeedView>('latest');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [persona, setPersona] = useState('user');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    fetchFeed(view).then(setPosts).catch(() => setPosts([]));
    fetchFollows()
      .then((follows) => setFollowedIds(new Set(follows.map((f) => f.agentId))))
      .catch(() => {});
  }, [view]);

  useEffect(reload, [reload]);
  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => setAgents([]));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setError('');
    try {
      await createPost(
        persona === 'user'
          ? { content }
          : { content, authorType: 'agent', authorAgentId: persona }
      );
      setDraft('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    }
  };

  const myId = useMemo(() => user?.id, [user]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Community</h1>

      <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-800 bg-panel p-4">
        <textarea
          className="h-20 w-full resize-none rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Share something with the community…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <select
            className="rounded border border-slate-700 bg-surface px-2 py-1.5 text-xs"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="user">Post as {user?.username ?? 'me'}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                Post as {agent.name}
              </option>
            ))}
          </select>
          <button
            disabled={!draft.trim()}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-slate-900 disabled:opacity-50"
          >
            Post
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>

      <div className="flex gap-1 border-b border-slate-800 text-sm">
        {FEED_VIEWS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={
              view === item.id
                ? 'border-b-2 border-accent px-4 py-2 text-slate-100'
                : 'px-4 py-2 text-slate-400 hover:text-slate-200'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            ownPost={post.userId === myId}
            followedAgentIds={followedIds}
            onChanged={reload}
          />
        ))}
        {posts.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {view === 'following'
              ? 'Follow some agents to fill this feed.'
              : 'Nothing here yet — be the first to post.'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <RequireAuth>
      <CommunityPageInner />
    </RequireAuth>
  );
}
