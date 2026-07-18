export type NodeKind =
  | 'worker'
  | 'orchestrator'
  | 'router'
  | 'aggregator'
  | 'judge'
  | 'evaluator'
  | 'optimizer';

export const NODE_KINDS: NodeKind[] = [
  'worker',
  'orchestrator',
  'router',
  'aggregator',
  'judge',
  'evaluator',
  'optimizer',
];

export interface Position {
  x: number;
  y: number;
}

export interface StartNode {
  id: string;
  type: 'start';
  label: string;
  position?: Position;
}

export interface AgentNode {
  id: string;
  type: 'agent';
  label: string;
  agentId?: string; // bound agent instance; unbound nodes fail at execution
  kind: NodeKind;
  role?: string;
  position?: Position;
}

export interface ConditionNode {
  id: string;
  type: 'condition';
  label: string;
  expression: string; // criterion the judge/heuristic evaluates
  position?: Position;
}

export interface EndNode {
  id: string;
  type: 'end';
  label: string;
  position?: Position;
}

export type WorkflowNode = StartNode | AgentNode | ConditionNode | EndNode;

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  branch?: 'yes' | 'no'; // meaningful only when `from` is a condition node
  label?: string;
}

export interface WorkflowDsl {
  version: '1';
  name: string;
  description: string;
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  execution: {
    mode: 'dag' | 'state-machine';
    maxConcurrency: number;
    timeoutSec: number;
    maxIterations?: number; // per-node run cap in state-machine mode
  };
  metadata?: {
    source?: 'canvas' | 'generated' | 'fallback' | 'template';
    pattern?: string;
    /** Bumps each time a confirmed draft replaces this workflow. */
    version?: number;
    origin?: WorkflowOrigin;
  };
}

/** Provenance for workflows crystallized out of a workshop discussion. */
export interface WorkflowOrigin {
  kind: 'workshop';
  sessionId: string;
  sessionTitle: string;
  revision: number;
  feedback?: string;
  notes: Array<{ column: string; text: string; authorName: string }>;
  confirmedAt: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_SEC = 1800;
const DEFAULT_MAX_ITERATIONS = 3;

export function slugifyId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function detectCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return start >= 0 ? [...path.slice(start), id] : [id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const node of nodes) {
    const found = visit(node.id);
    if (found) return found;
  }
  return null;
}

/**
 * Structural validation shared by the API and the executor. Errors block
 * saving for execution; warnings do not.
 */
export function validateGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      errors.push({ code: 'duplicate_node', message: `Duplicate node id: ${node.id}`, nodeId: node.id });
    }
    ids.add(node.id);
  }

  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  const agents = nodes.filter((n) => n.type === 'agent');
  if (starts.length !== 1) {
    errors.push({ code: 'start_count', message: `Workflow needs exactly one start node, found ${starts.length}` });
  }
  if (ends.length < 1) {
    errors.push({ code: 'missing_end', message: 'Workflow needs at least one end node' });
  }
  if (agents.length < 1) {
    errors.push({ code: 'missing_agent', message: 'Workflow needs at least one agent node' });
  }

  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  const seenEdges = new Set<string>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const edge of edges) {
    const key = `${edge.from}:${edge.branch ?? ''}:${edge.to}`;
    if (seenEdges.has(key)) {
      errors.push({ code: 'duplicate_edge', message: `Duplicate edge ${edge.from} -> ${edge.to}`, edgeId: edge.id });
    }
    seenEdges.add(key);

    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      errors.push({ code: 'dangling_edge', message: `Edge ${edge.id} references a missing node`, edgeId: edge.id });
      continue;
    }
    if (edge.from === edge.to) {
      errors.push({ code: 'self_loop', message: `Node ${edge.from} connects to itself`, edgeId: edge.id });
    }
    if (from.type === 'end') {
      errors.push({ code: 'end_outgoing', message: 'End nodes cannot have outgoing edges', edgeId: edge.id });
    }
    if (to.type === 'start') {
      errors.push({ code: 'start_incoming', message: 'Start nodes cannot have incoming edges', edgeId: edge.id });
    }
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  for (const node of nodes) {
    if (node.type !== 'start' && (incoming.get(node.id)?.length ?? 0) === 0) {
      errors.push({ code: 'unreachable', message: `Node "${node.label}" has no incoming edge`, nodeId: node.id });
    }
    if (node.type !== 'end' && (outgoing.get(node.id)?.length ?? 0) === 0) {
      errors.push({ code: 'dead_end', message: `Node "${node.label}" has no outgoing edge`, nodeId: node.id });
    }
    if (node.type === 'agent' && !node.agentId) {
      warnings.push({ code: 'unbound_agent', message: `Agent node "${node.label}" is not bound to an agent`, nodeId: node.id });
    }
    if (node.type === 'condition') {
      const branches = (outgoing.get(node.id) ?? []).map((e) => e.branch);
      if (!branches.includes('yes')) {
        errors.push({ code: 'condition_missing_yes', message: `Condition "${node.label}" is missing its yes branch`, nodeId: node.id });
      }
      if (!branches.includes('no')) {
        errors.push({ code: 'condition_missing_no', message: `Condition "${node.label}" is missing its no branch`, nodeId: node.id });
      }
    }
  }

  // Reachability from start and path-to-end, only when the basics hold.
  if (starts.length === 1 && errors.length === 0) {
    const reachable = new Set<string>([starts[0]!.id]);
    const queue = [starts[0]!.id];
    while (queue.length > 0) {
      for (const edge of outgoing.get(queue.shift()!) ?? []) {
        if (!reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        errors.push({ code: 'unreachable', message: `Node "${node.label}" cannot be reached from start`, nodeId: node.id });
      }
    }
  }

  const cycle = detectCycle(nodes, edges);
  if (cycle) {
    warnings.push({
      code: 'cycle',
      message: `Cycle detected (${cycle.join(' -> ')}); execution will run in state-machine mode with an iteration cap`,
    });
  }

  return { errors, warnings };
}

/**
 * Coerces an untrusted DSL draft (LLM output or client payload) into a valid
 * workflow: sanitizes ids, drops unknown references, guarantees start/end,
 * repairs missing links and condition branches, and picks the execution mode.
 */
export function normalizeDsl(raw: unknown, knownAgentIds: Set<string>): WorkflowDsl {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const usedIds = new Set<string>();
  const idMap = new Map<string, string>();

  const uniqueId = (base: string): string => {
    let candidate = base;
    for (let i = 2; usedIds.has(candidate); i += 1) candidate = `${base}-${i}`;
    usedIds.add(candidate);
    return candidate;
  };

  const nodes: WorkflowNode[] = [];
  rawNodes.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const type = ['start', 'agent', 'condition', 'end'].includes(record.type as string)
      ? (record.type as WorkflowNode['type'])
      : 'agent';
    const rawId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${type}-${index + 1}`;
    const id = uniqueId(slugifyId(rawId, `${type}-${index + 1}`));
    idMap.set(rawId, id);

    const label =
      typeof record.label === 'string' && record.label.trim() ? record.label.trim() : defaultLabel(type, index);
    const position =
      record.position &&
      typeof record.position === 'object' &&
      typeof (record.position as Position).x === 'number' &&
      typeof (record.position as Position).y === 'number'
        ? { x: (record.position as Position).x, y: (record.position as Position).y }
        : undefined;

    if (type === 'start') nodes.push({ id, type, label, position });
    else if (type === 'end') nodes.push({ id, type, label, position });
    else if (type === 'condition') {
      nodes.push({
        id,
        type,
        label,
        expression:
          typeof record.expression === 'string' && record.expression.trim() ? record.expression.trim() : label,
        position,
      });
    } else {
      const requestedAgent = typeof record.agentId === 'string' ? record.agentId : undefined;
      nodes.push({
        id,
        type: 'agent',
        label,
        agentId: requestedAgent && knownAgentIds.has(requestedAgent) ? requestedAgent : undefined,
        kind: NODE_KINDS.includes(record.kind as NodeKind) ? (record.kind as NodeKind) : 'worker',
        role: typeof record.role === 'string' && record.role.trim() ? record.role.trim() : undefined,
        position,
      });
    }
  });

  // Guarantee boundary nodes.
  if (!nodes.some((n) => n.type === 'start')) {
    usedIds.add('start');
    nodes.unshift({ id: 'start', type: 'start', label: 'Task input' });
  }
  if (!nodes.some((n) => n.type === 'end')) {
    usedIds.add('end');
    nodes.push({ id: 'end', type: 'end', label: 'Final output' });
  }
  const start = nodes.find((n) => n.type === 'start')!;
  const end = nodes.find((n) => n.type === 'end')!;

  // Rebuild edges against sanitized ids; drop unknown/illegal ones.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const edges: WorkflowEdge[] = [];
  const edgeKeys = new Set<string>();

  const pushEdge = (from: string, to: string, branch?: 'yes' | 'no', label?: string) => {
    const key = `${from}:${branch ?? ''}:${to}`;
    if (edgeKeys.has(key) || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    if (nodeById.get(from)!.type === 'end' || nodeById.get(to)!.type === 'start') return;
    edgeKeys.add(key);
    edges.push({ id: `e-${edges.length + 1}-${from}-${to}`, from, to, branch, label });
  };

  for (const item of rawEdges) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const from = idMap.get(record.from as string) ?? slugifyId(String(record.from ?? ''), '');
    const to = idMap.get(record.to as string) ?? slugifyId(String(record.to ?? ''), '');
    const branch = record.branch === 'yes' || record.branch === 'no' ? record.branch : undefined;
    const fromNode = nodeById.get(from);
    pushEdge(
      from,
      to,
      fromNode?.type === 'condition' ? branch : undefined,
      typeof record.label === 'string' ? record.label : undefined
    );
  }

  // Repair: every non-start node needs an inflow, every non-end an outflow.
  for (const node of nodes) {
    if (node.type !== 'start' && !edges.some((e) => e.to === node.id)) {
      pushEdge(start.id, node.id);
    }
  }
  for (const node of nodes) {
    if (node.type === 'end') continue;
    if (node.type === 'condition') {
      const branches = edges.filter((e) => e.from === node.id);
      const yes = branches.find((e) => e.branch === 'yes');
      const no = branches.find((e) => e.branch === 'no');
      // Adopt unlabeled outgoing edges as branches before inventing new ones.
      const unlabeled = branches.filter((e) => !e.branch);
      if (!yes && unlabeled[0]) unlabeled[0].branch = 'yes';
      if (!no && unlabeled[1]) unlabeled[1].branch = 'no';
      if (!edges.some((e) => e.from === node.id && e.branch === 'yes')) pushEdge(node.id, end.id, 'yes', 'yes');
      if (!edges.some((e) => e.from === node.id && e.branch === 'no')) pushEdge(node.id, end.id, 'no', 'no');
      continue;
    }
    if (!edges.some((e) => e.from === node.id)) {
      pushEdge(node.id, end.id);
    }
  }

  const cycle = detectCycle(nodes, edges);
  const execution = (obj.execution ?? {}) as Record<string, unknown>;
  const rawIterations = Number(execution.maxIterations);

  return {
    version: '1',
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Untitled workflow',
    description: typeof obj.description === 'string' ? obj.description : '',
    entryNodeId: start.id,
    nodes,
    edges,
    execution: {
      mode: cycle ? 'state-machine' : 'dag',
      maxConcurrency: clampInt(execution.maxConcurrency, 1, 8, DEFAULT_MAX_CONCURRENCY),
      timeoutSec: clampInt(execution.timeoutSec, 30, 7200, DEFAULT_TIMEOUT_SEC),
      maxIterations: cycle ? clampInt(rawIterations, 1, 10, DEFAULT_MAX_ITERATIONS) : undefined,
    },
    metadata: (obj.metadata as WorkflowDsl['metadata']) ?? undefined,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function defaultLabel(type: WorkflowNode['type'], index: number): string {
  if (type === 'start') return 'Task input';
  if (type === 'end') return 'Final output';
  if (type === 'condition') return 'Review gate';
  return `Agent ${index + 1}`;
}
