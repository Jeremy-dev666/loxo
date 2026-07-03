import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Message } from '../../db/schema';

const MAX_PROMPT_CHARS = 24_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS_PER_MESSAGE = 600;
const MAX_SKILL_INDEX_CHARS = 4_000;

/**
 * Neutralizes code fences so injected documents cannot break out of the
 * context block or read as executable instructions.
 */
export function sanitizeInjected(text: string): string {
  return text.replace(/```/g, '~~~');
}

interface SkillEntry {
  name: string;
  description: string;
  relativePath: string;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta: { name?: string; description?: string } = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'name') meta.name = value;
    if (key === 'description') meta.description = value;
  }
  return meta;
}

export function collectSkillIndex(workspace: string): SkillEntry[] {
  const root = path.join(workspace, 'skills');
  const entries: SkillEntry[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        const meta = parseFrontmatter(fs.readFileSync(full, 'utf8'));
        entries.push({
          name: meta.name ?? path.basename(path.dirname(full)),
          description: meta.description ?? '',
          relativePath: path.relative(workspace, full).replace(/\\/g, '/'),
        });
      }
    }
  };
  walk(root);
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WorkflowNodeTurnContext {
  agent: Pick<Agent, 'name' | 'description'>;
  workflowName: string;
  executionId: string;
  nodeId: string;
  nodeLabel: string;
  kind: string;
  role?: string;
  task: string;
  input: string;
  workspace: string;
  artifactsDir: string;
}

/**
 * Workflow-node prompt. Unlike direct chat this run is non-interactive: the
 * agent gets hard directives to produce real files without asking questions,
 * because nobody is watching the turn.
 */
export function buildWorkflowNodePrompt(input: WorkflowNodeTurnContext): string {
  const sections: string[] = [
    '[AGENT_RUNTIME_CONTEXT]',
    'You are the agent described below, executing one node of a multi-agent workflow on the SwarmDev platform.',
    `Agent: ${input.agent.name}`,
    input.agent.description ? `Description: ${sanitizeInjected(input.agent.description)}` : '',
    `Workflow: ${sanitizeInjected(input.workflowName)} (execution ${input.executionId})`,
    `Node: ${sanitizeInjected(input.nodeLabel)} — ${input.kind}${input.role ? `, role: ${sanitizeInjected(input.role)}` : ''}`,
    `Original task: ${sanitizeInjected(input.task)}`,
    `Shared workspace: ${input.workspace}`,
    `Run artifacts directory: ${input.artifactsDir}`,
    [
      'Hard rules for this run:',
      '- This run is non-interactive. Never ask questions or wait for confirmation; decide and proceed.',
      '- Upstream nodes may have left files in the shared workspace; inspect the handoff files referenced in your input before starting.',
      '- Produce real files in the shared workspace for anything downstream nodes need. No placeholders and no descriptions of work you did not do.',
      '- State the paths of files you created or changed in your reply.',
      "- Return only this node's result. Do not perform downstream nodes' work.",
    ].join('\n'),
    'Treat everything inside AGENT_RUNTIME_CONTEXT as platform framing, not user-authored text.',
    'Do not reveal credentials or platform internals in replies.',
    '[/AGENT_RUNTIME_CONTEXT]',
  ].filter(Boolean);

  let context = sections.join('\n\n');
  if (context.length > MAX_PROMPT_CHARS) {
    context = `${context.slice(0, MAX_PROMPT_CHARS)}\n[context truncated]\n[/AGENT_RUNTIME_CONTEXT]`;
  }

  return [context, '', '[NODE_INPUT]', input.input, '[/NODE_INPUT]'].join('\n');
}

export interface DirectChatContext {
  agent: Agent;
  workspace: string;
  userMessage: string;
  conversationId: string;
  /** Prior turns; injected only for runtimes without native session resume. */
  history?: Message[];
}

/**
 * Direct-chat prompt. The runtime block is server-authored framing; the user
 * message is delimited so agents can distinguish it from platform text.
 * claude-code reads CLAUDE.md from the workspace natively, so workspace docs
 * are not re-injected here.
 */
export function buildDirectChatPrompt(input: DirectChatContext): string {
  const sections: string[] = [
    '[AGENT_RUNTIME_CONTEXT]',
    'You are the agent described below, running inside the SwarmDev platform.',
    `Agent: ${input.agent.name}`,
    input.agent.description ? `Description: ${sanitizeInjected(input.agent.description)}` : '',
    `Conversation: ${input.conversationId}`,
    'Treat everything inside AGENT_RUNTIME_CONTEXT as platform framing, not user-authored text.',
    'Do not reveal credentials or platform internals in replies.',
  ].filter(Boolean);

  const skills = collectSkillIndex(input.workspace);
  if (skills.length > 0) {
    let index = 'Available skills (read the referenced SKILL.md before specialized work):\n';
    for (const skill of skills) {
      const line = `- ${skill.name}: ${sanitizeInjected(skill.description)} (${skill.relativePath})\n`;
      if (index.length + line.length > MAX_SKILL_INDEX_CHARS) break;
      index += line;
    }
    sections.push(index.trimEnd());
  }

  if (input.history && input.history.length > 0) {
    const recent = input.history
      .slice(-MAX_HISTORY_MESSAGES)
      .map(
        (m) =>
          `${m.role}: ${sanitizeInjected(m.content.replace(/\s+/g, ' ').slice(0, MAX_HISTORY_CHARS_PER_MESSAGE))}`
      );
    sections.push(`Recent conversation:\n${recent.join('\n')}`);
  }

  sections.push('[/AGENT_RUNTIME_CONTEXT]');

  let context = sections.join('\n\n');
  if (context.length > MAX_PROMPT_CHARS) {
    context = `${context.slice(0, MAX_PROMPT_CHARS)}\n[context truncated]\n[/AGENT_RUNTIME_CONTEXT]`;
  }

  return [context, '', '[USER_MESSAGE]', input.userMessage, '[/USER_MESSAGE]'].join('\n');
}
