// ==================== Messages ====================

export type SenderType = 'user' | 'agent' | 'system';
export type MessageType = 'text' | 'code' | 'artifact' | 'task_update' | 'system';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  messageType: MessageType;
  content: string;
  metadata: MessageMetadata;
  sequenceNumber: number;
  createdAt: string;
}

export interface MessageMetadata {
  agentRole?: AgentRole;
  taskId?: string;
  codeLanguage?: string;
  diffData?: Record<string, unknown>;
}

// ==================== Agents ====================

export type AgentRole = 'orchestrator' | 'frontend' | 'backend' | 'database' | 'tester' | 'devops';

export interface AgentConfig {
  id: string;
  role: AgentRole;
  displayName: string;
  avatar: string;
  systemPrompt: string;
  model: string;
  temperature: number;
}

// ==================== Conversations ====================

export type ConversationType = 'direct' | 'group';
export type ConversationStatus = 'active' | 'archived';

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

// ==================== Tasks ====================

export type TaskStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignedAgent: AgentRole;
  status: TaskStatus;
  dependencies: string[];
  createdAt: string;
}

// ==================== WebSocket Events ====================

export interface ClientEvents {
  send_message: (data: { conversationId: string; content: string; messageType: MessageType }) => void;
  typing_start: (data: { conversationId: string }) => void;
  typing_stop: (data: { conversationId: string }) => void;
  join_conversation: (data: { conversationId: string }) => void;
  leave_conversation: (data: { conversationId: string }) => void;
}

export interface ServerEvents {
  new_message: (message: ChatMessage) => void;
  agent_typing: (data: { conversationId: string; agentRole: AgentRole; isTyping: boolean }) => void;
  task_status_update: (data: { taskId: string; status: TaskStatus }) => void;
  error: (data: { code: string; message: string }) => void;
}
