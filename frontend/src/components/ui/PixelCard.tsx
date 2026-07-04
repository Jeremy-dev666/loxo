'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';

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
    <motion.div
      whileHover={hoverable ? { scale: 1.02 } : {}}
      onClick={onClick}
      className={`flex min-h-0 flex-col border-4 border-pixel-black bg-pixel-white ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      style={{ boxShadow: '6px 6px 0px 0px #101010' }}
    >
      {title && (
        <div className="border-b-4 border-pixel-black bg-pixel-blue p-2 font-pixel text-lg text-pixel-white">
          {title}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </motion.div>
  );
}
