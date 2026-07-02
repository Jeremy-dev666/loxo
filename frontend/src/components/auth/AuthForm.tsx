'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, login, register } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result =
        mode === 'register'
          ? await register({ email, username, password })
          : await login({ email, password });
      setSession(result.token, result.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-16 w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">
        {mode === 'register' ? 'Create your account' : 'Sign in'}
      </h1>
      <input
        className={inputClass}
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {mode === 'register' && (
        <input
          className={inputClass}
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          maxLength={32}
          required
        />
      )}
      <input
        className={inputClass}
        type="password"
        placeholder={mode === 'register' ? 'Password (8+ characters)' : 'Password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={mode === 'register' ? 8 : 1}
        required
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-accent py-2 font-medium text-slate-900 disabled:opacity-60"
      >
        {submitting ? 'Please wait…' : mode === 'register' ? 'Sign up' : 'Sign in'}
      </button>
    </form>
  );
}
