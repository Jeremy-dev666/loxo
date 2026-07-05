import { apiFetch } from './api';

export type SlackScope = 'agent' | 'team';

export interface SlackWebhookInfo {
  scope: SlackScope;
  subjectId: string;
  subjectName: string;
  requestUrl: string;
  configured: boolean;
  envStatus: {
    botTokenConfigured: boolean;
    signingSecretConfigured: boolean;
    publicBaseConfigured: boolean;
  };
}

export interface SlackConfigView {
  id: string;
  scope: SlackScope;
  subjectId: string;
  botTokenMasked: string;
  signingSecretMasked: string;
  channelId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function fetchSlackWebhookInfo(scope: SlackScope, subjectId: string) {
  return apiFetch<{ integration: SlackWebhookInfo }>(
    `/api/integrations/slack/webhook/${scope}/${subjectId}`
  ).then((r) => r.integration);
}

export function fetchSlackConfig(scope: SlackScope, subjectId: string) {
  return apiFetch<{ config: SlackConfigView | null }>(
    `/api/integrations/slack/config/${scope}/${subjectId}`
  ).then((r) => r.config);
}

export function saveSlackConfig(
  scope: SlackScope,
  subjectId: string,
  input: { botToken: string; signingSecret: string; channelId?: string }
) {
  return apiFetch<{ config: SlackConfigView }>(
    `/api/integrations/slack/config/${scope}/${subjectId}`,
    { method: 'PUT', body: JSON.stringify(input) }
  ).then((r) => r.config);
}

export function deleteSlackConfig(scope: SlackScope, subjectId: string) {
  return apiFetch<{ ok: boolean }>(`/api/integrations/slack/config/${scope}/${subjectId}`, {
    method: 'DELETE',
  });
}
