import { apiFetch } from './api';

export type GoalStatus = 'active' | 'achieved' | 'archived';

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  parentGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchGoals(status?: GoalStatus) {
  const query = status ? `?status=${status}` : '';
  return apiFetch<{ goals: Goal[] }>(`/api/goals${query}`);
}

export function createGoal(input: { title: string; description?: string; parentGoalId?: string }) {
  return apiFetch<{ goal: Goal }>('/api/goals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateGoal(
  id: string,
  input: {
    title?: string;
    description?: string;
    status?: GoalStatus;
    parentGoalId?: string | null;
  }
) {
  return apiFetch<{ goal: Goal }>(`/api/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteGoal(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/goals/${id}`, { method: 'DELETE' });
}
