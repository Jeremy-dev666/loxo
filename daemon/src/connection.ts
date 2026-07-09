import WebSocket from 'ws';
import type { MachineClientFrame, MachineServerFrame } from '@swarmdev/shared';
import type { DaemonConfig } from './config';
import { detectRuntimes } from './runtimes';
import { cancelTurn, startTurn } from './turns';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function wsUrl(config: DaemonConfig): string {
  const base = config.serverUrl.replace(/^http/, 'ws');
  return `${base}/ws/machine?token=${encodeURIComponent(config.machineToken)}`;
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

export function runDaemon(config: DaemonConfig): void {
  let backoffMs = RECONNECT_MIN_MS;
  let stopping = false;
  let socket: WebSocket | null = null;

  const send = (frame: MachineClientFrame): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const connect = (): void => {
    if (stopping) return;
    log(`Connecting to ${config.serverUrl} ...`);
    const ws = new WebSocket(wsUrl(config));
    socket = ws;

    ws.on('open', () => {
      backoffMs = RECONNECT_MIN_MS;
      log('Connected');
      void detectRuntimes().then((runtimes) => {
        send({ type: 'machine.runtimes', payload: { runtimes } });
        const available = runtimes.filter((r) => r.available).map((r) => r.runtime);
        log(`Reported runtimes: ${available.length > 0 ? available.join(', ') : 'none available'}`);
      });
    });

    ws.on('message', (raw) => {
      let frame: MachineServerFrame;
      try {
        frame = JSON.parse(raw.toString()) as MachineServerFrame;
      } catch {
        return;
      }
      if (frame.type === 'machine.error') {
        log(`Server error: ${frame.payload.code} ${frame.payload.message}`);
      } else if (frame.type === 'machine.turn.start') {
        void startTurn(frame.payload, send, log);
      } else if (frame.type === 'machine.turn.cancel') {
        cancelTurn(frame.payload.turnId);
      }
    });

    ws.on('close', (code) => {
      socket = null;
      if (stopping) return;
      if (code === 4001) {
        log('Server rejected the machine token. Re-pair with: swarmdev-daemon pair --server <url>');
        process.exit(1);
      }
      log(`Disconnected (code ${code}); retrying in ${Math.round(backoffMs / 1000)}s`);
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
    });

    ws.on('error', (error) => {
      log(`Socket error: ${error.message}`);
      // 401 during the upgrade handshake means the token is invalid or revoked.
      if (error.message.includes('401')) {
        log('Unauthorized. Re-pair with: swarmdev-daemon pair --server <url>');
        process.exit(1);
      }
      ws.terminate();
    });
  };

  const stop = (): void => {
    stopping = true;
    socket?.close();
    log('Daemon stopped');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  connect();
}
