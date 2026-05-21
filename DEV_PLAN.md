# SwarmDev Phase 1 Day 2 — 分步实施计划

## Context
Day 1 已完成：monorepo 骨架、DB schema（5 表）、auth API（注册/登录）、Socket.io stub。前端仍是 Next.js 模板。目标：逐步构建完整的 IM 聊天 + Agent 响应流程。

---

## Step 1: 安装依赖 + JWT 中间件
**范围：** 安装新依赖、创建 JWT 认证中间件保护后续 API

新增/修改文件：
- `apps/server/src/middleware/auth.ts` — JWT 验证中间件
- `apps/server/src/types/express.d.ts` — 扩展 Express Request 类型
- `apps/web/package.json` — 添加 socket.io-client, zustand, react-syntax-highlighter, @swarmdev/shared

---

## Step 2: 会话 + Agent REST API
**范围：** 创建会话 CRUD、Agent 列表、Agent 种子数据

新增/修改文件：
- `apps/server/src/routes/conversations.ts` — GET/POST 会话, GET 消息分页
- `apps/server/src/routes/agents.ts` — GET 所有 Agent
- `apps/server/src/db/seed.ts` — 插入 3 个 Agent（Orchestrator, Frontend, Backend）
- `apps/server/src/index.ts` — 挂载新路由

---

## Step 3: WebSocket 消息事件 + 消息持久化
**范围：** Socket 认证、消息收发、持久化到数据库

新增/修改文件：
- `apps/server/src/services/messageService.ts` — 消息保存 + sequenceNumber
- `apps/server/src/socket/handlers.ts` — send_message, join/leave_conversation
- `apps/server/src/index.ts` — Socket auth 中间件，挂载 handlers

---

## Step 4: 前端 — Auth 页面（登录/注册）
**范围：** 暗色主题登录注册页 + 路由保护 + 状态管理

新增/修改文件：
- `apps/web/lib/api.ts` — HTTP 请求封装
- `apps/web/stores/authStore.ts` — Zustand auth 状态
- `apps/web/components/AuthGuard.tsx` — 路由守卫
- `apps/web/app/(auth)/layout.tsx` — Auth 页面布局
- `apps/web/app/(auth)/login/page.tsx` — 登录页
- `apps/web/app/(auth)/register/page.tsx` — 注册页
- `apps/web/app/layout.tsx` — 更新 metadata + dark mode
- `apps/web/app/page.tsx` — 根路由重定向
- `apps/web/app/globals.css` — 暗色主题 CSS

---

## Step 5: 前端 — 聊天 UI
**范围：** 侧边栏、消息列表、消息气泡、输入框、代码块

新增/修改文件：
- `apps/web/lib/socket.ts` — Socket.io 客户端
- `apps/web/stores/chatStore.ts` — Zustand chat 状态
- `apps/web/hooks/useSocket.ts` — Socket 事件 hook
- `apps/web/app/(main)/layout.tsx` — 主布局（侧边栏 + 内容区）
- `apps/web/app/(main)/chat/page.tsx` — 默认聊天页
- `apps/web/app/(main)/chat/[conversationId]/page.tsx` — 聊天对话页
- `apps/web/components/sidebar/ConversationList.tsx` — 会话列表
- `apps/web/components/chat/MessageList.tsx` — 消息列表
- `apps/web/components/chat/MessageBubble.tsx` — 消息气泡
- `apps/web/components/chat/CodeBlock.tsx` — 代码块高亮
- `apps/web/components/chat/TypingIndicator.tsx` — 打字指示器
- `apps/web/components/chat/MessageInput.tsx` — 消息输入框

---

## Step 6: Agent 响应系统
**范围：** LLM 调用、Agent 编排处理链

新增/修改文件：
- `apps/server/src/services/llmService.ts` — LLM API 封装（无 key 时 mock）
- `apps/server/src/agents/registry.ts` — Agent 配置加载
- `apps/server/src/agents/processor.ts` — processUserMessage: Orchestrator -> Frontend -> Backend
- `apps/server/src/socket/handlers.ts` — 在 send_message 中触发 agent 处理

---

## 验证流程
每个 Step 完成后可以验证的内容：
- Step 1-2: Postman 测试新 API
- Step 3: Postman/wscat 测试 WebSocket
- Step 4: 浏览器测试登录注册
- Step 5: 浏览器测试聊天 UI
- Step 6: 端到端流程测试
