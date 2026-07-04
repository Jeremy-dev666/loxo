'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import {
  ADOPTION_RUNTIMES,
  adoptOfficialAgent,
  adoptTeamTemplate,
  deployApiAgent,
  downloadListing,
  fetchApiAgentPresets,
  fetchListings,
  fetchTeamTemplates,
  fetchTemplateDuplicates,
  formatSize,
  listingAvatarUrl,
  type ApiAgentPreset,
  type DuplicateAgentChoice,
  type DuplicateTemplateAgent,
  type MarketListing,
  type TeamTemplate,
} from '@/lib/market';

type Tab = 'agents' | 'api-agents' | 'team-templates';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'api-agents', label: 'API Agents' },
  { id: 'team-templates', label: 'Team Templates' },
];

function ListingAvatar({ listing }: { listing: MarketListing }) {
  const url = listingAvatarUrl(listing);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm">
      {listing.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function OfficialAdoptModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState<string>(ADOPTION_RUNTIMES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adoptOfficialAgent({ name: name.trim(), runtime });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adoption failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-700 bg-panel p-6">
        <h2 className="font-medium">Adopt the official starter agent</h2>
        <label className="block text-sm">
          <span className="text-slate-400">Agent name</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-surface px-3 py-2 outline-none focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Starter Agent"
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Runtime</span>
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-surface px-3 py-2"
            value={runtime}
            onChange={(e) => setRuntime(e.target.value)}
          >
            {ADOPTION_RUNTIMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 text-sm">
          <button type="button" onClick={onClose} className="rounded border border-slate-700 px-3 py-2 text-slate-300">
            Cancel
          </button>
          <button
            disabled={busy || !name.trim()}
            className="rounded bg-accent px-3 py-2 font-medium text-slate-900 disabled:opacity-50"
          >
            {busy ? 'Adopting…' : 'Adopt'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ListingsTab() {
  const router = useRouter();
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [search, setSearch] = useState('');
  const [adopting, setAdopting] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = useCallback((query?: string) => {
    fetchListings(query).then(setListings).catch(() => setListings([]));
  }, []);

  useEffect(() => reload(), [reload]);

  const download = async (listing: MarketListing) => {
    setNotice('');
    try {
      const agent = await downloadListing(listing.id);
      setNotice(`Downloaded "${agent.name}" into your agents.`);
      reload(search);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Download failed');
    }
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          reload(search.trim() || undefined);
        }}
        className="flex max-w-md gap-2"
      >
        <input
          className="flex-1 rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Search listings"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500">
          Search
        </button>
      </form>

      {notice && <p className="text-sm text-accent">{notice}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <div key={listing.id} className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="flex items-start gap-3">
              <ListingAvatar listing={listing} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{listing.name}</span>
                  {listing.isOfficial && (
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">official</span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                  {listing.description || 'No description'}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                {listing.runtime} · v{listing.latestVersion} · {formatSize(listing.sizeBytes)}
              </span>
              <span>
                {listing.downloadCount} downloads
                {listing.ownerUsername ? ` · by ${listing.ownerUsername}` : ''}
              </span>
            </div>
            <div className="mt-3 flex justify-end gap-2 text-sm">
              {listing.isOfficial ? (
                <button
                  onClick={() => setAdopting(true)}
                  className="rounded bg-accent px-3 py-1.5 font-medium text-slate-900 hover:opacity-90"
                >
                  Adopt
                </button>
              ) : (
                <button
                  onClick={() => download(listing)}
                  disabled={!listing.hasFiles}
                  className="rounded bg-accent px-3 py-1.5 font-medium text-slate-900 hover:opacity-90 disabled:opacity-50"
                >
                  Download
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {listings.length === 0 && <p className="text-sm text-slate-500">No listings found.</p>}

      {adopting && (
        <OfficialAdoptModal
          onClose={() => setAdopting(false)}
          onDone={() => {
            setAdopting(false);
            router.push('/agents');
          }}
        />
      )}
    </div>
  );
}

function ApiAgentsTab() {
  const router = useRouter();
  const [presets, setPresets] = useState<ApiAgentPreset[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetchApiAgentPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  const deploy = async (preset: ApiAgentPreset) => {
    setNotice('');
    try {
      await deployApiAgent(preset.id);
      router.push('/agents');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Deploy failed');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Hosted agents that run over your own OpenAI or Anthropic provider — no CLI runtime needed.
        Configure a provider after deploying.
      </p>
      {notice && <p className="text-sm text-red-400">{notice}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {presets.map((preset) => (
          <div key={preset.id} className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{preset.name}</span>
              {preset.featured && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">featured</span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-slate-400">{preset.description}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                {preset.protocol} · {preset.model}
              </span>
              <span>{preset.category}</span>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => deploy(preset)}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-slate-900 hover:opacity-90"
              >
                Deploy
              </button>
            </div>
          </div>
        ))}
      </div>
      {presets.length === 0 && <p className="text-sm text-slate-500">No API agents configured.</p>}
    </div>
  );
}

function TemplateAdoptModal({
  template,
  onClose,
}: {
  template: TeamTemplate;
  onClose: () => void;
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState(template.name);
  const [duplicates, setDuplicates] = useState<DuplicateTemplateAgent[]>([]);
  const [modes, setModes] = useState<Record<string, 'clone' | 'share-config'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTemplateDuplicates(template.id).then(setDuplicates).catch(() => setDuplicates([]));
  }, [template.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const duplicateChoices: DuplicateAgentChoice[] = duplicates.map((d) => ({
        roleCode: d.roleCode,
        existingAgentId: d.agentId,
        mode: modes[d.roleCode] ?? 'clone',
      }));
      await adoptTeamTemplate(template.id, { teamName: teamName.trim(), duplicateChoices });
      router.push('/teams');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adoption failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-slate-700 bg-panel p-6"
      >
        <h2 className="font-medium">Adopt “{template.name}”</h2>
        <p className="text-sm text-slate-400">
          Creates {template.memberCount} agents in a new group and a team wired as a pipeline.
        </p>
        <label className="block text-sm">
          <span className="text-slate-400">Team name</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-surface px-3 py-2 outline-none focus:border-accent"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
        </label>

        {duplicates.length > 0 && (
          <div className="space-y-2 rounded border border-slate-700 p-3 text-sm">
            <p className="text-slate-300">
              You already have agents from this template. Share their provider setup with the new
              agents?
            </p>
            {duplicates.map((d) => (
              <div key={d.roleCode} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-400">
                  {d.memberName} <span className="text-slate-600">({d.agentName})</span>
                </span>
                <select
                  className="rounded border border-slate-700 bg-surface px-2 py-1 text-xs"
                  value={modes[d.roleCode] ?? 'clone'}
                  onChange={(e) =>
                    setModes((prev) => ({
                      ...prev,
                      [d.roleCode]: e.target.value as 'clone' | 'share-config',
                    }))
                  }
                >
                  <option value="clone">Fresh agent</option>
                  <option value="share-config">Share provider config</option>
                </select>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 text-sm">
          <button type="button" onClick={onClose} className="rounded border border-slate-700 px-3 py-2 text-slate-300">
            Cancel
          </button>
          <button
            disabled={busy || !teamName.trim()}
            className="rounded bg-accent px-3 py-2 font-medium text-slate-900 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Adopt team'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TeamTemplatesTab() {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [adopting, setAdopting] = useState<TeamTemplate | null>(null);

  useEffect(() => {
    fetchTeamTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: template.color }} />
              <span className="font-medium">{template.name}</span>
              <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">
                {template.category}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400">{template.description}</p>
            <div className="mt-3 space-y-1">
              {template.members.map((member) => (
                <div key={member.roleCode} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: member.color }} />
                  <span className="text-slate-300">{member.name}</span>
                  <span className="text-slate-600">
                    {member.roleCode} · {member.runtime ?? template.defaultRuntime} ·{' '}
                    {member.skills.length} skills
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{template.workflowSummary}</p>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setAdopting(template)}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-slate-900 hover:opacity-90"
              >
                Adopt team
              </button>
            </div>
          </div>
        ))}
      </div>
      {templates.length === 0 && <p className="text-sm text-slate-500">No templates available.</p>}

      {adopting && <TemplateAdoptModal template={adopting} onClose={() => setAdopting(null)} />}
    </div>
  );
}

function MarketPageInner() {
  const [tab, setTab] = useState<Tab>('agents');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Market</h1>
      </div>

      <div className="flex gap-1 border-b border-slate-800 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'border-b-2 border-accent px-4 py-2 text-slate-100'
                : 'px-4 py-2 text-slate-400 hover:text-slate-200'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'agents' && <ListingsTab />}
      {tab === 'api-agents' && <ApiAgentsTab />}
      {tab === 'team-templates' && <TeamTemplatesTab />}
    </div>
  );
}

export default function MarketPage() {
  return (
    <RequireAuth>
      <MarketPageInner />
    </RequireAuth>
  );
}
