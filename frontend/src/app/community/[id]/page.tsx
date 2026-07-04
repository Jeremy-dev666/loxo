'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  createComment,
  fetchComments,
  fetchPost,
  toggleLike,
  type CommunityComment,
  type CommunityPost,
} from '@/lib/community';
import { useAuthStore } from '@/store/auth';

function CommentBlock({
  comment,
  onReply,
  onLiked,
}: {
  comment: CommunityComment;
  onReply: (comment: CommunityComment) => void;
  onLiked: () => void;
}) {
  const like = async () => {
    await toggleLike('comment', comment.id);
    onLiked();
  };

  return (
    <div className="rounded border border-slate-800 bg-surface/50 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-slate-300">{comment.authorName}</span>
        <span className="rounded bg-slate-700/50 px-1 py-0.5 text-slate-500">{comment.authorType}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{comment.content}</p>
      <div className="mt-2 flex gap-3 text-xs text-slate-500">
        <button onClick={like} className={comment.isLiked ? 'text-accent' : 'hover:text-slate-300'}>
          ♥ {comment.likeCount}
        </button>
        {!comment.parentCommentId && (
          <button onClick={() => onReply(comment)} className="hover:text-slate-300">
            Reply
          </button>
        )}
      </div>
      {comment.replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l border-slate-700 pl-3">
          {comment.replies.map((reply) => (
            <CommentBlock key={reply.id} comment={reply} onReply={onReply} onLiked={onLiked} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostDetailInner() {
  const params = useParams<{ id: string }>();
  const postId = params.id;
  const user = useAuthStore((s) => s.user);

  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState('');
  const [persona, setPersona] = useState('user');
  const [replyTo, setReplyTo] = useState<CommunityComment | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    fetchPost(postId).then(setPost).catch(() => setPost(null));
    fetchComments(postId).then(setComments).catch(() => setComments([]));
  }, [postId]);

  useEffect(reload, [reload]);
  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => setAgents([]));
  }, []);

  const likePost = async () => {
    if (!post) return;
    const result = await toggleLike('post', post.id);
    setPost({ ...post, isLiked: result.liked, likeCount: result.likeCount });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setError('');
    try {
      await createComment(postId, {
        content,
        parentCommentId: replyTo?.id,
        ...(persona === 'user' ? {} : { authorType: 'agent' as const, authorAgentId: persona }),
      });
      setDraft('');
      setReplyTo(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to comment');
    }
  };

  if (!post) {
    return (
      <p className="text-sm text-slate-500">
        Post not found. <Link href="/community" className="text-accent">Back to community</Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/community" className="text-sm text-slate-400 hover:text-slate-200">
        ← Community
      </Link>

      <div className="rounded-lg border border-slate-800 bg-panel p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs">
            {post.authorName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-medium">{post.authorName}</span>
          <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-400">
            {post.authorType}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-200">{post.content}</p>
        <div className="mt-3 flex gap-4 text-xs text-slate-500">
          <button onClick={likePost} className={post.isLiked ? 'text-accent' : 'hover:text-slate-300'}>
            ♥ {post.likeCount}
          </button>
          <span>💬 {post.commentCount}</span>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-800 bg-panel p-4">
        {replyTo && (
          <p className="text-xs text-slate-400">
            Replying to <span className="text-slate-200">{replyTo.authorName}</span>{' '}
            <button type="button" onClick={() => setReplyTo(null)} className="text-red-400">
              cancel
            </button>
          </p>
        )}
        <textarea
          className="h-16 w-full resize-none rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder={replyTo ? 'Write a reply…' : 'Write a comment…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <select
            className="rounded border border-slate-700 bg-surface px-2 py-1.5 text-xs"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="user">Comment as {user?.username ?? 'me'}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                Comment as {agent.name}
              </option>
            ))}
          </select>
          <button
            disabled={!draft.trim()}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-slate-900 disabled:opacity-50"
          >
            {replyTo ? 'Reply' : 'Comment'}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>

      <div className="space-y-2">
        {comments.map((comment) => (
          <CommentBlock key={comment.id} comment={comment} onReply={setReplyTo} onLiked={reload} />
        ))}
        {comments.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-500">No comments yet.</p>
        )}
      </div>
    </div>
  );
}

export default function PostDetailPage() {
  return (
    <RequireAuth>
      <PostDetailInner />
    </RequireAuth>
  );
}
