'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { BackButton } from '@/components/ui/BackButton';
import { PixelButton } from '@/components/ui/PixelButton';
import { PixelInput } from '@/components/ui/PixelInput';
import { createTeam } from '@/lib/teams';

function CreateTeamInner() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const team = await createTeam({ name: name.trim(), description: description.trim() || undefined });
      router.push(`/teams/${team.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 pb-16">
      <BackButton href="/teams" label="My Teams" />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
        <h1 className="brand-large mb-2 text-pixel-black">Create a Team</h1>
        <p className="font-pixel text-xl text-pixel-blue">ASSEMBLE YOUR CREW</p>
        <p className="mt-2 font-pixel text-sm text-pixel-black/60">
          Name the team first — then design its workflow on the canvas or generate one from plain language.
        </p>
      </motion.div>

      <div className="space-y-5 border border-pixel-black bg-pixel-white p-5" style={{ boxShadow: '6px 6px 0 #26221B' }}>
        <div>
          <label className="mb-1 block font-pixel text-sm text-pixel-black">Team name</label>
          <PixelInput value={name} onChange={setName} placeholder="Product delivery squad" />
        </div>
        <div>
          <label className="mb-1 block font-pixel text-sm text-pixel-black">Description (optional)</label>
          <PixelInput
            value={description}
            onChange={setDescription}
            placeholder="What does this team ship?"
            multiline
            rows={3}
          />
        </div>

        {error && (
          <div className="border border-pixel-red bg-pixel-red/10 p-3">
            <p className="font-pixel text-sm text-pixel-red">{error}</p>
          </div>
        )}

        <PixelButton variant="primary" size="lg" className="w-full" disabled={creating || !name.trim()} onClick={() => void submit()}>
          {creating ? 'Creating…' : 'Create and open the canvas'}
        </PixelButton>
      </div>

      <p className="mt-4 text-center font-pixel text-xs text-pixel-black/40">
        Want a ready-made crew instead?{' '}
        <Link href="/market?tab=team-templates" className="text-pixel-blue">
          Adopt a team template →
        </Link>
      </p>
    </div>
  );
}

export default function CreateTeamPage() {
  return (
    <RequireAuth>
      <CreateTeamInner />
    </RequireAuth>
  );
}
