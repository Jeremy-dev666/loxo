'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  createProject,
  deleteProject,
  fetchProjects,
  type ProjectView,
} from '@/lib/projects';
import { fetchTeams, type TeamView } from '@/lib/teams';

function formatRecency(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

interface CreateDialogProps {
  teams: TeamView[];
  agents: Agent[];
  onClose: () => void;
  onCreated: (project: ProjectView) => void;
}

function CreateDialog({ teams, agents, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        teamIds,
        agentIds,
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-panel p-5">
        <h2 className="text-lg font-semibold">New project</h2>
        <div className="mt-4 space-y-3">
          <input
            autoFocus
            className="w-full rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="w-full rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="What is this project about? (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">Teams</p>
            <div className="flex flex-wrap gap-2">
              {teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => toggle(teamIds, team.id, setTeamIds)}
                  className={`rounded border px-2 py-1 text-xs ${
                    teamIds.includes(team.id)
                      ? 'border-accent text-accent'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {team.name}
                </button>
              ))}
              {teams.length === 0 && <p className="text-xs text-slate-500">No teams yet.</p>}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">Agents</p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => toggle(agentIds, agent.id, setAgentIds)}
                  className={`rounded border px-2 py-1 text-xs ${
                    agentIds.includes(agent.id)
                      ? 'border-accent text-accent'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {agent.name}
                </button>
              ))}
              {agents.length === 0 && <p className="text-xs text-slate-500">No agents yet.</p>}
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectsPageInner() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    reload();
    fetchTeams().then(setTeams).catch(() => setTeams([]));
    fetchAgents().then(setAgents).catch(() => setAgents([]));
  }, [reload]);

  const remove = async (project: ProjectView) => {
    if (!confirm(`Delete project "${project.name}"? Its workspace files will be removed.`)) return;
    await deleteProject(project.id);
    reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-slate-500">{projects.length} workspaces</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900"
        >
          New project
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div key={project.id} className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="flex items-start justify-between">
              <Link href={`/projects/${project.id}`} className="font-medium hover:text-accent">
                {project.name}
              </Link>
              <button
                onClick={() => remove(project)}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                delete
              </button>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">
              {project.teamIds.length} teams · {project.agentIds.length} agents ·{' '}
              {project.description || 'No description yet'}
            </p>
            <p className="mt-1 text-xs text-slate-500">Last active {formatRecency(project.updatedAt)}</p>
          </div>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="text-sm text-slate-500">No projects yet. Create one to give your agents a shared workspace.</p>
      )}

      {showCreate && (
        <CreateDialog
          teams={teams}
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            window.location.href = `/projects/${project.id}`;
          }}
        />
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <RequireAuth>
      <ProjectsPageInner />
    </RequireAuth>
  );
}
