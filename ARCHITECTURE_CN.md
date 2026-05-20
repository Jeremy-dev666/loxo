# SwarmDev — 多 Agent IM 协作开发平台 架构设计

## 项目背景

一个面向软件开发场景的多 Agent IM 协作平台。多个 Agent 在聊天室中（类似 Slack/微信）协作完成需求拆解、代码实现、代码审查和项目部署。用户可以实时观察和介入协作过程。

灵感来源：字节跳动挑战课题 — 打造 IM 聊天式的多 Agent 协作平台，支持单聊、群聊、任务拆解、代码 Diff、网页预览及一键部署。

---

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────┐
│                  Client (Next.js 14)                    │
│   Chat UI  │  DAG 可视化  │  代码 Diff  │  网页预览     │
└──────┬──────────┬──────────────┬─────────────┬──────────┘
    Socket.io   REST API      REST API      REST API
       │          │              │             │
┌──────▼──────────▼──────────────▼─────────────▼──────────┐
│               API Server (Express.js + TypeScript)       │
│  ┌────────────────┐  ┌──────────────────────────────┐    │
│  │  Socket.io     │  │      REST Routes             │    │
│  │  Server        │  │  /auth /conversations         │    │
│  │  (实时通信)     │  │  /projects /tasks /agents     │    │
│  └───────┬────────┘  └──────────────┬───────────────┘    │
│  ┌───────▼──────────────────────────▼───────────────┐    │
│  │            Message Router (消息路由)               │    │
│  │  • 用户消息 → Agent    • Agent 消息 → 聊天室       │    │
│  │  • 消息持久化          • 打字指示器                 │    │
│  └───────────────────────┬──────────────────────────┘    │
└──────────────────────────┼───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│              Orchestration Engine (编排引擎)               │
│  ┌─────────────────────┐  ┌───────────────────────────┐  │
│  │  Task Decomposer    │  │  DAG Scheduler            │  │
│  │  (Orchestrator调LLM │  │  • Kahn's 拓扑排序        │  │
│  │   结构化输出任务DAG)  │  │  • 并行分发独立任务       │  │
│  └─────────────────────┘  │  • 依赖追踪 + 失败传播    │  │
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
│  │用户/会话  │   │缓存    │   │代码文件      │            │
│  │消息/任务  │   │Pub/Sub │   │构建产物      │            │
│  │Agent配置 │   │队列后端 │   │             │            │
│  └──────────┘   └────────┘   └─────────────┘            │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈

### 前端
| 技术 | 用途 |
|------|------|
| Next.js 14 (App Router) | 框架 |
| TypeScript | 语言 |
| Zustand | 状态管理 |
| Socket.io-client | 实时通信 |
| Monaco Editor | 代码展示 + Diff |
| ReactFlow | DAG 可视化 |
| Tailwind CSS + shadcn/ui | UI 组件库 |

### 后端
| 技术 | 用途 |
|------|------|
| Node.js + Express.js + TypeScript | API 服务 |
| Socket.io | WebSocket 服务 |
| BullMQ | 任务队列（Agent 任务分发） |
| Drizzle ORM | 数据库 ORM |
| Anthropic/OpenAI SDK | LLM 调用 |

### 数据层
| 技术 | 用途 |
|------|------|
| PostgreSQL | 主数据库 |
| Redis | 缓存 + Pub/Sub + 队列后端 |
| MinIO（Phase 3） | 文件/产物存储 |

### 基础设施
| 技术 | 用途 |
|------|------|
| Docker Compose | 本地开发环境 |
| Nginx | 反向代理（WebSocket upgrade） |

---

## 3. 核心模块设计

### 3.1 消息路由 (Message Router)

核心数据结构：
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
  sequenceNumber: number;  // 每个会话单调递增，保证消息顺序
  createdAt: Date;
}
```

关键设计：
- 消息排序用 `sequenceNumber`（PostgreSQL sequence），不依赖时间戳（避免时钟偏移）
- Agent 之间不直接聊天，通过编排引擎传递上下文（简化系统）
- LLM 流式输出时显示"正在输入"指示器

### 3.2 编排引擎 (Orchestration Engine)

**任务拆解**：Orchestrator Agent 调 LLM，返回结构化输出：
```typescript
interface TaskDecomposition {
  projectSummary: string;
  tasks: Array<{
    taskId: string;
    title: string;
    description: string;
    assignedAgent: 'frontend' | 'backend' | 'database' | 'tester' | 'devops';
    dependencies: string[];  // 依赖的 taskId
    deliverables: string[];
  }>;
}
```

**DAG 调度算法**（Kahn's 拓扑排序）：
1. 解析任务为邻接表
2. DFS 检测环
3. 计算所有节点入度
4. 入度为 0 的任务入队 ready_queue
5. 循环：
   - ready_queue 中的任务并行分发到 BullMQ
   - 任务完成 → 减少下游任务入度 → 新的入度 0 任务入队
   - 任务失败 → 标记下游任务为 BLOCKED → 通知用户

### 3.3 Agent 管理

Agent 配置（存 PostgreSQL，可通过 UI 修改）：
```typescript
interface AgentConfig {
  id: string;
  role: string;
  displayName: string;
  avatar: string;
  systemPrompt: string;
  model: string;         // 可配置不同模型
  temperature: number;
  tools: ToolDefinition[];
}
```

Agent 执行流程：
1. BullMQ Worker 取任务
2. 加载 Agent 配置
3. 组装 prompt（system prompt + 任务描述 + 上游产物）
4. 调 LLM（带 tool_use）
5. 若返回工具调用 → 执行工具 → 结果喂回 LLM → 循环
6. 持久化产物（代码文件等）
7. 通过 MessageRouter 发聊天消息
8. 标记任务完成

### 3.4 工具集成

| 工具 | 实现方式 |
|------|---------|
| write_file | Node.js fs / MinIO |
| read_file | Node.js fs / MinIO |
| run_command | Docker 沙箱执行 |
| send_message | MessageRouter API |

MVP 阶段工具输出为模拟，Phase 3 接入真实 Docker 执行。

---

## 4. 数据模型

核心表：
- **users** — 用户
- **agents** — Agent 配置（role, system_prompt, model, tools_config JSONB）
- **conversations** — 会话（type: direct/group）
- **conversation_participants** — 会话参与者（用户+Agent）
- **messages** — 消息（sequence_number 保证顺序, metadata JSONB 灵活扩展）
- **projects** — 项目
- **tasks** — 任务/DAG 节点（status: pending/queued/in_progress/completed/failed/blocked）
- **task_dependencies** — 任务依赖/DAG 边
- **artifacts** — 代码产物（file_path, content, version）

关键索引：
- `messages(conversation_id, sequence_number DESC)` — 聊天消息快速加载
- `artifacts(project_id, file_path, version DESC)` — 文件版本查询

---

## 5. API 设计

### REST
```
POST/GET  /api/auth/*                    — 注册/登录/JWT
POST/GET  /api/conversations             — 创建/列出会话
GET       /api/conversations/:id/messages — 游标分页消息（?before=<seq>&limit=50）
POST/GET  /api/projects                  — 项目管理
GET       /api/projects/:id/tasks        — 任务 DAG 结构
GET       /api/projects/:id/artifacts    — 代码产物
GET       /api/projects/:id/diff/:taskId — 代码 Diff
GET       /api/agents                    — Agent 列表/配置
POST      /api/tasks/:id/retry           — 重试失败任务
```

### WebSocket 事件
```
Client → Server:
  send_message, typing_start, join_conversation

Server → Client:
  new_message, agent_typing, task_status_update, dag_update, artifact_created
```

---

## 6. 前端页面结构

```
app/
├── (auth)/login, register
├── (main)/
│   ├── layout.tsx                — 侧边栏 + 主内容
│   ├── chat/[conversationId]/   — ★ 核心聊天页面
│   ├── projects/[projectId]/    — 项目概览 + DAG + 代码 + 预览
│   └── settings/                — Agent 配置
```

主聊天页面布局：
```
┌──────────┬────────────────────────────────────┐
│          │ Chat Header: "Todo App"  [DAG][Code]│
│ 会话列表  ├────────────────────────────────────┤
│          │                                    │
│ > Todo   │  Orchestrator: 拆解为4个任务...      │
│ > Blog   │  DB Agent: CREATE TABLE ...         │
│          │  Backend Agent 正在输入...           │
│          │                                    │
│          ├────────────────────────────────────┤
│          │  [消息输入框]                [发送]   │
└──────────┴────────────────────────────────────┘
```

---

## 7. 开发阶段

### Phase 1: MVP（3-4 周）— "能跑 demo"
- 用户认证（JWT）
- 群聊界面 + WebSocket 实时消息
- Message Router 消息路由
- Orchestrator Agent 任务拆解（LLM 结构化输出）
- 2 个 Agent Worker（Frontend + Backend），顺序执行
- 代码块语法高亮渲染
- 简单任务状态显示
- Docker Compose（PostgreSQL + Redis）

### Phase 2: 编排引擎（3-4 周）— "架构有深度"
- DAG Builder + Validator（环检测）
- DAG Scheduler（Kahn's 拓扑排序 + 并行分发）
- BullMQ 任务队列集成
- ReactFlow DAG 可视化（实时状态更新）
- 全部 6 个 Agent 上线
- 单聊 + 群聊两种模式
- 游标分页 + 无限滚动
- Agent 配置管理页面

### Phase 3: 丰富功能（2-3 周）— "产品完整"
- 代码产物版本管理
- 文件浏览器（树形结构）
- 代码 Diff 展示（Monaco/react-diff-viewer）
- 网页预览（iframe sandbox）
- Tester Agent 代码审查流程
- 部署模拟（DevOps Agent）
- MinIO 文件存储

### Phase 4: 打磨（1-2 周）— "面试就绪"
- 错误处理 + 重试机制
- 各种加载/空/错误状态
- API 限流
- README + 架构文档
- 录制 Demo 视频
- 部署上线

---

## 8. 项目目录结构

```
swarmdev/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                        — Next.js 前端
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
│   └── server/                     — Express.js 后端
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
    └── shared/                     — 共享 TypeScript 类型
```

---

## 9. 面试高频讨论点

| 话题 | 回答方向 |
|------|---------|
| 为什么 PostgreSQL 不用 MongoDB？ | 消息排序需要事务保证，JSONB 兼顾灵活性 |
| WebSocket 怎么水平扩展？ | Redis adapter + Nginx sticky session |
| 为什么 BullMQ 不用 Kafka？ | 单服务内任务队列，BullMQ 天然支持延迟/重试/优先级，Kafka 是跨服务事件流 |
| DAG 失败怎么处理？ | 下游标记 BLOCKED，通知用户，支持重试，DAG 结构让失败传播显式化 |
| Agent 之间怎么通信？ | 不直接通信，编排引擎管理上下文传递，避免 Agent 间消息路由复杂性和 token 浪费 |
| 消息怎么保证顺序？ | per-conversation sequence_number（PG sequence），不依赖时间戳 |

---

## 10. 验证方式

1. **Phase 1 验证**：启动项目 → 发送需求 → 看到 Orchestrator 拆解 → Agent 逐个回复代码 → 消息实时出现
2. **Phase 2 验证**：发送复杂需求 → DAG 可视化显示任务图 → 独立任务并行执行 → 状态实时更新
3. **Phase 3 验证**：点击代码 Diff 查看变更 → 文件浏览器浏览项目 → iframe 预览网页 → Tester Agent 发出 review 评论
4. **端到端**：输入"做一个 Todo App" → 全程在聊天中看到协作 → 查看生成的完整项目代码 → 预览效果
