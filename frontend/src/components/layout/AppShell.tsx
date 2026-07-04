'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/agents', label: 'Agents' },
  { href: '/teams', label: 'Teams' },
  { href: '/projects', label: 'Projects' },
  { href: '/market', label: 'Market' },
  { href: '/roundtable', label: 'Roundtable' },
  { href: '/community', label: 'Community' },
  { href: '/settings/providers', label: 'Providers' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, hasHydrated, logout } = useAuthStore();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-panel">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-semibold tracking-tight text-accent">
              SwarmDev
            </Link>
            <nav className="flex gap-4 text-sm">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    pathname === item.href
                      ? 'text-slate-100'
                      : 'text-slate-400 transition-colors hover:text-slate-100'
                  }
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {hasHydrated && user ? (
              <>
                <span className="text-slate-300">{user.username}</span>
                <button
                  onClick={logout}
                  className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-500"
                >
                  Sign out
                </button>
              </>
            ) : hasHydrated ? (
              <>
                <Link href="/login" className="text-slate-300 hover:text-slate-100">
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="rounded bg-accent px-3 py-1 font-medium text-slate-900 hover:opacity-90"
                >
                  Sign up
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
