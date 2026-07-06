'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { PixelButton } from '@/components/ui/PixelButton';
import { PixelInput } from '@/components/ui/PixelInput';
import { BrandMark } from '@/components/layout/Header';
import { ApiError, login, register } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

function PixelStar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="0" width="2" height="16" fill="#111111" />
      <rect x="0" y="7" width="16" height="2" fill="#111111" />
      <rect x="2" y="2" width="2" height="2" fill="#111111" />
      <rect x="12" y="2" width="2" height="2" fill="#111111" />
      <rect x="2" y="12" width="2" height="2" fill="#111111" />
      <rect x="12" y="12" width="2" height="2" fill="#111111" />
    </svg>
  );
}

function FloatingMark({
  top,
  left,
  right,
  delay,
  tone,
}: {
  top: string;
  left?: string;
  right?: string;
  delay: number;
  tone: string;
}) {
  return (
    <motion.div
      className="absolute"
      style={{ top, left, right }}
      animate={{ y: [0, -10, 0], opacity: [0.35, 0.6, 0.35] }}
      transition={{ duration: 3.5, repeat: Infinity, delay, ease: 'easeInOut' }}
    >
      <span className={`flex h-9 w-9 items-center justify-center border border-pixel-black ${tone}`}>
        <BrandMark className="h-5 w-5 text-pixel-white" />
      </span>
    </motion.div>
  );
}

const FLOATING_MARKS = [
  { top: '8%', left: '15%', delay: 0, tone: 'bg-pixel-blue' },
  { top: '12%', right: '12%', delay: 1.2, tone: 'bg-pixel-green' },
  { top: '30%', left: '4%', delay: 0.7, tone: 'bg-pixel-red' },
  { top: '20%', right: '5%', delay: 1.8, tone: 'bg-pixel-yellow' },
  { top: '48%', left: '6%', delay: 2.5, tone: 'bg-pixel-green' },
  { top: '55%', right: '4%', delay: 0.4, tone: 'bg-pixel-blue' },
  { top: '68%', left: '10%', delay: 1.1, tone: 'bg-pixel-yellow' },
];

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const { token, user, setSession } = useAuthStore();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === 'register';
  const title = isRegister ? 'SIGN UP' : 'SIGN IN';

  useEffect(() => {
    if (token && user) router.push('/');
  }, [token, user, router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim() || (isRegister && !username.trim())) {
      setError('Fill in all fields first.');
      return;
    }
    if (isRegister && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (isRegister && username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const result = isRegister
        ? await register({ email: email.trim(), username: username.trim(), password })
        : await login({ email: email.trim(), password });
      setSession(result.token, result.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed — try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[60vh] items-center justify-center overflow-hidden py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <PixelStar className="absolute left-[8%] top-[10%] h-4 w-4 animate-pulse" style={{ animationDuration: '2s' }} />
        <PixelStar className="absolute right-[12%] top-[15%] h-3 w-3 animate-pulse" style={{ animationDuration: '3s' }} />
        <PixelStar className="absolute bottom-[20%] left-[5%] h-5 w-5 animate-pulse" style={{ animationDuration: '2.5s' }} />
        <PixelStar className="absolute bottom-[30%] right-[8%] h-3 w-3 animate-pulse" style={{ animationDuration: '1.8s' }} />
        <PixelStar className="absolute right-[5%] top-[40%] h-4 w-4 animate-pulse" style={{ animationDuration: '3.5s' }} />
        <PixelStar className="absolute left-[3%] top-[60%] h-3 w-3 animate-pulse" style={{ animationDuration: '2.2s' }} />

        {FLOATING_MARKS.map((mark, i) => (
          <FloatingMark key={i} {...mark} />
        ))}

        <motion.div
          className="pointer-events-none absolute bottom-[2%] right-[2%] opacity-[0.06]"
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <BrandMark className="h-[280px] w-[280px] text-pixel-black" />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="border border-pixel-black bg-pixel-white" style={{ boxShadow: '3px 3px 0px 0px rgba(17,17,17,0.10)' }}>
          <div
            className={`flex items-center justify-center gap-3 border-b border-pixel-black p-3 text-center font-pixel text-xl text-pixel-white ${
              isRegister ? 'bg-pixel-green' : 'bg-pixel-red'
            }`}
          >
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 1.5, repeat: Infinity }}>
              <BrandMark className="h-6 w-6" />
            </motion.div>
            {title}
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.75 }}>
              <BrandMark className="h-6 w-6" />
            </motion.div>
          </div>

          <div className="mb-2 mt-4 flex justify-center">
            <motion.div
              animate={{ y: [0, -10, 0], rotate: [0, 4, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div
                className="flex h-20 w-20 items-center justify-center border border-pixel-black bg-pixel-red"
                style={{ filter: 'drop-shadow(4px 4px 0px rgba(17,17,17,0.10))' }}
              >
                <BrandMark className="h-11 w-11 text-pixel-white" />
              </div>
            </motion.div>
          </div>

          <p className="mb-4 px-4 text-center font-pixel text-xs text-pixel-black/50">
            {isRegister ? 'Join the swarm — set sail with your agents!' : 'Welcome back, captain!'}
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="mx-4 mb-4 border border-pixel-red bg-pixel-red/10 p-3"
            >
              <p className="font-pixel text-sm text-pixel-red">{error}</p>
            </motion.div>
          )}

          <form onSubmit={onSubmit} className="space-y-4 px-4 pb-4">
            <div>
              <label className="mb-1 block font-pixel text-sm text-pixel-black">EMAIL</label>
              <PixelInput value={email} onChange={setEmail} placeholder="your@email.com" type="email" />
            </div>

            {isRegister && (
              <div>
                <label className="mb-1 block font-pixel text-sm text-pixel-black">USERNAME</label>
                <PixelInput value={username} onChange={setUsername} placeholder="captain" />
              </div>
            )}

            <div>
              <label className="mb-1 block font-pixel text-sm text-pixel-black">PASSWORD</label>
              <PixelInput value={password} onChange={setPassword} placeholder="********" type="password" />
            </div>

            <PixelButton type="submit" variant="primary" size="lg" disabled={submitting} className="mt-2 w-full">
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="inline-block h-4 w-4 rounded-full border border-pixel-white border-t-transparent"
                  />
                  {isRegister ? 'Signing up…' : 'Signing in…'}
                </span>
              ) : (
                title
              )}
            </PixelButton>
          </form>

          <div className="mt-2 pb-4 text-center">
            <p className="font-pixel text-sm text-pixel-black/60">
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <Link href={isRegister ? '/login' : '/register'} className="text-pixel-blue hover:underline">
                {isRegister ? 'Sign in' : 'Sign up now'}
              </Link>
            </p>
          </div>

          <div className="pb-4 text-center">
            <Link href="/" className="font-pixel text-xs text-pixel-black/40 hover:text-pixel-black/60">
              Back to home
            </Link>
          </div>
        </div>

        <motion.p
          className="mt-4 text-center font-pixel text-xs text-pixel-black/40"
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          INSERT COIN TO PLAY
        </motion.p>
      </motion.div>
    </div>
  );
}
