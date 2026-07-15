import type { IssueStatus } from '../../db/schema';

/**
 * Single source of truth for legal status moves. Every write path (PATCH,
 * kanban drag, future agent tools) validates here; there is no other door.
 * done and cancelled are terminal until an explicit reopen flow exists.
 */
export const ALLOWED_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['in_progress', 'backlog', 'cancelled'],
  in_progress: ['in_review', 'blocked', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  in_review: ['done', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly IssueStatus[] = ['done', 'cancelled'];

export function isTransitionAllowed(from: IssueStatus, to: IssueStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
