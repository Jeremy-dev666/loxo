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
    <div className="border border-pixel-black bg-pixel-white/50 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-pixel-black/70">{comment.authorName}</span>
        <span className="border border-pixel-black bg-pixel-cream px-1 py-0.5 text-pixel-black/60">{comment.authorType}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-pixel-black">{comment.content}</p>
      <div className="mt-2 flex gap-3 text-xs text-pixel-black/50">
        <button onClick={like} className={comment.isLiked ? 'text-pixel-blue' : 'hover:text-pixel-black'}>
          {comment.likeCount} likes
        </button>
        {!comment.parentCommentId && (
          <button onClick={() => onReply(comment)} className="hover:text-pixel-black">
            Reply
          </button>
        )}
      </div>
      {comment.replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l border-pixel-black pl-3">
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
      <p className="text-sm text-pixel-black/50">
        Post not found. <Link href="/community" className="text-pixel-blue">Back to community</Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/community" className="text-sm text-pixel-black/60 hover:text-pixel-black">
        ← Community
      </Link>

      <div className="border border-pixel-black bg-pixel-white shadow-pixel p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pixel-gray text-xs">
            {post.authorName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-medium">{post.authorName}</span>
          <span className="bg-pixel-cream px-1.5 py-0.5 text-xs text-pixel-black/60">
            {post.authorType}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-pixel-black">{post.content}</p>
        <div className="mt-3 flex gap-4 text-xs text-pixel-black/50">
          <button onClick={likePost} className={post.isLiked ? 'text-pixel-blue' : 'hover:text-pixel-black'}>
            {post.likeCount} likes
          </button>
          <span>{post.commentCount} comments</span>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-2 border border-pixel-black bg-pixel-white shadow-pixel p-4">
        {replyTo && (
          <p className="text-xs text-pixel-black/60">
            Replying to <span className="text-pixel-black">{replyTo.authorName}</span>{' '}
            <button type="button" onClick={() => setReplyTo(null)} className="text-pixel-red">
              cancel
            </button>
          </p>
        )}
        <textarea
          className="h-16 w-full resize-none border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-3 py-2 text-sm outline-none focus:border-pixel-blue"
          placeholder={replyTo ? 'Write a reply…' : 'Write a comment…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <select
            className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-2 py-1.5 text-xs"
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
            className="border border-pixel-black bg-pixel-red px-4 py-1.5 font-pixel text-sm font-bold text-pixel-white shadow-pixel-sm hover:bg-pixel-orange disabled:opacity-50"
          >
            {replyTo ? 'Reply' : 'Comment'}
          </button>
        </div>
        {error && <p className="text-xs text-pixel-red">{error}</p>}
      </form>

      <div className="space-y-2">
        {comments.map((comment) => (
          <CommentBlock key={comment.id} comment={comment} onReply={setReplyTo} onLiked={reload} />
        ))}
        {comments.length === 0 && (
          <p className="py-4 text-center text-sm text-pixel-black/50">No comments yet.</p>
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
