'use client';

import { avatarUrl, type Agent } from '@/lib/agents';

const SIZE_STYLES = {
  sm: { box: 'h-12 w-12 border-2', text: 'text-lg', dot: 'h-3 w-3 border' },
  md: { box: 'h-16 w-16 border-3', text: 'text-2xl', dot: 'h-3.5 w-3.5 border' },
  lg: { box: 'h-24 w-24 border-4', text: 'text-4xl', dot: 'h-4 w-4 border-2' },
};

/** Deterministic tone per agent so placeholder portraits stay recognizable. */
const TONES = ['bg-pixel-blue', 'bg-pixel-green', 'bg-pixel-red', 'bg-pixel-yellow', 'bg-pixel-gray'];

function toneFor(agent: Agent): string {
  let hash = 0;
  for (const ch of agent.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length]!;
}

interface AgentSpriteProps {
  agent: Agent;
  size?: keyof typeof SIZE_STYLES;
  silhouette?: boolean;
  showProviderStatus?: boolean;
  providerConfigured?: boolean;
  className?: string;
}

export function AgentSprite({
  agent,
  size = 'md',
  silhouette = false,
  showProviderStatus = false,
  providerConfigured = false,
  className = '',
}: AgentSpriteProps) {
  const styles = SIZE_STYLES[size];
  const avatar = avatarUrl(agent);
  const dimmed = silhouette || (showProviderStatus && !providerConfigured);

  return (
    <div className={`relative inline-flex ${className}`}>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt={agent.name}
          className={`${styles.box} border-pixel-black object-cover pixelated ${dimmed ? 'opacity-45 grayscale' : ''}`}
        />
      ) : (
        <div
          className={`${styles.box} flex items-center justify-center border-pixel-black font-pixel text-pixel-white ${toneFor(agent)} ${
            dimmed ? 'opacity-45 grayscale' : ''
          }`}
        >
          <span className={styles.text}>{agent.name.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      {showProviderStatus && !silhouette && (
        <span
          aria-label={providerConfigured ? 'Provider configured' : 'Provider not configured'}
          className={`absolute -right-1 -top-1 rounded-full border-pixel-black ${styles.dot} ${
            providerConfigured ? 'bg-pixel-green' : 'bg-pixel-gray'
          }`}
        />
      )}
    </div>
  );
}
