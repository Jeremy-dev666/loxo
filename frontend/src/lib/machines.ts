import { apiFetch } from './api';

export interface RuntimeProbeView {
  runtime: string;
  available: boolean;
  version: string | null;
  error?: string;
}

export interface MachineView {
  id: string;
  name: string;
  platform: string | null;
  hostname: string | null;
  online: boolean;
  runtimes: RuntimeProbeView[];
  env: Record<string, string>;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const fetchMachines = () =>
  apiFetch<{ machines: MachineView[] }>('/api/machines').then((r) => r.machines);

export const approvePairing = (userCode: string, name?: string) =>
  apiFetch<{ machine: MachineView }>('/api/machines/pair/approve', {
    method: 'POST',
    body: JSON.stringify({ userCode, name: name || undefined }),
  }).then((r) => r.machine);

export const renameMachine = (id: string, name: string) =>
  apiFetch<{ machine: MachineView }>(`/api/machines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  }).then((r) => r.machine);

export const revokeMachine = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/machines/${id}`, { method: 'DELETE' });

export const updateMachineEnv = (id: string, env: Record<string, string>) =>
  apiFetch<{ machine: MachineView }>(`/api/machines/${id}/env`, {
    method: 'PUT',
    body: JSON.stringify({ env }),
  }).then((r) => r.machine);
