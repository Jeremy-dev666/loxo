'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

interface BackButtonProps {
  href?: string;
  label?: string;
  onClick?: () => void;
}

export function BackButton({ href = '/', label = 'Home', onClick }: BackButtonProps) {
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="mb-6">
      <Link
        href={href}
        onClick={onClick}
        className="inline-flex items-center gap-2 border border-pixel-line bg-pixel-white px-4 py-2 font-pixel text-pixel-black no-underline transition-colors hover:bg-pixel-cream"
        style={{ boxShadow: '2px 2px 0px 0px rgba(17,17,17,0.10)' }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
        {label}
      </Link>
    </motion.div>
  );
}
