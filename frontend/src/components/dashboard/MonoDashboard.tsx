'use client';

import Link from 'next/link';
import { AgentBadgeCard, HireBadgeCard } from '@/components/dashboard/AgentBadgeCard';
import type { Agent } from '@/lib/agents';
import type { TeamView } from '@/lib/teams';
import type { ProjectView } from '@/lib/projects';

// Placeholder rows until a workflow-executions API exists.
const SAMPLE_RUNS = [
  {
    id: 'run-1',
    status: 'running' as const,
    title: 'Release notes draft',
    detail: 'Docs crew → Website refresh',
    when: 'Started 4 min ago',
  },
  {
    id: 'run-2',
    status: 'done' as const,
    title: 'API error triage',
    detail: 'Backend duo → Bug backlog',
    when: '38 min · finished 10:24',
  },
  {
    id: 'run-3',
    status: 'done' as const,
    title: 'Landing page copy pass',
    detail: 'Docs crew → Website refresh',
    when: '12 min · finished 09:51',
  },
  {
    id: 'run-4',
    status: 'failed' as const,
    title: 'Nightly dependency audit',
    detail: 'Maintenance bot → Chores',
    when: 'Failed at step 2 · 07:00',
  },
];

// Placeholder feed until an activity API exists.
const SAMPLE_ACTIVITY = [
  { id: 'a1', time: '10:24', text: 'API error triage finished — 2 deliverables ready for review' },
  { id: 'a2', time: '10:02', text: 'Scout replied in roundtable "Sprint planning"' },
  { id: 'a3', time: '09:51', text: 'Landing page copy pass finished without changes requested' },
  { id: 'a4', time: '09:12', text: 'Slack: 3 messages handled by Support bot' },
  { id: 'a5', time: '07:00', text: 'Nightly dependency audit failed — step 2 timed out' },
];

const RUN_STATUS_STYLES = {
  running: 'bg-[#111] text-white',
  done: 'border border-[#C9C9C9] text-[#6B6B6B]',
  failed: 'border border-[#111] text-[#111]',
};

const RUN_STATUS_LABELS = { running: 'Running', done: 'Done', failed: 'Failed' };

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function dateLine(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function SectionHead({
  title,
  sample = false,
  action,
}: {
  title: string;
  sample?: boolean;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#111]">{title}</h2>
        {sample && (
          <span className="rounded-full border border-[#C9C9C9] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#9B9B9B]">
            Sample
          </span>
        )}
      </div>
      {action && (
        <Link href={action.href} className="text-[13px] text-[#6B6B6B] no-underline hover:text-[#111]">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[#E4E4E4] bg-white ${className}`}>{children}</div>;
}

export function MonoDashboard({
  agents,
  teams,
  projects,
  isLoggedIn,
  userName,
}: {
  agents: Agent[];
  teams: TeamView[];
  projects: ProjectView[];
  isLoggedIn: boolean;
  userName?: string;
}) {
  const onDuty = agents.filter((a) => a.providerId);
  const idle = agents.length - onDuty.length;
  const recentProjects = projects.slice(0, 4);
  const recentTeams = teams.slice(0, 4);

  return (
    <div className="hidden font-sans text-[#111] md:block">
      <div className="mx-auto max-w-[1200px] px-2 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-pixel text-xs uppercase tracking-[0.2em] text-[#9B9B9B]">{dateLine()}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {greeting()}
              {isLoggedIn && userName ? `, ${userName}` : ''}
            </h1>
            <p className="mt-2 text-sm text-[#6B6B6B]">
              {isLoggedIn
                ? `${onDuty.length} of ${agents.length} agents on duty · ${teams.length} teams · ${projects.length} projects`
                : 'Sign in to bring your agents back on duty.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/upload"
              className="rounded-full bg-[#111] px-5 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#333]"
            >
              Hire an agent
            </Link>
            <Link
              href="/teams/create"
              className="rounded-full border border-[#111] px-5 py-2.5 text-sm font-semibold text-[#111] no-underline transition-colors hover:bg-[#111] hover:text-white"
            >
              New team
            </Link>
          </div>
        </div>

        {/* Roster */}
        <section className="mt-10">
          <SectionHead
            title={`Agent roster · ${agents.length}`}
            action={{ href: '/agents', label: 'View all' }}
          />
          <div className="flex gap-5 overflow-x-auto pb-2">
            {agents.slice(0, 8).map((agent) => (
              <AgentBadgeCard key={agent.id} agent={agent} />
            ))}
            <HireBadgeCard />
          </div>
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-10">
            {/* Runs */}
            <section>
              <SectionHead title="Workflow runs" sample />
              <Card>
                {SAMPLE_RUNS.map((run, i) => (
                  <div
                    key={run.id}
                    className={`flex items-center gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}
                  >
                    <span
                      className={`w-[72px] shrink-0 rounded-md px-2 py-1 text-center text-[11px] font-semibold leading-none ${RUN_STATUS_STYLES[run.status]}`}
                    >
                      {RUN_STATUS_LABELS[run.status]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{run.title}</p>
                      <p className="truncate text-[13px] text-[#6B6B6B]">{run.detail}</p>
                    </div>
                    <span className="shrink-0 font-pixel text-xs text-[#9B9B9B]">{run.when}</span>
                  </div>
                ))}
              </Card>
            </section>

            {/* Projects */}
            <section>
              <SectionHead title="Projects" action={{ href: '/projects', label: 'Manage' }} />
              {recentProjects.length > 0 ? (
                <Card>
                  {recentProjects.map((project, i) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className={`flex items-center gap-4 px-5 py-3.5 no-underline transition-colors hover:bg-[#FAFAFA] ${
                        i > 0 ? 'border-t border-[#F0F0F0]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#111]">{project.name}</p>
                        <p className="truncate text-[13px] text-[#6B6B6B]">
                          {project.description || 'Server workspace'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[12px] text-[#6B6B6B]">
                        {project.teamIds.length} teams · {project.agentIds.length} agents
                      </span>
                      <span className="shrink-0 font-pixel text-xs text-[#9B9B9B]">
                        {relativeDay(project.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </Card>
              ) : (
                <Card className="px-5 py-8 text-center">
                  <p className="text-sm text-[#6B6B6B]">
                    No projects yet.{' '}
                    <Link href="/projects" className="font-semibold text-[#111]">
                      Create a workspace
                    </Link>{' '}
                    and bind a team to run its first task.
                  </p>
                </Card>
              )}
            </section>
          </div>

          <div className="space-y-10">
            {/* Attention */}
            <section>
              <SectionHead title="Needs attention" />
              <Card className="divide-y divide-[#F0F0F0]">
                {idle > 0 && (
                  <Link
                    href="/settings/providers"
                    className="block px-5 py-3.5 no-underline transition-colors hover:bg-[#FAFAFA]"
                  >
                    <p className="text-sm font-semibold text-[#111]">
                      {idle} {idle === 1 ? 'agent has' : 'agents have'} no provider key
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#6B6B6B]">Configure a provider to put them on duty</p>
                  </Link>
                )}
                {/* Placeholder items until review/run APIs exist. */}
                <div className="px-5 py-3.5">
                  <p className="text-sm font-semibold">
                    2 deliverables waiting for review{' '}
                    <span className="ml-1 rounded-full border border-[#C9C9C9] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[#9B9B9B]">
                      sample
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-[#6B6B6B]">API error triage · finished 10:24</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-sm font-semibold">
                    1 run failed overnight{' '}
                    <span className="ml-1 rounded-full border border-[#C9C9C9] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[#9B9B9B]">
                      sample
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-[#6B6B6B]">Nightly dependency audit · step 2 timed out</p>
                </div>
              </Card>
            </section>

            {/* Teams */}
            <section>
              <SectionHead title="Teams" action={{ href: '/teams', label: 'View all' }} />
              {recentTeams.length > 0 ? (
                <Card className="divide-y divide-[#F0F0F0]">
                  {recentTeams.map((team) => (
                    <Link
                      key={team.id}
                      href={`/teams/${team.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3.5 no-underline transition-colors hover:bg-[#FAFAFA]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#111]">{team.name}</p>
                        <p className="truncate text-[13px] text-[#6B6B6B]">
                          {team.workflow.nodes.length} members · {team.workflow.execution.mode}
                        </p>
                      </div>
                      <span className="shrink-0 text-lg leading-none text-[#C9C9C9]">›</span>
                    </Link>
                  ))}
                </Card>
              ) : (
                <Card className="px-5 py-6 text-center">
                  <p className="text-sm text-[#6B6B6B]">
                    No teams yet.{' '}
                    <Link href="/teams/create" className="font-semibold text-[#111]">
                      Compose your first crew
                    </Link>
                  </p>
                </Card>
              )}
            </section>

            {/* Activity */}
            <section>
              <SectionHead title="Activity" sample />
              <Card className="px-5 py-4">
                <ol className="space-y-3">
                  {SAMPLE_ACTIVITY.map((item) => (
                    <li key={item.id} className="flex gap-3 text-[13px] leading-snug">
                      <span className="shrink-0 font-pixel text-xs text-[#9B9B9B]">{item.time}</span>
                      <span className="text-[#3C3C3C]">{item.text}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
