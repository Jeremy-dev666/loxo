'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ApiError } from '@/lib/api';
import {
  createProvider,
  deleteProvider,
  fetchProviders,
  fetchRuntimeHealth,
  updateProvider,
  VENDORS,
  type PlatformHealth,
  type ProviderView,
  type Vendor,
} from '@/lib/providers';

const inputClass =
  'w-full border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-3 py-2 text-sm outline-none focus:border-pixel-blue';

function ProviderForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<Vendor>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createProvider({
        name,
        vendor,
        apiKey,
        baseUrl: baseUrl.trim() || null,
        models: models
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      });
      setName('');
      setApiKey('');
      setBaseUrl('');
      setModels('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border border-pixel-black bg-pixel-white shadow-pixel p-4">
      <h2 className="font-medium">Add provider</h2>
      <div className="grid grid-cols-2 gap-3">
        <input
          className={inputClass}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select
          className={inputClass}
          value={vendor}
          onChange={(e) => setVendor(e.target.value as Vendor)}
        >
          {VENDORS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <input
        className={inputClass}
        type="password"
        placeholder="API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        minLength={8}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          className={inputClass}
          placeholder="Base URL (optional)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Models, comma-separated"
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-pixel-red">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="bg-pixel-red px-4 py-2 text-sm font-medium text-pixel-white disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save provider'}
      </button>
    </form>
  );
}

function HealthBadge({ platform }: { platform: PlatformHealth }) {
  return (
    <div className="border border-pixel-black bg-pixel-white shadow-pixel p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{platform.label}</span>
        <span
          className={
            platform.ready
              ? 'bg-emerald-500/15 px-2 py-0.5 text-xs text-pixel-green'
              : 'bg-amber-500/15 px-2 py-0.5 text-xs text-pixel-black'
          }
        >
          {platform.ready ? 'Ready' : 'Not ready'}
        </span>
      </div>
      <p className="mt-1 text-xs text-pixel-black/60">
        {platform.cli.available
          ? `CLI ${platform.cli.version}`
          : platform.cli.error ?? 'CLI unavailable'}
      </p>
      {!platform.ready && <p className="mt-1 text-xs text-pixel-black/50">{platform.installHint}</p>}
    </div>
  );
}

function ProvidersPageInner() {
  const [items, setItems] = useState<ProviderView[]>([]);
  const [health, setHealth] = useState<PlatformHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchProviders().then(setItems).catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to load providers')
    );
  }, []);

  useEffect(() => {
    reload();
    fetchRuntimeHealth()
      .then((h) => setHealth(h.platforms))
      .catch(() => setHealth(null));
  }, [reload]);

  const setDefault = async (provider: ProviderView) => {
    await updateProvider(provider.id, { isDefault: true });
    reload();
  };

  const remove = async (provider: ProviderView) => {
    await deleteProvider(provider.id);
    reload();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Providers</h1>
      {error && <p className="text-sm text-pixel-red">{error}</p>}

      <section className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-pixel-black/60">No providers yet. Add one below.</p>
        )}
        {items.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between border border-pixel-black bg-pixel-white shadow-pixel px-4 py-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{provider.name}</span>
                <span className="border border-pixel-black bg-pixel-yellow px-1.5 py-0.5 font-pixel text-xs text-pixel-black">
                  {provider.vendor}
                </span>
                {provider.isDefault && (
                  <span className="bg-pixel-red/15 px-1.5 py-0.5 text-xs text-pixel-blue">
                    default
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-pixel-black/60">
                {provider.apiKeyPrefix}
                {provider.models.length > 0 && ` · ${provider.models.join(', ')}`}
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              {!provider.isDefault && (
                <button
                  onClick={() => setDefault(provider)}
                  className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-2 py-1 text-pixel-black/70 hover:bg-pixel-yellow/40"
                >
                  Make default
                </button>
              )}
              <button
                onClick={() => remove(provider)}
                className="border border-red-900 px-2 py-1 text-pixel-red hover:border-pixel-red"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>

      <ProviderForm onCreated={reload} />

      <section>
        <h2 className="mb-3 font-medium">Runtime health</h2>
        {health ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {health.map((platform) => (
              <HealthBadge key={platform.platform} platform={platform} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-pixel-black/60">Checking local CLI runtimes…</p>
        )}
      </section>
    </div>
  );
}

export default function ProvidersPage() {
  return (
    <RequireAuth>
      <ProvidersPageInner />
    </RequireAuth>
  );
}
