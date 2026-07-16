'use client';

import { ReactNode } from 'react';

interface PixelCardProps {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  className?: string;
  hoverable?: boolean;
}

export function PixelCard({
  children,
  title,
  onClick,
  className = '',
  hoverable = true,
}: PixelCardProps) {
  return (
    <div
      onClick={onClick}
      className={`flex min-h-0 flex-col border border-pixel-line bg-pixel-white transition-colors duration-100 ${
        onClick ? 'cursor-pointer' : ''
      } ${hoverable ? 'hover:border-pixel-yellow' : ''} ${className}`}
      style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
    >
      {title && (
        <div className="flex items-center gap-2 border-b border-pixel-line bg-pixel-cream px-3 py-1.5">
          <span className="h-3 w-1 bg-pixel-yellow" aria-hidden />
          <span className="font-sans text-xs uppercase tracking-wide text-pixel-black">{title}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
    </div>
  );
}
