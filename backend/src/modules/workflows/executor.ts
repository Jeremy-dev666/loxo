import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowExecutionStatus, WorkflowNodeStatus } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { storage } from '../../storage/layout';
import {
  validateGraph,
  type AgentNode,
  type WorkflowDsl,
  type WorkflowEdge,
  type WorkflowNode,
} from '../teams/workflow-dsl';
import {
  persistNodeOutput,
  readArtifactPreview,
  sanitizeFileName,
  type NodeArtifact,
} from './artifacts';
import { registerDeliverable } from './deliverables.service';
import {
  addArtifacts,
  appendEvent,
  createExecution,
  getExecution,
  updateExecution,
  updateNodeState,
  type ExecutionDetail,
} from './execution-store';

/**
 * Workflow executor. Postgres holds the durable record (Stage 1); this module
 * keeps the scheduling state for in-flight executions in memory and writes
 * every transition through.
 *
 * Scheduling model:
 * - An edge becomes EXPECTED when its source node starts, and ACTIVE when the
 *   source succeeds (condition nodes activate only the chosen branch). A node
 *   with incoming edges is ready once at least one is active and every
 *   active/expected edge's source is settled — this is what makes parallel
 *   joins wait for all in-flight branches.
 * - A node whose upstreams all settled without activating any edge into it is
 *   skipped; skips cascade.
 * - state-machine mode re-runs nodes: activating an edge into a succeeded or
 *   skipped node resets it to pending while runCount stays below the
 *   iteration cap. (Reviving skipped nodes is deliberate: without it a loop
 *   that first takes the "no" branch could never execute the "yes" path.)
 * - A node failure fails the whole execution; cancel stops scheduling but
 *   leaves node states as they were.
 */

const TERMINAL_NODE: ReadonlySet<WorkflowNodeStatus> = new Set(['succeeded', 'failed', 'skipped']);
const EVENT_OUTPUT_PREVIEW_CHARS = 2000;
const DRY_RUN_NODE_DELAY_MS = Number(process.env.WORKFLOW_DRY_RUN_NODE_DELAY_MS ?? 120);

interface NodeRuntime {
  node: WorkflowNode;
  status: WorkflowNodeStatus;
  runCount: number;
  output: string;
  /** Artifacts of the latest run; used for downstream handoff previews. */
  artifacts: NodeArtifact[];
  error?: string;
}

export interface RunPaths {
  runRoot: string;
  workspace: string;
  artifacts: string;
}

interface LiveExecution {
  id: string;
  userId: string;
  teamId: string;
  projectId: string | null;
  task: string;
  dryRun: boolean;
  workflow: WorkflowDsl;
  status: WorkflowExecutionStatus;
  nodes: Map<string, NodeRuntime>;
  incoming: Map<string, WorkflowEdge[]>;
  outgoing: Map<string, WorkflowEdge[]>;
  activeEdges: Set<string>;
  expectedEdges: Set<string>;
  running: Map<string, Promise<void>>;
  seq: number;
  abort: AbortController;
  paths: RunPaths;
  finalOutput?: string;
  error?: string;
}

export interface NodeStateSummary {
  nodeId: string;
  type: WorkflowNode['type'];
  label: string;
  status: WorkflowNodeStatus;
  runCount: number;
  error?: string;
}

/** Slim per-event frame pushed to the websocket layer. */
export interface WorkflowEventDelta {
  executionId: string;
  userId: string;
  teamId: string;
  projectId: string | null;
  workflowName: string;
  status: WorkflowExecutionStatus;
  event: {
    seq: number;
    type: string;
    nodeId?: string;
    message: string;
    payload: Record<string, unknown>;
  };
  nodeStates: NodeStateSummary[];
  finalOutput?: string;
  error?: string;
}

export const executorEvents = new EventEmitter();

const liveExecutions = new Map<string, LiveExecution>();

export interface AgentNodeRequest {
  executionId: string;
  userId: string;
  workflowName: string;
  task: string;
  node: AgentNode;
  input: string;
  runCount: number;
  paths: RunPaths;
  timeoutSec: number;
  signal: AbortSignal;
}

export interface AgentNodeResult {
  output: string;
  artifacts: NodeArtifact[];
}

export type AgentNodeRunner = (request: AgentNodeRequest) => Promise<AgentNodeResult>;

let defaultAgentNodeRunner: AgentNodeRunner = async () => {
  throw new Error('Agent node execution is not available');
};
let agentNodeRunner: AgentNodeRunner = (request) => defaultAgentNodeRunner(request);

/** Called once by the agent-node module to install the real runner. */
export function registerAgentNodeRunner(runner: AgentNodeRunner): void {
  defaultAgentNodeRunner = runner;
}

/** Test seam: swap the agent runner without spawning CLI processes. */
export function setAgentNodeRunnerForTests(runner: AgentNodeRunner | null): void {
  agentNodeRunner = runner ?? ((request) => defaultAgentNodeRunner(request));
}

function ensured(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveRunPaths(
  userId: string,
  teamId: string,
  projectId: string | null,
  executionId: string
): RunPaths {
  if (projectId) {
    const workspace = storage.projectWorkspace(userId, projectId);
    const runRoot = ensured(path.join(workspace, '.swarmdev', 'runs', executionId));
    return { runRoot, workspace, artifacts: ensured(path.join(runRoot, 'artifacts')) };
  }
  const dirs = storage.teamRunDirs(userId, teamId, executionId);
  return { runRoot: dirs.root, workspace: dirs.workspace, artifacts: dirs.artifacts };
}

function nodeMaxRuns(live: LiveExecution): number {
  if (live.workflow.execution.mode === 'state-machine') {
    return Math.max(1, live.workflow.execution.maxIterations ?? 3);
  }
  return 1;
}

function summaries(live: LiveExecution): NodeStateSummary[] {
  return [...live.nodes.values()].map((state) => ({
    nodeId: state.node.id,
    type: state.node.type,
    label: state.node.label,
    status: state.status,
    runCount: state.runCount,
    error: state.error,
  }));
}

function slimPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const output = payload.output;
  if (typeof output !== 'string' || output.length <= EVENT_OUTPUT_PREVIEW_CHARS) return payload;
  return { ...payload, output: `${output.slice(0, EVENT_OUTPUT_PREVIEW_CHARS)}\n[output truncated]` };
}

async function emitEvent(
  live: LiveExecution,
  type: string,
  fields: { nodeId?: string; message: string; payload?: Record<string, unknown> }
): Promise<void> {
  live.seq += 1;
  const seq = live.seq;
  const payload = fields.payload ?? {};
  await appendEvent(live.id, {
    seq,
    type,
    nodeId: fields.nodeId ?? null,
    message: fields.message,
    payload,
  });
  const delta: WorkflowEventDelta = {
    executionId: live.id,
    userId: live.userId,
    teamId: live.teamId,
    projectId: live.projectId,
    workflowName: live.workflow.name,
    status: live.status,
    event: { seq, type, nodeId: fields.nodeId, message: fields.message, payload: slimPayload(payload) },
    nodeStates: summaries(live),
    finalOutput: live.finalOutput,
    error: live.error,
  };
  executorEvents.emit('workflowEvent', delta);
}

export interface StartExecutionInput {
  userId: string;
  teamId: string;
  projectId?: string | null;
  task: string;
  dryRun?: boolean;
  workflow: WorkflowDsl;
}

export async function startExecution(input: StartExecutionInput): Promise<ExecutionDetail> {
  const { errors } = validateGraph(input.workflow.nodes, input.workflow.edges);
  if (errors.length > 0) {
    throw badRequest('invalid_workflow', errors[0]!.message);
  }

  const detail = await createExecution({
    userId: input.userId,
    teamId: input.teamId,
    projectId: input.projectId ?? null,
    task: input.task,
    mode: input.workflow.execution.mode,
    dryRun: input.dryRun === true,
    workflow: input.workflow,
    nodeIds: input.workflow.nodes.map((n) => n.id),
  });

  const live: LiveExecution = {
    id: detail.id,
    userId: input.userId,
    teamId: input.teamId,
    projectId: input.projectId ?? null,
    task: input.task,
    dryRun: input.dryRun === true,
    workflow: input.workflow,
    status: 'queued',
    nodes: new Map(
      input.workflow.nodes.map((node) => [
        node.id,
        {
          node,
          status: 'pending' as WorkflowNodeStatus,
          runCount: 0,
          output: '',
          artifacts: [] as NodeArtifact[],
        },
      ])
    ),
    incoming: groupEdges(input.workflow.edges, (e) => e.to),
    outgoing: groupEdges(input.workflow.edges, (e) => e.from),
    activeEdges: new Set(),
    expectedEdges: new Set(),
    running: new Map(),
    seq: 0,
    abort: new AbortController(),
    paths: resolveRunPaths(input.userId, input.teamId, input.projectId ?? null, detail.id),
  };
  liveExecutions.set(live.id, live);

  void runLoop(live).catch((error) => {
    console.error(`Workflow execution ${live.id} crashed:`, error);
  });
  return detail;
}

export async function cancelExecution(
  userId: string,
  executionId: string
): Promise<ExecutionDetail | null> {
  const live = liveExecutions.get(executionId);
  if (live && live.userId === userId && (live.status === 'queued' || live.status === 'running')) {
    live.status = 'cancelled';
    live.abort.abort();
    await updateExecution(executionId, { status: 'cancelled', finishedAt: new Date() });
    await emitEvent(live, 'execution_cancelled', { message: 'Execution was cancelled' });
  }
  return getExecution(userId, executionId);
}

function groupEdges(
  edges: WorkflowEdge[],
  key: (edge: WorkflowEdge) => string
): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    map.set(key(edge), [...(map.get(key(edge)) ?? []), edge]);
  }
  return map;
}

async function runLoop(live: LiveExecution): Promise<void> {
  live.status = 'running';
  await updateExecution(live.id, { status: 'running', startedAt: new Date() });
  await emitEvent(live, 'execution_started', {
    message: `Execution started (${live.workflow.execution.mode} mode${live.dryRun ? ', dry run' : ''})`,
    payload: {
      task: live.task,
      mode: live.workflow.execution.mode,
      dryRun: live.dryRun,
      workspace: live.paths.workspace,
    },
  });

  try {
    while (live.status === 'running') {
      await markSkippedNodes(live);
      await startReadyNodes(live);

      if (live.running.size === 0) {
        const pendingNodes = [...live.nodes.values()].filter(
          (state) => !TERMINAL_NODE.has(state.status)
        );
        if (pendingNodes.length === 0) break;
        throw new Error(
          `Workflow stalled: ${pendingNodes.map((s) => s.node.label).join(', ')} cannot be scheduled`
        );
      }
      await Promise.race(live.running.values());
    }

    if (live.status === 'running') {
      await finishExecution(live);
    }
  } catch (error) {
    await failExecution(live, error instanceof Error ? error.message : 'Execution failed');
  } finally {
    liveExecutions.delete(live.id);
  }
}

async function finishExecution(live: LiveExecution): Promise<void> {
  live.finalOutput = buildFinalOutput(live);
  live.status = 'succeeded';
  await updateExecution(live.id, {
    status: 'succeeded',
    finalOutput: live.finalOutput,
    finishedAt: new Date(),
  });
  await emitEvent(live, 'execution_completed', {
    message: 'Execution completed',
    payload: { output: live.finalOutput },
  });
}

async function failExecution(live: LiveExecution, error: string): Promise<void> {
  if (live.status !== 'running' && live.status !== 'queued') return;
  live.status = 'failed';
  live.error = error;
  await updateExecution(live.id, { status: 'failed', error, finishedAt: new Date() });
  await emitEvent(live, 'execution_failed', { message: error, payload: { error } });
}

function buildFinalOutput(live: LiveExecution): string {
  const endOutputs = [...live.nodes.values()]
    .filter((state) => state.node.type === 'end' && state.output.trim())
    .map((state) => state.output.trim());
  if (endOutputs.length > 0) return endOutputs.join('\n\n');

  return [...live.nodes.values()]
    .filter((state) => state.output.trim())
    .map((state) => `## ${state.node.label}\n\n${state.output.trim()}`)
    .join('\n\n');
}

async function markSkippedNodes(live: LiveExecution): Promise<void> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of live.nodes.values()) {
      if (TERMINAL_NODE.has(state.status) || state.status === 'running') continue;
      if (state.node.id === live.workflow.entryNodeId) continue;
      const incoming = live.incoming.get(state.node.id) ?? [];
      if (incoming.length === 0) continue;

      const everySourceSettled = incoming.every((edge) =>
        TERMINAL_NODE.has(live.nodes.get(edge.from)?.status ?? 'pending')
      );
      const anyActive = incoming.some((edge) => live.activeEdges.has(edge.id));
      if (everySourceSettled && !anyActive) {
        state.status = 'skipped';
        await updateNodeState(live.id, state.node.id, {
          status: 'skipped',
          finishedAt: new Date(),
        });
        await emitEvent(live, 'node_skipped', {
          nodeId: state.node.id,
          message: `${state.node.label} was skipped: no active branch reached it`,
        });
        changed = true;
      }
    }
  }
}

async function startReadyNodes(live: LiveExecution): Promise<void> {
  // Cancellation can land at any await point; never launch past it.
  if (live.status !== 'running') return;
  const capacity = Math.max(1, live.workflow.execution.maxConcurrency) - live.running.size;
  if (capacity <= 0) return;

  const ready: NodeRuntime[] = [];
  for (const state of live.nodes.values()) {
    if (state.status !== 'pending' && state.status !== 'ready') continue;
    if (state.runCount >= nodeMaxRuns(live)) continue;

    const incoming = live.incoming.get(state.node.id) ?? [];
    if (incoming.length === 0) {
      if (state.node.id !== live.workflow.entryNodeId && state.node.type !== 'start') continue;
    } else {
      const anyActive = incoming.some((edge) => live.activeEdges.has(edge.id));
      if (!anyActive) continue;
      const blocking = incoming.filter(
        (edge) => live.activeEdges.has(edge.id) || live.expectedEdges.has(edge.id)
      );
      const allSettled = blocking.every((edge) => {
        const source = live.nodes.get(edge.from);
        return source?.status === 'succeeded' || source?.status === 'skipped';
      });
      if (!allSettled) continue;
    }

    if (state.status === 'pending') {
      state.status = 'ready';
      await updateNodeState(live.id, state.node.id, { status: 'ready' });
      await emitEvent(live, 'node_ready', {
        nodeId: state.node.id,
        message: `${state.node.label} is ready`,
      });
    }
    ready.push(state);
  }

  for (const state of ready.slice(0, capacity)) {
    if (live.status !== 'running') return;
    await beginNode(live, state);
  }
}

async function beginNode(live: LiveExecution, state: NodeRuntime): Promise<void> {
  state.status = 'running';
  state.runCount += 1;
  state.error = undefined;
  await updateNodeState(live.id, state.node.id, {
    status: 'running',
    runCount: state.runCount,
    error: null,
    startedAt: new Date(),
    finishedAt: null,
  });

  // Expected edges make downstream joins wait for this branch. Condition
  // nodes are exempt: only the chosen branch should ever count.
  if (state.node.type !== 'condition') {
    for (const edge of live.outgoing.get(state.node.id) ?? []) {
      live.expectedEdges.add(edge.id);
    }
  }

  await emitEvent(live, 'node_started', {
    nodeId: state.node.id,
    message: `${state.node.label} started (run ${state.runCount})`,
    payload: {
      runCount: state.runCount,
      kind: state.node.type === 'agent' ? state.node.kind : state.node.type,
    },
  });

  const promise = executeNode(live, state)
    .catch(async (error) => {
      await markNodeFailed(
        live,
        state,
        error instanceof Error ? error.message : 'Node execution failed'
      );
    })
    .finally(() => {
      live.running.delete(state.node.id);
    });
  live.running.set(state.node.id, promise);
}

async function executeNode(live: LiveExecution, state: NodeRuntime): Promise<void> {
  const node = state.node;

  if (node.type === 'start') {
    await markNodeSucceeded(live, state, live.task);
    return;
  }

  if (node.type === 'condition') {
    const input = buildNodeInput(live, node.id);
    const { branch, source } = evaluateCondition(live, node.id, input);
    await activateOutgoingEdges(live, node.id, branch);
    state.output = `branch:${branch}`;
    await markNodeSucceeded(live, state, state.output);
    await emitEvent(live, 'branch_selected', {
      nodeId: node.id,
      message: `${node.label} selected the "${branch}" branch (${source})`,
      payload: { branch, source, expression: node.expression },
    });
    return;
  }

  if (node.type === 'end') {
    await markNodeSucceeded(live, state, buildNodeInput(live, node.id));
    return;
  }

  // Agent node.
  const input = buildNodeInput(live, node.id);
  if (live.dryRun) {
    await new Promise((resolve) => setTimeout(resolve, DRY_RUN_NODE_DELAY_MS));
    let output = [
      `Dry run: ${node.label} completed without invoking an agent.`,
      `Kind: ${node.kind}${node.role ? ` (${node.role})` : ''}`,
      `Task: ${live.task}`,
    ].join('\n');
    const handoff = writeDryRunHandoff(live, state);
    if (handoff) output += `\nHandoff file: ${handoff.path}`;
    await markNodeSucceeded(live, state, output, handoff ? [handoff] : []);
    return;
  }

  if (!node.agentId) {
    throw new Error(`Agent node "${node.label}" has no bound agent`);
  }

  const result = await agentNodeRunner({
    executionId: live.id,
    userId: live.userId,
    workflowName: live.workflow.name,
    task: live.task,
    node,
    input,
    runCount: state.runCount,
    paths: live.paths,
    timeoutSec: Math.max(1, live.workflow.execution.timeoutSec),
    signal: live.abort.signal,
  });
  await markNodeSucceeded(live, state, result.output, result.artifacts);
}

async function markNodeSucceeded(
  live: LiveExecution,
  state: NodeRuntime,
  output: string,
  workspaceArtifacts: NodeArtifact[] = []
): Promise<void> {
  // Persist output to disk before activating edges: downstream inputs may
  // reference these files the moment the next node starts.
  const outputArtifact = persistNodeOutput({
    runRoot: live.paths.runRoot,
    artifactsDir: live.paths.artifacts,
    executionId: live.id,
    workflowName: live.workflow.name,
    nodeId: state.node.id,
    nodeLabel: state.node.label,
    runCount: state.runCount,
    output,
  });
  const artifacts = [...workspaceArtifacts, outputArtifact];

  state.status = 'succeeded';
  state.output = output;
  state.artifacts = artifacts;
  await addArtifacts(
    live.id,
    artifacts.map(({ absolutePath: _abs, ...row }) => row)
  );
  await updateNodeState(live.id, state.node.id, {
    status: 'succeeded',
    output,
    finishedAt: new Date(),
  });
  if (state.node.type !== 'condition') {
    await activateOutgoingEdges(live, state.node.id);
  }
  await emitEvent(live, 'node_completed', {
    nodeId: state.node.id,
    message: `${state.node.label} completed`,
    payload: { output, runCount: state.runCount, artifacts: artifacts.map((a) => a.path) },
  });
  await registerNodeDeliverables(live, state, workspaceArtifacts);
}

/** Scaffold files the agent runtime drops into fresh workspaces. */
const SCAFFOLD_BASENAMES = new Set([
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
]);

function isDeliverableFile(relPath: string): boolean {
  if (relPath.startsWith('handoff/') || relPath.startsWith('.swarmdev/')) return false;
  const basename = relPath.split('/').pop() ?? '';
  return !SCAFFOLD_BASENAMES.has(basename);
}

/**
 * Project executions surface agent file output for review. Registration
 * failures never fail the node — the work itself already succeeded.
 */
async function registerNodeDeliverables(
  live: LiveExecution,
  state: NodeRuntime,
  workspaceArtifacts: NodeArtifact[]
): Promise<void> {
  if (!live.projectId || state.node.type !== 'agent') return;
  const files = workspaceArtifacts.filter(
    (a) => a.kind === 'workspace-file' && isDeliverableFile(a.path)
  );
  for (const file of files) {
    try {
      const deliverable = await registerDeliverable({
        userId: live.userId,
        projectId: live.projectId,
        executionId: live.id,
        nodeId: state.node.id,
        agentId: state.node.agentId ?? null,
        filePath: file.path,
      });
      await emitEvent(live, 'deliverable_created', {
        nodeId: state.node.id,
        message: `${file.path} was registered for review`,
        payload: { deliverableId: deliverable.id, filePath: file.path },
      });
    } catch (error) {
      console.error(`Failed to register deliverable ${file.path}:`, error);
    }
  }
}

async function markNodeFailed(
  live: LiveExecution,
  state: NodeRuntime,
  error: string
): Promise<void> {
  state.status = 'failed';
  state.error = error;
  await updateNodeState(live.id, state.node.id, {
    status: 'failed',
    error,
    finishedAt: new Date(),
  });
  await emitEvent(live, 'node_failed', {
    nodeId: state.node.id,
    message: `${state.node.label} failed: ${error}`,
    payload: { error },
  });
  await failExecution(live, `${state.node.label} failed: ${error}`);
}

/**
 * Activates outgoing edges after a node settles. In state-machine mode a
 * re-activated edge revives its settled target (up to the iteration cap) so
 * feedback loops can re-run nodes — including previously skipped ones.
 */
async function activateOutgoingEdges(
  live: LiveExecution,
  nodeId: string,
  branch?: 'yes' | 'no'
): Promise<void> {
  const node = live.nodes.get(nodeId)!.node;
  const edges = live.outgoing.get(nodeId) ?? [];
  const selected = node.type === 'condition' ? edges.filter((e) => e.branch === branch) : edges;

  let activated = 0;
  for (const edge of selected) {
    const target = live.nodes.get(edge.to);
    if (!target) continue;
    if (target.runCount >= nodeMaxRuns(live)) {
      await emitEvent(live, 'max_iterations', {
        nodeId: edge.to,
        message: `${target.node.label} reached its iteration cap and will not run again`,
      });
      continue;
    }
    live.activeEdges.add(edge.id);
    activated += 1;
    if (
      live.workflow.execution.mode === 'state-machine' &&
      (target.status === 'succeeded' || target.status === 'skipped')
    ) {
      target.status = 'pending';
      await updateNodeState(live.id, edge.to, {
        status: 'pending',
        startedAt: null,
        finishedAt: null,
      });
    }
  }

  // A condition must not dead-end the flow: if the chosen branch activated
  // nothing (e.g. its target hit the cap), fall back to the other branch.
  if (node.type === 'condition' && activated === 0) {
    const fallback = edges.find((e) => e.branch && e.branch !== branch);
    if (fallback) live.activeEdges.add(fallback.id);
  }
}

const HANDOFF_PREVIEW_BUDGET_CHARS = 24_000;

function buildNodeInput(live: LiveExecution, nodeId: string): string {
  const activeIncoming = (live.incoming.get(nodeId) ?? []).filter((edge) =>
    live.activeEdges.has(edge.id)
  );
  if (activeIncoming.length === 0) return live.task;

  let previewBudget = HANDOFF_PREVIEW_BUDGET_CHARS;
  const sections = activeIncoming.map((edge) => {
    const source = live.nodes.get(edge.from);
    const label = source?.node.label ?? edge.from;
    const output = source?.output.trim() || '(no output)';
    const parts = [`## Upstream: ${label}`, output];

    const files = (source?.artifacts ?? []).filter((a) => a.kind === 'workspace-file');
    if (files.length > 0) {
      const lines = ['### Handoff files'];
      for (const file of files) {
        lines.push(`- ${file.path} (${file.label}, ${file.size} bytes)`);
        if (previewBudget <= 0) continue;
        const preview = readArtifactPreview(file.absolutePath);
        if (!preview) continue;
        const text = preview.text.slice(0, previewBudget).replace(/```/g, '~~~');
        previewBudget -= text.length;
        lines.push('', '~~~', text + (preview.truncated ? '\n[preview truncated]' : ''), '~~~');
      }
      parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
  });
  return sections.join('\n\n');
}

/**
 * Dry runs normally leave the workspace untouched; the env flag lets smoke
 * tests exercise the handoff-file path without real agents.
 */
function writeDryRunHandoff(live: LiveExecution, state: NodeRuntime): NodeArtifact | null {
  if (process.env.WORKFLOW_DRY_RUN_WRITE_HANDOFF !== '1') return null;
  const dir = path.join(live.paths.workspace, 'handoff');
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${sanitizeFileName(state.node.id)}-run-${state.runCount}.md`;
  const absolutePath = path.join(dir, fileName);
  const content = [
    `# Dry run handoff: ${state.node.label}`,
    '',
    `- Workflow: ${live.workflow.name}`,
    `- Execution: ${live.id}`,
    `- Run: ${state.runCount}`,
    '',
    live.task,
    '',
  ].join('\n');
  fs.writeFileSync(absolutePath, content, 'utf8');
  return {
    nodeId: state.node.id,
    runCount: state.runCount,
    kind: 'workspace-file',
    label: 'created',
    path: `handoff/${fileName}`,
    size: Buffer.byteLength(content),
    absolutePath,
  };
}

/**
 * Branch decision (deviation #8): a structured directive emitted by a judge
 * agent wins; keyword heuristics are the fallback. When every "no" target is
 * already at the iteration cap the branch is forced to "yes" to break loops.
 */
const BRANCH_DIRECTIVE = /\{[^{}]*"branch"\s*:\s*"(yes|no)"[^{}]*\}/gi;
const NO_SIGNALS = /\b(?:retry|revise|reject(?:ed)?|fail(?:ed|s|ure)?|no|not\s+(?:passed|approved))\b/i;

export function parseBranchDirective(text: string): 'yes' | 'no' | null {
  let last: 'yes' | 'no' | null = null;
  for (const match of text.matchAll(BRANCH_DIRECTIVE)) {
    last = match[1]!.toLowerCase() as 'yes' | 'no';
  }
  return last;
}

function evaluateCondition(
  live: LiveExecution,
  nodeId: string,
  input: string
): { branch: 'yes' | 'no'; source: 'directive' | 'heuristic' | 'forced' } {
  const directive = parseBranchDirective(input);
  let branch: 'yes' | 'no';
  let source: 'directive' | 'heuristic' | 'forced';
  if (directive) {
    branch = directive;
    source = 'directive';
  } else {
    branch = NO_SIGNALS.test(input) ? 'no' : 'yes';
    source = 'heuristic';
  }

  if (branch === 'no') {
    const maxIterations = live.workflow.execution.maxIterations ?? 3;
    const noEdges = (live.outgoing.get(nodeId) ?? []).filter((e) => e.branch === 'no');
    const allCapped =
      noEdges.length > 0 &&
      noEdges.every((e) => (live.nodes.get(e.to)?.runCount ?? 0) >= maxIterations);
    if (allCapped) {
      branch = 'yes';
      source = 'forced';
    }
  }
  return { branch, source };
}
