'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AgentCard } from '@/components/agent/AgentCard';
import { AgentSprite } from '@/components/agent/AgentSprite';
import { BackButton } from '@/components/ui/BackButton';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { PixelButton } from '@/components/ui/PixelButton';
import { PixelDialog } from '@/components/ui/PixelDialog';
import { PixelInput } from '@/components/ui/PixelInput';
import {
  createGroup,
  deleteGroup,
  fetchAgents,
  fetchGroups,
  updateAgent,
  type Agent,
  type AgentGroup,
} from '@/lib/agents';
import { fetchMyListings } from '@/lib/market';

const GROUP_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];

const UNGROUPED: AgentGroup = { id: '__ungrouped__', name: 'Unassigned', color: '#6b7280', sortOrder: 9999 };

function GroupSection({
  group,
  agents,
  publishedAgentIds,
  onDeleteGroup,
  onOpenAddAgent,
  onMoveOut,
  onChanged,
}: {
  group: AgentGroup;
  agents: Agent[];
  publishedAgentIds: Set<string>;
  onDeleteGroup: (group: AgentGroup) => void;
  onOpenAddAgent?: (groupId: string) => void;
  onMoveOut?: (agentId: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isUngrouped = group.id === UNGROUPED.id;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
      <div
        className="flex cursor-pointer items-center gap-4 border border-pixel-line p-4"
        style={{ background: group.color, boxShadow: '5px 5px 0px 0px rgba(17,17,17,0.10)' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full border border-pixel-line font-pixel text-2xl font-bold text-white md:h-12 md:w-12 md:text-xl"
          style={{ background: group.color, filter: 'brightness(0.8)' }}
        >
          {group.name.charAt(0) || '?'}
        </div>
        <div className="flex-1">
          <h2 className="font-pixel text-[1.7rem] font-bold leading-tight text-white md:text-xl">{group.name}</h2>
          <p className="mt-1 font-pixel text-[1.1rem] text-white/80 md:text-sm">{agents.length} agents</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          {!isUngrouped && onOpenAddAgent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAddAgent(group.id);
              }}
              className="border border-pixel-line bg-pixel-white px-3 py-2 font-pixel text-sm font-bold text-pixel-black transition-colors hover:bg-pixel-cream md:py-1 md:text-xs"
              style={{ boxShadow: '1px 1px 0px 0px rgba(17,17,17,0.10)' }}
            >
              + Add agent
            </button>
          )}
          {!isUngrouped && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteGroup(group);
              }}
              className="hidden border border-pixel-line bg-pixel-yellow px-3 py-2 font-pixel text-sm font-bold text-pixel-black transition-colors hover:bg-pixel-orange sm:block md:py-1 md:text-xs"
              style={{ boxShadow: '1px 1px 0px 0px rgba(17,17,17,0.10)' }}
            >
              Delete den
            </button>
          )}
          <div className="font-pixel text-3xl font-bold text-white md:text-2xl">{expanded ? '▲' : '▼'}</div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border border-t-0 border-pixel-line bg-pixel-white/80 p-3 md:p-4">
              {agents.length > 0 ? (
                <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {agents.map((agent, index) => (
                    <div key={agent.id} className="flex h-full min-h-0 flex-col gap-2">
                      <motion.div
                        className="flex min-h-0 flex-1 flex-col"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <AgentCard
                          agent={agent}
                          published={publishedAgentIds.has(agent.id)}
                          onChanged={onChanged}
                        />
                      </motion.div>
                      {!isUngrouped && onMoveOut && (
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => onMoveOut(agent.id)}
                            className="border border-pixel-line bg-pixel-white px-3 py-2 font-pixel text-sm font-bold text-pixel-black transition-colors hover:bg-pixel-cream md:px-2 md:py-1 md:text-xs"
                            style={{ boxShadow: '2px 2px 0 rgba(17,17,17,0.10)' }}
                          >
                            Move out
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="font-pixel text-[1.2rem] text-pixel-black/50 md:text-sm">No agents in this den yet</p>
                  <Link href="/market" className="mt-3 inline-block">
                    <PixelButton variant="primary" size="sm">
                      Adopt one
                    </PixelButton>
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AgentsPageInner() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [publishedAgentIds, setPublishedAgentIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [addTargetGroupId, setAddTargetGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]!);

  const reload = useCallback(async () => {
    const [agentList, groupList, listings] = await Promise.all([
      fetchAgents().catch(() => []),
      fetchGroups().catch(() => []),
      fetchMyListings().catch(() => []),
    ]);
    setAgents(agentList);
    setGroups(groupList);
    setPublishedAgentIds(
      new Set(listings.filter((l) => l.status === 'active' && l.sourceAgentId).map((l) => l.sourceAgentId!))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim(), color: newGroupColor });
    setNewGroupName('');
    setNewGroupColor(GROUP_COLORS[0]!);
    setShowCreateDialog(false);
    await reload();
  };

  const handleDeleteGroup = async (group: AgentGroup) => {
    if (!window.confirm(`Delete den "${group.name}"? Agents inside are kept.`)) return;
    await deleteGroup(group.id);
    await reload();
  };

  const handleMove = async (agentId: string, groupId: string | null) => {
    await updateAgent(agentId, { groupId });
    await reload();
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-16">
        <BackButton href="/" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border border-pixel-blue border-t-transparent" />
            <p className="font-pixel text-pixel-black/60">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  const agentsByGroup = new Map<string, Agent[]>();
  const unassigned: Agent[] = [];
  for (const agent of agents) {
    if (agent.groupId) {
      agentsByGroup.set(agent.groupId, [...(agentsByGroup.get(agent.groupId) ?? []), agent]);
    } else {
      unassigned.push(agent);
    }
  }

  const configuredCount = agents.filter((a) => a.providerId).length;
  const addTargetGroup = addTargetGroupId ? groups.find((g) => g.id === addTargetGroupId) : undefined;
  const addCandidates = addTargetGroupId ? agents.filter((a) => a.groupId !== addTargetGroupId) : [];

  return (
    <div className="mx-auto max-w-6xl px-3 pb-48 md:px-4 md:pb-16">
      <div className="hidden md:block">
        <BackButton href="/" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 border-b border-pixel-line bg-pixel-white pb-4 pt-3 text-left md:mb-8 md:border-b-0 md:bg-transparent md:pb-0 md:pt-6 md:text-center"
      >
        <p className="font-pixel text-[1.25rem] leading-none text-pixel-black/55 md:hidden">MY AGENT DEN</p>
        <h1 className="md:brand-large mt-2 font-pixel text-[3rem] font-bold leading-none text-pixel-black md:mb-2">
          My Agent Den
        </h1>
        <p className="hidden font-pixel text-xl text-pixel-blue md:block">MY AGENT DEN</p>
        <p className="mt-2 font-pixel text-[1.2rem] leading-snug text-pixel-black/60 md:text-sm">
          {agents.length} agents · {groups.length} dens
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-6 grid grid-cols-3 gap-2 md:mb-8 md:flex md:flex-wrap md:justify-center md:gap-6"
      >
        <div
          className="border border-pixel-line bg-pixel-white px-3 py-3 text-center md:px-6 md:text-left"
          style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
        >
          <p className="font-pixel text-base leading-none text-pixel-black/60 md:text-xs">Total</p>
          <p className="mt-1 font-pixel text-[1.8rem] leading-none text-pixel-black md:text-2xl md:leading-normal">
            {agents.length}
          </p>
        </div>
        <div
          className="border border-pixel-line bg-pixel-green px-3 py-3 text-center md:px-6 md:text-left"
          style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
        >
          <p className="font-pixel text-base leading-none text-pixel-white md:text-xs">Configured</p>
          <p className="mt-1 font-pixel text-[1.8rem] leading-none text-pixel-white md:text-2xl md:leading-normal">
            {configuredCount}
          </p>
        </div>
        <div
          className="border border-pixel-line bg-pixel-gray px-3 py-3 text-center md:px-6 md:text-left"
          style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
        >
          <p className="font-pixel text-base leading-none text-pixel-white md:text-xs">Unconfigured</p>
          <p className="mt-1 font-pixel text-[1.8rem] leading-none text-pixel-black md:text-2xl md:leading-normal">
            {agents.length - configuredCount}
          </p>
        </div>
      </motion.div>

      <div className="mb-6 flex justify-center gap-3">
        <PixelButton
          variant="primary"
          onClick={() => setShowCreateDialog(true)}
          className="min-h-[56px] w-full text-[1.2rem] md:min-h-0 md:w-auto md:text-base"
        >
          + Create a new den
        </PixelButton>
        <Link href="/upload" className="hidden md:block">
          <PixelButton variant="secondary">Upload agent</PixelButton>
        </Link>
      </div>

      {groups.length === 0 && agents.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 text-center">
          <h2 className="md:brand-large mb-4 font-pixel text-[2.2rem] font-bold leading-tight text-pixel-black">
            No dens yet
          </h2>
          <p className="mb-6 font-pixel text-[1.2rem] text-pixel-black/60 md:text-base">
            Create a den for your agents first!
          </p>
          <PixelButton
            variant="primary"
            onClick={() => setShowCreateDialog(true)}
            className="min-h-[56px] text-[1.2rem] md:min-h-0 md:text-base"
          >
            Create the first den
          </PixelButton>
        </motion.div>
      ) : (
        <div>
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              agents={agentsByGroup.get(group.id) ?? []}
              publishedAgentIds={publishedAgentIds}
              onDeleteGroup={handleDeleteGroup}
              onOpenAddAgent={(id) => setAddTargetGroupId(id)}
              onMoveOut={(agentId) => void handleMove(agentId, null)}
              onChanged={reload}
            />
          ))}

          {unassigned.length > 0 && (
            <GroupSection
              group={UNGROUPED}
              agents={unassigned}
              publishedAgentIds={publishedAgentIds}
              onDeleteGroup={() => {}}
              onChanged={reload}
            />
          )}
        </div>
      )}

      <AnimatePresence>
        {addTargetGroupId && addTargetGroup && (
          <ModalPortal>
            <motion.div
              key={addTargetGroupId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
              onClick={() => setAddTargetGroupId(null)}
            >
              <motion.div
                initial={{ scale: 0.92, y: 16 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 16 }}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[80vh] w-full max-w-lg overflow-y-auto border border-pixel-line bg-pixel-white"
                style={{ boxShadow: '3px 3px 0px 0px rgba(17,17,17,0.10)' }}
              >
                <div
                  className="flex items-center justify-between border-b border-pixel-line p-3 font-pixel text-xl text-pixel-white"
                  style={{ background: addTargetGroup.color }}
                >
                  <span>Add agents to {addTargetGroup.name}</span>
                  <button
                    onClick={() => setAddTargetGroupId(null)}
                    className="flex h-8 w-8 items-center justify-center border border-pixel-line bg-pixel-black text-pixel-white"
                    style={{ boxShadow: '1px 1px 0px 0px rgba(17,17,17,0.10)' }}
                  >
                    X
                  </button>
                </div>
                <div className="space-y-2 p-4">
                  {addCandidates.length === 0 && (
                    <p className="py-4 text-center font-pixel text-sm text-pixel-black/50">
                      Every agent is already in this den.
                    </p>
                  )}
                  {addCandidates.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={async () => {
                        await handleMove(agent.id, addTargetGroupId);
                      }}
                      className="flex w-full items-center gap-3 border border-pixel-line bg-pixel-white p-2 text-left hover:bg-pixel-cream"
                      style={{ boxShadow: '2px 2px 0 rgba(17,17,17,0.10)' }}
                    >
                      <AgentSprite agent={agent} size="sm" showProviderStatus providerConfigured={!!agent.providerId} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-pixel text-sm font-bold text-pixel-black">
                          {agent.name}
                        </span>
                        <span className="block truncate font-pixel text-xs text-pixel-black/55">
                          {agent.groupId
                            ? `In ${groups.find((g) => g.id === agent.groupId)?.name ?? 'another den'}`
                            : 'Unassigned'}
                        </span>
                      </span>
                      <span className="font-pixel text-xs text-pixel-blue">Add →</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>

      <PixelDialog isOpen={showCreateDialog} onClose={() => setShowCreateDialog(false)} title="Create a new den">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block font-pixel text-sm text-pixel-black">Den name</label>
            <PixelInput value={newGroupName} onChange={setNewGroupName} placeholder="Research crew" />
          </div>
          <div>
            <label className="mb-1 block font-pixel text-sm text-pixel-black">Color</label>
            <div className="flex gap-2">
              {GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewGroupColor(color)}
                  className={`h-9 w-9 border ${newGroupColor === color ? 'border-pixel-line' : 'border-transparent'}`}
                  style={{ background: color, boxShadow: newGroupColor === color ? '2px 2px 0 rgba(17,17,17,0.10)' : 'none' }}
                  aria-label={`Choose color ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <PixelButton variant="secondary" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </PixelButton>
            <PixelButton variant="primary" onClick={() => void handleCreateGroup()} disabled={!newGroupName.trim()}>
              Create
            </PixelButton>
          </div>
        </div>
      </PixelDialog>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <RequireAuth>
      <AgentsPageInner />
    </RequireAuth>
  );
}
