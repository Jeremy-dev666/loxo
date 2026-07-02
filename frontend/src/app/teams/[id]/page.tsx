'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { nodeTypes, setCanvasContext } from '@/components/canvas/nodes';
import { fetchAgents, type Agent } from '@/lib/agents';
import { dslToFlow, flowToDsl, type CanvasNodeData } from '@/lib/flow-convert';
import { fetchTeam, generateDsl, saveWorkflow, type TeamView } from '@/lib/teams';

let nodeCounter = 0;

function EditorInner() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;

  const [team, setTeam] = useState<TeamView | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => {});
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    fetchTeam(teamId)
      .then((t) => {
        loadedRef.current = true;
        setTeam(t);
        const flow = dslToFlow(t.workflow);
        setNodes(flow.nodes);
        setEdges(flow.edges);
      })
      .catch(() => setMessage('Failed to load team'));
  }, [teamId, setNodes, setEdges]);

  // Custom node components read agents + mutators through this context.
  useEffect(() => {
    setCanvasContext({
      agents,
      updateNode: (id, patch) =>
        setNodes((current) =>
          current.map((node) =>
            node.id === id ? { ...node, data: { ...node.data, ...patch } } : node
          )
        ),
      removeNode: (id) => {
        setNodes((current) => current.filter((node) => node.id !== id));
        setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      },
    });
  }, [agents, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      if (!source || !target) return;
      if (source.type === 'end' || target.type === 'start') {
        setMessage('End nodes have no outputs; start nodes have no inputs');
        return;
      }
      if (source.type === 'condition' && connection.sourceHandle !== 'yes' && connection.sourceHandle !== 'no') {
        setMessage('Connect conditions from their yes/no handles');
        return;
      }
      setMessage(null);
      setEdges((current) =>
        addEdge({ ...connection, label: connection.sourceHandle ?? undefined }, current)
      );
    },
    [nodes, setEdges]
  );

  const addNode = (type: 'agent' | 'condition') => {
    nodeCounter += 1;
    const id = `${type}-${Date.now()}-${nodeCounter}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type,
        position: { x: 300 + Math.random() * 120, y: 160 + Math.random() * 120 },
        data:
          type === 'agent'
            ? { label: `Agent ${nodeCounter}`, kind: 'worker' }
            : { label: 'Review gate', expression: '' },
      },
    ]);
  };

  const save = async (draft: boolean) => {
    if (!team) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await saveWorkflow(
        teamId,
        flowToDsl({ name: team.name, description: team.description }, nodes, edges),
        draft
      );
      setTeam(updated);
      const flow = dslToFlow(updated.workflow);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setMessage(draft ? 'Draft saved.' : 'Saved.');
    } catch (err) {
      setMessage(err instanceof Error ? `${err.message} — use "Save draft" to keep work in progress` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setMessage(null);
    try {
      const result = await generateDsl(prompt.trim());
      const flow = dslToFlow(result.workflow);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setMessage(
        `Generated via ${result.generator}${result.warnings.length ? ` (${result.warnings[0]})` : ''}. Review bindings, then save.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (!team) return <p className="text-slate-400">{message ?? 'Loading…'}</p>;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{team.name}</h1>
        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">
          {team.workflow.execution.mode}
        </span>
        <button
          onClick={() => addNode('agent')}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          + Agent node
        </button>
        <button
          onClick={() => addNode('condition')}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          + Condition
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-slate-900 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-700 bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder='Describe the workflow, e.g. "research the topic, review quality, then write a summary"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
        />
        <button
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="rounded border border-violet-700 px-4 py-2 text-xs text-violet-300 hover:border-violet-500 disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {message && <p className="text-xs text-amber-400">{message}</p>}
      {team.warnings.length > 0 && (
        <p className="text-xs text-slate-500">
          {team.warnings.map((w) => w.message).join(' · ')}
        </p>
      )}

      <div className="min-h-0 flex-1 rounded-lg border border-slate-800">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={16} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function TeamEditorPage() {
  return (
    <RequireAuth>
      <EditorInner />
    </RequireAuth>
  );
}
