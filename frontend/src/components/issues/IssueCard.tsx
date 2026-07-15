'use client';

import { STATUS_META, type Issue } from '@/lib/issues';

interface IssueCardProps {
  issue: Issue;
  /** Present on blocked/in_progress cards: toggles the blocked loop. */
  onToggleBlocked?: (issue: Issue) => void;
  onOpen?: (issue: Issue) => void;
  dragging?: boolean;
}

export function IssueCard({ issue, onToggleBlocked, onOpen, dragging = false }: IssueCardProps) {
  const blocked = issue.status === 'blocked';
  const spine = STATUS_META[issue.status].swatch;

  return (
    <div
      onClick={() => onOpen?.(issue)}
      className={`group relative border border-pixel-line bg-pixel-white transition-colors ${
        dragging ? 'border-pixel-black' : 'hover:border-pixel-gray'
      } ${onOpen ? 'cursor-pointer' : ''}`}
      style={{
        boxShadow: dragging
          ? '4px 4px 0px 0px rgba(17,17,17,0.18)'
          : '2px 2px 0px 0px rgba(17,17,17,0.10)',
      }}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${spine}`} aria-hidden />
      <div className="py-2 pl-3 pr-2">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-xs text-pixel-gray">#{issue.issueNumber}</span>
          {blocked && (
            <span className="bg-pixel-red px-1 font-pixel text-[10px] uppercase tracking-wide text-pixel-white">
              Blocked
            </span>
          )}
        </div>
        <p className="mt-1 break-words text-sm leading-snug text-pixel-black">{issue.title}</p>
        {onToggleBlocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBlocked(issue);
            }}
            className={`mt-1.5 hidden font-pixel text-[10px] uppercase tracking-wide underline group-hover:inline-block ${
              blocked ? 'text-pixel-green' : 'text-pixel-red'
            }`}
          >
            {blocked ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>
    </div>
  );
}
