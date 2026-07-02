import { API_BASE } from './runtime';
import { useAuthStore, type SessionUser } from '@/store/auth';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.code ?? 'unknown', body.message ?? 'Request failed');
  }
  return body as T;
}

export interface AuthResponse {
  user: SessionUser;
  token: string;
}

export function register(input: { email: string; username: string; password: string }) {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export { apiFetch };
