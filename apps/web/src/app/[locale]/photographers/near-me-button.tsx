'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { roundCoordinate } from '@/lib/search-params';

const NEAR_ME_RADIUS_KM = 25;

export function NearMeButton({ label, errorMessage }: { label: string; errorMessage: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'locating' | 'error'>('idle');

  function handleClick() {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams(searchParams);
        params.set('lat', String(roundCoordinate(position.coords.latitude)));
        params.set('lng', String(roundCoordinate(position.coords.longitude)));
        params.set('radiusKm', String(NEAR_ME_RADIUS_KM));
        params.delete('cursor');
        setStatus('idle');
        router.push(`${pathname}?${params.toString()}`);
      },
      () => {
        setStatus('error');
      },
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={status === 'locating'}
      >
        {label}
      </Button>
      {status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
