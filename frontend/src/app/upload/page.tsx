'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import {
  importAgentArchive,
  importAgentFolder,
  RUNTIMES,
  type Agent,
} from '@/lib/agents';

const inputClass =
  'w-full rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent';

function UploadPageInner() {
  const router = useRouter();
  const [mode, setMode] = useState<'archive' | 'folder'>('archive');
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState(''); // '' = auto-detect
  const [archive, setArchive] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ agent: Agent; fileCount: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const common = { name, runtime: runtime || undefined };
      const imported =
        mode === 'archive'
          ? await importAgentArchive({ ...common, archive: archive! })
          : await importAgentFolder({
              ...common,
              files: folderFiles.map((file) => ({
                relativePath:
                  (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
                file,
              })),
            });
      setResult(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Agent imported</h1>
        <p className="text-slate-400">
          <span className="text-slate-100">{result.agent.name}</span> · runtime{' '}
          <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-sm">{result.agent.runtime}</span>{' '}
          · {result.fileCount} files
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => router.push(`/agents/${result.agent.id}/settings`)}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900"
          >
            Configure agent
          </button>
          <Link
            href="/agents"
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300"
          >
            Back to agents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Import agent</h1>

      <div className="flex gap-2">
        {(['archive', 'folder'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m
                ? 'rounded bg-accent px-3 py-1.5 text-sm font-medium text-slate-900'
                : 'rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300'
            }
          >
            {m === 'archive' ? 'Zip archive' : 'Folder'}
          </button>
        ))}
      </div>

      <input
        className={inputClass}
        placeholder="Agent name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <select className={inputClass} value={runtime} onChange={(e) => setRuntime(e.target.value)}>
        <option value="">Auto-detect runtime</option>
        {RUNTIMES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      {mode === 'archive' ? (
        <input
          type="file"
          accept=".zip"
          onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100"
          required
        />
      ) : (
        <input
          type="file"
          // @ts-expect-error non-standard folder-picker attribute
          webkitdirectory=""
          multiple
          onChange={(e) => setFolderFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100"
          required
        />
      )}
      {mode === 'folder' && folderFiles.length > 0 && (
        <p className="text-xs text-slate-500">{folderFiles.length} files selected</p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || (mode === 'archive' ? !archive : folderFiles.length === 0)}
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-60"
      >
        {busy ? 'Importing…' : 'Import'}
      </button>
      <p className="text-xs text-slate-500">
        Limits: 1000 files, 200MB. The runtime is detected from workspace markers (.claude, .codex,
        opencode.json, hermes.yaml, …); pick one explicitly when detection fails.
      </p>
    </form>
  );
}

export default function UploadPage() {
  return (
    <RequireAuth>
      <UploadPageInner />
    </RequireAuth>
  );
}
