'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PixelCard } from '@/components/ui/PixelCard';
import { AgentSprite } from './AgentSprite';
import { deleteAgent, type Agent } from '@/lib/agents';
import { publishAgent, unpublishAgent } from '@/lib/market';

const RUNTIME_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  api: 'API',
};

interface AgentCardProps {
  agent: Agent;
  published?: boolean;
  silhouette?: boolean;
  onChanged?: () => Promise<void> | void;
  animateOnlineProfile?: boolean;
}

type BusyAction = 'delete' | 'market' | null;

export function AgentCard({
  agent,
  published = false,
  silhouette = false,
  onChanged,
  animateOnlineProfile = false,
}: AgentCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [menuOpen]);

  const providerConfigured = Boolean(agent.providerId);

  const handleClick = () => {
    if (!silhouette) router.push(`/agents/${agent.id}`);
  };

  const handleDelete = async () => {
    if (busyAction || silhouette) return;
    if (!window.confirm(`Delete "${agent.name}"? Its workspace will be removed.`)) return;
    try {
      setBusyAction('delete');
      await deleteAgent(agent.id);
      await onChanged?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete agent');
    } finally {
      setBusyAction(null);
      setMenuOpen(false);
    }
  };

  const handleMarketToggle = async () => {
    if (busyAction || silhouette) return;
    const confirmed = window.confirm(
      published
        ? `Remove "${agent.name}" from the market? Existing downloads keep working.`
        : `Publish "${agent.name}" to the market? Sensitive files are omitted and secrets are redacted in the published copy.`
    );
    if (!confirmed) return;
    try {
      setBusyAction('market');
      if (published) {
        await unpublishAgent(agent.id);
      } else {
        const result = await publishAgent({ agentId: agent.id });
        if (result.sanitization) alert(result.sanitization);
      }
      await onChanged?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Market action failed');
    } finally {
      setBusyAction(null);
      setMenuOpen(false);
    }
  };

  const handleConfigure = () => {
    if (busyAction || silhouette) return;
    setMenuOpen(false);
    router.push(`/agents/${agent.id}/settings`);
  };

  const handleCommunity = () => {
    setMenuOpen(false);
    router.push(`/community?agentId=${encodeURIComponent(agent.id)}`);
  };

  const description = agent.description?.trim() || 'No description yet';

  return (
    <PixelCard
      onClick={handleClick}
      hoverable={!silhouette && providerConfigured}
      className={`group/agent-card relative flex h-full min-h-[360px] w-full flex-col md:min-h-[320px] ${
        silhouette ? 'pointer-events-none' : ''
      }`}
    >
      {published && !silhouette && (
        <div className="absolute left-1.5 top-1.5 z-20 border border-pixel-line bg-pixel-yellow px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none text-pixel-black md:text-[9px]">
          LISTED
        </div>
      )}

      {!silhouette && (
        <div
          className={`absolute right-2 top-2 z-[80] transition-opacity duration-150 ${
            menuOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover/agent-card:pointer-events-auto group-hover/agent-card:opacity-100 group-focus-within/agent-card:pointer-events-auto group-focus-within/agent-card:opacity-100'
          }`}
        >
          <button
            type="button"
            aria-label="Agent actions"
            className="h-11 w-11 border-0 bg-transparent font-sans text-2xl font-bold leading-none text-pixel-black/65 hover:bg-pixel-black/5 hover:text-pixel-black focus:text-pixel-black focus:outline-none md:h-8 md:w-8 md:text-xl"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            disabled={busyAction !== null}
          >
            ...
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 mt-2 w-72 border border-pixel-line bg-pixel-white py-1 md:w-56"
              style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="w-full px-4 py-3 text-left font-sans text-base text-pixel-black hover:bg-pixel-cream disabled:opacity-50 md:px-3 md:py-2 md:text-xs"
                onClick={handleConfigure}
                disabled={busyAction !== null}
              >
                Configure agent
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left font-sans text-base text-pixel-black hover:bg-pixel-cream disabled:opacity-50 md:px-3 md:py-2 md:text-xs"
                onClick={handleDelete}
                disabled={busyAction !== null}
              >
                Delete this agent
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left font-sans text-base text-pixel-black hover:bg-pixel-cream disabled:opacity-50 md:px-3 md:py-2 md:text-xs"
                onClick={handleMarketToggle}
                disabled={busyAction !== null}
              >
                {published ? 'Remove from market' : 'Publish to market'}
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left font-sans text-base text-pixel-black hover:bg-pixel-cream disabled:opacity-50 md:px-3 md:py-2 md:text-xs"
                onClick={handleCommunity}
                disabled={busyAction !== null}
              >
                View in community
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-between gap-4 pb-9 pt-12 md:gap-3 md:pb-8 md:pt-10">
        <div
          className={`relative inline-flex ${
            animateOnlineProfile && providerConfigured && !silhouette ? 'animate-float' : ''
          }`}
        >
          <AgentSprite
            agent={agent}
            size="lg"
            silhouette={silhouette}
            showProviderStatus={!silhouette}
            providerConfigured={providerConfigured}
          />
          {!silhouette && (
            <div className="pointer-events-none absolute -left-2 bottom-0 z-20 border border-pixel-line bg-pixel-white px-1 py-0.5 font-sans text-[9px] leading-none text-pixel-black">
              {RUNTIME_LABELS[agent.runtime] ?? agent.runtime}
            </div>
          )}
        </div>
        <div className="flex w-full flex-1 flex-col justify-end text-center">
          <p className="mb-2 line-clamp-2 min-h-[3.8rem] font-sans text-[1.55rem] font-bold leading-tight text-pixel-black md:mb-1 md:min-h-[2.5rem] md:text-base">
            {agent.name}
          </p>
          <p className="line-clamp-3 min-h-[4.6rem] font-sans text-[1.1rem] leading-snug text-pixel-black/70 md:min-h-[3rem] md:text-xs">
            {description}
          </p>
          <p className="mt-3 truncate font-sans text-[0.95rem] text-pixel-black/50 md:mt-2 md:text-xs">
            {providerConfigured ? `Model: ${agent.model ?? 'default'}` : 'Provider not configured'}
          </p>
        </div>
      </div>
    </PixelCard>
  );
}
