'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_KINDS } from '@/lib/teams';
import type { CanvasNodeData } from '@/lib/flow-convert';
import type { Agent } from '@/lib/agents';

/** Agents available for binding; provided by the editor page. */
export interface CanvasContext {
  agents: Agent[];
  updateNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  removeNode: (id: string) => void;
}

let canvasContext: CanvasContext = { agents: [], updateNode: () => {}, removeNode: () => {} };
export function setCanvasContext(ctx: CanvasContext): void {
  canvasContext = ctx;
}

const box = 'rounded-lg border bg-panel px-3 py-2 text-xs shadow';

export function StartNode({ data }: NodeProps) {
  return (
    <div className={`${box} border-emerald-700`}>
      <p className="font-medium text-emerald-400">▶ {(data as CanvasNodeData).label}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function EndNode({ data }: NodeProps) {
  return (
    <div className={`${box} border-slate-500`}>
      <p className="font-medium text-slate-300">■ {(data as CanvasNodeData).label}</p>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export function AgentNode({ id, data }: NodeProps) {
  const d = data as CanvasNodeData;
  const bound = canvasContext.agents.find((a) => a.id === d.agentId);
  return (
    <div className={`${box} w-52 ${bound ? 'border-sky-700' : 'border-amber-700'}`}>
      <div className="flex items-center justify-between">
        <input
          className="w-32 bg-transparent font-medium outline-none"
          value={d.label}
          onChange={(e) => canvasContext.updateNode(id, { label: e.target.value })}
        />
        <button
          onClick={() => canvasContext.removeNode(id)}
          className="text-slate-600 hover:text-red-400"
        >
          ×
        </button>
      </div>
      <select
        className="nodrag mt-1 w-full rounded border border-slate-700 bg-surface px-1 py-0.5"
        value={d.agentId ?? ''}
        onChange={(e) => canvasContext.updateNode(id, { agentId: e.target.value || undefined })}
      >
        <option value="">— bind agent —</option>
        {canvasContext.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name} ({agent.runtime})
          </option>
        ))}
      </select>
      <select
        className="nodrag mt-1 w-full rounded border border-slate-700 bg-surface px-1 py-0.5"
        value={d.kind ?? 'worker'}
        onChange={(e) => canvasContext.updateNode(id, { kind: e.target.value })}
      >
        {NODE_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {!bound && <p className="mt-1 text-[10px] text-amber-500">unbound</p>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ConditionNode({ id, data }: NodeProps) {
  const d = data as CanvasNodeData;
  return (
    <div className={`${box} w-52 border-violet-700`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-violet-300">◇ {d.label}</span>
        <button
          onClick={() => canvasContext.removeNode(id)}
          className="text-slate-600 hover:text-red-400"
        >
          ×
        </button>
      </div>
      <input
        className="nodrag mt-1 w-full rounded border border-slate-700 bg-surface px-1 py-0.5"
        placeholder="pass criterion"
        value={d.expression ?? ''}
        onChange={(e) => canvasContext.updateNode(id, { expression: e.target.value })}
      />
      <div className="mt-1 flex justify-between text-[10px]">
        <span className="text-emerald-400">yes ↑</span>
        <span className="text-red-400">no ↓</span>
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle id="yes" type="source" position={Position.Top} className="!bg-emerald-500" />
      <Handle id="no" type="source" position={Position.Bottom} className="!bg-red-500" />
    </div>
  );
}

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  agent: AgentNode,
  condition: ConditionNode,
};
