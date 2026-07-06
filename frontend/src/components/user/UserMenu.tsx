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
      className="w-72 rounded-sm border border-[#E4E4E4] bg-white"
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
    >
      <div className="border-b border-[#F0F0F0] bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-sm bg-[#111] text-white font-pixel text-xl">
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
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F5F5F5]"
        >
          <span className="text-lg">🔑</span>
          <div>
            <div className="font-pixel text-sm text-pixel-black">Provider settings</div>
            <div className="font-pixel text-xs text-pixel-black/50">Manage API keys</div>
          </div>
        </button>

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F5F5F5]"
        >
          <span className="text-lg">🚪</span>
          <div>
            <div className="font-pixel text-sm text-[#111]">Sign out</div>
            <div className="font-pixel text-xs text-pixel-black/50">Switch account</div>
          </div>
        </button>
      </div>
    </div>
  );
}
