'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AgentBadgeCard, HireBadgeCard } from '@/components/dashboard/AgentBadgeCard';
import type { Agent } from '@/lib/agents';
import type { TeamView } from '@/lib/teams';
import type { ProjectView } from '@/lib/projects';
import {
  fetchDashboardActivity,
  fetchDashboardSummary,
  type ActivityEvent,
  type DashboardRunRow,
  type DashboardSummary,
} from '@/lib/dashboard';
import type { RunStatus } from '@/lib/runs';

const REFRESH_MS = 30000;

const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  queued: 'border border-dashed border-[#9B9B9B] text-[#6B6B6B]',
  running: 'bg-[#111] text-white',
  succeeded: 'border border-[#C9C9C9] text-[#6B6B6B]',
  failed: 'border border-[#111] text-[#111]',
  cancelled: 'border border-[#C9C9C9] text-[#9B9B9B]',
};

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

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

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function issueRef(event: { issueNumber: number | null; issueTitle: string | null }): string {
  if (event.issueNumber == null) return '';
  return ` — #${event.issueNumber} ${event.issueTitle ?? ''}`.trimEnd();
}

function activityText(event: ActivityEvent): string {
  const actor = event.actorName ?? 'You';
  switch (event.kind) {
    case 'run_finished':
      if (event.detail === 'failed') return `${actor} run failed${issueRef(event)}`;
      if (event.detail === 'cancelled') return `${actor} run cancelled${issueRef(event)}`;
      return `${actor} finished a run${issueRef(event)}`;
    case 'issue_created':
      return `Issue filed${issueRef(event)}`;
    case 'issue_closed':
      return event.detail === 'cancelled'
        ? `Issue cancelled${issueRef(event)}`
        : `Issue done${issueRef(event)}`;
    case 'comment':
      return `${actor} commented${issueRef(event)}`;
    case 'review':
      return event.detail === 'approved'
        ? `${actor} approved the review${issueRef(event)}`
        : `${actor} requested changes${issueRef(event)}`;
  }
}

function runDetail(run: DashboardRunRow): string {
  const target =
    run.issueNumber != null ? `#${run.issueNumber} ${run.issueTitle ?? ''}`.trimEnd() : run.reason;
  return target ? `${run.agentName} → ${target}` : run.agentName;
}

function runTiming(run: DashboardRunRow): string {
  if (run.status === 'queued') return `Queued ${timeAgo(run.createdAt)}`;
  if (run.status === 'running') {
    return run.startedAt ? `Started ${timeAgo(run.startedAt)}` : 'Starting';
  }
  if (!run.finishedAt) return '';
  const finished = `finished ${clockTime(run.finishedAt)}`;
  if (run.startedAt) {
    const mins = Math.round(
      (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 60000
    );
    return `${mins < 1 ? '<1' : mins} min · ${finished}`;
  }
  return finished;
}

function runTitle(run: DashboardRunRow): string {
  if (run.issueNumber != null) return run.issueTitle ?? `Issue #${run.issueNumber}`;
  return run.reason || `${run.trigger} run`;
}

function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#111]">{title}</h2>
      {action && (
        <Link href={action.href} className="text-[13px] text-[#6B6B6B] no-underline hover:text-[#111]">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded border border-[#E4E4E4] bg-white ${className}`}>{children}</div>;
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-[0.14em] text-[#9B9B9B]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[#111]">{value}</p>
      <p className="mt-1 truncate text-[13px] text-[#6B6B6B]">{sub}</p>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded border border-[#E4E4E4] bg-white px-5 py-4 no-underline transition-colors hover:bg-[#FAFAFA]"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded border border-[#E4E4E4] bg-white px-5 py-4">{body}</div>;
}

function AttentionRow({
  title,
  detail,
  href,
}: {
  title: string;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-sm font-semibold text-[#111]">{title}</p>
      <p className="mt-0.5 text-[13px] text-[#6B6B6B]">{detail}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="block px-5 py-3.5 no-underline transition-colors hover:bg-[#FAFAFA]">
        {body}
      </Link>
    );
  }
  return <div className="px-5 py-3.5">{body}</div>;
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
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    if (!isLoggedIn) {
      setSummary(null);
      setActivity([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const [summaryRes, activityRes] = await Promise.all([
        fetchDashboardSummary().catch(() => null),
        fetchDashboardActivity(12).catch(() => null),
      ]);
      if (cancelled) return;
      if (summaryRes) setSummary(summaryRes.summary);
      if (activityRes) setActivity(activityRes.events);
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isLoggedIn]);

  const onDuty = agents.filter((a) => a.providerId);
  const idle = agents.length - onDuty.length;
  const recentProjects = projects.slice(0, 4);
  const recentTeams = teams.slice(0, 4);

  const runRows = summary ? [...summary.activeRuns, ...summary.recentRuns].slice(0, 6) : [];
  const inReview = summary?.issues.byStatus['in_review'] ?? 0;
  const blocked = summary?.issues.byStatus['blocked'] ?? 0;
  const failedToday = summary?.today.failedRuns ?? 0;
  const hasAttention = idle > 0 || inReview > 0 || blocked > 0 || failedToday > 0;

  return (
    <div className="hidden text-[#111] md:block">
      <div className="mx-auto max-w-[1200px] px-2 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-sans text-xs uppercase tracking-[0.2em] text-[#9B9B9B]">{dateLine()}</p>
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
              className="rounded bg-[#111] px-5 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#333]"
            >
              Hire an agent
            </Link>
            <Link
              href="/teams/create"
              className="rounded border border-[#111] px-5 py-2.5 text-sm font-semibold text-[#111] no-underline transition-colors hover:bg-[#111] hover:text-white"
            >
              New team
            </Link>
          </div>
        </div>

        {/* Stats */}
        {isLoggedIn && summary && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Open issues"
              value={String(summary.issues.open)}
              sub={
                inReview > 0
                  ? `${inReview} in review${blocked > 0 ? ` · ${blocked} blocked` : ''}`
                  : blocked > 0
                    ? `${blocked} blocked`
                    : 'Across all projects'
              }
              href="/issues"
            />
            <StatCard
              label="Active runs"
              value={String(summary.runs.active)}
              sub={`${summary.runs.running} running · ${summary.runs.queued} queued`}
            />
            <StatCard
              label="Agents busy"
              value={`${summary.agents.busy}/${summary.agents.total}`}
              sub={idle > 0 ? `${idle} missing a provider key` : 'All providers configured'}
              href="/agents"
            />
            <StatCard
              label="Spent today"
              value={formatCost(summary.today.costUsd)}
              sub={`${summary.today.runs} ${summary.today.runs === 1 ? 'run' : 'runs'} · ${formatTokens(
                summary.today.tokensIn + summary.today.tokensOut
              )} tokens`}
            />
          </div>
        )}

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
              <SectionHead title="Runs" action={{ href: '/issues', label: 'Board' }} />
              {runRows.length > 0 ? (
                <Card>
                  {runRows.map((run, i) => (
                    <div
                      key={run.id}
                      className={`flex items-center gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}
                    >
                      <span
                        className={`w-[72px] shrink-0 rounded-sm px-2 py-1 text-center text-[11px] font-semibold leading-none ${RUN_STATUS_STYLES[run.status]}`}
                      >
                        {RUN_STATUS_LABELS[run.status]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{runTitle(run)}</p>
                        <p className="truncate text-[13px] text-[#6B6B6B]">{runDetail(run)}</p>
                      </div>
                      <span className="shrink-0 font-sans text-xs text-[#9B9B9B]">{runTiming(run)}</span>
                    </div>
                  ))}
                </Card>
              ) : (
                <Card className="px-5 py-8 text-center">
                  <p className="text-sm text-[#6B6B6B]">
                    {isLoggedIn ? (
                      <>
                        No runs yet. Assign an agent to an issue on the{' '}
                        <Link href="/issues" className="font-semibold text-[#111]">
                          board
                        </Link>{' '}
                        to wake one up.
                      </>
                    ) : (
                      'Sign in to see your agents at work.'
                    )}
                  </p>
                </Card>
              )}
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
                      <span className="shrink-0 font-sans text-xs text-[#9B9B9B]">
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
                {inReview > 0 && (
                  <AttentionRow
                    title={`${inReview} ${inReview === 1 ? 'issue' : 'issues'} waiting for review`}
                    detail="Approve or request changes on the board"
                    href="/issues"
                  />
                )}
                {blocked > 0 && (
                  <AttentionRow
                    title={`${blocked} ${blocked === 1 ? 'issue is' : 'issues are'} blocked`}
                    detail="Unblock them so assignees can resume"
                    href="/issues"
                  />
                )}
                {failedToday > 0 && (
                  <AttentionRow
                    title={`${failedToday} ${failedToday === 1 ? 'run' : 'runs'} failed today`}
                    detail="Check the run output for what went wrong"
                  />
                )}
                {idle > 0 && (
                  <AttentionRow
                    title={`${idle} ${idle === 1 ? 'agent has' : 'agents have'} no provider key`}
                    detail="Configure a provider to put them on duty"
                    href="/settings/providers"
                  />
                )}
                {!hasAttention && (
                  <AttentionRow
                    title="All clear"
                    detail={isLoggedIn ? 'Nothing is waiting on you right now' : 'Sign in to see what needs you'}
                  />
                )}
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
              <SectionHead title="Activity" />
              <Card className="px-5 py-4">
                {activity.length > 0 ? (
                  <ol className="space-y-3">
                    {activity.map((event) => (
                      <li key={event.id} className="flex gap-3 text-[13px] leading-snug">
                        <span className="w-10 shrink-0 font-sans text-xs text-[#9B9B9B]">
                          {clockTime(event.occurredAt)}
                        </span>
                        <span className="min-w-0 text-[#3C3C3C]">{activityText(event)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="py-2 text-center text-[13px] text-[#6B6B6B]">
                    {isLoggedIn ? 'No activity yet — file an issue to get things moving.' : 'Sign in to see your feed.'}
                  </p>
                )}
              </Card>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
