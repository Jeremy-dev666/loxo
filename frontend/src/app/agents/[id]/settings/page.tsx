'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import {
  avatarUrl,
  fetchAgent,
  fetchDiagnostics,
  fetchSkills,
  updateAgent,
  updateAgentConfig,
  uploadAvatar,
  uploadSkill,
  type Agent,
  type Diagnostics,
  type SkillSummary,
} from '@/lib/agents';
import { fetchProviders, type ProviderView } from '@/lib/providers';

const VENDORS_FOR_RUNTIME: Record<string, string[]> = {
  'claude-code': ['anthropic'],
  codex: ['openai'],
  opencode: ['openai'],
  hermes: ['hermes'],
  openclaw: ['openclaw'],
  api: ['anthropic', 'openai'],
};

const inputClass =
  'w-full rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent';

function SettingsInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const reload = useCallback(() => {
    fetchAgent(agentId)
      .then((a) => {
        setAgent(a);
        setName(a.name);
        setDescription(a.description);
      })
      .catch(() => router.replace('/agents'));
    fetchSkills(agentId).then(setSkills).catch(() => {});
  }, [agentId, router]);

  useEffect(reload, [reload]);
  useEffect(() => {
    fetchProviders().then(setProviders).catch(() => {});
  }, []);

  const eligibleProviders = useMemo(() => {
    if (!agent) return [];
    const vendors = VENDORS_FOR_RUNTIME[agent.runtime] ?? [];
    return providers.filter((p) => vendors.includes(p.vendor));
  }, [agent, providers]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === agent?.providerId) ?? null,
    [providers, agent]
  );

  if (!agent) return <p className="text-slate-400">Loading…</p>;

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      setAgent(await updateAgent(agentId, { name, description }));
      setMessage('Saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const changeProvider = async (providerId: string) => {
    setMessage(null);
    try {
      setAgent(await updateAgentConfig(agentId, { providerId: providerId || null, model: null }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const changeModel = async (model: string) => {
    setMessage(null);
    try {
      setAgent(await updateAgentConfig(agentId, { model: model || null }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    await uploadAvatar(agentId, file);
    reload();
  };

  const onSkill = async (file: File | undefined) => {
    if (!file) return;
    setSkills(await uploadSkill(agentId, file).then((r) => r.skills));
  };

  const runDiagnostics = async () => {
    setDiagnostics(await fetchDiagnostics(agentId));
  };

  const avatar = avatarUrl(agent);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-700">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold">{agent.name}</h1>
          <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">
            {agent.runtime}
          </span>
        </div>
        <label className="ml-auto cursor-pointer rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">
          Change avatar
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onAvatar(e.target.files?.[0])}
          />
        </label>
      </div>

      {message && <p className="text-sm text-amber-400">{message}</p>}

      <form onSubmit={saveProfile} className="space-y-3 rounded-lg border border-slate-800 bg-panel p-4">
        <h2 className="font-medium">Profile</h2>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        <textarea
          className={inputClass}
          rows={3}
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          disabled={saving}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-60"
        >
          Save
        </button>
      </form>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-panel p-4">
        <h2 className="font-medium">Model provider</h2>
        <select
          className={inputClass}
          value={agent.providerId ?? ''}
          onChange={(e) => changeProvider(e.target.value)}
        >
          <option value="">No provider (use environment credentials)</option>
          {eligibleProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.vendor})
            </option>
          ))}
        </select>
        {selectedProvider && selectedProvider.models.length > 0 && (
          <select
            className={inputClass}
            value={agent.model ?? ''}
            onChange={(e) => changeModel(e.target.value)}
          >
            <option value="">Default model</option>
            {selectedProvider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        {eligibleProviders.length === 0 && (
          <p className="text-xs text-slate-500">
            No provider matches this runtime. Add one under Settings → Providers.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Skills</h2>
          <label className="cursor-pointer rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
            Upload skill (.md / .zip)
            <input
              type="file"
              accept=".md,.zip"
              className="hidden"
              onChange={(e) => onSkill(e.target.files?.[0])}
            />
          </label>
        </div>
        {skills.length === 0 ? (
          <p className="text-xs text-slate-500">No skills installed.</p>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => (
              <li key={skill.id} className="rounded border border-slate-800 px-3 py-2">
                <span className="text-sm font-medium">{skill.name}</span>
                <p className="text-xs text-slate-400">{skill.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Diagnostics</h2>
          <button
            onClick={runDiagnostics}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            Run check
          </button>
        </div>
        {diagnostics && (
          <div className="space-y-1 text-sm">
            <p>
              CLI:{' '}
              {diagnostics.cli.available ? (
                <span className="text-emerald-400">{diagnostics.cli.version}</span>
              ) : (
                <span className="text-red-400">{diagnostics.cli.error}</span>
              )}
            </p>
            <p>
              Provider:{' '}
              {diagnostics.provider ? (
                <span className={diagnostics.provider.vendorMatch ? 'text-emerald-400' : 'text-red-400'}>
                  {diagnostics.provider.vendor}
                  {diagnostics.provider.vendorMatch ? '' : ' (vendor mismatch)'}
                </span>
              ) : (
                <span className="text-slate-400">not configured</span>
              )}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AgentSettingsPage() {
  return (
    <RequireAuth>
      <SettingsInner />
    </RequireAuth>
  );
}
