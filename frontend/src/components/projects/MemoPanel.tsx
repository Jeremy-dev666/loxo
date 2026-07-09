'use client';

import type { Memo } from '@/lib/memos';

const SOURCE_STYLES: Record<Memo['source'], { label: string; chip: string }> = {
  retro: { label: 'Run retro', chip: 'bg-pixel-blue/20 text-pixel-blue' },
  review: { label: 'Review', chip: 'bg-pixel-yellow/30 text-pixel-blue' },
};

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Project-scope memory: distilled run summaries the executor injects into
 * future node prompts. Deleting a stale memo removes it from that context.
 */
export function MemoPanel({
  memos,
  onDelete,
}: {
  memos: Memo[];
  onDelete: (memoId: string) => void;
}) {
  if (memos.length === 0) {
    return (
      <p className="p-4 text-sm text-pixel-black/50">
        No memory yet. Each workflow run distills what happened here; future runs read it back.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-pixel-black/10">
      {memos.map((memo) => {
        const source = SOURCE_STYLES[memo.source];
        return (
          <li key={memo.id} className="group flex items-start gap-2 px-4 py-2.5 text-xs">
            <span className={`mt-0.5 shrink-0 px-1.5 py-0.5 ${source.chip}`}>{source.label}</span>
            <div className="min-w-0 flex-1">
              <p className="text-pixel-black">{memo.content}</p>
              <p className="mt-0.5 text-[10px] text-pixel-black/40">{relativeTime(memo.createdAt)}</p>
            </div>
            <button
              type="button"
              onClick={() => onDelete(memo.id)}
              title="Forget this memo"
              className="shrink-0 border border-pixel-line bg-pixel-white px-1.5 py-0.5 font-pixel text-[10px] text-pixel-black/60 opacity-0 transition-opacity hover:bg-pixel-red hover:text-pixel-white group-hover:opacity-100"
            >
              Forget
            </button>
          </li>
        );
      })}
    </ul>
  );
}
