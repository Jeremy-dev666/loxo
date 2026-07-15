import { hostname } from 'node:os';
import type { PairPollResponse, PairStartResponse } from '@swarmdev/shared';
import { CONFIG_PATH, saveConfig } from './config';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${url} responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pair(serverUrl: string): Promise<void> {
  const base = serverUrl.replace(/\/+$/, '');
  const start = await postJson<PairStartResponse>(`${base}/api/machines/pair/start`, {
    platform: process.platform,
    hostname: hostname(),
  });

  console.log('');
  console.log(`  Pairing code: ${start.userCode}`);
  console.log('');
  console.log('  Open SwarmDev in your browser -> Settings -> Machines,');
  console.log(`  enter the code above, then approve. Expires in ${Math.round(start.expiresInS / 60)} minutes.`);
  console.log('');

  const deadline = Date.now() + start.expiresInS * 1000;
  while (Date.now() < deadline) {
    await sleep(start.intervalS * 1000);
    let poll: PairPollResponse;
    try {
      poll = await postJson<PairPollResponse>(`${base}/api/machines/pair/poll`, {
        deviceCode: start.deviceCode,
      });
    } catch (error) {
      // A 404 after expiry ends the flow; transient network errors keep polling.
      if (error instanceof Error && error.message.includes(' 404')) {
        throw new Error('Pairing expired or was not approved in time. Run pair again.');
      }
      continue;
    }
    if (poll.status === 'approved') {
      saveConfig({ serverUrl: base, machineToken: poll.machineToken, machineId: poll.machineId });
      console.log(`Paired. Credentials saved to ${CONFIG_PATH}`);
      console.log('Start the daemon with: swarmdev-daemon run');
      return;
    }
  }
  throw new Error('Pairing expired or was not approved in time. Run pair again.');
}
