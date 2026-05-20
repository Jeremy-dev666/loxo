# SwarmDev — Multi-Agent IM Collaboration Platform for Software Development

## Context

A multi-agent IM-style collaboration platform for software development. Agents collaborate in chat rooms (like Slack/WeChat) to decompose, implement, review, and deploy software projects. Users can observe and intervene in the process in real-time.

Inspired by ByteDance challenge: build an IM-based multi-Agent collaboration platform supporting direct/group chat, task decomposition, code diff, web preview, and one-click deployment.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Client (Next.js 14)                    │
│   Chat UI  │  DAG Visualization  │  Code Diff  │ Preview│
└──────┬──────────┬──────────────────┬────────────┬───────┘
    Socket.io   REST API          REST API     REST API
       │          │                  │            │
┌──────▼──────────▼──────────────────▼────────────▼───────┐
│               API Server (Express.js + TypeScript)       │
│  ┌────────────────┐  ┌──────────────────────────────┐    │
│  │  Socket.io     │  │      REST Routes             │    │
│  │  Server        │  │  /auth /conversations         │    │
│  │  (Real-time)   │  │  /projects /tasks /agents     │    │
│  └───────┬────────┘  └──────────────┬───────────────┘    │
│  ┌───────▼──────────────────────────▼───────────────┐    │
│  │            Message Router                         │    │
│  │  • User messages → Agents                         │    │
│  │  • Agent messages → Chat rooms                    │    │
│  │  • Message persistence                            │    │
│  │  • Typing indicators                              │    │
│  └───────────────────────┬──────────────────────────┘    │
└──────────────────────────┼───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│              Orchestration Engine                         │
│  ┌─────────────────────┐  ┌───────────────────────────┐  │
│  │  Task Decomposer    │  │  DAG Scheduler            │  │
│  │  (Orchestrator LLM  │  │  • Kahn's topological sort│  │
│  │   structured output)│  │  • Parallel dispatch      │  │
│  └─────────────────────┘  │  • Dependency tracking    │  │
│                           │  • Failure propagation    │  │
│                           └─────────────┬─────────────┘  │
└─────────────────────────────────────────┼────────────────┘
                                          │ enqueue
┌─────────────────────────────────────────▼────────────────┐
│              BullMQ Task Queue (Redis)                    │
│  Queues: agent:frontend, agent:backend, agent:database,  │
│          agent:tester, agent:devops                       │
└───┬─────────┬──────────┬──────────┬──────────┬───────────┘
    │         │          │          │          │
┌───▼───┐ ┌──▼────┐ ┌───▼──┐ ┌────▼───┐ ┌───▼────┐
│Frontend│ │Backend│ │  DB  │ │ Tester │ │ DevOps │
│ Agent  │ │ Agent │ │Agent │ │ Agent  │ │ Agent  │
│Worker  │ │Worker │ │Worker│ │ Worker │ │ Worker │
└───┬────┘ └──┬────┘ └──┬───┘ └───┬────┘ └───┬────┘
    └─────────┴─────┬────┴────────┴───────────┘
                    │ results + messages
┌───────────────────▼──────────────────────────────────────┐
│                    Data Layer                             │
│  ┌──────────┐   ┌────────┐   ┌─────────────┐            │
│  │PostgreSQL│   │ Redis  │   │ MinIO       │            │
│  │Users     │   │Cache   │   │Code files   │            │
│  │Messages  │   │Pub/Sub │   │Artifacts    │            │
│  │Tasks     │   │Queue   │   │             │            │
│  │Agents    │   │backend │   │             │            │
│  └──────────┘   └────────┘   └─────────────┘            │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| Next.js 14 (App Router) | Framework |
| TypeScript | Language |
| Zustand | State management |
| Socket.io-client | Real-time communication |
| Monaco Editor | Code display + Diff |
| ReactFlow | DAG visualization |
| Tailwind CSS + shadcn/ui | UI components |

### Backend
| Technology | Purpose |
|------------|---------|
| Node.js + Express.js + TypeScript | API server |
| Socket.io | WebSocket server |
| BullMQ | Task queue (Agent task dispatch) |
| Drizzle ORM | Database ORM |
| Anthropic/OpenAI SDK | LLM integration |

### Data Layer
| Technology | Purpose |
|------------|---------|
| PostgreSQL | Primary database |
| Redis | Cache + Pub/Sub + Queue backend |
| MinIO (Phase 3) | File/artifact storage |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Docker Compose | Local development environment |
| Nginx | Reverse proxy (WebSocket upgrade) |

---

## 3. Core Module Design

### 3.1 Message Router

Core data structure:
```typescript
interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'user' | 'agent' | 'system';
  messageType: 'text' | 'code' | 'artifact' | 'task_update' | 'system';
  content: string;
  metadata: {
    agentRole?: string;
    taskId?: string;
    codeLanguage?: string;
    diffData?: object;
  };
  sequenceNumber: number;  // Monotonically increasing per conversation
  createdAt: Date;
}
```

Key design decisions:
- Message ordering via `sequenceNumber` (PostgreSQL sequence), not timestamps (avoids clock skew)
- Agents don't chat directly with each other; context passes through the Orchestration Engine
- LLM streaming output shows "typing" indicator

### 3.2 Orchestration Engine

**Task Decomposition** — Orchestrator Agent calls LLM with structured output:
```typescript
interface TaskDecomposition {
  projectSummary: string;
  tasks: Array<{
    taskId: string;
    title: string;
    description: string;
    assignedAgent: 'frontend' | 'backend' | 'database' | 'tester' | 'devops';
    dependencies: string[];  // Dependent taskIds
    deliverables: string[];
  }>;
}
```

**DAG Scheduling Algorithm** (Kahn's topological sort):
1. Parse tasks into adjacency list
2. DFS cycle detection
3. Compute in-degrees for all nodes
4. Enqueue zero-in-degree tasks to ready_queue
5. Loop:
   - Dispatch ready_queue tasks in parallel to BullMQ
   - Task complete → decrement downstream in-degrees → enqueue newly ready tasks
   - Task failed → mark downstream as BLOCKED → notify user

### 3.3 Agent Management

Agent configuration (stored in PostgreSQL, editable via UI):
```typescript
interface AgentConfig {
  id: string;
  role: string;
  displayName: string;
  avatar: string;
  systemPrompt: string;
  model: string;         // Configurable per agent
  temperature: number;
  tools: ToolDefinition[];
}
```

Agent execution flow:
1. BullMQ Worker picks up task
2. Load AgentConfig from registry
3. Assemble prompt (system prompt + task description + upstream deliverables)
4. Call LLM (with tool_use)
5. If tool_use returned → execute tool → feed result back → loop
6. Persist artifacts (code files, etc.)
7. Post chat message via MessageRouter
8. Mark task complete

### 3.4 Tool Integration

| Tool | Implementation |
|------|---------------|
| write_file | Node.js fs / MinIO |
| read_file | Node.js fs / MinIO |
| run_command | Docker sandbox execution |
| send_message | MessageRouter API |

MVP: simulated tool output. Phase 3: real Docker execution.

---

## 4. Data Model

Core tables:
- **users** — User accounts
- **agents** — Agent config (role, system_prompt, model, tools_config JSONB)
- **conversations** — Chat sessions (type: direct/group)
- **conversation_participants** — Participants (users + agents)
- **messages** — Chat messages (sequence_number for ordering, metadata JSONB)
- **projects** — Development projects
- **tasks** — DAG nodes (status: pending/queued/in_progress/completed/failed/blocked)
- **task_dependencies** — DAG edges
- **artifacts** — Code artifacts (file_path, content, version)

Key indexes:
- `messages(conversation_id, sequence_number DESC)` — Fast message loading
- `artifacts(project_id, file_path, version DESC)` — File version queries

---

## 5. API Design

### REST
```
POST/GET  /api/auth/*                    — Register/Login/JWT
POST/GET  /api/conversations             — Create/List conversations
GET       /api/conversations/:id/messages — Cursor-based pagination (?before=<seq>&limit=50)
POST/GET  /api/projects                  — Project management
GET       /api/projects/:id/tasks        — Task DAG structure
GET       /api/projects/:id/artifacts    — Code artifacts
GET       /api/projects/:id/diff/:taskId — Code diff
GET       /api/agents                    — Agent list/config
POST      /api/tasks/:id/retry           — Retry failed task
```

### WebSocket Events
```
Client → Server:
  send_message, typing_start, join_conversation

Server → Client:
  new_message, agent_typing, task_status_update, dag_update, artifact_created
```

---

## 6. Frontend Page Structure

```
app/
├── (auth)/login, register
├── (main)/
│   ├── layout.tsx                    — Sidebar + main content
│   ├── chat/[conversationId]/       — Main chat view (core page)
│   ├── projects/[projectId]/        — Project overview + DAG + code + preview
│   └── settings/                    — Agent configuration
```

Main chat page layout:
```
┌──────────┬─────────────────────────────────────┐
│          │ Chat Header: "Todo App"  [DAG] [Code]│
│ Convos   ├─────────────────────────────────────┤
│          │                                     │
│ > Todo   │  Orchestrator: Breaking into tasks..│
│ > Blog   │  DB Agent: CREATE TABLE todos ...   │
│          │  Backend Agent is typing...         │
│          │                                     │
│          ├─────────────────────────────────────┤
│          │  [Message input]            [Send]  │
└──────────┴─────────────────────────────────────┘
```

---

## 7. Development Phases

### Phase 1: MVP (3-4 weeks) — "Working demo"
- User auth (JWT)
- Group chat UI + WebSocket real-time messaging
- Message Router
- Orchestrator Agent task decomposition (LLM structured output)
- 2 Agent Workers (Frontend + Backend), sequential execution
- Code block syntax highlighting
- Simple task status display
- Docker Compose (PostgreSQL + Redis)

### Phase 2: Orchestration Engine (3-4 weeks) — "Architectural depth"
- DAG Builder + Validator (cycle detection)
- DAG Scheduler (Kahn's topological sort + parallel dispatch)
- BullMQ task queue integration
- ReactFlow DAG visualization (real-time status updates)
- All 6 agents online
- Direct chat + group chat modes
- Cursor-based pagination + infinite scroll
- Agent configuration admin page

### Phase 3: Rich Features (2-3 weeks) — "Complete product"
- Code artifact versioning
- File explorer (tree view)
- Code diff display (Monaco/react-diff-viewer)
- Web preview (iframe sandbox)
- Tester Agent code review workflow
- Deployment simulation (DevOps Agent)
- MinIO file storage

### Phase 4: Polish (1-2 weeks) — "Interview ready"
- Error handling + retry mechanisms
- Loading/empty/error states
- API rate limiting
- README + architecture docs
- Demo video
- Cloud deployment

---

## 8. Project Directory Structure

```
swarmdev/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                        — Next.js frontend
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── chat/               — ChatContainer, MessageList, MessageBubble,
│   │   │   │                         CodeBlock, CodeDiffView, TypingIndicator,
│   │   │   │                         MessageInput
│   │   │   ├── dag/                — TaskDAGView, TaskNode, TaskEdge
│   │   │   ├── sidebar/            — ConversationList
│   │   │   └── project/            — FileExplorer, CodeViewer, WebPreview
│   │   ├── hooks/                  — useSocket, useMessages, useTaskStatus
│   │   ├── stores/                 — chatStore, projectStore, authStore (Zustand)
│   │   └── lib/                    — socket.ts, api.ts, types.ts
│   └── server/                     — Express.js backend
│       └── src/
│           ├── modules/
│           │   ├── auth/
│           │   ├── messaging/      — MessageRouter, Persistence, Broadcaster
│           │   ├── orchestration/  — DAGScheduler, TaskDecomposer, DAGValidator
│           │   ├── agents/         — AgentRegistry, AgentWorker, tools/, agents/
│           │   └── projects/
│           ├── socket/             — Socket.io event handlers
│           ├── routes/
│           └── db/migrations/
└── packages/
    └── shared/                     — Shared TypeScript types
```

---

## 9. Interview Discussion Points

| Topic | Answer Direction |
|-------|-----------------|
| Why PostgreSQL over MongoDB? | Message ordering needs transactional guarantees; JSONB provides flexibility |
| How to scale WebSocket horizontally? | Redis adapter for Socket.io + Nginx sticky sessions |
| Why BullMQ not Kafka? | Single-service task queue; BullMQ natively supports delay/retry/priority; Kafka is for cross-service event streaming |
| How to handle DAG task failure? | Mark downstream as BLOCKED, notify user, support retry; DAG structure makes failure propagation explicit |
| How do agents communicate? | Not directly; Orchestration Engine manages context passing to avoid routing complexity and token waste |
| How to guarantee message ordering? | Per-conversation sequence_number (PG sequence), not timestamps |

---

## 10. Verification

1. **Phase 1**: Start project → send requirement → see Orchestrator decompose → Agents reply with code → messages appear in real-time
2. **Phase 2**: Send complex requirement → DAG visualization shows task graph → independent tasks execute in parallel → status updates in real-time
3. **Phase 3**: Click code diff → browse file explorer → iframe preview → Tester Agent posts review comments
4. **End-to-end**: Input "Build a Todo App" → watch agents collaborate in chat → browse generated project code → preview result
