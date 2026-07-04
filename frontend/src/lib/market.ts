import { apiFetch } from './api';
import { API_BASE } from './runtime';
import type { Agent } from './agents';

export interface MarketListing {
  id: string;
  ownerUserId: string;
  ownerUsername: string | null;
  sourceAgentId: string | null;
  name: string;
  description: string;
  runtime: string;
  latestVersion: string;
  visibility: 'public' | 'unlisted' | 'private';
  status: 'active' | 'disabled';
  tags: string[];
  isOfficial: boolean;
  downloadCount: number;
  hasFiles: boolean;
  sizeBytes: number;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingVersion {
  id: string;
  version: string;
  checksum: string;
  changelog: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ApiAgentPreset {
  id: string;
  name: string;
  description: string;
  protocol: 'openai' | 'anthropic';
  model: string;
  tags: string[];
  category: string;
  creator: string;
  rating: number;
  featured: boolean;
}

export interface TemplateSkill {
  name: string;
  summary: string;
}

export interface TeamTemplateMember {
  roleCode: string;
  name: string;
  description: string;
  runtime?: string;
  color: string;
  skills: TemplateSkill[];
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  color: string;
  defaultRuntime: string;
  memberCount: number;
  members: TeamTemplateMember[];
  workflowSummary: string;
  stages: string[];
}

export interface DuplicateTemplateAgent {
  roleCode: string;
  memberName: string;
  agentId: string;
  agentName: string;
}

export interface DuplicateAgentChoice {
  roleCode: string;
  existingAgentId: string;
  mode: 'clone' | 'share-config';
}

export const ADOPTION_RUNTIMES = ['openclaw', 'hermes', 'opencode'] as const;

export const fetchListings = (search?: string) =>
  apiFetch<{ listings: MarketListing[] }>(
    `/api/market${search ? `?search=${encodeURIComponent(search)}` : ''}`
  ).then((r) => r.listings);

export const fetchMyListings = () =>
  apiFetch<{ listings: MarketListing[] }>('/api/market/mine').then((r) => r.listings);

export const fetchListing = (id: string) =>
  apiFetch<{ listing: MarketListing }>(`/api/market/${id}`).then((r) => r.listing);

export const fetchListingVersions = (id: string) =>
  apiFetch<{ versions: ListingVersion[] }>(`/api/market/${id}/versions`).then((r) => r.versions);

export const downloadListing = (id: string) =>
  apiFetch<{ agent: Agent }>(`/api/market/${id}/download`, { method: 'POST' }).then((r) => r.agent);

export const publishAgent = (input: {
  agentId: string;
  name?: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
}) =>
  apiFetch<{ listing: MarketListing; alreadyPublished: boolean; sanitization: string | null }>(
    '/api/market/publish',
    { method: 'POST', body: JSON.stringify(input) }
  );

export const unpublishAgent = (agentId: string) =>
  apiFetch<{ ok: boolean }>(`/api/market/publish/${agentId}`, { method: 'DELETE' });

export const adoptOfficialAgent = (input: { name: string; runtime?: string }) =>
  apiFetch<{ agent: Agent }>('/api/market/official/adopt', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.agent);

export const fetchApiAgentPresets = (search?: string) =>
  apiFetch<{ presets: ApiAgentPreset[] }>(
    `/api/market/api-agents${search ? `?search=${encodeURIComponent(search)}` : ''}`
  ).then((r) => r.presets);

export const deployApiAgent = (presetId: string) =>
  apiFetch<{ agent: Agent }>(`/api/market/api-agents/${presetId}/deploy`, {
    method: 'POST',
  }).then((r) => r.agent);

export const fetchTeamTemplates = () =>
  apiFetch<{ templates: TeamTemplate[] }>('/api/market/team-templates').then((r) => r.templates);

export const fetchTemplateDuplicates = (templateId: string) =>
  apiFetch<{ duplicates: DuplicateTemplateAgent[] }>(
    `/api/market/team-templates/${templateId}/duplicates`
  ).then((r) => r.duplicates);

export const adoptTeamTemplate = (
  templateId: string,
  input: { teamName?: string; duplicateChoices?: DuplicateAgentChoice[] }
) =>
  apiFetch<{ team: { id: string; name: string }; groupId: string; agentIds: string[] }>(
    `/api/market/team-templates/${templateId}/adopt`,
    { method: 'POST', body: JSON.stringify(input) }
  );

export const listingAvatarUrl = (listing: MarketListing) =>
  listing.avatarUrl ? `${API_BASE}${listing.avatarUrl}` : null;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
