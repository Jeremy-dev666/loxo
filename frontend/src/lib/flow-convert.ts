import type { Edge, Node } from '@xyflow/react';
import type { DslEdge, DslNode, WorkflowDsl } from './teams';

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  agentId?: string;
  kind?: string;
  role?: string;
  expression?: string;
}

/** Auto-layout for nodes without stored positions: BFS depth → column. */
function computePositions(dsl: WorkflowDsl): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const outgoing = new Map<string, DslEdge[]>();
  for (const edge of dsl.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const laneAtDepth = new Map<number, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: dsl.entryNodeId, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const lane = laneAtDepth.get(depth) ?? 0;
    laneAtDepth.set(depth, lane + 1);
    positions.set(id, { x: 60 + depth * 240, y: 80 + lane * 140 });
    for (const edge of outgoing.get(id) ?? []) {
      queue.push({ id: edge.to, depth: depth + 1 });
    }
  }
  dsl.nodes.forEach((node, index) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: 60 + index * 240, y: 420 });
    }
  });
  return positions;
}

export function dslToFlow(dsl: WorkflowDsl): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const positions = computePositions(dsl);
  const nodes: Node<CanvasNodeData>[] = dsl.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position ?? positions.get(node.id)!,
    data: {
      label: node.label,
      agentId: node.agentId,
      kind: node.kind,
      role: node.role,
      expression: node.expression,
    },
  }));
  const edges: Edge[] = dsl.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    sourceHandle: edge.branch ?? null,
    label: edge.branch ?? edge.label,
  }));
  return { nodes, edges };
}

export function flowToDsl(
  meta: { name: string; description: string },
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): Record<string, unknown> {
  const dslNodes: DslNode[] = nodes.map((node) => ({
    id: node.id,
    type: (node.type ?? 'agent') as DslNode['type'],
    label: node.data.label,
    agentId: node.data.agentId || undefined,
    kind: (node.data.kind as DslNode['kind']) || undefined,
    role: node.data.role || undefined,
    expression: node.data.expression || undefined,
    position: { x: node.position.x, y: node.position.y },
  }));
  const dslEdges = edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    branch: edge.sourceHandle === 'yes' || edge.sourceHandle === 'no' ? edge.sourceHandle : undefined,
  }));
  return { ...meta, nodes: dslNodes, edges: dslEdges };
}
