'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import {
  avatarUrl,
  createGroup,
  deleteAgent,
  deleteGroup,
  fetchAgents,
  fetchGroups,
  updateAgent,
  type Agent,
  type AgentGroup,
} from '@/lib/agents';

function AgentCard({
  agent,
  groups,
  onChanged,
}: {
  agent: Agent;
  groups: AgentGroup[];
  onChanged: () => void;
}) {
  const avatar = avatarUrl(agent);

  const move = async (groupId: string) => {
    await updateAgent(agent.id, { groupId: groupId || null });
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete agent "${agent.name}"? Its workspace will be removed.`)) return;
    await deleteAgent(agent.id);
    onChanged();
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-panel p-4">
      <div className="flex items-start gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/agents/${agent.id}`} className="font-medium hover:text-accent">
            {agent.name}
          </Link>
          <p className="truncate text-xs text-slate-400">{agent.description || 'No description'}</p>
        </div>
        <Link
          href={`/agents/${agent.id}/settings`}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          settings
        </Link>
        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">
          {agent.runtime}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <select
          className="rounded border border-slate-700 bg-surface px-2 py-1"
          value={agent.groupId ?? ''}
          onChange={(e) => move(e.target.value)}
        >
          <option value="">Ungrouped</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button onClick={remove} className="text-red-400 hover:text-red-300">
          Delete
        </button>
      </div>
    </div>
  );
}

function AgentsPageInner() {
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');

  const reload = useCallback(() => {
    fetchAgents().then(setAgentList).catch(() => setAgentList([]));
    fetchGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  useEffect(reload, [reload]);

  const sections = useMemo(() => {
    const byGroup = new Map<string | null, Agent[]>();
    for (const agent of agentList) {
      const key = agent.groupId;
      byGroup.set(key, [...(byGroup.get(key) ?? []), agent]);
    }
    return byGroup;
  }, [agentList]);

  const addGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim() });
    setNewGroupName('');
    reload();
  };

  const removeGroup = async (group: AgentGroup) => {
    if (!confirm(`Delete group "${group.name}"? Agents will be kept.`)) return;
    await deleteGroup(group.id);
    reload();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Link
          href="/upload"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 hover:opacity-90"
        >
          Import agent
        </Link>
      </div>

      {groups.map((group) => (
        <section key={group.id}>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: group.color }} />
            <h2 className="font-medium">{group.name}</h2>
            <button
              onClick={() => removeGroup(group)}
              className="text-xs text-slate-500 hover:text-red-400"
            >
              delete
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(sections.get(group.id) ?? []).map((agent) => (
              <AgentCard key={agent.id} agent={agent} groups={groups} onChanged={reload} />
            ))}
          </div>
          {(sections.get(group.id) ?? []).length === 0 && (
            <p className="text-sm text-slate-500">Empty group.</p>
          )}
        </section>
      ))}

      <section>
        <h2 className="mb-3 font-medium">Ungrouped</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(sections.get(null) ?? []).map((agent) => (
            <AgentCard key={agent.id} agent={agent} groups={groups} onChanged={reload} />
          ))}
        </div>
        {(sections.get(null) ?? []).length === 0 && (
          <p className="text-sm text-slate-500">
            No agents yet. <Link href="/upload" className="text-accent">Import one</Link> to get
            started.
          </p>
        )}
      </section>

      <form onSubmit={addGroup} className="flex max-w-sm gap-2">
        <input
          className="flex-1 rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
        <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500">
          Add group
        </button>
      </form>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <RequireAuth>
      <AgentsPageInner />
    </RequireAuth>
  );
}
