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

  if (!team) return <p className="font-pixel text-pixel-black/50">{message ?? 'Loading…'}</p>;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-pixel text-xl font-bold text-pixel-black">{team.name}</h1>
        <span className="border-2 border-pixel-black bg-pixel-yellow px-1.5 py-0.5 font-pixel text-xs text-pixel-black">
          {team.workflow.execution.mode}
        </span>
        <button
          onClick={() => addNode('agent')}
          className="border-2 border-pixel-black bg-pixel-white px-3 py-1.5 font-pixel text-xs text-pixel-black hover:bg-pixel-yellow" style={{ boxShadow: '2px 2px 0 #101010' }}
        >
          + Agent node
        </button>
        <button
          onClick={() => addNode('condition')}
          className="border-2 border-pixel-black bg-pixel-white px-3 py-1.5 font-pixel text-xs text-pixel-black hover:bg-pixel-yellow" style={{ boxShadow: '2px 2px 0 #101010' }}
        >
          + Condition
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="border-2 border-pixel-black bg-pixel-white px-3 py-1.5 font-pixel text-xs text-pixel-black hover:bg-pixel-yellow disabled:opacity-50" style={{ boxShadow: '2px 2px 0 #101010' }}
          >
            Save draft
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="border-2 border-pixel-black bg-pixel-red px-4 py-1.5 font-pixel text-xs font-bold text-pixel-white hover:bg-pixel-orange disabled:opacity-50" style={{ boxShadow: '2px 2px 0 #101010' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border-4 border-pixel-black bg-pixel-white px-3 py-2 font-pixel text-sm text-pixel-black outline-none placeholder:text-pixel-black/40 focus:border-pixel-blue" style={{ boxShadow: 'inset 2px 2px 0 #101010' }}
          placeholder='Describe the workflow, e.g. "research the topic, review quality, then write a summary"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
        />
        <button
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="border-2 border-pixel-black bg-pixel-blue px-4 py-2 font-pixel text-xs font-bold text-pixel-white hover:bg-pixel-green disabled:opacity-50" style={{ boxShadow: '2px 2px 0 #101010' }}
        >
          {generating ? '✨ Generating…' : '✨ Generate'}
        </button>
      </div>

      {message && <p className="border-2 border-pixel-yellow bg-pixel-yellow/15 px-2 py-1 font-pixel text-xs text-pixel-black">{message}</p>}
      {team.warnings.length > 0 && (
        <p className="font-pixel text-xs text-pixel-black/55">
          {team.warnings.map((w) => w.message).join(' · ')}
        </p>
      )}

      <div className="min-h-0 flex-1 border-4 border-pixel-black bg-pixel-white" style={{ boxShadow: '5px 5px 0 #101010' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode="light"
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
