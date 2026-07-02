const DEFAULT_API_BASE = 'http://localhost:4000';

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE).replace(/\/+$/, '');

/** REST and WebSocket share one backend port; the WS endpoint lives at /ws. */
export function wsUrl(params: URLSearchParams): string {
  const base = API_BASE.replace(/^http/, 'ws');
  return `${base}/ws?${params.toString()}`;
}
