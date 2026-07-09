import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { machines, type Machine } from '../../db/schema';
import { badRequest, conflict, notFound } from '../../http/errors';
import { isMachineOnline, terminateMachineSocket } from './machine-registry';

const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_POLL_INTERVAL_S = 3;

const MACHINE_TOKEN_PREFIX = 'smk_';

/** No 0/O/1/I so the code survives being read aloud or retyped. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface PendingPairing {
  deviceCode: string;
  userCode: string;
  platform: string | null;
  hostname: string | null;
  expiresAt: number;
  /** Set on approval; consumed (and entry deleted) by the next poll. */
  approved?: { machineId: string; machineToken: string };
}

const pendingByDeviceCode = new Map<string, PendingPairing>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pendingByDeviceCode) {
    if (entry.expiresAt <= now) pendingByDeviceCode.delete(key);
  }
}

function generateUserCode(): string {
  const chars = Array.from(
    randomBytes(8),
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]
  );
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function hashMachineToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PairingStart {
  deviceCode: string;
  userCode: string;
  expiresInS: number;
  intervalS: number;
}

export function startPairing(input: {
  platform?: string | null;
  hostname?: string | null;
}): PairingStart {
  pruneExpired();
  const entry: PendingPairing = {
    deviceCode: randomBytes(32).toString('hex'),
    userCode: generateUserCode(),
    platform: input.platform ?? null,
    hostname: input.hostname ?? null,
    expiresAt: Date.now() + PAIRING_TTL_MS,
  };
  pendingByDeviceCode.set(entry.deviceCode, entry);
  return {
    deviceCode: entry.deviceCode,
    userCode: entry.userCode,
    expiresInS: PAIRING_TTL_MS / 1000,
    intervalS: PAIRING_POLL_INTERVAL_S,
  };
}

export interface MachineView {
  id: string;
  name: string;
  platform: string | null;
  hostname: string | null;
  online: boolean;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function toView(row: Machine): MachineView {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    hostname: row.hostname,
    online: isMachineOnline(row.id),
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export async function approvePairing(
  userId: string,
  userCode: string,
  name?: string
): Promise<MachineView> {
  pruneExpired();
  const normalized = userCode.trim().toUpperCase();
  const entry = [...pendingByDeviceCode.values()].find((p) => p.userCode === normalized);
  if (!entry) throw notFound('Pairing code not found or expired');
  if (entry.approved) throw conflict('pairing_already_approved', 'Code was already approved');

  const machineToken = MACHINE_TOKEN_PREFIX + randomBytes(32).toString('hex');
  const [row] = await db
    .insert(machines)
    .values({
      userId,
      name: name?.trim() || entry.hostname || 'New machine',
      platform: entry.platform,
      hostname: entry.hostname,
      tokenHash: hashMachineToken(machineToken),
    })
    .returning();
  entry.approved = { machineId: row!.id, machineToken };
  return toView(row!);
}

export type PairingPollResult =
  | { status: 'pending' }
  | { status: 'approved'; machineId: string; machineToken: string };

export function pollPairing(deviceCode: string): PairingPollResult {
  pruneExpired();
  const entry = pendingByDeviceCode.get(deviceCode);
  if (!entry) throw notFound('Pairing not found or expired');
  if (!entry.approved) return { status: 'pending' };
  // The token is handed out exactly once.
  pendingByDeviceCode.delete(deviceCode);
  return { status: 'approved', ...entry.approved };
}

export async function authenticateMachineToken(token: string): Promise<Machine | null> {
  if (!token.startsWith(MACHINE_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(machines)
    .where(and(eq(machines.tokenHash, hashMachineToken(token)), isNull(machines.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function touchMachineLastSeen(machineId: string): Promise<void> {
  await db
    .update(machines)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(machines.id, machineId));
}

export async function listMachines(userId: string): Promise<MachineView[]> {
  const rows = await db
    .select()
    .from(machines)
    .where(and(eq(machines.userId, userId), isNull(machines.revokedAt)));
  return rows.map(toView);
}

export async function renameMachine(
  userId: string,
  machineId: string,
  name: string
): Promise<MachineView> {
  const trimmed = name.trim();
  if (!trimmed) throw badRequest('invalid_input', 'Name must not be empty');
  const [row] = await db
    .update(machines)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(
      and(eq(machines.id, machineId), eq(machines.userId, userId), isNull(machines.revokedAt))
    )
    .returning();
  if (!row) throw notFound('Machine not found');
  return toView(row);
}

/** Revocation is a tombstone, not a delete: agents may still reference the row. */
export async function revokeMachine(userId: string, machineId: string): Promise<void> {
  const [row] = await db
    .update(machines)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(machines.id, machineId), eq(machines.userId, userId), isNull(machines.revokedAt))
    )
    .returning({ id: machines.id });
  if (!row) throw notFound('Machine not found');
  terminateMachineSocket(machineId);
}
