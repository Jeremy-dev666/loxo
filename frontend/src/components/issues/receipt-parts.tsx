'use client';

/** Thermal-paper tone shared by every ticket surface. */
export const PAPER = '#FDFCF7';

/**
 * Torn-paper edge. Top edge: paper sits low, teeth point up. Bottom edge
 * needs the inverse form (transparent-first) so the teeth point down;
 * swapping gradient angles alone is a no-op since the pair is mirrored.
 */
export function TornEdge({ bottom = false }: { bottom?: boolean }) {
  const teeth = bottom
    ? `linear-gradient(45deg, transparent 5px, ${PAPER} 0), linear-gradient(-45deg, transparent 5px, ${PAPER} 0)`
    : `linear-gradient(45deg, ${PAPER} 5px, transparent 0), linear-gradient(-45deg, ${PAPER} 5px, transparent 0)`;
  return (
    <div
      aria-hidden
      className="h-[10px] w-full shrink-0"
      style={{
        background: teeth,
        backgroundPosition: bottom ? 'left top' : 'left bottom',
        backgroundRepeat: 'repeat-x',
        backgroundSize: '10px 10px',
      }}
    />
  );
}

export function Rule({ dashed = false }: { dashed?: boolean }) {
  return (
    <div
      className={`my-3 border-t ${dashed ? 'border-dashed border-pixel-gray/70' : 'border-t-2 border-pixel-black'}`}
    />
  );
}

export function BracketButton({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`font-pixel text-xs uppercase tracking-wide disabled:opacity-40 ${
        danger ? 'text-pixel-red hover:bg-pixel-red' : 'text-pixel-black hover:bg-pixel-black'
      } px-1 hover:text-pixel-white disabled:hover:bg-transparent ${
        danger ? 'disabled:hover:text-pixel-red' : 'disabled:hover:text-pixel-black'
      }`}
    >
      [ {children} ]
    </button>
  );
}
