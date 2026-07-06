'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteSlackConfig,
  fetchSlackConfig,
  fetchSlackWebhookInfo,
  saveSlackConfig,
  type SlackConfigView,
  type SlackScope,
  type SlackWebhookInfo,
} from '@/lib/integrations';

const inputClass =
  'w-full border border-pixel-black bg-pixel-white px-3 py-2 font-pixel text-sm text-pixel-black outline-none placeholder:text-pixel-black/40 focus:border-pixel-blue';
const chipButtonClass =
  'cursor-pointer border border-pixel-black bg-pixel-white px-3 py-1.5 font-pixel text-xs text-pixel-black hover:bg-pixel-cream disabled:opacity-50';

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`border border-pixel-black px-1.5 py-0.5 font-pixel text-xs ${
        ok ? 'bg-pixel-green text-pixel-white' : 'bg-pixel-white text-pixel-black/55'
      }`}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

export function SlackIntegrationCard({
  scope,
  subjectId,
}: {
  scope: SlackScope;
  subjectId: string;
}) {
  const [info, setInfo] = useState<SlackWebhookInfo | null>(null);
  const [config, setConfig] = useState<SlackConfigView | null>(null);
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [channelId, setChannelId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    fetchSlackWebhookInfo(scope, subjectId).then(setInfo).catch(() => {});
    fetchSlackConfig(scope, subjectId)
      .then((c) => {
        setConfig(c);
        setChannelId(c?.channelId ?? '');
      })
      .catch(() => {});
  }, [scope, subjectId]);

  useEffect(reload, [reload]);

  const copyUrl = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.requestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveSlackConfig(scope, subjectId, {
        botToken: botToken.trim(),
        signingSecret: signingSecret.trim(),
        channelId: channelId.trim() || undefined,
      });
      setConfig(saved);
      setBotToken('');
      setSigningSecret('');
      setMessage('Slack credentials saved.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setMessage(null);
    try {
      await deleteSlackConfig(scope, subjectId);
      setConfig(null);
      setMessage('Slack integration removed.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (!info) return <p className="font-pixel text-xs text-pixel-black/50">Loading Slack setup…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatusChip ok={info.envStatus.botTokenConfigured} label="bot token" />
        <StatusChip ok={info.envStatus.signingSecretConfigured} label="signing secret" />
        <StatusChip ok={info.envStatus.publicBaseConfigured} label="public URL" />
      </div>

      <div>
        <p className="mb-1 font-pixel text-xs font-bold text-pixel-black">
          Request URL (paste into Slack → Event Subscriptions)
        </p>
        <div className="flex gap-2">
          <input className={inputClass} readOnly value={info.requestUrl} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            onClick={copyUrl}
            className={chipButtonClass}
            style={{ boxShadow: '2px 2px 0 rgba(17,17,17,0.10)' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {!info.envStatus.publicBaseConfigured && (
          <p className="mt-1 font-pixel text-xs text-pixel-black/55">
            Set SLACK_PUBLIC_BASE_URL (e.g. an ngrok tunnel) so Slack can reach this URL.
          </p>
        )}
      </div>

      {config && (
        <div className="flex items-center justify-between border border-pixel-black bg-pixel-green/10 px-3 py-2">
          <p className="font-pixel text-xs text-pixel-black">
            Connected · token {config.botTokenMasked} · secret {config.signingSecretMasked}
            {config.channelId ? ` · channel ${config.channelId}` : ''}
          </p>
          <button
            type="button"
            onClick={disconnect}
            className={chipButtonClass}
            style={{ boxShadow: '2px 2px 0 rgba(17,17,17,0.10)' }}
          >
            Disconnect
          </button>
        </div>
      )}

      <form onSubmit={save} className="space-y-2">
        <input
          className={inputClass}
          placeholder="Bot token (xoxb-…)"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          required
        />
        <input
          className={inputClass}
          placeholder="Signing secret"
          value={signingSecret}
          onChange={(e) => setSigningSecret(e.target.value)}
          required
        />
        <input
          className={inputClass}
          placeholder="Channel ID filter (optional, e.g. C0123456789)"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
        />
        <button
          disabled={saving || !botToken.trim() || !signingSecret.trim()}
          className="border border-pixel-black bg-pixel-yellow px-4 py-2 font-pixel text-sm text-pixel-black hover:bg-pixel-orange disabled:opacity-60"
          style={{ boxShadow: '3px 3px 0 rgba(17,17,17,0.10)' }}
        >
          {saving ? 'Saving…' : config ? 'Update credentials' : 'Connect Slack'}
        </button>
      </form>

      {message && (
        <p className="border border-pixel-yellow bg-pixel-yellow/15 p-2 font-pixel text-xs text-pixel-black">
          {message}
        </p>
      )}

      <p className="font-pixel text-xs text-pixel-black/55">
        {scope === 'agent'
          ? 'Mention the bot in a channel to chat with this agent; replies land in the thread.'
          : 'Mention the bot with a task to run this team’s workflow; the summary is posted in the thread.'}
      </p>
    </div>
  );
}
