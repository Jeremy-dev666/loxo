'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

type ListingType = 'agents' | 'api-agents' | 'team-templates';
type SortOrder = 'downloads' | 'newest' | 'name';

const TYPE_LABELS: Record<ListingType, string> = {
  agents: 'Agents',
  'api-agents': 'API Agents',
  'team-templates': 'Team Templates',
};

const SORT_LABELS: Record<SortOrder, string> = {
  downloads: 'Most downloaded',
  newest: 'Newest',
  name: 'Name A–Z',
};

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function publishedDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function AvatarBox({
  name,
  imageUrl,
  size = 'h-10 w-10',
  text = 'text-[13px]',
}: {
  name: string;
  imageUrl?: string | null;
  size?: string;
  text?: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={`${size} shrink-0 border border-pixel-line object-cover`} />;
  }
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center border border-pixel-line font-pixel ${text} text-[#111]`}
    >
      {initials(name)}
    </span>
  );
}

function OfficialBadge({ label = 'Official' }: { label?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6B6B]">
      <span className="h-2 w-2 bg-pixel-yellow" />
      {label}
    </span>
  );
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9B9B9B]">
      {children}
    </p>
  );
}

function SpecGrid({ cells }: { cells: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 border border-pixel-line">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={`px-4 py-3 ${i % 2 === 1 ? 'border-l border-pixel-line' : ''} ${
            i >= 2 ? 'border-t border-pixel-line' : ''
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9B9B9B]">
            {cell.label}
          </p>
          <p className="mt-1 truncate font-pixel text-[13px] uppercase text-[#111]" title={cell.value}>
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-full bg-pixel-black py-2.5 text-sm font-semibold text-white hover:bg-[#333] disabled:bg-[#C9C9C9]"
    >
      {children}
    </button>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block w-full border border-pixel-line py-2.5 text-center text-sm text-[#111] no-underline hover:border-[#111]"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Adopt modals (flows unchanged; quiet-console styling)

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-pixel-black/70 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 border border-pixel-line bg-white p-6">
        <h2 className="text-base font-semibold text-[#111]">Adopt the official starter agent</h2>
        <label className="block text-sm">
          <span className="text-[#6B6B6B]">Agent name</span>
          <input
            className="mt-1 w-full border border-pixel-line px-3 py-2 text-sm text-[#111] outline-none focus:border-[#111]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Starter Agent"
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="text-[#6B6B6B]">Runtime</span>
          <select
            className="mt-1 w-full border border-pixel-line bg-white px-3 py-2 text-sm text-[#111]"
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
        {error && <p className="text-sm text-pixel-red">{error}</p>}
        <div className="flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="border border-pixel-line px-4 py-2 text-[#6B6B6B] hover:border-[#111] hover:text-[#111]"
          >
            Cancel
          </button>
          <button
            disabled={busy || !name.trim()}
            className="bg-pixel-black px-4 py-2 font-semibold text-white hover:bg-[#333] disabled:bg-[#C9C9C9]"
          >
            {busy ? 'Adopting…' : 'Adopt'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TemplateAdoptModal({ template, onClose }: { template: TeamTemplate; onClose: () => void }) {
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-pixel-black/70 p-4">
      <form
        onSubmit={submit}
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto border border-pixel-line bg-white p-6"
      >
        <h2 className="text-base font-semibold text-[#111]">Adopt “{template.name}”</h2>
        <p className="text-sm text-[#6B6B6B]">
          Creates {template.memberCount} agents in a new group and a team wired as a pipeline.
        </p>
        <label className="block text-sm">
          <span className="text-[#6B6B6B]">Team name</span>
          <input
            className="mt-1 w-full border border-pixel-line px-3 py-2 text-sm text-[#111] outline-none focus:border-[#111]"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
        </label>

        {duplicates.length > 0 && (
          <div className="space-y-2 border border-pixel-line p-3 text-sm">
            <p className="text-[#6B6B6B]">
              You already have agents from this template. Share their provider setup with the new
              agents?
            </p>
            {duplicates.map((d) => (
              <div key={d.roleCode} className="flex items-center justify-between gap-2">
                <span className="truncate text-[#6B6B6B]">
                  {d.memberName} <span className="text-[#9B9B9B]">({d.agentName})</span>
                </span>
                <select
                  className="border border-pixel-line bg-white px-2 py-1 text-xs text-[#111]"
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

        {error && <p className="text-sm text-pixel-red">{error}</p>}
        <div className="flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="border border-pixel-line px-4 py-2 text-[#6B6B6B] hover:border-[#111] hover:text-[#111]"
          >
            Cancel
          </button>
          <button
            disabled={busy || !teamName.trim()}
            className="bg-pixel-black px-4 py-2 font-semibold text-white hover:bg-[#333] disabled:bg-[#C9C9C9]"
          >
            {busy ? 'Creating…' : 'Adopt team'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory rows

function DirectoryRow({
  selected,
  onSelect,
  avatar,
  title,
  badge,
  description,
  metaTop,
  metaBottom,
}: {
  selected: boolean;
  onSelect: () => void;
  avatar: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  description: string;
  metaTop: string;
  metaBottom?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-4 border-b border-[#F0F0F0] px-5 py-4 text-left transition-colors ${
        selected ? 'border-l-2 border-l-pixel-yellow bg-[#FAFAFA] pl-[18px]' : 'hover:bg-[#FAFAFA]'
      }`}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-3">
          <span className="truncate text-[15px] font-semibold text-[#111]">{title}</span>
          {badge}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-[#6B6B6B]">{description}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-pixel text-[11px] uppercase tracking-wide text-[#6B6B6B]">
          {metaTop}
        </span>
        {metaBottom && (
          <span className="mt-0.5 block font-pixel text-[11px] text-[#9B9B9B]">{metaBottom}</span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function MarketPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialType: ListingType =
    requestedTab === 'api-agents' || requestedTab === 'team-templates' ? requestedTab : 'agents';

  const [type, setType] = useState<ListingType>(initialType);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [presets, setPresets] = useState<ApiAgentPreset[]>([]);
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [runtimeFilter, setRuntimeFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortOrder>('downloads');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adoptingOfficial, setAdoptingOfficial] = useState(false);
  const [adoptingTemplate, setAdoptingTemplate] = useState<TeamTemplate | null>(null);

  const reloadListings = useCallback(() => {
    fetchListings().then(setListings).catch(() => setListings([]));
  }, []);

  useEffect(() => {
    reloadListings();
    fetchApiAgentPresets().then(setPresets).catch(() => setPresets([]));
    fetchTeamTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [reloadListings]);

  const query = search.trim().toLowerCase();
  const matches = (name: string, description: string) =>
    !query || name.toLowerCase().includes(query) || description.toLowerCase().includes(query);

  const runtimeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const listing of listings) {
      counts.set(listing.runtime, (counts.get(listing.runtime) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [listings]);

  const visibleListings = useMemo(() => {
    const filtered = listings.filter(
      (l) =>
        matches(l.name, l.description) && (runtimeFilter.size === 0 || runtimeFilter.has(l.runtime))
    );
    return filtered.sort((a, b) => {
      if (sort === 'downloads') return b.downloadCount - a.downloadCount;
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, query, runtimeFilter, sort]);

  const visiblePresets = useMemo(
    () => presets.filter((p) => matches(p.name, p.description)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presets, query]
  );
  const visibleTemplates = useMemo(
    () => templates.filter((t) => matches(t.name, t.description)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, query]
  );

  const visibleIds: string[] =
    type === 'agents'
      ? visibleListings.map((l) => l.id)
      : type === 'api-agents'
        ? visiblePresets.map((p) => p.id)
        : visibleTemplates.map((t) => t.id);

  // Keep a row selected whenever the visible list changes.
  useEffect(() => {
    if (visibleIds.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleIds.includes(selectedId)) setSelectedId(visibleIds[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, visibleIds.join(',')]);

  const officialCount = listings.filter((l) => l.isOfficial).length;
  const totalCount = listings.length + presets.length + templates.length;

  const switchType = (next: ListingType) => {
    setType(next);
    setNotice('');
    setSelectedId(null);
  };

  const toggleRuntime = (runtime: string) => {
    setRuntimeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(runtime)) next.delete(runtime);
      else next.add(runtime);
      return next;
    });
  };

  const download = async (listing: MarketListing) => {
    setNotice('');
    setBusy(true);
    try {
      const agent = await downloadListing(listing.id);
      setNotice(`Downloaded “${agent.name}” into your agents.`);
      reloadListings();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  const deploy = async (preset: ApiAgentPreset) => {
    setNotice('');
    setBusy(true);
    try {
      await deployApiAgent(preset.id);
      router.push('/agents');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Deploy failed');
      setBusy(false);
    }
  };

  const selectedListing =
    type === 'agents' ? visibleListings.find((l) => l.id === selectedId) : undefined;
  const selectedPreset =
    type === 'api-agents' ? visiblePresets.find((p) => p.id === selectedId) : undefined;
  const selectedTemplate =
    type === 'team-templates' ? visibleTemplates.find((t) => t.id === selectedId) : undefined;

  return (
    <div className="flex h-[calc(100vh-130px)] min-h-[540px] flex-col border border-pixel-line bg-white text-[#111]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pixel-line px-6 py-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Market</h1>
          <p className="mt-0.5 text-[13px] text-[#9B9B9B]">
            {totalCount} listings · {officialCount} official
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search listings…"
          className="w-[280px] max-w-full border border-pixel-line bg-[#FAFAFA] px-4 py-2.5 text-sm text-[#111] outline-none placeholder:text-[#9B9B9B] focus:border-[#111] focus:bg-white"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Filters */}
        <aside className="w-[228px] shrink-0 overflow-y-auto border-r border-pixel-line px-4 py-4">
          <SideLabel>Type</SideLabel>
          <ul className="space-y-1">
            {(Object.keys(TYPE_LABELS) as ListingType[]).map((key) => {
              const count =
                key === 'agents' ? listings.length : key === 'api-agents' ? presets.length : templates.length;
              const active = type === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => switchType(key)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      active ? 'bg-pixel-black font-semibold text-white' : 'text-[#111] hover:bg-[#FAFAFA]'
                    }`}
                  >
                    {TYPE_LABELS[key]}
                    <span className={active ? 'text-white/60' : 'text-[#9B9B9B]'}>{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {type === 'agents' && runtimeCounts.length > 0 && (
            <div className="mt-7">
              <SideLabel>Runtime</SideLabel>
              <ul className="space-y-2">
                {runtimeCounts.map(([runtime, count]) => {
                  const checked = runtimeFilter.has(runtime);
                  return (
                    <li key={runtime}>
                      <button
                        type="button"
                        onClick={() => toggleRuntime(runtime)}
                        className="flex w-full items-center gap-2.5 px-1 text-left text-sm text-[#111]"
                      >
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                            checked ? 'border-pixel-black bg-pixel-black' : 'border-[#C9C9C9]'
                          }`}
                        >
                          {checked && <span className="h-1.5 w-1.5 bg-white" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{runtime}</span>
                        <span className="shrink-0 text-[#9B9B9B]">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {type === 'agents' && (
            <div className="mt-7">
              <SideLabel>Sort</SideLabel>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOrder)}
                className="w-full border border-pixel-line bg-white px-2 py-1.5 text-sm text-[#111]"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </aside>

        {/* Directory list */}
        <section className="min-w-0 flex-1 overflow-y-auto">
          {type === 'agents' &&
            visibleListings.map((listing) => (
              <DirectoryRow
                key={listing.id}
                selected={selectedId === listing.id}
                onSelect={() => setSelectedId(listing.id)}
                avatar={<AvatarBox name={listing.name} imageUrl={listingAvatarUrl(listing)} />}
                title={listing.name}
                badge={listing.isOfficial ? <OfficialBadge /> : undefined}
                description={listing.description || 'No description'}
                metaTop={listing.runtime}
                metaBottom={`${listing.downloadCount} dl`}
              />
            ))}
          {type === 'api-agents' &&
            visiblePresets.map((preset) => (
              <DirectoryRow
                key={preset.id}
                selected={selectedId === preset.id}
                onSelect={() => setSelectedId(preset.id)}
                avatar={<AvatarBox name={preset.name} />}
                title={preset.name}
                badge={preset.featured ? <OfficialBadge label="Featured" /> : undefined}
                description={preset.description}
                metaTop={preset.protocol}
                metaBottom={preset.model}
              />
            ))}
          {type === 'team-templates' &&
            visibleTemplates.map((template) => (
              <DirectoryRow
                key={template.id}
                selected={selectedId === template.id}
                onSelect={() => setSelectedId(template.id)}
                avatar={<AvatarBox name={template.name} />}
                title={template.name}
                badge={<OfficialBadge label={template.category} />}
                description={template.description}
                metaTop={template.defaultRuntime}
                metaBottom={`${template.memberCount} roles`}
              />
            ))}
          {visibleIds.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-[#9B9B9B]">
              {query ? 'Nothing matches this search.' : 'Nothing listed yet.'}
            </p>
          )}
        </section>

        {/* Detail preview */}
        <aside className="flex w-[336px] shrink-0 flex-col overflow-y-auto border-l border-pixel-line">
          {selectedListing && (
            <div className="flex min-h-full flex-col px-6 py-6">
              <div className="flex items-center gap-4">
                <AvatarBox
                  name={selectedListing.name}
                  imageUrl={listingAvatarUrl(selectedListing)}
                  size="h-14 w-14"
                  text="text-[17px]"
                />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{selectedListing.name}</h2>
                  <OfficialBadge
                    label={
                      selectedListing.isOfficial
                        ? 'Official · by Loxo'
                        : `by ${selectedListing.ownerUsername ?? 'unknown'}`
                    }
                  />
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[#3C3C3C]">
                {selectedListing.description || 'No description provided.'}
              </p>
              <div className="mt-5">
                <SpecGrid
                  cells={[
                    { label: 'Version', value: `v${selectedListing.latestVersion}` },
                    { label: 'Size', value: formatSize(selectedListing.sizeBytes) },
                    { label: 'Downloads', value: String(selectedListing.downloadCount) },
                    { label: 'Runtime', value: selectedListing.runtime },
                  ]}
                />
              </div>
              <div className="mt-5 space-y-2">
                {selectedListing.isOfficial ? (
                  <PrimaryButton onClick={() => setAdoptingOfficial(true)} disabled={busy}>
                    Adopt this agent
                  </PrimaryButton>
                ) : (
                  <PrimaryButton
                    onClick={() => void download(selectedListing)}
                    disabled={busy || !selectedListing.hasFiles}
                    title={selectedListing.hasFiles ? undefined : 'No files published yet'}
                  >
                    {busy ? 'Working…' : 'Download this agent'}
                  </PrimaryButton>
                )}
                <SecondaryLink href="/community">View in community</SecondaryLink>
              </div>
              {notice && <p className="mt-3 text-[13px] text-[#6B6B6B]">{notice}</p>}
              <p className="mt-auto pt-8 font-pixel text-[11px] uppercase leading-relaxed text-[#9B9B9B]">
                Published {publishedDate(selectedListing.createdAt)} · secrets redacted on publish
              </p>
            </div>
          )}

          {selectedPreset && (
            <div className="flex min-h-full flex-col px-6 py-6">
              <div className="flex items-center gap-4">
                <AvatarBox name={selectedPreset.name} size="h-14 w-14" text="text-[17px]" />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{selectedPreset.name}</h2>
                  <OfficialBadge
                    label={selectedPreset.featured ? 'Featured' : `by ${selectedPreset.creator}`}
                  />
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[#3C3C3C]">{selectedPreset.description}</p>
              <div className="mt-5">
                <SpecGrid
                  cells={[
                    { label: 'Protocol', value: selectedPreset.protocol },
                    { label: 'Model', value: selectedPreset.model },
                    { label: 'Category', value: selectedPreset.category },
                    { label: 'Rating', value: selectedPreset.rating.toFixed(1) },
                  ]}
                />
              </div>
              <div className="mt-5">
                <PrimaryButton onClick={() => void deploy(selectedPreset)} disabled={busy}>
                  {busy ? 'Deploying…' : 'Deploy this agent'}
                </PrimaryButton>
              </div>
              {notice && <p className="mt-3 text-[13px] text-pixel-red">{notice}</p>}
              <p className="mt-auto pt-8 font-pixel text-[11px] uppercase leading-relaxed text-[#9B9B9B]">
                Runs over your own provider key · no CLI runtime needed
              </p>
            </div>
          )}

          {selectedTemplate && (
            <div className="flex min-h-full flex-col px-6 py-6">
              <div className="flex items-center gap-4">
                <AvatarBox name={selectedTemplate.name} size="h-14 w-14" text="text-[17px]" />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{selectedTemplate.name}</h2>
                  <OfficialBadge label={selectedTemplate.category} />
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[#3C3C3C]">{selectedTemplate.description}</p>
              <div className="mt-5">
                <SpecGrid
                  cells={[
                    { label: 'Roles', value: String(selectedTemplate.memberCount) },
                    { label: 'Runtime', value: selectedTemplate.defaultRuntime },
                    { label: 'Stages', value: String(selectedTemplate.stages.length) },
                    {
                      label: 'Skills',
                      value: String(
                        selectedTemplate.members.reduce((total, m) => total + m.skills.length, 0)
                      ),
                    },
                  ]}
                />
              </div>
              <ul className="mt-4 space-y-1.5">
                {selectedTemplate.members.map((member) => (
                  <li key={member.roleCode} className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-semibold text-[#111]">{member.name}</span>
                    <span className="truncate text-[#9B9B9B]">
                      {member.roleCode} · {member.skills.length} skills
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <PrimaryButton onClick={() => setAdoptingTemplate(selectedTemplate)} disabled={busy}>
                  Adopt this team
                </PrimaryButton>
              </div>
              <p className="mt-auto pt-8 font-pixel text-[11px] uppercase leading-relaxed text-[#9B9B9B]">
                {selectedTemplate.workflowSummary}
              </p>
            </div>
          )}

          {!selectedListing && !selectedPreset && !selectedTemplate && (
            <p className="px-6 py-10 text-center text-sm text-[#9B9B9B]">
              Select a listing to preview it.
            </p>
          )}
        </aside>
      </div>

      {adoptingOfficial && (
        <OfficialAdoptModal
          onClose={() => setAdoptingOfficial(false)}
          onDone={() => {
            setAdoptingOfficial(false);
            router.push('/agents');
          }}
        />
      )}
      {adoptingTemplate && (
        <TemplateAdoptModal template={adoptingTemplate} onClose={() => setAdoptingTemplate(null)} />
      )}
    </div>
  );
}

export default function MarketPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="p-8 text-center text-sm text-[#9B9B9B]">Loading…</div>}>
        <MarketPageInner />
      </Suspense>
    </RequireAuth>
  );
}
