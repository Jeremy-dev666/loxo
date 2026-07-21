import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  EXECUTION_WORKSPACE_TERMINAL_STATUSES,
  executionWorkspaces,
  projectRepositories,
  projects,
  runChangeSnapshots,
  type ExecutionWorkspace,
  type Issue,
  type ProjectRepository,
  type RunChangeSnapshot,
} from '../../db/schema';
import { badRequest, conflict, notFound } from '../../http/errors';
import { storage } from '../../storage/layout';
import type { TurnPermission } from '../runner/runner';
import { issueBranchName } from './branch-name';
import { localGitDriver } from './local-git-driver';
import {
  GitDriverError,
  type BaseDriftReport,
  type WorkingTreeSnapshot,
} from './workspace.types';

const TERMINALS = [...EXECUTION_WORKSPACE_TERMINAL_STATUSES];

/** Translates driver failures into client-visible errors at the API boundary. */
function rethrowGitError(err: unknown): never {
  if (err instanceof GitDriverError) {
    throw badRequest(err.code, err.message);
  }
  throw err;
}

/** Server repositories live in the project workspace; machine roots arrive with Gate B. */
function repositoryRoot(userId: string, repository: ProjectRepository): string {
  if (repository.location !== 'server') {
    throw badRequest('machine_unsupported', 'Machine repositories are not available yet');
  }
  return storage.projectWorkspace(userId, repository.projectId);
}

export async function getProjectRepository(
  userId: string,
  projectId: string
): Promise<ProjectRepository | null> {
  const [row] = await db
    .select()
    .from(projectRepositories)
    .where(
      and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.userId, userId))
    )
    .limit(1);
  return row ?? null;
}

export interface BindRepositoryInput {
  location: 'server' | 'machine';
  defaultBaseRef?: string;
  branchPrefix?: string;
  cleanupPolicy?: 'manual' | 'after_merge';
}

export async function bindProjectRepository(
  userId: string,
  projectId: string,
  input: BindRepositoryInput
): Promise<ProjectRepository> {
  const [project] = await db
    .select({ id: projects.id, kind: projects.kind })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!project) throw notFound('Project not found');
  if (project.kind === 'default') {
    throw badRequest('default_project', 'The default project cannot enable code execution');
  }
  if (input.location !== 'server') {
    throw badRequest('machine_unsupported', 'Machine repositories arrive with the machine workspace milestone');
  }

  const baseRef = input.defaultBaseRef?.trim() || 'main';
  const rootPath = storage.projectWorkspace(userId, projectId);
  const info = await localGitDriver
    .inspectRepository({ rootPath, baseRef })
    .catch(rethrowGitError);

  const values = {
    location: 'server' as const,
    defaultBaseRef: baseRef,
    branchPrefix: input.branchPrefix?.trim() || 'swarmdev',
    cleanupPolicy: input.cleanupPolicy ?? ('manual' as const),
    repositoryFingerprint: info.fingerprint,
    updatedAt: new Date(),
  };

  const existing = await getProjectRepository(userId, projectId);
  if (existing) {
    const [updated] = await db
      .update(projectRepositories)
      .set(values)
      .where(eq(projectRepositories.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(projectRepositories)
    .values({ userId, projectId, ...values })
    .returning();
  return created!;
}

export interface RepositoryInspection {
  valid: boolean;
  error?: string;
  root?: string;
  baseRef?: string;
  baseCommit?: string;
  currentBranch?: string | null;
  dirty?: boolean;
}

export async function inspectProjectRepository(
  userId: string,
  projectId: string
): Promise<RepositoryInspection> {
  const repository = await getProjectRepository(userId, projectId);
  if (!repository) throw notFound('Project has no repository binding');
  try {
    const info = await localGitDriver.inspectRepository({
      rootPath: repositoryRoot(userId, repository),
      baseRef: repository.defaultBaseRef,
    });
    return {
      valid: true,
      root: info.root,
      baseRef: info.baseRef,
      baseCommit: info.baseCommit,
      currentBranch: info.currentBranch,
      dirty: info.dirty,
    };
  } catch (err) {
    if (err instanceof GitDriverError) return { valid: false, error: err.message };
    throw err;
  }
}

export async function unbindProjectRepository(userId: string, projectId: string): Promise<void> {
  const repository = await getProjectRepository(userId, projectId);
  if (!repository) throw notFound('Project has no repository binding');
  const [active] = await db
    .select({ id: executionWorkspaces.id })
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.repositoryId, repository.id),
        notInArray(executionWorkspaces.status, TERMINALS)
      )
    )
    .limit(1);
  if (active) {
    throw conflict(
      'workspace_active',
      'Merge, keep, or abandon the active issue workspaces before unbinding the repository'
    );
  }
  await db.delete(projectRepositories).where(eq(projectRepositories.id, repository.id));
}

export async function getIssueWorkspace(
  userId: string,
  issueId: string
): Promise<ExecutionWorkspace | null> {
  const [row] = await db
    .select()
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.issueId, issueId),
        eq(executionWorkspaces.userId, userId),
        notInArray(executionWorkspaces.status, TERMINALS)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function hasActiveWorkspaces(
  scope: { issueId: string } | { projectId: string }
): Promise<boolean> {
  const filter =
    'issueId' in scope
      ? eq(executionWorkspaces.issueId, scope.issueId)
      : eq(executionWorkspaces.projectId, scope.projectId);
  const [row] = await db
    .select({ id: executionWorkspaces.id })
    .from(executionWorkspaces)
    .where(and(filter, notInArray(executionWorkspaces.status, TERMINALS)))
    .limit(1);
  return row !== undefined;
}

async function updateWorkspace(
  id: string,
  patch: Partial<typeof executionWorkspaces.$inferInsert>
): Promise<ExecutionWorkspace> {
  const [row] = await db
    .update(executionWorkspaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(executionWorkspaces.id, id))
    .returning();
  return row!;
}

/** Once cumulative changes existed, a later zero-change observation never resets to ready. */
function ratchetStatus(
  current: ExecutionWorkspace['status'],
  observed: 'ready' | 'dirty'
): 'ready' | 'dirty' {
  return current === 'dirty' && observed === 'ready' ? 'dirty' : observed;
}

export interface ResolvedWorkspace {
  workspace: ExecutionWorkspace;
  repository: ProjectRepository;
}

/**
 * The single entry point for run admission: no repository binding means no
 * code workspace (legacy shared project workspace behavior); a binding means
 * the issue gets its isolated worktree, created or reused idempotently.
 */
export async function resolveExecutionWorkspace(
  userId: string,
  issue: Issue
): Promise<ResolvedWorkspace | null> {
  const repository = await getProjectRepository(userId, issue.projectId);
  if (!repository) return null;
  const workspace = await prepareIssueWorkspace(userId, issue, repository);
  if (workspace.status !== 'ready' && workspace.status !== 'dirty') {
    throw conflict(
      'workspace_unavailable',
      workspace.lastError ?? `Issue workspace is ${workspace.status}; reconcile it before running`
    );
  }
  return { workspace, repository };
}

export async function prepareIssueWorkspace(
  userId: string,
  issue: Issue,
  boundRepository?: ProjectRepository
): Promise<ExecutionWorkspace> {
  const repository =
    boundRepository ?? (await getProjectRepository(userId, issue.projectId)) ?? undefined;
  if (!repository) throw notFound('Project has no repository binding');
  const root = repositoryRoot(userId, repository);
  const worktreesRoot = storage.projectWorktreesRoot(userId, issue.projectId);

  let row = await getIssueWorkspace(userId, issue.id);
  if (!row) {
    const branchName = issueBranchName(repository.branchPrefix, issue.issueNumber, issue.id);
    const info = await localGitDriver
      .inspectRepository({ rootPath: root, baseRef: repository.defaultBaseRef })
      .catch(rethrowGitError);
    try {
      const [created] = await db
        .insert(executionWorkspaces)
        .values({
          userId,
          projectId: issue.projectId,
          issueId: issue.id,
          repositoryId: repository.id,
          location: 'server',
          worktreePath: path.join(worktreesRoot, issue.id),
          branchName,
          baseRef: repository.defaultBaseRef,
          baseCommit: info.baseCommit,
          status: 'preparing',
        })
        .returning();
      row = created!;
    } catch (err) {
      // Lost the partial-unique-index race; adopt the winner's row.
      const code = (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      if (code !== '23505') throw err;
      row = await getIssueWorkspace(userId, issue.id);
      if (!row) throw err;
    }
  }

  try {
    // The row's baseCommit is the immutable creation point: the worktree is
    // created exactly there, and reuse measures changes against it.
    const prepared = await localGitDriver.prepareWorkspace({
      repositoryRoot: root,
      worktreesRoot,
      issueId: issue.id,
      branchName: row.branchName,
      baseRef: row.baseRef,
      baseCommit: row.baseCommit,
    });
    if (prepared.state === 'error' || prepared.state === 'missing') {
      return updateWorkspace(row.id, {
        status: prepared.state,
        lastError: prepared.error,
      });
    }
    return updateWorkspace(row.id, {
      status: ratchetStatus(row.status, prepared.state),
      worktreePath: prepared.worktreePath,
      headCommit: prepared.headCommit,
      preparedAt: row.preparedAt ?? new Date(),
      lastError: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workspace preparation failed';
    await updateWorkspace(row.id, { status: 'error', lastError: message });
    rethrowGitError(err);
  }
}

export async function reconcileIssueWorkspace(
  userId: string,
  issueId: string
): Promise<ExecutionWorkspace> {
  const row = await getIssueWorkspace(userId, issueId);
  if (!row) throw notFound('Issue has no active workspace');
  const repository = await getProjectRepository(userId, row.projectId);
  if (!repository) throw conflict('repository_unbound', 'The project repository binding is gone');

  const result = await localGitDriver
    .reconcileWorkspace({
      repositoryRoot: repositoryRoot(userId, repository),
      worktreePath: row.worktreePath,
      branchName: row.branchName,
      baseCommit: row.baseCommit,
    })
    .catch(rethrowGitError);

  if (result.state === 'missing') {
    return updateWorkspace(row.id, { status: 'missing', lastError: null });
  }
  if (result.state === 'error') {
    return updateWorkspace(row.id, { status: 'error', lastError: result.error });
  }
  return updateWorkspace(row.id, {
    status: ratchetStatus(row.status, result.state),
    headCommit: result.headCommit,
    lastError: null,
  });
}

export async function snapshotBeforeRun(
  workspace: ExecutionWorkspace
): Promise<WorkingTreeSnapshot> {
  return localGitDriver.snapshotWorkingTree({ worktreePath: workspace.worktreePath });
}

export interface CaptureRunInput {
  runId: string;
  userId: string;
  workspace: ExecutionWorkspace;
  before: WorkingTreeSnapshot;
  permission: TurnPermission;
}

export interface CaptureRunResult {
  snapshot: RunChangeSnapshot;
  policyViolation: boolean;
}

/**
 * Platform-collected evidence after a run settles, regardless of outcome.
 * Agent-authored summaries are never treated as proof.
 */
export async function captureRunChanges(input: CaptureRunInput): Promise<CaptureRunResult> {
  const captured = await localGitDriver.captureChanges({
    worktreePath: input.workspace.worktreePath,
    beforeHead: input.before.head,
    baseCommit: input.workspace.baseCommit,
  });

  let patchStorageKey: string | null = null;
  if (captured.patch.length > 0) {
    const dir = storage.projectCodeArtifacts(input.userId, input.workspace.projectId, input.runId);
    const target = path.join(dir, 'changes.patch');
    fs.writeFileSync(target, captured.patch);
    patchStorageKey = target;
  }

  const policyViolation = input.permission === 'read_only' && captured.trackedChanges;
  const [snapshot] = await db
    .insert(runChangeSnapshots)
    .values({
      runId: input.runId,
      executionWorkspaceId: input.workspace.id,
      beforeHead: input.before.head,
      afterHead: captured.afterHead,
      changedFiles: captured.changedFiles,
      additions: captured.additions,
      deletions: captured.deletions,
      beforeSummaryJson: input.before.summary,
      afterSummaryJson: captured.summary,
      changeFingerprint: captured.fingerprint,
      patchStorageKey,
      patchTruncated: captured.patchTruncated,
      policyViolation,
    })
    .returning();

  const hasChanges = captured.afterHead !== input.workspace.baseCommit || captured.changedFiles > 0;
  await updateWorkspace(input.workspace.id, {
    status: ratchetStatus(input.workspace.status, hasChanges ? 'dirty' : 'ready'),
    headCommit: captured.afterHead,
    lastRunId: input.runId,
  });

  return { snapshot: snapshot!, policyViolation };
}

/** Latest platform-captured snapshot for the issue's active workspace; approval binds to it. */
export async function latestIssueSnapshot(
  userId: string,
  issueId: string
): Promise<RunChangeSnapshot | null> {
  const workspace = await getIssueWorkspace(userId, issueId);
  if (!workspace) return null;
  const [row] = await db
    .select()
    .from(runChangeSnapshots)
    .where(eq(runChangeSnapshots.executionWorkspaceId, workspace.id))
    .orderBy(desc(runChangeSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

export interface IssueChangesView {
  workspace: ExecutionWorkspace;
  snapshot: RunChangeSnapshot | null;
  drift: BaseDriftReport | null;
}

export async function getIssueChanges(userId: string, issueId: string): Promise<IssueChangesView> {
  const workspace = await getIssueWorkspace(userId, issueId);
  if (!workspace) throw notFound('Issue has no active workspace');
  const snapshot = await latestIssueSnapshot(userId, issueId);
  const repository = await getProjectRepository(userId, workspace.projectId);

  let drift: BaseDriftReport | null = null;
  if (repository && (workspace.status === 'ready' || workspace.status === 'dirty')) {
    drift = await localGitDriver
      .reportBaseDrift({
        repositoryRoot: repositoryRoot(userId, repository),
        baseRef: workspace.baseRef,
        baseCommit: workspace.baseCommit,
        branchName: workspace.branchName,
      })
      .catch(() => null);
  }
  return { workspace, snapshot, drift };
}
