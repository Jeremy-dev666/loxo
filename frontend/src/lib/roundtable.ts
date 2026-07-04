import { apiFetch } from './api';

export const WHITEBOARD_COLUMNS = ['ideas', 'questions', 'actions', 'risks'] as const;
export type WhiteboardColumn = (typeof WHITEBOARD_COLUMNS)[number];

export interface RoundtableMember {
  agentId: string;
  name: string;
  role?: string;
  description?: string;
}

export interface RoundtableMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  sentAt: string;
}

export interface WhiteboardNote {
  id: string;
  column: WhiteboardColumn;
  text: string;
  authorName: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunLogEntry {
  id: string;
  agentName: string;
  status: 'running' | 'success' | 'error';
  message: string;
  at: string;
}

export interface SessionState {
  sessionId: string;
  title: string;
  active: boolean;
  stopRequested: boolean;
  round: number;
  members: RoundtableMember[];
  messages: RoundtableMessage[];
  notes: WhiteboardNote[];
  runLogs: RunLogEntry[];
  speakingAgents: string[];
  updatedAt: string;
}

export const fetchSessionState = (sessionId: string) =>
  apiFetch<SessionState>(`/api/roundtable/sessions/${encodeURIComponent(sessionId)}`);

export const sendSessionMessage = (
  sessionId: string,
  input: {
    title?: string;
    userMessage: { content: string; senderName?: string };
    members: RoundtableMember[];
    messages?: RoundtableMessage[];
    notes?: WhiteboardNote[];
  }
) =>
  apiFetch<SessionState>(`/api/roundtable/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const stopSession = (sessionId: string) =>
  apiFetch<SessionState>(`/api/roundtable/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
  });

export const updateNote = (
  sessionId: string,
  noteId: string,
  patch: { x?: number; y?: number; column?: WhiteboardColumn; text?: string }
) =>
  apiFetch<{ note: WhiteboardNote }>(
    `/api/roundtable/sessions/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(noteId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
