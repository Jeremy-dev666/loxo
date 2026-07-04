'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/auth';
import { UserMenu } from '@/components/user/UserMenu';
import { useDisplayMode } from '@/lib/display-mode';

interface HeaderProps {
  traditionalMode?: boolean;
  traditionalSidebarOpen?: boolean;
  traditionalSidebarWidth?: number;
}

function DisplayModeIcon({ mode }: { mode: 'professional' | 'traditional' }) {
  if (mode === 'traditional') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" shapeRendering="crispEdges">
        <path fill="currentColor" d="M3 3h5v18H3V3Zm7 2h11v4H10V5Zm0 6h5v4h-5v-4Zm7 0h4v4h-4v-4Zm-7 6h11v2H10v-2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" shapeRendering="crispEdges">
      <path fill="currentColor" d="M3 4h8v7H3V4Zm10 0h8v7h-8V4ZM3 13h8v7H3v-7Zm10 0h8v7h-8v-7Z" />
    </svg>
  );
}

function DisplayModeToggle() {
  const [displayMode, setDisplayMode] = useDisplayMode();
  const nextMode = displayMode === 'professional' ? 'traditional' : 'professional';

  return (
    <motion.button
      type="button"
      aria-label={nextMode === 'traditional' ? 'Switch to sidebar layout' : 'Switch to centered layout'}
      title={nextMode === 'traditional' ? 'Switch to sidebar layout' : 'Switch to centered layout'}
      onClick={() => setDisplayMode(nextMode)}
      whileHover={{ y: -1 }}
      whileTap={{ y: 1, scale: 0.96 }}
      className="hidden h-10 w-10 items-center justify-center border-2 border-pixel-white bg-pixel-black text-pixel-white transition-colors hover:border-pixel-yellow hover:text-pixel-yellow md:flex"
      style={{ boxShadow: '2px 2px 0px 0px #101010' }}
    >
      <DisplayModeIcon mode={displayMode} />
    </motion.button>
  );
}

/** Pixel swarm mark: three stacked hex-ish blocks. */
export function BrandMark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" shapeRendering="crispEdges">
      <path
        fill="currentColor"
        d="M9 2h6v4h4v6h-4v-4H9V2Zm-4 8h6v4h4v4h4v4h-6v-4H9v-4H5v-4Z"
      />
    </svg>
  );
}

export function Header({
  traditionalMode = false,
  traditionalSidebarOpen = false,
  traditionalSidebarWidth = 0,
}: HeaderProps) {
  const { user, token, hasHydrated } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const headerContentStyle =
    traditionalMode && traditionalSidebarOpen ? { paddingLeft: traditionalSidebarWidth } : undefined;
  const showHeaderBrand = !traditionalMode || !traditionalSidebarOpen;

  return (
    <header className={`border-b-4 border-pixel-white bg-pixel-black px-4 py-3 ${traditionalMode ? 'md:px-0' : ''}`}>
      <div
        className={
          traditionalMode
            ? `mx-0 flex w-full max-w-none items-center ${showHeaderBrand ? 'justify-between' : 'justify-end'} gap-6 px-6 transition-[padding] duration-300 ease-out xl:px-8`
            : 'mx-auto flex max-w-7xl items-center justify-between'
        }
        style={headerContentStyle}
      >
        {showHeaderBrand && (
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" className="flex min-w-0 items-center gap-4 no-underline">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center border-4 border-pixel-white bg-pixel-red">
                <BrandMark className="h-7 w-7 text-pixel-white" />
              </div>
              <h1 className="flex min-w-0 items-center gap-3">
                <span className="brand-large whitespace-nowrap !text-pixel-red">SwarmDev</span>
                <span className={`font-pixel !text-pixel-yellow ${traditionalMode ? 'hidden text-xl lg:inline' : 'text-xl'}`}>
                  AGENT TEAM PLATFORM
                </span>
              </h1>
            </Link>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-4">
          <DisplayModeToggle />

          {hasHydrated && user && token ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 border-2 border-pixel-white px-2 py-1 transition-colors hover:border-pixel-yellow"
              >
                <div className="flex h-8 w-8 items-center justify-center border-2 border-pixel-white bg-pixel-green">
                  <span className="font-pixel text-sm text-pixel-white">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="font-pixel text-sm text-pixel-white">{user.username}</span>
                <span className="text-pixel-white/50">▾</span>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full z-[180] mt-2">
                  <UserMenu onClose={() => setShowUserMenu(false)} />
                </div>
              )}
            </div>
          ) : hasHydrated ? (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="border-2 border-pixel-white bg-pixel-blue px-3 py-1 font-pixel text-sm text-pixel-white no-underline transition-colors hover:bg-pixel-green hover:text-pixel-black"
                style={{ boxShadow: '2px 2px 0px 0px #101010' }}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="border-2 border-pixel-white bg-pixel-green px-3 py-1 font-pixel text-sm text-pixel-black no-underline transition-colors hover:bg-pixel-yellow"
                style={{ boxShadow: '2px 2px 0px 0px #101010' }}
              >
                Sign up
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
