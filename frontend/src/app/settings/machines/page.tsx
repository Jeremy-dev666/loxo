'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ApiError } from '@/lib/api';
import {
  approvePairing,
  fetchMachines,
  renameMachine,
  revokeMachine,
  type MachineView,
} from '@/lib/machines';

const inputClass =
  'w-full border border-pixel-line bg-pixel-white font-pixel text-pixel-black px-3 py-2 text-sm outline-none focus:border-pixel-blue';

const POLL_INTERVAL_MS = 10_000;

function PairForm({ onPaired }: { onPaired: () => void }) {
  const [userCode, setUserCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await approvePairing(userCode.trim().toUpperCase(), name.trim() || undefined);
      setUserCode('');
      setName('');
      onPaired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve pairing');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 border border-pixel-line bg-pixel-white shadow-pixel p-4"
    >
      <h2 className="font-medium">Connect a machine</h2>
      <p className="text-xs text-pixel-black/60">
        Run the SwarmDev daemon on the machine, then enter the pairing code it prints.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <input
          className={inputClass}
          placeholder="Pairing code (e.g. AB2C-D3EF)"
          value={userCode}
          onChange={(e) => setUserCode(e.target.value)}
          minLength={8}
          required
        />
        <input
          className={inputClass}
          placeholder="Machine name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-pixel-red">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="bg-pixel-yellow px-4 py-2 text-sm font-medium text-pixel-black disabled:opacity-60"
      >
        {saving ? 'Approving…' : 'Approve pairing'}
      </button>
    </form>
  );
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'never connected';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function MachineRow({
  machine,
  onChanged,
}: {
  machine: MachineView;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(machine.name);

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== machine.name) {
      await renameMachine(machine.id, trimmed);
      onChanged();
    }
    setRenaming(false);
  };

  const revoke = async () => {
    await revokeMachine(machine.id);
    onChanged();
  };

  return (
    <div className="flex items-center justify-between border border-pixel-line bg-pixel-white shadow-pixel px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span
            className={
              machine.online
                ? 'h-2 w-2 rounded-full bg-pixel-green'
                : 'h-2 w-2 rounded-full bg-pixel-black/20'
            }
            title={machine.online ? 'Online' : 'Offline'}
          />
          {renaming ? (
            <input
              className={`${inputClass} !w-48 !py-0.5`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              autoFocus
            />
          ) : (
            <span className="font-medium">{machine.name}</span>
          )}
          {machine.platform && (
            <span className="border border-pixel-line bg-pixel-yellow px-1.5 py-0.5 font-pixel text-xs text-pixel-black">
              {machine.platform}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-pixel-black/60">
          {machine.hostname && `${machine.hostname} · `}
          {machine.online ? 'online' : `last seen ${formatLastSeen(machine.lastSeenAt)}`}
        </p>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setRenaming(true)}
          className="border border-pixel-line bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-2 py-1 text-pixel-black/70 hover:bg-pixel-cream"
        >
          Rename
        </button>
        <button
          onClick={revoke}
          className="border border-red-900 px-2 py-1 text-pixel-red hover:border-pixel-red"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function MachinesPageInner() {
  const [items, setItems] = useState<MachineView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchMachines()
      .then(setItems)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load machines')
      );
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Machines</h1>
      <p className="text-sm text-pixel-black/60">
        Machines run your local agents. Pair one to execute agents with your own CLI runtimes and
        files.
      </p>
      {error && <p className="text-sm text-pixel-red">{error}</p>}

      <section className="space-y-3">
        {items && items.length === 0 && (
          <p className="text-sm text-pixel-black/60">No machines paired yet.</p>
        )}
        {items?.map((machine) => (
          <MachineRow key={machine.id} machine={machine} onChanged={reload} />
        ))}
      </section>

      <PairForm onPaired={reload} />
    </div>
  );
}

export default function MachinesPage() {
  return (
    <RequireAuth>
      <MachinesPageInner />
    </RequireAuth>
  );
}
