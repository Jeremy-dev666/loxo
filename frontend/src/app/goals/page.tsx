'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import {
  createGoal,
  deleteGoal,
  fetchGoals,
  updateGoal,
  type Goal,
  type GoalStatus,
} from '@/lib/goals';

const STATUS_DOT: Record<GoalStatus, string> = {
  active: 'bg-pixel-green',
  achieved: 'bg-pixel-steel',
  archived: 'bg-pixel-gray',
};

function GoalRow({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  const mutate = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
    onChanged();
  };

  const saveTitle = () => {
    const next = title.trim();
    if (!next || next === goal.title) {
      setTitle(goal.title);
      return;
    }
    void mutate(() => updateGoal(goal.id, { title: next }));
  };

  const saveDescription = () => {
    if (description === goal.description) return;
    void mutate(() => updateGoal(goal.id, { description }));
  };

  const remove = () => {
    if (window.confirm(`Delete goal "${goal.title}"? Issues keep running, links are cleared.`)) {
      void mutate(() => deleteGoal(goal.id));
    }
  };

  return (
    <div
      className="border border-pixel-line bg-pixel-white"
      style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.08)' }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`h-2 w-2 shrink-0 ${STATUS_DOT[goal.status]}`} aria-hidden />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 border border-transparent bg-transparent font-pixel text-sm text-pixel-black hover:border-pixel-line focus:border-pixel-black focus:outline-none"
        />
        <select
          value={goal.status}
          onChange={(e) => void mutate(() => updateGoal(goal.id, { status: e.target.value as GoalStatus }))}
          className="border border-pixel-line bg-pixel-white px-1.5 py-0.5 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none"
        >
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          <option value="archived">Archived</option>
        </select>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="px-1 font-pixel text-xs text-pixel-gray hover:text-pixel-black"
          aria-label="Toggle details"
        >
          {expanded ? '▲' : '▼'}
        </button>
        <button
          type="button"
          onClick={remove}
          className="px-1 font-pixel text-xs uppercase text-pixel-red hover:bg-pixel-red hover:text-pixel-white"
        >
          [ DEL ]
        </button>
      </div>
      {expanded && (
        <div className="border-t border-pixel-line px-3 py-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={2}
            placeholder="Why does this goal exist?"
            className="w-full border border-transparent bg-transparent font-pixel text-xs leading-relaxed text-pixel-black hover:border-pixel-line focus:border-pixel-black focus:outline-none"
          />
        </div>
      )}
      {error && (
        <p className="border-t border-pixel-red px-3 py-1 font-pixel text-xs text-pixel-red">
          {error}
        </p>
      )}
    </div>
  );
}

function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filter, setFilter] = useState<GoalStatus | ''>('active');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { goals: list } = await fetchGoals(filter || undefined);
    setGoals(list);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setError('');
    setNewTitle('');
    try {
      await createGoal({ title });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
    await refresh().catch(() => undefined);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-pixel-line pb-4">
        <h1 className="font-pixel text-xl text-pixel-black">Goals</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as GoalStatus | '')}
          className="border border-pixel-line bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none"
        >
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          <option value="archived">Archived</option>
          <option value="">All</option>
        </select>
        {error && (
          <span className="border border-pixel-red bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-red">
            {error}
          </span>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="What are you working toward?"
          className="min-w-0 flex-1 border border-pixel-line bg-pixel-white px-2 py-1.5 font-pixel text-sm text-pixel-black focus:border-pixel-black focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!newTitle.trim()}
          className="bg-pixel-black px-3 py-1 font-pixel text-xs uppercase tracking-wide text-pixel-white hover:bg-pixel-orange hover:text-pixel-black disabled:opacity-40"
        >
          [ ADD GOAL ]
        </button>
      </div>

      {loading ? (
        <p className="font-pixel text-sm text-pixel-gray">Loading goals...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} onChanged={() => void refresh()} />
          ))}
          {goals.length === 0 && (
            <p className="py-8 text-center font-pixel text-xs uppercase tracking-[0.15em] text-pixel-gray">
              no goals here
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <GoalsPage />
    </RequireAuth>
  );
}
