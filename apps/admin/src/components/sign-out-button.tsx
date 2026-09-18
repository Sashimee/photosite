'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { SIGN_IN_PATH } from '@/lib/sign-in-path';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await api.POST('/v1/auth/sign-out');
    router.push(SIGN_IN_PATH);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        void handleSignOut();
      }}
    >
      {label}
    </Button>
  );
}
