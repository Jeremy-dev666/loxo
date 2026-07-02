'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth';

/** Redirects unauthenticated visitors to /login once the store has hydrated. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && !token) {
      router.replace('/login');
    }
  }, [hasHydrated, token, router]);

  if (!hasHydrated || !token) return null;
  return <>{children}</>;
}
