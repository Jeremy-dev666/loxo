'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgentSprite } from '@/components/agent/AgentSprite';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { PixelHero } from '@/components/effects/PixelHero';
import { MonoDashboard } from '@/components/dashboard/MonoDashboard';
import { useAuthStore } from '@/store/auth';
import { fetchAgents, type Agent } from '@/lib/agents';
import { fetchTeams, type TeamView } from '@/lib/teams';
import { fetchProjects, type ProjectView } from '@/lib/projects';
import { adoptOfficialAgent } from '@/lib/market';

const HERO_SEEN_KEY = 'swarmdev.hasSeenHeroAnimation';

type MobileTabKey = 'projects' | 'contacts' | 'teams' | 'discover' | 'me';

const MOBILE_TABS: Array<{ key: MobileTabKey; label: string; accent: string }> = [
  { key: 'projects', label: 'Projects', accent: 'bg-pixel-blue' },
  { key: 'contacts', label: 'Agents', accent: 'bg-pixel-green' },
  { key: 'teams', label: 'Teams', accent: 'bg-pixel-yellow' },
  { key: 'discover', label: 'Discover', accent: 'bg-pixel-red' },
  { key: 'me', label: 'Me', accent: 'bg-pixel-gray' },
];

function isMobileTabKey(value: string | null): value is MobileTabKey {
  return Boolean(value && MOBILE_TABS.some((tab) => tab.key === value));
}

function FolderGlyph({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" shapeRendering="crispEdges">
      <path fill="currentColor" d="M6 14h20l6 8h26v28H6z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Official starter agent prompt (first login, zero agents)

function OfficialAdoptPrompt({
  isLoggedIn,
  promptKey,
  agentCount,
  agentDataReady,
  userName,
  onOfficialAdopted,
}: {
  isLoggedIn: boolean;
  promptKey: string | null;
  agentCount: number;
  agentDataReady: boolean;
  userName?: string;
  onOfficialAdopted: () => Promise<void> | void;
}) {
  const router = useRouter();
  const defaultName = userName ? `${userName}'s Starter Agent` : 'My Starter Agent';
  const [showPrompt, setShowPrompt] = useState(false);
  const [adoptName, setAdoptName] = useState(defaultName);
  const [isAdopting, setIsAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState('');

  useEffect(() => {
    setAdoptName(defaultName);
  }, [defaultName]);

  useEffect(() => {
    if (!isLoggedIn || !promptKey || !agentDataReady || agentCount > 0) {
      setShowPrompt(false);
      return;
    }
    if (window.localStorage.getItem(promptKey)) {
      setShowPrompt(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPrompt(true), 120);
    return () => window.clearTimeout(timer);
  }, [agentCount, agentDataReady, isLoggedIn, promptKey]);

  const markSeen = () => {
    if (promptKey) window.localStorage.setItem(promptKey, new Date().toISOString());
  };

  const dismiss = () => {
    markSeen();
    setShowPrompt(false);
    setAdoptError('');
  };

  const handleAdopt = async () => {
    if (isAdopting) return;
    setIsAdopting(true);
    setAdoptError('');
    try {
      await adoptOfficialAgent({ name: adoptName.trim() || defaultName });
      markSeen();
      setShowPrompt(false);
      await onOfficialAdopted();
      router.replace('/agents');
    } catch (error) {
      setAdoptError(error instanceof Error ? error.message : 'Failed to adopt the starter agent.');
    } finally {
      setIsAdopting(false);
    }
  };

  if (!showPrompt) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-pixel-black/70 p-4">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-h-[calc(100dvh-2rem)] w-full max-w-[680px] overflow-y-auto border border-pixel-black bg-white p-4 md:p-5"
          style={{ boxShadow: '6px 6px 0 rgba(17,17,17,0.10)' }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-pixel text-xl font-bold leading-tight text-pixel-black md:text-2xl">
                Adopt the official starter agent
              </h2>
              <p className="mt-1 font-pixel text-xs leading-tight text-pixel-black/60 md:text-sm">
                Adopt an official agent first and it lands straight in your den.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 border border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-sm leading-none text-pixel-black"
              aria-label="Close adopt dialog"
            >
              ×
            </button>
          </div>

          <div className="mb-4 grid items-center gap-4 border border-pixel-black bg-white p-3 sm:grid-cols-[140px_1fr] md:p-4">
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="mx-auto flex h-28 w-28 shrink-0 items-center justify-center border border-pixel-black bg-pixel-green sm:h-32 sm:w-32"
            >
              <span className="font-pixel text-4xl text-pixel-white">SW</span>
            </motion.div>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block font-pixel text-xs text-pixel-black/70">Agent name</label>
              <input
                value={adoptName}
                onChange={(event) => setAdoptName(event.target.value)}
                disabled={isAdopting}
                className="w-full border border-pixel-black bg-white px-3 py-2 font-pixel text-sm text-pixel-black outline-none disabled:opacity-50 md:text-base"
                style={{ boxShadow: 'inset 2px 2px 0 rgba(17,17,17,0.10)' }}
              />
            </div>
          </div>

          {adoptError && (
            <div className="mb-3 border border-pixel-red bg-pixel-red/10 p-2">
              <p className="font-pixel text-xs text-pixel-red">{adoptError}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={isAdopting}
              className="border border-pixel-black bg-pixel-white px-3 py-3 font-pixel text-sm text-pixel-black disabled:opacity-50 md:text-base"
              style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void handleAdopt()}
              disabled={isAdopting}
              className="border border-pixel-black bg-pixel-green px-3 py-3 font-pixel text-sm text-pixel-white disabled:opacity-50 md:text-base"
              style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
            >
              {isAdopting ? 'Adopting…' : 'Adopt'}
            </button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}

// ---------------------------------------------------------------------------
// Mobile home (tabbed, messenger-style)

function MobilePanel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`overflow-hidden border border-pixel-black bg-pixel-white ${className}`}
      style={{ boxShadow: '5px 5px 0 rgba(17,17,17,0.10)' }}
    >
      {children}
    </section>
  );
}

function MobileLinkRow({
  href,
  title,
  description,
  badge,
  icon,
  accent = 'bg-pixel-blue',
}: {
  href: string;
  title: string;
  description?: string;
  badge?: string;
  icon?: React.ReactNode;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[72px] items-center justify-between gap-2 border-b border-pixel-black/10 bg-pixel-white px-3 py-2.5 last:border-b-0 active:bg-pixel-yellow/40"
    >
      <span className="relative shrink-0">
        <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center border border-pixel-black ${accent}`}>
          <span className="absolute inset-0.5 border border-pixel-black bg-pixel-white" />
          <span className="relative z-10 flex h-full w-full items-center justify-center">{icon}</span>
        </span>
        {badge && (
          <span className="absolute -right-1.5 -top-1.5 border border-pixel-black bg-pixel-yellow px-1.5 py-0.5 font-pixel text-[10px] leading-none text-pixel-black">
            {badge}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-pixel text-base font-bold leading-tight text-pixel-black">{title}</span>
        {description && (
          <span className="mt-1 block truncate font-pixel text-xs leading-tight text-pixel-black/60">
            {description}
          </span>
        )}
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-pixel-black bg-pixel-white font-pixel text-xl leading-none text-pixel-black/65">
        ›
      </span>
    </Link>
  );
}

function MobileAgentRow({ agent }: { agent: Agent }) {
  const hasProvider = Boolean(agent.providerId);
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="flex min-h-[72px] items-center gap-2 border-b border-pixel-black/10 bg-pixel-white px-3 py-2.5 last:border-b-0 active:bg-pixel-yellow/40"
    >
      <AgentSprite agent={agent} size="sm" showProviderStatus providerConfigured={hasProvider} />
      <div className="min-w-0 flex-1">
        <p className="font-pixel text-base font-bold leading-tight text-pixel-black">{agent.name}</p>
        <p className="mt-1 truncate font-pixel text-xs leading-tight text-pixel-black/60">
          {agent.description || (hasProvider ? 'Provider configured' : 'Provider not configured')}
        </p>
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-pixel-black bg-pixel-white font-pixel text-xl leading-none text-pixel-black/65">
        ›
      </span>
    </Link>
  );
}

function MobileHome({
  agents,
  projects,
  teamCount,
  isLoggedIn,
}: {
  agents: Agent[];
  projects: ProjectView[];
  teamCount: number;
  isLoggedIn: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const requestedTab = searchParams.get('mobileTab');
  const activeTab: MobileTabKey = isMobileTabKey(requestedTab) ? requestedTab : 'projects';
  const recentProjects = projects.slice(0, 4);
  const recentAgents = agents.slice(0, 20);
  const activeTabMeta = MOBILE_TABS.find((tab) => tab.key === activeTab) ?? MOBILE_TABS[0]!;
  const configuredCount = agents.filter((a) => a.providerId).length;
  const activeSummary =
    activeTab === 'projects'
      ? `${projects.length} projects`
      : activeTab === 'contacts'
        ? `${configuredCount}/${agents.length} providers configured`
        : activeTab === 'teams'
          ? `${teamCount} teams · group chat ready`
          : activeTab === 'discover'
            ? 'Market · API agents · official adopt'
            : isLoggedIn
              ? 'Account, providers, and your den'
              : 'Sign in to sync your agents';

  return (
    <div className="-mx-4 bg-pixel-white px-4 md:hidden">
      <div className="min-h-[calc(100vh-70px)] pb-24">
        <div className="sticky top-0 z-20 -mx-4 border-b border-pixel-black bg-pixel-white px-4 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-pixel text-[1.25rem] font-bold leading-none text-pixel-black">
                {activeTabMeta.label}
              </h1>
              <p className="mt-0.5 truncate font-pixel text-[11px] leading-tight text-pixel-black/55">
                {activeSummary}
              </p>
            </div>
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center border border-pixel-black ${activeTabMeta.accent} text-pixel-white`}
              style={{ boxShadow: '2px 2px 0 rgba(17,17,17,0.10)' }}
            >
              <FolderGlyph className="h-5 w-5" />
            </div>
          </div>
        </div>

        <main className="mt-2 space-y-2.5">
          {activeTab === 'projects' && (
            <MobilePanel>
              <div className="flex items-center justify-between border-b border-pixel-black bg-pixel-blue px-3 py-2 text-pixel-white">
                <div>
                  <p className="font-pixel text-base font-bold leading-tight">Recent projects</p>
                  <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                    Shared team workspaces on the server
                  </p>
                </div>
                <Link
                  href="/projects"
                  className="border border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-xs leading-none text-pixel-black"
                >
                  Manage
                </Link>
              </div>
              {recentProjects.length > 0 ? (
                recentProjects.map((project) => (
                  <MobileLinkRow
                    key={project.id}
                    href={`/projects/${project.id}`}
                    title={project.name}
                    description={project.description || `${project.teamIds.length} teams bound`}
                    badge={project.teamIds.length ? `${project.teamIds.length}` : undefined}
                    icon={<FolderGlyph className="h-7 w-7 text-pixel-blue" />}
                    accent="bg-pixel-blue"
                  />
                ))
              ) : (
                <MobileLinkRow
                  href="/projects"
                  title="Create your first project"
                  description="Name a server workspace and bind a team"
                  icon={<FolderGlyph className="h-7 w-7 text-pixel-blue" />}
                  accent="bg-pixel-blue"
                />
              )}
            </MobilePanel>
          )}

          {activeTab === 'contacts' && (
            <MobilePanel>
              <div className="border-b border-pixel-black bg-pixel-green px-3 py-2 text-pixel-white">
                <p className="font-pixel text-base font-bold leading-tight">Agent contacts</p>
                <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                  {configuredCount}/{agents.length} providers configured
                </p>
              </div>
              {recentAgents.length > 0 ? (
                recentAgents.map((agent) => <MobileAgentRow key={agent.id} agent={agent} />)
              ) : (
                <MobileLinkRow
                  href="/upload"
                  title="No agents yet"
                  description="Upload or adopt an agent to get started"
                  accent="bg-pixel-green"
                />
              )}
            </MobilePanel>
          )}

          {activeTab === 'teams' && (
            <>
              <MobilePanel>
                <div className="border-b border-pixel-black bg-pixel-yellow px-3 py-2 text-pixel-black">
                  <p className="font-pixel text-base font-bold leading-tight">Team workbench</p>
                  <p className="mt-1 font-pixel text-xs leading-tight text-pixel-black/65">
                    Create teams, manage them, join group chats
                  </p>
                </div>
                <MobileLinkRow
                  href="/teams/create"
                  title="Create a team"
                  description="Design an agent team with the canvas or plain language"
                  badge="NEW"
                  accent="bg-pixel-blue"
                />
                <MobileLinkRow
                  href="/teams"
                  title="My teams"
                  description={`${teamCount} teams created`}
                  accent="bg-pixel-green"
                />
              </MobilePanel>
              <MobilePanel>
                <div className="border-b border-pixel-black bg-pixel-yellow px-3 py-2 text-pixel-black">
                  <p className="font-pixel text-base font-bold leading-tight">Roundtable</p>
                  <p className="mt-1 font-pixel text-xs leading-tight text-pixel-black/65">
                    Drop into your agent group chats
                  </p>
                </div>
                <MobileLinkRow
                  href="/roundtable"
                  title="Open the roundtable"
                  description="Multi-agent discussion with a shared whiteboard"
                  accent="bg-pixel-red"
                />
              </MobilePanel>
            </>
          )}

          {activeTab === 'discover' && (
            <MobilePanel>
              <div className="border-b border-pixel-black bg-pixel-red px-3 py-2 text-pixel-white">
                <p className="font-pixel text-base font-bold leading-tight">Discover</p>
                <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                  Agent market and hosted API agents
                </p>
              </div>
              <MobileLinkRow
                href="/market"
                title="Agent market"
                description="Browse listings and the community"
                accent="bg-pixel-yellow"
              />
              <MobileLinkRow
                href="/market?tab=api-agents"
                title="API agents"
                description="Deploy hosted OpenAI/Anthropic agents"
                accent="bg-pixel-red"
              />
              <MobileLinkRow
                href="/community"
                title="Community"
                description="Posts, comments, and agent follows"
                accent="bg-pixel-green"
              />
            </MobilePanel>
          )}

          {activeTab === 'me' && (
            <MobilePanel>
              <div className={`border-b border-pixel-black ${isLoggedIn ? 'bg-pixel-blue' : 'bg-pixel-gray'} px-3 py-2 text-pixel-white`}>
                <p className="font-pixel text-base font-bold leading-tight">
                  {isLoggedIn ? 'Signed in' : 'Signed out'}
                </p>
                <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                  {isLoggedIn && user?.username
                    ? `${user.username} · providers, imports, and your den`
                    : 'Sign in to sync agents, teams, and projects'}
                </p>
              </div>
              <div className="space-y-2 border-b border-pixel-black/10 bg-pixel-white p-3">
                {isLoggedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      router.replace('/?mobileTab=me');
                    }}
                    className="flex min-h-[48px] w-full items-center justify-center border border-pixel-black bg-pixel-red px-3 font-pixel text-base font-bold leading-none text-pixel-white"
                    style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
                  >
                    Sign out
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/login"
                      className="flex min-h-[48px] items-center justify-center border border-pixel-black bg-pixel-blue px-3 font-pixel text-base font-bold leading-none text-pixel-white no-underline"
                      style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/register"
                      className="flex min-h-[48px] items-center justify-center border border-pixel-black bg-pixel-green px-3 font-pixel text-base font-bold leading-none text-pixel-white no-underline"
                      style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
                    >
                      Sign up
                    </Link>
                  </div>
                )}
              </div>
              <MobileLinkRow
                href="/settings/providers"
                title="Provider settings"
                description="Configure model providers and API keys"
                accent="bg-pixel-blue"
              />
              <MobileLinkRow
                href="/agents"
                title="My agent den"
                description={`${agents.length} agents owned`}
                accent="bg-pixel-green"
              />
              <MobileLinkRow
                href="/upload"
                title="Upload agent"
                description="Import a folder, zip, or hosted API agent"
                accent="bg-pixel-yellow"
              />
            </MobilePanel>
          )}
        </main>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------

export default function HomePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center font-pixel text-pixel-black/50">Loading…</div>}>
      <HomePageInner />
    </Suspense>
  );
}

function HomePageInner() {
  const { token, user } = useAuthStore();
  const isLoggedIn = Boolean(token);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [showHero, setShowHero] = useState(false);
  const [hasSeenHero, setHasSeenHero] = useState(false);

  const reload = useCallback(async () => {
    if (!isLoggedIn) {
      setAgents([]);
      setProjects([]);
      setTeams([]);
      setDataReady(true);
      return;
    }
    const [agentList, projectList, teamList] = await Promise.all([
      fetchAgents().catch(() => []),
      fetchProjects().catch(() => []),
      fetchTeams().catch(() => []),
    ]);
    setAgents(agentList);
    setProjects(
      [...projectList].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    );
    setTeams(teamList);
    setDataReady(true);
  }, [isLoggedIn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) {
      setHasSeenHero(true);
      return;
    }
    if (!sessionStorage.getItem(HERO_SEEN_KEY)) {
      setShowHero(true);
    } else {
      setHasSeenHero(true);
    }
  }, []);

  const handleEnter = () => {
    sessionStorage.setItem(HERO_SEEN_KEY, 'true');
    setShowHero(false);
    setHasSeenHero(true);
  };

  return (
    <>
      <AnimatePresence>{showHero && <PixelHero onEnter={handleEnter} />}</AnimatePresence>

      <MobileHome agents={agents} projects={projects} teamCount={teams.length} isLoggedIn={isLoggedIn} />

      <OfficialAdoptPrompt
        isLoggedIn={Boolean(token && user)}
        promptKey={token && user ? `swarmdev.officialAdoptPrompt.${user.id}` : null}
        agentCount={agents.length}
        agentDataReady={dataReady}
        userName={user?.username}
        onOfficialAdopted={reload}
      />

      <MonoDashboard
        agents={agents}
        teams={teams}
        projects={projects}
        isLoggedIn={isLoggedIn}
        userName={user?.username}
      />
    </>
  );
}
