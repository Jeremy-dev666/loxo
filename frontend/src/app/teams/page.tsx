'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { createTeam, deleteTeam, fetchTeams, type TeamView } from '@/lib/teams';

function TeamsPageInner() {
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [name, setName] = useState('');

  const reload = useCallback(() => {
    fetchTeams().then(setTeams).catch(() => setTeams([]));
  }, []);
  useEffect(reload, [reload]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const team = await createTeam({ name: name.trim() });
    setName('');
    window.location.href = `/teams/${team.id}`;
  };

  const remove = async (team: TeamView) => {
    if (!confirm(`Delete team "${team.name}"?`)) return;
    await deleteTeam(team.id);
    reload();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Teams</h1>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => {
          const agents = team.workflow.nodes.filter((n) => n.type === 'agent');
          const bound = agents.filter((n) => n.agentId).length;
          return (
            <div key={team.id} className="rounded-lg border border-slate-800 bg-panel p-4">
              <div className="flex items-start justify-between">
                <Link href={`/teams/${team.id}`} className="font-medium hover:text-accent">
                  {team.name}
                </Link>
                <button
                  onClick={() => remove(team)}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  delete
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {agents.length} agents ({bound} bound) · {team.workflow.execution.mode}
              </p>
              {team.warnings.length > 0 && (
                <p className="mt-1 text-xs text-amber-500">{team.warnings.length} warnings</p>
              )}
            </div>
          );
        })}
      </div>
      {teams.length === 0 && <p className="text-sm text-slate-500">No teams yet.</p>}
      <form onSubmit={add} className="flex max-w-sm gap-2">
        <input
          className="flex-1 rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="New team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900">
          Create
        </button>
      </form>
    </div>
  );
}

export default function TeamsPage() {
  return (
    <RequireAuth>
      <TeamsPageInner />
    </RequireAuth>
  );
}
