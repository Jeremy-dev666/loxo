'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MenuCard, SectionA, SectionB } from '@/components/layout/Dashboard';
import { AgentCard } from '@/components/agent/AgentCard';
import { AgentSprite } from '@/components/agent/AgentSprite';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { PixelHero } from '@/components/effects/PixelHero';
import { useDisplayMode } from '@/lib/display-mode';
import { useAuthStore } from '@/store/auth';
import { fetchAgents, type Agent } from '@/lib/agents';
import { fetchTeams } from '@/lib/teams';
import { deleteProject, fetchProjects, type ProjectView } from '@/lib/projects';
import { adoptOfficialAgent, fetchMyListings } from '@/lib/market';

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
          className="max-h-[calc(100dvh-2rem)] w-full max-w-[680px] overflow-y-auto border-4 border-pixel-black bg-white p-4 md:p-5"
          style={{ boxShadow: '6px 6px 0 #101010' }}
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
              className="shrink-0 border-2 border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-sm leading-none text-pixel-black"
              aria-label="Close adopt dialog"
            >
              ×
            </button>
          </div>

          <div className="mb-4 grid items-center gap-4 border-4 border-pixel-black bg-white p-3 sm:grid-cols-[140px_1fr] md:p-4">
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="mx-auto flex h-28 w-28 shrink-0 items-center justify-center border-4 border-pixel-black bg-pixel-green sm:h-32 sm:w-32"
            >
              <span className="font-pixel text-4xl text-pixel-white">SW</span>
            </motion.div>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block font-pixel text-xs text-pixel-black/70">Agent name</label>
              <input
                value={adoptName}
                onChange={(event) => setAdoptName(event.target.value)}
                disabled={isAdopting}
                className="w-full border-4 border-pixel-black bg-white px-3 py-2 font-pixel text-sm text-pixel-black outline-none disabled:opacity-50 md:text-base"
                style={{ boxShadow: 'inset 2px 2px 0 #101010' }}
              />
            </div>
          </div>

          {adoptError && (
            <div className="mb-3 border-4 border-pixel-red bg-pixel-red/10 p-2">
              <p className="font-pixel text-xs text-pixel-red">{adoptError}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={isAdopting}
              className="border-4 border-pixel-black bg-pixel-white px-3 py-3 font-pixel text-sm text-pixel-black disabled:opacity-50 md:text-base"
              style={{ boxShadow: '3px 3px 0 #101010' }}
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void handleAdopt()}
              disabled={isAdopting}
              className="border-4 border-pixel-black bg-pixel-green px-3 py-3 font-pixel text-sm text-pixel-white disabled:opacity-50 md:text-base"
              style={{ boxShadow: '3px 3px 0 #101010' }}
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
      className={`overflow-hidden border-4 border-pixel-black bg-pixel-white ${className}`}
      style={{ boxShadow: '5px 5px 0 #101010' }}
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
      className="flex min-h-[72px] items-center justify-between gap-2 border-b-2 border-pixel-black/10 bg-pixel-white px-3 py-2.5 last:border-b-0 active:bg-pixel-yellow/40"
    >
      <span className="relative shrink-0">
        <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center border-2 border-pixel-black ${accent}`}>
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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-pixel-black bg-pixel-white font-pixel text-xl leading-none text-pixel-black/65">
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
      className="flex min-h-[72px] items-center gap-2 border-b-2 border-pixel-black/10 bg-pixel-white px-3 py-2.5 last:border-b-0 active:bg-pixel-yellow/40"
    >
      <AgentSprite agent={agent} size="sm" showProviderStatus providerConfigured={hasProvider} />
      <div className="min-w-0 flex-1">
        <p className="font-pixel text-base font-bold leading-tight text-pixel-black">{agent.name}</p>
        <p className="mt-1 truncate font-pixel text-xs leading-tight text-pixel-black/60">
          {agent.description || (hasProvider ? 'Provider configured' : 'Provider not configured')}
        </p>
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-pixel-black bg-pixel-white font-pixel text-xl leading-none text-pixel-black/65">
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
        <div className="sticky top-0 z-20 -mx-4 border-b-4 border-pixel-black bg-pixel-white px-4 py-1.5">
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
              className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 border-pixel-black ${activeTabMeta.accent} text-pixel-white`}
              style={{ boxShadow: '2px 2px 0 #101010' }}
            >
              <FolderGlyph className="h-5 w-5" />
            </div>
          </div>
        </div>

        <main className="mt-2 space-y-2.5">
          {activeTab === 'projects' && (
            <MobilePanel>
              <div className="flex items-center justify-between border-b-4 border-pixel-black bg-pixel-blue px-3 py-2 text-pixel-white">
                <div>
                  <p className="font-pixel text-base font-bold leading-tight">Recent projects</p>
                  <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                    Shared team workspaces on the server
                  </p>
                </div>
                <Link
                  href="/projects"
                  className="border-2 border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-xs leading-none text-pixel-black"
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
              <div className="border-b-4 border-pixel-black bg-pixel-green px-3 py-2 text-pixel-white">
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
                <div className="border-b-4 border-pixel-black bg-pixel-yellow px-3 py-2 text-pixel-black">
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
                <div className="border-b-4 border-pixel-black bg-pixel-yellow px-3 py-2 text-pixel-black">
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
              <div className="border-b-4 border-pixel-black bg-pixel-red px-3 py-2 text-pixel-white">
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
              <div className={`border-b-4 border-pixel-black ${isLoggedIn ? 'bg-pixel-blue' : 'bg-pixel-gray'} px-3 py-2 text-pixel-white`}>
                <p className="font-pixel text-base font-bold leading-tight">
                  {isLoggedIn ? 'Signed in' : 'Signed out'}
                </p>
                <p className="mt-1 font-pixel text-xs leading-tight text-pixel-white/80">
                  {isLoggedIn && user?.username
                    ? `${user.username} · providers, imports, and your den`
                    : 'Sign in to sync agents, teams, and projects'}
                </p>
              </div>
              <div className="space-y-2 border-b-2 border-pixel-black/10 bg-pixel-white p-3">
                {isLoggedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      router.replace('/?mobileTab=me');
                    }}
                    className="flex min-h-[48px] w-full items-center justify-center border-4 border-pixel-black bg-pixel-red px-3 font-pixel text-base font-bold leading-none text-pixel-white"
                    style={{ boxShadow: '3px 3px 0 #101010' }}
                  >
                    Sign out
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/login"
                      className="flex min-h-[48px] items-center justify-center border-4 border-pixel-black bg-pixel-blue px-3 font-pixel text-base font-bold leading-none text-pixel-white no-underline"
                      style={{ boxShadow: '3px 3px 0 #101010' }}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/register"
                      className="flex min-h-[48px] items-center justify-center border-4 border-pixel-black bg-pixel-green px-3 font-pixel text-base font-bold leading-none text-pixel-white no-underline"
                      style={{ boxShadow: '3px 3px 0 #101010' }}
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
// Desktop dashboards

function ProjectCard({
  project,
  index,
  onDelete,
}: {
  project: ProjectView;
  index: number;
  onDelete?: (project: ProjectView) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="group/project-card relative min-h-[148px] border-4 border-pixel-black bg-pixel-white p-3"
      style={{ boxShadow: '4px 4px 0px 0px #101010' }}
    >
      {onDelete && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(project);
          }}
          className="pointer-events-none absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center border-2 border-pixel-black bg-pixel-red font-pixel text-base font-bold leading-none text-pixel-white opacity-0 transition-opacity hover:brightness-95 group-hover/project-card:pointer-events-auto group-hover/project-card:opacity-100"
          style={{ boxShadow: '2px 2px 0 #101010' }}
          aria-label={`Delete project ${project.name}`}
          title="Delete project"
        >
          X
        </button>
      )}
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start gap-3">
          <FolderGlyph className="h-12 w-12 shrink-0 text-pixel-blue" />
          <div className="min-w-0">
            <h4 className="truncate font-pixel text-lg font-bold text-pixel-black">{project.name}</h4>
            <p className="mt-1 line-clamp-2 font-pixel text-sm leading-snug text-pixel-black/65">
              {project.description || 'Server workspace'}
            </p>
          </div>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap gap-1">
            <span className="border-2 border-pixel-black bg-pixel-blue px-2 py-0.5 font-pixel text-xs text-pixel-white">
              {project.teamIds.length} TEAM
            </span>
            <span className="border-2 border-pixel-black bg-pixel-yellow px-2 py-0.5 font-pixel text-xs text-pixel-black">
              {project.agentIds.length} AGENT
            </span>
          </div>
          <Link
            href={`/projects/${project.id}`}
            className="inline-block border-2 border-pixel-black bg-pixel-blue px-3 py-1 font-pixel text-xs text-pixel-white hover:bg-pixel-gray"
            style={{ boxShadow: '2px 2px 0px 0px #101010' }}
          >
            Open project
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

type ActionTone = 'green' | 'blue' | 'yellow' | 'red' | 'gray';

const TONE_STYLES: Record<ActionTone, { bg: string; border: string; text: string }> = {
  green: { bg: 'bg-pixel-green', border: 'border-t-pixel-green', text: 'text-pixel-green' },
  blue: { bg: 'bg-pixel-blue', border: 'border-t-pixel-blue', text: 'text-pixel-blue' },
  yellow: { bg: 'bg-pixel-yellow', border: 'border-t-pixel-yellow', text: 'text-pixel-yellow' },
  red: { bg: 'bg-pixel-red', border: 'border-t-pixel-red', text: 'text-pixel-red' },
  gray: { bg: 'bg-pixel-gray', border: 'border-t-pixel-gray', text: 'text-pixel-gray' },
};

interface ActionItem {
  href: string;
  title: string;
  description: string;
  eyebrow: string;
  tone: ActionTone;
}

function getDesktopActions({
  isLoggedIn,
  agentCount,
  projectCount,
  teamCount,
}: {
  isLoggedIn: boolean;
  agentCount: number;
  projectCount: number;
  teamCount: number;
}): ActionItem[] {
  return [
    {
      href: '/market',
      title: 'Quick adopt',
      description: 'Get a new teammate instantly, deployed straight into your workspace.',
      eyebrow: 'QUICK ADOPT',
      tone: 'green',
    },
    {
      href: '/upload',
      title: 'Upload agent',
      description: 'Import a trained agent and configure it as your own.',
      eyebrow: 'UPLOAD',
      tone: 'blue',
    },
    {
      href: '/market',
      title: 'Agent market',
      description: 'Browse the market and community picks.',
      eyebrow: 'MARKET',
      tone: 'yellow',
    },
    {
      href: '/agents',
      title: 'My agent den',
      description: isLoggedIn ? `Manage the ${agentCount} agents you own.` : 'Sign in to see your agents.',
      eyebrow: `MY AGENTS · ${isLoggedIn ? agentCount : 0}`,
      tone: 'red',
    },
    {
      href: '/teams/create',
      title: 'Create a team',
      description: 'Design a new agent collaboration with the canvas or plain language.',
      eyebrow: 'CREATE TEAM',
      tone: 'blue',
    },
    {
      href: '/teams',
      title: 'My teams',
      description: isLoggedIn ? `View and manage ${teamCount} teams.` : 'Sign in to manage teams.',
      eyebrow: `MY TEAMS · ${isLoggedIn ? teamCount : 0}`,
      tone: 'green',
    },
    {
      href: '/projects',
      title: 'My projects',
      description: isLoggedIn ? `Manage ${projectCount} server workspaces.` : 'Sign in to see project workspaces.',
      eyebrow: `PROJECTS · ${isLoggedIn ? projectCount : 0}`,
      tone: 'yellow',
    },
    {
      href: '/roundtable',
      title: 'Roundtable',
      description: isLoggedIn ? 'Multi-agent group chat for open discussion.' : 'Sign in to use group chat.',
      eyebrow: 'ROUNDTABLE',
      tone: 'red',
    },
  ];
}

function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note: string;
  tone: ActionTone;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <motion.div
      layout
      className={`border-[3px] border-t-[5px] border-pixel-black ${styles.border} bg-pixel-white p-3`}
      style={{ boxShadow: '3px 3px 0px 0px #101010' }}
    >
      <p className="font-pixel text-xs uppercase text-pixel-black/55">{label}</p>
      <p className="mt-1 font-pixel text-3xl font-bold leading-none text-pixel-black">{value}</p>
      <p className={`mt-2 font-pixel text-xs ${styles.text}`}>{note}</p>
    </motion.div>
  );
}

function ActionTile({ action, index }: { action: ActionItem; index: number }) {
  const styles = TONE_STYLES[action.tone];
  const yellowCard = action.tone === 'yellow';
  const titleClassName = yellowCard
    ? 'text-pixel-black group-hover:text-pixel-blue'
    : 'text-pixel-white group-hover:text-pixel-yellow';
  const descriptionClassName = yellowCard ? 'text-pixel-black/70' : 'text-pixel-white/80';
  const eyebrowClassName = yellowCard ? 'text-pixel-black/55' : 'text-pixel-white/65';
  const arrowClassName = yellowCard ? 'text-pixel-black' : 'text-pixel-white';

  return (
    <Link href={action.href} className="block h-full no-underline">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 * index }}
        whileHover={{ y: -4, x: 2 }}
        whileTap={{ y: 1, scale: 0.99 }}
        className={`group flex h-full min-h-[150px] flex-col border-[3px] border-pixel-black ${styles.bg} p-4 2xl:min-h-[162px]`}
        style={{ boxShadow: '3px 3px 0px 0px #101010' }}
      >
        <span className={`mb-3 flex h-10 w-10 items-center justify-center border-2 border-pixel-black bg-pixel-white ${styles.text}`}>
          <FolderGlyph className="h-6 w-6" />
        </span>
        <h3 className={`font-pixel text-lg font-bold leading-tight transition-colors ${titleClassName}`}>
          {action.title}
        </h3>
        <p className={`mt-2 flex-1 font-pixel text-sm leading-snug ${descriptionClassName}`}>
          {action.description}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className={`font-pixel text-xs uppercase tracking-[0.12em] ${eyebrowClassName}`}>{action.eyebrow}</p>
          <svg
            viewBox="0 0 24 24"
            className={`h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 ${arrowClassName}`}
            aria-hidden="true"
          >
            <path fill="currentColor" d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z" />
          </svg>
        </div>
      </motion.div>
    </Link>
  );
}

function ActionGroup({
  label,
  actions,
  startIndex,
}: {
  label: string;
  actions: ActionItem[];
  startIndex: number;
}) {
  return (
    <section
      className="relative border-[3px] border-pixel-black bg-pixel-white p-4 pt-7"
      style={{ boxShadow: '3px 3px 0px 0px #101010' }}
    >
      <div
        className="absolute -top-[18px] left-4 border-[3px] border-pixel-black bg-pixel-yellow px-4 py-1 font-pixel text-sm uppercase leading-none text-pixel-black"
        style={{ boxShadow: '2px 2px 0px 0px #101010' }}
      >
        {label}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {actions.map((action, index) => (
          <ActionTile key={action.href + action.title} action={action} index={startIndex + index} />
        ))}
      </div>
    </section>
  );
}

function Panel({
  title,
  actionHref,
  actionLabel,
  className = '',
  children,
}: {
  title: string;
  actionHref: string;
  actionLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`border-[3px] border-pixel-black bg-pixel-white p-3 ${className}`}
      style={{ boxShadow: '3px 3px 0px 0px #101010' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-pixel text-lg font-bold text-pixel-black">■ {title}</h2>
        <Link href={actionHref} className="font-pixel text-sm text-pixel-blue no-underline hover:text-pixel-red">
          {actionLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

function TraditionalDesktopHome({
  agents,
  projects,
  teamCount,
  publishedAgentIds,
  isLoggedIn,
  hasSeenHero,
  onDeleteProject,
  onChanged,
}: {
  agents: Agent[];
  projects: ProjectView[];
  teamCount: number;
  publishedAgentIds: Set<string>;
  isLoggedIn: boolean;
  hasSeenHero: boolean;
  onDeleteProject: (project: ProjectView) => void;
  onChanged: () => Promise<void> | void;
}) {
  const actions = getDesktopActions({
    isLoggedIn,
    agentCount: agents.length,
    projectCount: projects.length,
    teamCount,
  });
  const singleAgentActions = actions.slice(0, 4);
  const agentTeamActions = actions.slice(4);
  const recentProjects = projects.slice(0, 4);
  const publishedCount = agents.filter((a) => publishedAgentIds.has(a.id)).length;

  return (
    <motion.div
      key="traditional"
      className="hidden md:block"
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -18, scale: 0.985 }}
      transition={{ duration: 0.28, delay: hasSeenHero ? 0 : 0.25 }}
    >
      <div className="relative mx-auto min-h-[760px] w-full max-w-[1840px] overflow-visible">
        <div className="space-y-5">
          <section
            className="border-[3px] border-pixel-black bg-pixel-white p-5"
            style={{ boxShadow: '3px 3px 0px 0px #101010' }}
          >
            <p className="font-pixel text-lg text-pixel-blue">WELCOME TO AGENT WORLD</p>
            <h1 className="brand-large mt-2 text-pixel-black">Welcome to the Agent World</h1>
            <p className="mt-2 font-pixel text-sm text-pixel-black/60">
              Pick an entry point to start managing and collaborating with your agents
            </p>
          </section>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Agents"
              value={agents.length}
              note={isLoggedIn ? 'Synced to your workbench' : 'Sign in to sync'}
              tone="green"
            />
            <StatCard label="Teams" value={teamCount} note="Open team management" tone="blue" />
            <StatCard label="Projects" value={projects.length} note="Server workspaces" tone="yellow" />
            <StatCard
              label="Listed on market"
              value={publishedCount}
              note={publishedCount > 0 ? 'Published from your den' : 'Nothing published yet'}
              tone="red"
            />
          </div>

          <div className="grid gap-5 pt-3 xl:grid-cols-2">
            <ActionGroup label="Single agent" actions={singleAgentActions} startIndex={0} />
            <ActionGroup label="Agent team" actions={agentTeamActions} startIndex={singleAgentActions.length} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(330px,0.72fr)_minmax(0,1.28fr)] 2xl:grid-cols-[minmax(360px,0.68fr)_minmax(0,1.32fr)]">
            <Panel title="Recent agents" actionHref="/agents" actionLabel="View all →">
              {agents.length > 0 && isLoggedIn ? (
                <div className="grid grid-cols-2 gap-2">
                  {agents.slice(0, 2).map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      published={publishedAgentIds.has(agent.id)}
                      onChanged={onChanged}
                      animateOnlineProfile
                    />
                  ))}
                </div>
              ) : (
                <div className="border-[3px] border-pixel-black bg-pixel-white/50 p-4 text-center">
                  <p className="font-pixel text-sm text-pixel-black/50">
                    {isLoggedIn ? 'No recent agents' : 'Sign in to see recent agents'}
                  </p>
                </div>
              )}
            </Panel>

            <Panel title="Recent projects" actionHref="/projects" actionLabel="Manage →">
              {recentProjects.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {recentProjects.map((project, index) => (
                    <ProjectCard key={project.id} project={project} index={index} onDelete={onDeleteProject} />
                  ))}
                </div>
              ) : (
                <Link
                  href="/projects"
                  className="block border-[3px] border-pixel-black bg-pixel-white/50 p-4 text-center no-underline"
                >
                  <p className="font-pixel text-sm text-pixel-black/50">
                    No recent projects — create a server workspace
                  </p>
                </Link>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </motion.div>
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
  const [teamCount, setTeamCount] = useState(0);
  const [publishedAgentIds, setPublishedAgentIds] = useState<Set<string>>(new Set());
  const [dataReady, setDataReady] = useState(false);
  const [showHero, setShowHero] = useState(false);
  const [hasSeenHero, setHasSeenHero] = useState(false);
  const [displayMode] = useDisplayMode();

  const reload = useCallback(async () => {
    if (!isLoggedIn) {
      setAgents([]);
      setProjects([]);
      setTeamCount(0);
      setPublishedAgentIds(new Set());
      setDataReady(true);
      return;
    }
    const [agentList, projectList, teamList, listings] = await Promise.all([
      fetchAgents().catch(() => []),
      fetchProjects().catch(() => []),
      fetchTeams().catch(() => []),
      fetchMyListings().catch(() => []),
    ]);
    setAgents(agentList);
    setProjects(
      [...projectList].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    );
    setTeamCount(teamList.length);
    setPublishedAgentIds(
      new Set(listings.filter((l) => l.status === 'active' && l.sourceAgentId).map((l) => l.sourceAgentId!))
    );
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

  const handleDeleteProject = async (project: ProjectView) => {
    const ok = window.confirm(
      `Delete project "${project.name}"? This removes its configuration and workspace.`
    );
    if (!ok) return;
    await deleteProject(project.id);
    await reload();
  };

  const recentProjects = projects.slice(0, 4);

  return (
    <>
      <AnimatePresence>{showHero && <PixelHero onEnter={handleEnter} />}</AnimatePresence>

      <MobileHome agents={agents} projects={projects} teamCount={teamCount} isLoggedIn={isLoggedIn} />

      <OfficialAdoptPrompt
        isLoggedIn={Boolean(token && user)}
        promptKey={token && user ? `swarmdev.officialAdoptPrompt.${user.id}` : null}
        agentCount={agents.length}
        agentDataReady={dataReady}
        userName={user?.username}
        onOfficialAdopted={reload}
      />

      <AnimatePresence mode="wait" initial={false}>
        {displayMode === 'traditional' ? (
          <TraditionalDesktopHome
            key="traditional"
            agents={agents}
            projects={projects}
            teamCount={teamCount}
            publishedAgentIds={publishedAgentIds}
            isLoggedIn={isLoggedIn}
            hasSeenHero={hasSeenHero}
            onDeleteProject={handleDeleteProject}
            onChanged={reload}
          />
        ) : (
          <motion.div
            key="professional"
            className="hidden space-y-6 md:block"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.985 }}
            transition={{ duration: 0.28, delay: hasSeenHero ? 0 : 0.3 }}
          >
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
              <h1 className="brand-large mb-2 text-pixel-black">Welcome to the Agent World</h1>
              <p className="font-pixel text-xl text-pixel-blue">WELCOME TO AGENT WORLD</p>
              <p className="mt-2 font-pixel text-sm text-pixel-black/60">
                Pick an entry point to start managing and collaborating with your agents
              </p>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2">
              <SectionA>
                <div className="space-y-4">
                  <MenuCard
                    href="/market"
                    title="Quick adopt"
                    description="Adopt | Get a new teammate instantly"
                    color="bg-pixel-green"
                    delay={0.1}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-green">
                        <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1 5h2v6h-2Zm0 8h2v2h-2Z" />
                      </svg>
                    }
                  />
                  <MenuCard
                    href="/upload"
                    title="Upload agent"
                    description="Upload | Import a trained agent"
                    color="bg-pixel-blue"
                    delay={0.2}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-blue">
                        <path fill="currentColor" d="M6 2h9l5 5v15H6V2Zm8 1v5h5M12 11v6M9 14l3-3 3 3" />
                      </svg>
                    }
                  />
                  <MenuCard
                    href="/market"
                    title="Agent market"
                    description="Market | Listings and community"
                    color="bg-pixel-yellow"
                    delay={0.3}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-yellow">
                        <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm3.5 14.5-7 2 2-7 7-2-2 7Z" />
                      </svg>
                    }
                  />
                  <MenuCard
                    href="/agents"
                    title="My agent den"
                    description={`My Agents | ${isLoggedIn ? `${agents.length} agents owned` : 'Sign in to view'}`}
                    color="bg-pixel-red"
                    delay={0.4}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-red">
                        <path fill="currentColor" d="M12 3 3 9v12h7v-6h4v6h7V9Zm0 2.5L18 10v9h-2v-6H8v6H6v-9Z" />
                      </svg>
                    }
                  />
                </div>

                <div className="mt-6">
                  <h3 className="mb-3 font-pixel text-base text-pixel-black">Recent agents</h3>
                  {agents.length > 0 && isLoggedIn ? (
                    <div className="grid grid-cols-3 gap-2">
                      {agents.slice(0, 3).map((agent) => (
                        <AgentCard
                          key={agent.id}
                          agent={agent}
                          published={publishedAgentIds.has(agent.id)}
                          onChanged={reload}
                          animateOnlineProfile
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="border-4 border-pixel-black bg-pixel-white/50 p-4 text-center">
                      <p className="font-pixel text-sm text-pixel-black/50">
                        {isLoggedIn ? 'No recent agents' : 'Sign in to see recent agents'}
                      </p>
                    </div>
                  )}
                </div>
              </SectionA>

              <SectionB>
                <div className="space-y-4">
                  <MenuCard
                    href="/teams/create"
                    title="Create a team"
                    description="Create | Design a new agent team"
                    color="bg-pixel-blue"
                    delay={0.1}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-blue">
                        <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z" />
                      </svg>
                    }
                  />
                  <MenuCard
                    href="/teams"
                    title="My teams"
                    description={`My Teams | ${isLoggedIn ? `${teamCount} created` : 'Sign in to view'}`}
                    color="bg-pixel-green"
                    delay={0.2}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-green">
                        <path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    }
                  />
                  <MenuCard
                    href="/projects"
                    title="My projects"
                    description={`Projects | ${isLoggedIn ? `${projects.length} workspaces` : 'Sign in to view'}`}
                    color="bg-pixel-yellow"
                    delay={0.3}
                    icon={<FolderGlyph className="h-8 w-8 text-pixel-yellow" />}
                  />
                  <MenuCard
                    href="/roundtable"
                    title="Roundtable"
                    description={`Roundtable | ${isLoggedIn ? 'Multi-agent group chat' : 'Sign in to use'}`}
                    color="bg-pixel-red"
                    delay={0.4}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-pixel-red">
                        <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H6l-2 2V4h16Z" />
                        <path fill="currentColor" d="M7 9h10v2H7Zm0-3h10v2H7Z" />
                      </svg>
                    }
                  />
                </div>

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-pixel text-base text-pixel-black">Recent projects</h3>
                    <Link href="/projects" className="font-pixel text-sm text-pixel-blue">
                      Manage projects
                    </Link>
                  </div>
                  {recentProjects.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {recentProjects.map((project, index) => (
                        <ProjectCard key={project.id} project={project} index={index} onDelete={handleDeleteProject} />
                      ))}
                    </div>
                  ) : (
                    <Link href="/projects" className="block border-4 border-pixel-black bg-pixel-white/50 p-4 text-center">
                      <p className="font-pixel text-sm text-pixel-black/50">
                        No recent projects — create a server workspace
                      </p>
                    </Link>
                  )}
                </div>
              </SectionB>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
