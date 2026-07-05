'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

interface UserMenuProps {
  onClose: () => void;
}

export function UserMenu({ onClose }: UserMenuProps) {
  const { user, logout } = useAuthStore();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/');
    onClose();
  };

  const handleProviders = () => {
    onClose();
    router.push('/settings/providers');
  };

  return (
    <div
      className="w-72 border border-pixel-black bg-pixel-white"
      style={{ boxShadow: '2px 2px 0px 0px #26221B' }}
    >
      <div className="border-b border-pixel-black bg-pixel-cream p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-pixel-black bg-pixel-yellow font-pixel text-xl">
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <p className="font-pixel text-base font-bold text-pixel-black">
              {user?.username || 'User'}
            </p>
            <p className="font-pixel text-xs text-pixel-black/50">{user?.email || ''}</p>
          </div>
        </div>
      </div>

      <div className="py-2">
        <button
          onClick={handleProviders}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-pixel-yellow/30"
        >
          <span className="text-lg">🔑</span>
          <div>
            <div className="font-pixel text-sm text-pixel-black">Provider settings</div>
            <div className="font-pixel text-xs text-pixel-black/50">Manage API keys</div>
          </div>
        </button>

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-pixel-red/20"
        >
          <span className="text-lg">🚪</span>
          <div>
            <div className="font-pixel text-sm text-pixel-red">Sign out</div>
            <div className="font-pixel text-xs text-pixel-black/50">Switch account</div>
          </div>
        </button>
      </div>
    </div>
  );
}
