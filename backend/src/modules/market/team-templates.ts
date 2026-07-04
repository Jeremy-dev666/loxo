import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents, type Agent } from '../../db/schema';
import { notFound } from '../../http/errors';
import { storage } from '../../storage/layout';
import {
  captureBaseline,
  createAgent,
  createGroup,
  deleteAgent,
  deleteGroup,
  updateAgent,
  updateAgentConfig,
} from '../agents/agents.service';
import type { AgentRuntime } from '../agents/runtime-detect';
import { createTeam, type TeamView } from '../teams/teams.service';
import type { WorkflowDsl, WorkflowEdge, WorkflowNode } from '../teams/workflow-dsl';

export interface TemplateSkill {
  name: string;
  summary: string;
}

export interface TeamTemplateMember {
  roleCode: string;
  name: string;
  description: string;
  runtime?: AgentRuntime;
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
  defaultRuntime: AgentRuntime;
  members: TeamTemplateMember[];
  workflowSummary: string;
  /** stages[i] labels the edge leading into member i (stages[0] = kickoff). */
  stages: string[];
  communication: { mode: string; description: string };
  isolation: { description: string };
}

export interface TeamTemplateView extends TeamTemplate {
  memberCount: number;
  workflow: WorkflowDsl;
}

const RESEARCH_PIPELINE: TeamTemplate = {
  id: 'tpl-research-pipeline',
  name: 'Applied ML Research Team',
  description:
    'A four-agent research pipeline with staged quality gates: the lead sets direction and reviews each phase, a literature researcher maps prior work, an experiment engineer runs and analyzes trials, and a paper author writes up the results.',
  category: 'Research',
  tags: ['research', 'machine-learning', 'pipeline'],
  color: '#10b981',
  defaultRuntime: 'openclaw',
  members: [
    {
      roleCode: 'LEAD',
      name: 'Principal Investigator',
      description:
        'Sets the research direction and runs the quality gates between phases. Reviews literature coverage, experimental rigor, and manuscript claims; approves or sends work back with concrete revision notes. Writes no code and no prose of its own.',
      color: '#ef4444',
      skills: [
        { name: 'gate-review', summary: 'Staged quality gates for literature, results, and manuscript phases with approve/revise decisions.' },
        { name: 'research-direction', summary: 'Turn a broad topic into a scoped, testable research question.' },
        { name: 'novelty-assessment', summary: 'Judge whether proposed contributions are distinct from prior work.' },
        { name: 'pipeline-state', summary: 'Track phase status in a shared state file so downstream agents know when to start.' },
      ],
    },
    {
      roleCode: 'LIT',
      name: 'Literature Researcher',
      description:
        'Performs systematic literature search, extracts the state of the art, identifies gaps, and drafts an experiment plan grounded in prior results. Writes findings into the shared literature directory for downstream agents.',
      color: '#3b82f6',
      skills: [
        { name: 'systematic-search', summary: 'Structured literature search with documented queries and inclusion criteria.' },
        { name: 'gap-analysis', summary: 'Contrast prior results to locate the unexplored territory worth testing.' },
        { name: 'citation-verification', summary: 'Verify that every cited claim actually appears in the cited source.' },
        { name: 'experiment-planning', summary: 'Translate a research gap into a concrete, falsifiable experiment plan.' },
      ],
    },
    {
      roleCode: 'EXP',
      name: 'Experiment Engineer',
      description:
        'Implements and runs the planned experiments with fixed random seeds and baseline comparisons, records failures for future runs, and reports metrics with statistical context in the shared experiment directory.',
      color: '#f59e0b',
      skills: [
        { name: 'experiment-execution', summary: 'Run planned trials reproducibly: pinned dependencies, fixed seeds, logged configs.' },
        { name: 'baseline-comparison', summary: 'Always evaluate against sensible baselines before claiming improvements.' },
        { name: 'result-analysis', summary: 'Summarize metrics with variance and significance, not single best runs.' },
        { name: 'failure-log', summary: 'Record failed configurations and why, so reruns skip known dead ends.' },
      ],
    },
    {
      roleCode: 'WRITE',
      name: 'Paper Author',
      description:
        'Drafts the manuscript from the recorded experiment results: outline, full draft, self-review, revision. Every number in the paper must trace back to a file in the experiment output directory.',
      color: '#8b5cf6',
      skills: [
        { name: 'manuscript-outline', summary: 'Structure the paper before writing: claims first, sections second.' },
        { name: 'results-writing', summary: 'Present results faithfully with limitations stated alongside strengths.' },
        { name: 'self-review', summary: 'Adversarial read of the draft before handing it to the gate review.' },
      ],
    },
  ],
  workflowSummary:
    'Linear pipeline with gate reviews: direction → literature → experiments → manuscript, with the lead reviewing between phases.',
  stages: [
    'Kick off with the research topic',
    'Map prior work and draft the experiment plan',
    'Run experiments against baselines',
    'Write the manuscript from recorded results',
  ],
  communication: {
    mode: 'file-mediated',
    description:
      'Members communicate through the shared run workspace: each phase writes its deliverables into an agreed directory and downstream agents read them as input. No real-time messaging.',
  },
  isolation: {
    description:
      'Each agent keeps its own workspace and runtime state. Within the shared run directory, each role writes only to its own phase directory and treats the others as read-only input.',
  },
};

const PRODUCT_DELIVERY: TeamTemplate = {
  id: 'tpl-product-delivery',
  name: 'Product Delivery Squad',
  description:
    'A three-agent, mixed-runtime delivery team: a product planner shapes requirements into fine-grained implementation plans, a full-stack engineer executes them, and a QA engineer enforces test-driven quality before anything ships.',
  category: 'Engineering',
  tags: ['software-delivery', 'full-stack', 'tdd'],
  color: '#6366f1',
  defaultRuntime: 'openclaw',
  members: [
    {
      roleCode: 'PLAN',
      name: 'Product Planner',
      description:
        'Turns raw ideas into specs and step-by-step implementation plans through structured questioning. Each planned task is small enough to verify independently; the plan is the contract the engineer executes against.',
      runtime: 'openclaw',
      color: '#ef4444',
      skills: [
        { name: 'requirement-shaping', summary: 'Interrogate an idea until acceptance criteria are unambiguous.' },
        { name: 'implementation-planning', summary: 'Break specs into small, independently verifiable tasks with explicit ordering.' },
        { name: 'scope-control', summary: 'Cut scope explicitly instead of letting tasks silently grow.' },
      ],
    },
    {
      roleCode: 'DEV',
      name: 'Full-Stack Engineer',
      description:
        'Executes the implementation plan task by task across the stack, keeps changes isolated per task, debugs systematically from symptoms to root cause, and addresses review feedback before closing out a task.',
      runtime: 'opencode',
      color: '#3b82f6',
      skills: [
        { name: 'plan-execution', summary: 'Work the plan in order; flag plan defects instead of silently deviating.' },
        { name: 'systematic-debugging', summary: 'Reproduce, isolate, root-cause, then fix — never patch symptoms blind.' },
        { name: 'change-isolation', summary: 'One task, one coherent change set; no drive-by edits.' },
        { name: 'review-response', summary: 'Address every review finding explicitly: fix it or argue it, never ignore it.' },
      ],
    },
    {
      roleCode: 'QA',
      name: 'QA Engineer',
      description:
        'Owns quality: writes tests ahead of or alongside implementation, verifies acceptance criteria with runnable evidence before any task is declared done, and requests review when the evidence is missing.',
      runtime: 'hermes',
      color: '#10b981',
      skills: [
        { name: 'test-first', summary: 'Red-green-refactor: a failing test precedes the fix that makes it pass.' },
        { name: 'acceptance-verification', summary: 'A task is done only when its acceptance criteria are demonstrated, not asserted.' },
        { name: 'review-request', summary: 'Escalate for review at task boundaries with the evidence attached.' },
      ],
    },
  ],
  workflowSummary:
    'Plan-driven delivery: the planner writes specs and plans, the engineer implements them, QA verifies with tests before completion.',
  stages: [
    'Kick off with the product idea',
    'Shape the spec and write the implementation plan',
    'Implement the plan task by task',
    'Verify acceptance criteria with tests',
  ],
  communication: {
    mode: 'plan-driven files',
    description:
      'The planner writes specs and plans into the shared docs directory; the engineer reads and executes them; QA reads the change set and records verification evidence. All handoffs are files in the shared workspace.',
  },
  isolation: {
    description:
      'The planner writes only docs, the engineer works the source tree, QA keeps tests and verification notes in the test directories. Roles do not edit each other\'s output.',
  },
};

const TEMPLATES: TeamTemplate[] = [RESEARCH_PIPELINE, PRODUCT_DELIVERY];

const START_NODE = 'start';
const END_NODE = 'end';

function memberNodeId(index: number): string {
  return `member-${index + 1}`;
}

/**
 * Materializes the template as a linear workflow DSL: start → members in
 * order → end. The first member orchestrates; positions form a two-column
 * zigzag so the canvas renders readably without manual layout.
 */
export function buildTemplateWorkflow(
  template: TeamTemplate,
  options: { teamName?: string; agentIds?: string[] } = {}
): WorkflowDsl {
  const nodes: WorkflowNode[] = [
    { id: START_NODE, type: 'start', label: 'Task input', position: { x: 220, y: 0 } },
    ...template.members.map((member, i): WorkflowNode => ({
      id: memberNodeId(i),
      type: 'agent',
      label: member.name,
      agentId: options.agentIds?.[i],
      kind: i === 0 ? 'orchestrator' : 'worker',
      role: member.roleCode,
      position: { x: 80 + (i % 2) * 280, y: 120 + i * 140 },
    })),
    {
      id: END_NODE,
      type: 'end',
      label: 'Final output',
      position: { x: 220, y: 120 + template.members.length * 140 },
    },
  ];

  const edges: WorkflowEdge[] = [
    { id: `${START_NODE}-${memberNodeId(0)}`, from: START_NODE, to: memberNodeId(0), label: template.stages[0] ?? '' },
    ...template.members.slice(0, -1).map((_, i) => ({
      id: `${memberNodeId(i)}-${memberNodeId(i + 1)}`,
      from: memberNodeId(i),
      to: memberNodeId(i + 1),
      label: template.stages[i + 1] ?? '',
    })),
    {
      id: `${memberNodeId(template.members.length - 1)}-${END_NODE}`,
      from: memberNodeId(template.members.length - 1),
      to: END_NODE,
      label: 'Deliver',
    },
  ];

  return {
    version: '1',
    name: options.teamName?.trim() || template.name,
    description: template.workflowSummary,
    entryNodeId: START_NODE,
    nodes,
    edges,
    execution: { mode: 'dag', maxConcurrency: 1, timeoutSec: 3600 },
    metadata: { source: 'template', pattern: 'pipeline' },
  };
}

function toView(template: TeamTemplate): TeamTemplateView {
  return {
    ...template,
    memberCount: template.members.length,
    workflow: buildTemplateWorkflow(template),
  };
}

export function listTeamTemplates(): TeamTemplateView[] {
  return TEMPLATES.map(toView);
}

export function getTeamTemplate(templateId: string): TeamTemplateView {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw notFound('Team template not found');
  return toView(template);
}

export interface DuplicateTemplateAgent {
  roleCode: string;
  memberName: string;
  agentId: string;
  agentName: string;
}

/** Agents previously adopted from the same template, keyed by role. */
export async function findDuplicateTemplateAgents(
  userId: string,
  templateId: string
): Promise<DuplicateTemplateAgent[]> {
  const template = getTeamTemplate(templateId);
  const memberNames = new Map(template.members.map((m) => [m.roleCode, m.name]));

  const rows = await db.select().from(agents).where(eq(agents.userId, userId));
  const byRole = new Map<string, DuplicateTemplateAgent>();
  for (const agent of rows) {
    const provenance = agent.manifest.template;
    if (provenance?.id !== templateId) continue;
    const roleCode = provenance.roleCode;
    if (!roleCode || !memberNames.has(roleCode) || byRole.has(roleCode)) continue;
    byRole.set(roleCode, {
      roleCode,
      memberName: memberNames.get(roleCode)!,
      agentId: agent.id,
      agentName: agent.name,
    });
  }
  return [...byRole.values()];
}

function writeMemberSkills(userId: string, agentId: string, member: TeamTemplateMember): void {
  const skillsRoot = path.join(storage.agentPaths(userId, agentId).workspace, 'skills');
  for (const skill of member.skills) {
    const dir = path.join(skillsRoot, skill.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      [
        '---',
        `name: "${skill.name}"`,
        `description: "${skill.summary}"`,
        '---',
        '',
        `# ${skill.name}`,
        '',
        skill.summary,
        '',
        `Applies to the ${member.name} (${member.roleCode}) role.`,
        '',
      ].join('\n')
    );
  }
}

export type DuplicateAgentMode = 'clone' | 'share-config';

export interface DuplicateAgentChoice {
  roleCode: string;
  existingAgentId: string;
  mode: DuplicateAgentMode;
}

export interface AdoptTeamInput {
  teamName?: string;
  duplicateChoices?: DuplicateAgentChoice[];
}

export interface AdoptTeamResult {
  team: TeamView;
  groupId: string;
  agentIds: string[];
}

/**
 * Materializes a template: one agent group, one agent per member (with
 * generated starter skills), and a team whose workflow binds the new agents
 * in pipeline order. A `share-config` duplicate choice copies provider/model
 * from a previously adopted agent of the same role; `clone` (and the
 * default) creates a fresh unconfigured agent.
 */
export async function adoptTeamTemplate(
  userId: string,
  templateId: string,
  input: AdoptTeamInput = {}
): Promise<AdoptTeamResult> {
  const template = getTeamTemplate(templateId);
  const teamName = input.teamName?.trim() || template.name;

  const ownedAgents = await db.select().from(agents).where(eq(agents.userId, userId));
  const ownedById = new Map(ownedAgents.map((a) => [a.id, a]));
  const shareSources = new Map<string, Agent>();
  for (const choice of input.duplicateChoices ?? []) {
    const source = ownedById.get(choice.existingAgentId);
    if (choice.mode === 'share-config' && source) shareSources.set(choice.roleCode, source);
  }

  const group = await createGroup(userId, { name: teamName, color: template.color });
  const createdIds: string[] = [];

  try {
    for (const member of template.members) {
      const agent = await createAgent(userId, {
        name: member.name,
        runtime: member.runtime ?? template.defaultRuntime,
        description: member.description,
        tags: [...template.tags, member.roleCode],
        manifest: {
          name: member.name,
          description: member.description,
          template: { id: template.id, roleCode: member.roleCode },
        },
      });
      createdIds.push(agent.id);

      await updateAgent(userId, agent.id, { groupId: group.id });

      const shared = shareSources.get(member.roleCode);
      if (shared?.providerId) {
        await updateAgentConfig(userId, agent.id, {
          providerId: shared.providerId,
          model: shared.model,
        });
      }

      writeMemberSkills(userId, agent.id, member);
      captureBaseline(userId, agent.id);
    }

    const workflow = buildTemplateWorkflow(template, { teamName, agentIds: createdIds });
    const team = await createTeam(userId, {
      name: teamName,
      description: template.description,
      workflow,
    });

    return { team, groupId: group.id, agentIds: createdIds };
  } catch (error) {
    for (const agentId of createdIds) {
      await deleteAgent(userId, agentId).catch(() => {});
    }
    await deleteGroup(userId, group.id).catch(() => {});
    throw error;
  }
}
