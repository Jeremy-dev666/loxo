'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ApiError } from '@/lib/api';
import {
  approvePairing,
  fetchMachines,
  renameMachine,
  revokeMachine,
  updateMachineEnv,
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

function EnvEditor({
  machine,
  onChanged,
}: {
  machine: MachineView;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(machine.env).map(([key, value]) => ({ key, value }))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editRows = (next: Array<{ key: string; value: string }>) => {
    setRows(next);
    setSavedAt(null);
  };

  const save = async () => {
    setError(null);
    const env: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        setError(`"${key}" is not a valid variable name (letters, digits, underscores).`);
        return;
      }
      env[key] = row.value;
    }
    setSaving(true);
    try {
      const updated = await updateMachineEnv(machine.id, env);
      setRows(Object.entries(updated.env).map(([key, value]) => ({ key, value })));
      setSavedAt(Date.now());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save variables');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-pixel-line/50 pt-3">
      <p className="font-pixel text-xs text-pixel-black/60">
        Environment variables for agent processes on this machine. Encrypted at rest, applied on
        the next turn — no daemon restart needed. Example: on networks that need a proxy, set{' '}
        <code className="bg-pixel-cream px-1">HTTP_PROXY</code> and{' '}
        <code className="bg-pixel-cream px-1">HTTPS_PROXY</code> to{' '}
        <code className="bg-pixel-cream px-1">http://127.0.0.1:7890</code>.
      </p>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <input
            className={`${inputClass} !w-56`}
            placeholder="NAME"
            value={row.key}
            onChange={(e) =>
              editRows(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
            }
          />
          <input
            className={inputClass}
            placeholder="value"
            value={row.value}
            onChange={(e) =>
              editRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
          />
          <button
            onClick={() => editRows(rows.filter((_, i) => i !== index))}
            className="border border-pixel-line px-2 font-pixel text-xs text-pixel-black/60 hover:text-pixel-red"
            title="Remove variable"
          >
            ×
          </button>
        </div>
      ))}
      {error && <p className="font-pixel text-xs text-pixel-red">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => editRows([...rows, { key: '', value: '' }])}
          className="border border-pixel-line bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black/70 hover:bg-pixel-cream"
        >
          + Add variable
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="bg-pixel-yellow px-3 py-1 font-pixel text-xs text-pixel-black disabled:opacity-60"
        >
          {saving ? 'Saving…' : savedAt ? 'Saved' : 'Save variables'}
        </button>
        {savedAt && (
          <span className="font-pixel text-xs text-pixel-green">
            Saved. Applies from the next agent turn.
          </span>
        )}
      </div>
    </div>
  );
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
  const [showEnv, setShowEnv] = useState(false);

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
    <div className="border border-pixel-line bg-pixel-white shadow-pixel px-4 py-3">
      <div className="flex items-center justify-between">
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
        {machine.runtimes.some((r) => r.available) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {machine.runtimes
              .filter((r) => r.available)
              .map((r) => (
                <span
                  key={r.runtime}
                  title={r.version ?? undefined}
                  className="border border-pixel-line bg-pixel-cream px-1.5 py-0.5 font-pixel text-[10px] text-pixel-black/70"
                >
                  {r.runtime}
                </span>
              ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setShowEnv(!showEnv)}
          className="border border-pixel-line bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-2 py-1 text-pixel-black/70 hover:bg-pixel-cream"
        >
          Env{Object.keys(machine.env).length > 0 ? ` (${Object.keys(machine.env).length})` : ''}
        </button>
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
      {showEnv && <EnvEditor machine={machine} onChanged={onChanged} />}
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
