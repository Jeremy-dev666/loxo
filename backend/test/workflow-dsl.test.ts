import { describe, expect, it } from 'vitest';
import {
  detectCycle,
  normalizeDsl,
  validateGraph,
  type AgentNode,
  type WorkflowDsl,
} from '../src/modules/teams/workflow-dsl';
import { extractJsonObject, fallbackDraft } from '../src/modules/teams/dsl-generator';

const KNOWN = new Set(['agent-a', 'agent-b']);

describe('normalizeDsl', () => {
  it('builds a minimal valid workflow from an empty draft', () => {
    const dsl = normalizeDsl({}, KNOWN);
    expect(dsl.nodes.some((n) => n.type === 'start')).toBe(true);
    expect(dsl.nodes.some((n) => n.type === 'end')).toBe(true);
    expect(dsl.execution.mode).toBe('dag');
  });

  it('sanitizes ids, deduplicates, and remaps edges', () => {
    const dsl = normalizeDsl(
      {
        nodes: [
          { id: 'Start!', type: 'start', label: 'S' },
          { id: 'My Agent', type: 'agent', label: 'A' },
          { id: 'My Agent', type: 'agent', label: 'B' },
          { id: 'End Node', type: 'end', label: 'E' },
        ],
        edges: [
          { from: 'Start!', to: 'My Agent' },
          { from: 'My Agent', to: 'End Node' },
        ],
      },
      KNOWN
    );
    const ids = dsl.nodes.map((n) => n.id);
    expect(ids).toContain('my-agent');
    expect(ids).toContain('my-agent-2');
    expect(new Set(ids).size).toBe(ids.length);
    expect(dsl.edges.some((e) => e.from === 'start' && e.to === 'my-agent')).toBe(true);
  });

  it('drops agent bindings that are not in the known set', () => {
    const dsl = normalizeDsl(
      { nodes: [{ id: 'a', type: 'agent', label: 'A', agentId: 'stolen-agent' }] },
      KNOWN
    );
    const agent = dsl.nodes.find((n) => n.type === 'agent') as AgentNode;
    expect(agent.agentId).toBeUndefined();
  });

  it('keeps valid agent bindings and kinds', () => {
    const dsl = normalizeDsl(
      { nodes: [{ id: 'a', type: 'agent', label: 'A', agentId: 'agent-a', kind: 'judge' }] },
      KNOWN
    );
    const agent = dsl.nodes.find((n) => n.type === 'agent') as AgentNode;
    expect(agent.agentId).toBe('agent-a');
    expect(agent.kind).toBe('judge');
  });

  it('repairs missing inflow/outflow so validation passes', () => {
    const dsl = normalizeDsl(
      {
        nodes: [
          { id: 'orphan-1', type: 'agent', label: 'One' },
          { id: 'orphan-2', type: 'agent', label: 'Two' },
        ],
        edges: [],
      },
      KNOWN
    );
    const { errors } = validateGraph(dsl.nodes, dsl.edges);
    expect(errors).toEqual([]);
  });

  it('adopts unlabeled condition edges as branches, then completes the pair', () => {
    const dsl = normalizeDsl(
      {
        nodes: [
          { id: 'gate', type: 'condition', label: 'Review' },
          { id: 'fix', type: 'agent', label: 'Fixer' },
        ],
        edges: [{ from: 'gate', to: 'fix' }],
      },
      KNOWN
    );
    const gateEdges = dsl.edges.filter((e) => e.from === 'gate');
    const branches = gateEdges.map((e) => e.branch).sort();
    expect(branches).toEqual(['no', 'yes']);
    // The pre-existing edge to fix was adopted as the yes branch.
    expect(gateEdges.find((e) => e.branch === 'yes')!.to).toBe('fix');
  });

  it('switches to state-machine mode with an iteration cap when a cycle exists', () => {
    const dsl = normalizeDsl(
      {
        nodes: [
          { id: 'work', type: 'agent', label: 'Worker' },
          { id: 'gate', type: 'condition', label: 'Gate' },
        ],
        edges: [
          { from: 'work', to: 'gate' },
          { from: 'gate', to: 'work', branch: 'no' },
        ],
      },
      KNOWN
    );
    expect(dsl.execution.mode).toBe('state-machine');
    expect(dsl.execution.maxIterations).toBe(3);
  });

  it('drops edges from end and into start', () => {
    const dsl = normalizeDsl(
      {
        nodes: [
          { id: 'start', type: 'start', label: 'S' },
          { id: 'a', type: 'agent', label: 'A' },
          { id: 'end', type: 'end', label: 'E' },
        ],
        edges: [
          { from: 'end', to: 'a' },
          { from: 'a', to: 'start' },
        ],
      },
      KNOWN
    );
    expect(dsl.edges.some((e) => e.from === 'end')).toBe(false);
    expect(dsl.edges.some((e) => e.to === 'start')).toBe(false);
  });

  it('clamps execution settings into sane ranges', () => {
    const dsl = normalizeDsl({ execution: { maxConcurrency: 999, timeoutSec: 1 } }, KNOWN);
    expect(dsl.execution.maxConcurrency).toBe(8);
    expect(dsl.execution.timeoutSec).toBe(30);
  });
});

describe('validateGraph', () => {
  const valid: Pick<WorkflowDsl, 'nodes' | 'edges'> = {
    nodes: [
      { id: 's', type: 'start', label: 'S' },
      { id: 'a', type: 'agent', label: 'A', kind: 'worker', agentId: 'agent-a' },
      { id: 'e', type: 'end', label: 'E' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a' },
      { id: 'e2', from: 'a', to: 'e' },
    ],
  };

  it('accepts a well-formed linear flow', () => {
    const { errors, warnings } = validateGraph(valid.nodes, valid.edges);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns on unbound agents without blocking', () => {
    const nodes = valid.nodes.map((n) =>
      n.id === 'a' ? { ...n, agentId: undefined } : n
    ) as WorkflowDsl['nodes'];
    const { errors, warnings } = validateGraph(nodes, valid.edges);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.code === 'unbound_agent')).toBe(true);
  });

  it('reports missing condition branches and unreachable nodes', () => {
    const { errors } = validateGraph(
      [
        { id: 's', type: 'start', label: 'S' },
        { id: 'c', type: 'condition', label: 'C', expression: 'ok?' },
        { id: 'island', type: 'agent', label: 'I', kind: 'worker' },
        { id: 'e', type: 'end', label: 'E' },
      ],
      [
        { id: 'e1', from: 's', to: 'c' },
        { id: 'e2', from: 'c', to: 'e', branch: 'yes' },
      ]
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('condition_missing_no');
    expect(codes).toContain('unreachable');
  });
});

describe('detectCycle', () => {
  it('finds a cycle path', () => {
    const cycle = detectCycle(
      [
        { id: 'a', type: 'agent', label: 'A', kind: 'worker' },
        { id: 'b', type: 'agent', label: 'B', kind: 'worker' },
      ],
      [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ]
    );
    expect(cycle).not.toBeNull();
  });

  it('returns null for a DAG', () => {
    expect(
      detectCycle(
        [
          { id: 'a', type: 'agent', label: 'A', kind: 'worker' },
          { id: 'b', type: 'agent', label: 'B', kind: 'worker' },
        ],
        [{ id: 'e1', from: 'a', to: 'b' }]
      )
    ).toBeNull();
  });
});

describe('generator helpers', () => {
  it('extracts JSON wrapped in prose', () => {
    const parsed = extractJsonObject('Sure! Here it is:\n{"name":"x"}\nDone.') as { name: string };
    expect(parsed.name).toBe('x');
  });

  it('fallback draft normalizes into a valid workflow with matched agents', () => {
    const draft = fallbackDraft('need a research helper', [
      { id: 'agent-a', name: 'Research Helper', description: 'searches papers', runtime: 'api' },
      { id: 'agent-b', name: 'Coder', description: 'writes code', runtime: 'claude-code' },
    ]);
    const dsl = normalizeDsl(draft, KNOWN);
    const { errors } = validateGraph(dsl.nodes, dsl.edges);
    expect(errors).toEqual([]);
    const bound = dsl.nodes.filter((n) => n.type === 'agent' && (n as AgentNode).agentId);
    expect(bound.length).toBeGreaterThan(0);
  });
});
