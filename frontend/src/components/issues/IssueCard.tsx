'use client';

import { STATUS_META, type Issue } from '@/lib/issues';

const PAPER = '#FDFCF7';

interface IssueCardProps {
  issue: Issue;
  /** Present on blocked/in_progress cards: toggles the blocked loop. */
  onToggleBlocked?: (issue: Issue) => void;
  onOpen?: (issue: Issue) => void;
  dragging?: boolean;
}

/**
 * Ticket stub on the rail: thermal paper, order number, a torn bottom
 * edge. The full receipt lives in IssueReceipt; this is its stub.
 */
export function IssueCard({ issue, onToggleBlocked, onOpen, dragging = false }: IssueCardProps) {
  const blocked = issue.status === 'blocked';
  const spine = STATUS_META[issue.status].swatch;

  return (
    <div
      onClick={() => onOpen?.(issue)}
      className={`group relative transition-transform ${onOpen ? 'cursor-pointer' : ''} ${
        dragging ? 'scale-[1.02]' : ''
      }`}
      style={{
        filter: dragging
          ? 'drop-shadow(3px 4px 0px rgba(17,17,17,0.22))'
          : 'drop-shadow(1px 2px 0px rgba(17,17,17,0.12))',
      }}
    >
      <div
        className={`relative border-x border-t ${
          dragging ? 'border-pixel-black' : 'border-pixel-line group-hover:border-pixel-gray'
        }`}
        style={{ backgroundColor: PAPER }}
      >
        <span className={`absolute inset-y-0 left-0 w-[3px] ${spine}`} aria-hidden />
        <div className="py-2 pl-3 pr-2">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[10px] tracking-wide text-pixel-gray">
              ORD-{String(issue.issueNumber).padStart(4, '0')}
            </span>
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
      {/* Torn bottom edge: transparent-first so the teeth point down. */}
      <div
        aria-hidden
        className="h-[6px] w-full"
        style={{
          background: `linear-gradient(45deg, transparent 3px, ${PAPER} 0), linear-gradient(-45deg, transparent 3px, ${PAPER} 0)`,
          backgroundPosition: 'left top',
          backgroundRepeat: 'repeat-x',
          backgroundSize: '6px 6px',
        }}
      />
    </div>
  );
}
