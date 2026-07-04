import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';

const app = createApp();
let tokenA = '';
let tokenB = '';
let agentA = ''; // owned by user A
let agentB = ''; // owned by user B

const asA = () => ({ Authorization: `Bearer ${tokenA}` });
const asB = () => ({ Authorization: `Bearer ${tokenB}` });

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');

  const a = await request(app).post('/auth/register').send({
    email: 'communitya@example.com',
    username: 'communitya',
    password: 'a-strong-password',
  });
  tokenA = a.body.token;
  const b = await request(app).post('/auth/register').send({
    email: 'communityb@example.com',
    username: 'communityb',
    password: 'a-strong-password',
  });
  tokenB = b.body.token;

  const agentARes = await request(app)
    .post('/api/agents')
    .set(asA())
    .send({ name: 'Poet Bot', runtime: 'api' });
  agentA = agentARes.body.agent.id;
  const agentBRes = await request(app)
    .post('/api/agents')
    .set(asB())
    .send({ name: 'Critic Bot', runtime: 'api' });
  agentB = agentBRes.body.agent.id;
});

describe('post authorship (server-derived)', () => {
  it('posts as the signed-in user with the account username', async () => {
    const res = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Hello community!', authorName: 'Spoofed Name' });
    expect(res.status).toBe(201);
    expect(res.body.post.authorType).toBe('user');
    expect(res.body.post.authorName).toBe('communitya');
    expect(res.body.post.authorAgentId).toBeNull();
  });

  it('posts as an owned agent with the agent name snapshotted', async () => {
    const res = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'A poem about code.', authorType: 'agent', authorAgentId: agentA, tags: ['poetry'] });
    expect(res.status).toBe(201);
    expect(res.body.post.authorType).toBe('agent');
    expect(res.body.post.authorName).toBe('Poet Bot');
  });

  it("rejects posting as another user's agent", async () => {
    const res = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Impersonation attempt', authorType: 'agent', authorAgentId: agentB });
    expect(res.status).toBe(404);
  });
});

describe('comments (two levels)', () => {
  let postId = '';
  let topCommentId = '';

  beforeAll(async () => {
    const post = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Discuss this post.' });
    postId = post.body.post.id;
  });

  it('adds top-level comments and replies, updating the comment count', async () => {
    const top = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set(asB())
      .send({ content: 'Interesting point.' });
    expect(top.status).toBe(201);
    topCommentId = top.body.comment.id;

    const reply = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set(asA())
      .send({ content: 'Thanks!', parentCommentId: topCommentId });
    expect(reply.status).toBe(201);

    const list = await request(app).get(`/api/community/posts/${postId}/comments`).set(asA());
    expect(list.body.comments).toHaveLength(1);
    expect(list.body.comments[0].replies).toHaveLength(1);

    const post = await request(app).get(`/api/community/posts/${postId}`).set(asA());
    expect(post.body.post.commentCount).toBe(2);
  });

  it('rejects replying to a reply', async () => {
    const list = await request(app).get(`/api/community/posts/${postId}/comments`).set(asA());
    const replyId = list.body.comments[0].replies[0].id;
    const res = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set(asB())
      .send({ content: 'Too deep', parentCommentId: replyId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('too_deep');
  });

  it('only the owner can delete a comment, and the count decrements', async () => {
    const denied = await request(app).delete(`/api/community/comments/${topCommentId}`).set(asA());
    expect(denied.status).toBe(404);

    const ok = await request(app).delete(`/api/community/comments/${topCommentId}`).set(asB());
    expect(ok.status).toBe(200);

    const post = await request(app).get(`/api/community/posts/${postId}`).set(asA());
    expect(post.body.post.commentCount).toBe(1);
  });
});

describe('likes', () => {
  let postId = '';

  beforeAll(async () => {
    const post = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Like me.' });
    postId = post.body.post.id;
  });

  it('toggles likes and keeps the count in sync', async () => {
    const like = await request(app)
      .post('/api/community/likes')
      .set(asB())
      .send({ targetType: 'post', targetId: postId });
    expect(like.body).toMatchObject({ liked: true, likeCount: 1 });

    const feed = await request(app).get('/api/community/feed').set(asB());
    const post = feed.body.posts.find((p: { id: string }) => p.id === postId);
    expect(post.isLiked).toBe(true);

    const unlike = await request(app)
      .post('/api/community/likes')
      .set(asB())
      .send({ targetType: 'post', targetId: postId });
    expect(unlike.body).toMatchObject({ liked: false, likeCount: 0 });
  });
});

describe('follows and feed views', () => {
  beforeAll(async () => {
    // Agent B posts twice so views have data; user B likes A's agent post.
    await request(app)
      .post('/api/community/posts')
      .set(asB())
      .send({ content: 'Critique #1', authorType: 'agent', authorAgentId: agentB });
    await request(app)
      .post('/api/community/posts')
      .set(asB())
      .send({ content: 'Critique #2', authorType: 'agent', authorAgentId: agentB });
  });

  it('toggles follow on any visible agent', async () => {
    const follow = await request(app).post('/api/community/follows').set(asA()).send({ agentId: agentB });
    expect(follow.body).toMatchObject({ following: true, followerCount: 1 });

    const list = await request(app).get('/api/community/follows').set(asA());
    expect(list.body.follows).toHaveLength(1);
    expect(list.body.follows[0].agentName).toBe('Critic Bot');
  });

  it('following view shows only posts by followed agents', async () => {
    const res = await request(app).get('/api/community/feed?view=following').set(asA());
    expect(res.body.posts.length).toBeGreaterThanOrEqual(2);
    expect(res.body.posts.every((p: { authorAgentId: string }) => p.authorAgentId === agentB)).toBe(true);
  });

  it('agent view filters by author agent', async () => {
    const res = await request(app).get(`/api/community/feed?view=agent&agentId=${agentA}`).set(asB());
    expect(res.body.posts.every((p: { authorAgentId: string }) => p.authorAgentId === agentA)).toBe(true);
  });

  it('home and trending rank engaged posts first', async () => {
    const target = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Engagement magnet' });
    await request(app)
      .post('/api/community/likes')
      .set(asB())
      .send({ targetType: 'post', targetId: target.body.post.id });
    await request(app)
      .post(`/api/community/posts/${target.body.post.id}/comments`)
      .set(asB())
      .send({ content: 'Nice!' });

    for (const view of ['home', 'trending']) {
      const res = await request(app).get(`/api/community/feed?view=${view}`).set(asA());
      expect(res.body.posts[0].id).toBe(target.body.post.id);
    }
  });

  it('empty following list yields an empty feed', async () => {
    const res = await request(app).get('/api/community/feed?view=following').set(asB());
    expect(res.body.posts).toEqual([]);
  });
});

describe('post deletion', () => {
  it('soft-deletes own posts and hides them from feeds', async () => {
    const post = await request(app)
      .post('/api/community/posts')
      .set(asA())
      .send({ content: 'Ephemeral post' });
    const postId = post.body.post.id;

    const deniedForB = await request(app).delete(`/api/community/posts/${postId}`).set(asB());
    expect(deniedForB.status).toBe(404);

    const ok = await request(app).delete(`/api/community/posts/${postId}`).set(asA());
    expect(ok.status).toBe(200);

    const detail = await request(app).get(`/api/community/posts/${postId}`).set(asA());
    expect(detail.status).toBe(404);
    const feed = await request(app).get('/api/community/feed').set(asA());
    expect(feed.body.posts.some((p: { id: string }) => p.id === postId)).toBe(false);
  });
});
