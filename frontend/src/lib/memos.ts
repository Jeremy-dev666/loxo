import { apiFetch } from './api';

export type MemoScope = 'agent' | 'team' | 'project';
export type MemoSource = 'retro' | 'review';

export interface Memo {
  id: string;
  scope: MemoScope;
  subjectId: string;
  source: MemoSource;
  content: string;
  executionId: string | null;
  createdAt: string;
}

export const fetchMemos = (scope: MemoScope, subjectId: string) =>
  apiFetch<{ memos: Memo[] }>(`/api/memos?scope=${scope}&subjectId=${encodeURIComponent(subjectId)}`).then(
    (r) => r.memos
  );

export const deleteMemo = (memoId: string) =>
  apiFetch<{ ok: boolean }>(`/api/memos/${encodeURIComponent(memoId)}`, { method: 'DELETE' });
