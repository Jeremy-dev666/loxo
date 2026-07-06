'use client';

import Link from 'next/link';
import { AgentSprite } from '@/components/agent/AgentSprite';
import type { Agent } from '@/lib/agents';

const RUNTIME_ROLES: Record<string, string> = {
  claude: 'Claude CLI Agent',
  codex: 'Codex CLI Agent',
  opencode: 'OpenCode Agent',
  openclaw: 'OpenClaw Agent',
  gemini: 'Gemini CLI Agent',
  hermes: 'Hermes Agent',
  api: 'Hosted API Agent',
};

function roleFor(agent: Agent): string {
  const tag = agent.tags[0];
  if (tag) return tag.charAt(0).toUpperCase() + tag.slice(1);
  return RUNTIME_ROLES[agent.runtime] ?? 'Agent';
}

/** Monochrome ID-badge card: clip, name bar, portrait, role, motto. */
export function AgentBadgeCard({ agent }: { agent: Agent }) {
  const onDuty = Boolean(agent.providerId);

  return (
    <div className="w-[236px] shrink-0">
      <div className="mx-auto h-3.5 w-9 rounded-t-md border border-b-0 border-[#111] bg-[#111]" aria-hidden />
      <Link
        href={`/agents/${agent.id}`}
        className="group block rounded-xl border border-[#E4E4E4] bg-white px-4 pb-4 pt-3 no-underline transition-colors hover:border-[#111]"
      >
        <div className="mx-auto mb-3 h-1.5 w-8 rounded-full bg-[#EFEFEF]" aria-hidden />
        <span className="inline-block max-w-full truncate rounded-md bg-[#111] px-3 py-1 text-sm font-semibold leading-tight text-white">
          {agent.name}
        </span>
        <div className="flex h-28 items-center justify-center py-2 grayscale contrast-125">
          <AgentSprite agent={agent} size="lg" />
        </div>
        <p className="text-[15px] font-semibold leading-snug text-[#111]">{roleFor(agent)}</p>
        <p className="mt-1 line-clamp-2 min-h-[2.4em] text-[13px] leading-snug text-[#6B6B6B]">
          {agent.description || 'No motto yet — give this agent a description.'}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#9B9B9B]">SwarmDev</span>
          <span
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold leading-none ${
              onDuty ? 'bg-[#111] text-white' : 'border border-[#C9C9C9] text-[#6B6B6B]'
            }`}
          >
            {onDuty ? (agent.model ?? 'On duty') : 'No provider'}
          </span>
        </div>
      </Link>
    </div>
  );
}

/** Trailing ghost card inviting a new hire. */
export function HireBadgeCard() {
  return (
    <div className="w-[236px] shrink-0 pt-[26px]">
      <Link
        href="/upload"
        className="flex h-[calc(100%-26px)] min-h-[248px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9C9C9] bg-white text-[#6B6B6B] no-underline transition-colors hover:border-[#111] hover:text-[#111]"
      >
        <span className="text-3xl leading-none">+</span>
        <span className="text-sm font-semibold">Hire an agent</span>
        <span className="text-xs">Upload or adopt from the market</span>
      </Link>
    </div>
  );
}
