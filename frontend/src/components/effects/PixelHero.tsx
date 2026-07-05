'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BrandMark } from '@/components/layout/Header';

const NODE_COLORS = ['#4A5D7E', '#4A7A3D', '#A3402E', '#C77B1E', '#7A7265'];

/** Animated agent-network backdrop: nodes, edges, pulses, drifting particles. */
function NetworkGraph() {
  const nodes = useMemo(
    () =>
      Array.from({ length: 25 }).map((_, i) => ({
        id: i,
        x: 5 + Math.random() * 90,
        y: 5 + Math.random() * 90,
        size: 6 + Math.floor(Math.random() * 10),
        delay: Math.random() * 3,
        duration: 2 + Math.random() * 2,
        color: NODE_COLORS[Math.floor(Math.random() * NODE_COLORS.length)]!,
      })),
    []
  );

  const edges = useMemo(() => {
    const edgeList: Array<{ from: number; to: number; delay: number; color: string }> = [];
    for (let i = 0; i < nodes.length; i++) {
      const connections = 2 + Math.floor(Math.random() * 4);
      for (let j = 0; j < connections; j++) {
        const target = (i + 1 + Math.floor(Math.random() * (nodes.length - 1))) % nodes.length;
        if (!edgeList.some((e) => (e.from === i && e.to === target) || (e.from === target && e.to === i))) {
          edgeList.push({ from: i, to: target, delay: Math.random() * 2, color: Math.random() > 0.5 ? '#4A5D7E' : '#4A7A3D' });
        }
      }
    }
    return edgeList;
  }, [nodes]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(16,16,16,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(16,16,16,0.5) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <svg className="absolute inset-0 h-full w-full" style={{ opacity: 0.2 }}>
        <defs>
          <linearGradient id="edgeGradientBlue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4A5D7E" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#4A5D7E" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="edgeGradientGreen" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4A7A3D" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#4A7A3D" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {edges.map((edge, i) => {
          const from = nodes[edge.from]!;
          const to = nodes[edge.to]!;
          const gradientId = edge.color === '#4A5D7E' ? 'edgeGradientBlue' : 'edgeGradientGreen';
          return (
            <motion.line
              key={i}
              x1={`${from.x}%`}
              y1={`${from.y}%`}
              x2={`${to.x}%`}
              y2={`${to.y}%`}
              stroke={`url(#${gradientId})`}
              strokeWidth="1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.2, 0.6, 0.2] }}
              transition={{ duration: 3, delay: edge.delay, repeat: Infinity }}
            />
          );
        })}
      </svg>

      {nodes.map((node) => (
        <motion.div
          key={node.id}
          className="absolute rounded-full"
          style={{
            left: `${node.x}%`,
            top: `${node.y}%`,
            width: node.size,
            height: node.size,
            backgroundColor: node.color,
            transform: 'translate(-50%, -50%)',
          }}
          animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
          transition={{ duration: node.duration, delay: node.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {nodes.slice(0, 10).map((node, i) => (
        <motion.div
          key={`pulse-${i}`}
          className="absolute rounded-full border"
          style={{
            left: `${node.x}%`,
            top: `${node.y}%`,
            width: 16,
            height: 16,
            borderColor: node.color,
            transform: 'translate(-50%, -50%)',
          }}
          animate={{ scale: [1, 4], opacity: [0.5, 0] }}
          transition={{ duration: 2.5, delay: i * 0.3, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {Array.from({ length: 40 }).map((_, i) => (
        <motion.div
          key={`particle-${i}`}
          className="absolute h-1 w-1 rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            backgroundColor: NODE_COLORS[Math.floor(Math.random() * 4)],
          }}
          animate={{ y: [-20, 20], x: [-10, 10, -10], opacity: [0, 0.6, 0] }}
          transition={{ duration: 4 + Math.random() * 4, delay: Math.random() * 5, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

interface PixelHeroProps {
  onEnter: () => void;
}

/** Full-screen intro shown once per session before the dashboard. */
export function PixelHero({ onEnter }: PixelHeroProps) {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowButton(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden bg-pixel-white"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <NetworkGraph />

      <motion.div
        className="relative z-10 text-center"
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 15, delay: 0.15 }}
      >
        <motion.div
          className="relative inline-block"
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div
            className="mx-auto flex h-[120px] w-[120px] items-center justify-center border border-pixel-black bg-pixel-red"
            style={{ boxShadow: '6px 6px 0 #26221B' }}
          >
            <BrandMark className="h-16 w-16 text-pixel-white" />
          </div>
        </motion.div>

        <motion.h1
          className="brand-large mt-4 text-pixel-blue"
          style={{ textShadow: '1px 1px 0 rgba(58, 91, 160, 0.1)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          Welcome to SwarmDev
        </motion.h1>

        <motion.p
          className="mt-2 font-pixel text-lg tracking-widest text-pixel-blue/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
        >
          WELCOME TO AGENT WORLD
        </motion.p>

        <motion.div
          className="mt-5 flex flex-col items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <div className="relative h-2.5 w-44 overflow-hidden border border-pixel-blue/25 bg-pixel-white">
            <motion.div
              className="h-full bg-pixel-green"
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ delay: 0.9, duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <p className="mt-2 font-pixel text-xs text-pixel-black/30">Loading...</p>
        </motion.div>

        {showButton && (
          <motion.button
            onClick={onEnter}
            className="pointer-events-auto mt-5 border border-pixel-black bg-pixel-blue px-5 py-2.5 font-pixel text-base text-pixel-white transition-all duration-150 hover:bg-pixel-yellow hover:text-pixel-black"
            style={{ boxShadow: '4px 4px 0px rgba(16,16,16,0.12)' }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.95 }}
          >
            <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
              ▶ ENTER ▷
            </motion.span>
          </motion.button>
        )}
      </motion.div>

      <motion.p
        className="absolute bottom-5 font-pixel text-xs text-pixel-black/15"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        SWARMDEV v0.1.0
      </motion.p>
    </motion.div>
  );
}
