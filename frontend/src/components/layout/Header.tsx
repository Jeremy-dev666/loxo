'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { UserMenu } from '@/components/user/UserMenu';

interface HeaderProps {
  traditionalMode?: boolean;
  traditionalSidebarOpen?: boolean;
  traditionalSidebarWidth?: number;
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
    <header className={`border-b border-pixel-black bg-pixel-white px-4 py-2 ${traditionalMode ? 'md:px-0' : ''}`}>
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
            <Link href="/" className="flex min-w-0 items-center gap-3 no-underline">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-[#111]">
                <BrandMark className="h-5 w-5 text-white" />
              </div>
              <h1 className="flex min-w-0 items-baseline gap-3">
                <span className="brand-large whitespace-nowrap !text-pixel-black">SwarmDev</span>
                <span className={`font-pixel uppercase tracking-widest !text-pixel-gray ${traditionalMode ? 'hidden text-xs lg:inline' : 'text-xs'}`}>
                  Agent team platform
                </span>
              </h1>
            </Link>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-4">
          {hasHydrated && user && token ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 rounded-sm border border-[#E4E4E4] bg-white px-2 py-1 transition-colors hover:border-[#111]"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-[#111]">
                  <span className="font-pixel text-xs text-white">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="font-pixel text-sm text-pixel-black">{user.username}</span>
                <span className="text-pixel-gray">▾</span>
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
                className="rounded-sm border border-[#111] bg-white px-3 py-1 font-pixel text-sm uppercase text-[#111] no-underline transition-colors hover:bg-[#F5F5F5]"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-sm border border-[#111] bg-[#111] px-3 py-1 font-pixel text-sm uppercase text-white no-underline transition-colors hover:bg-[#333]"
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
