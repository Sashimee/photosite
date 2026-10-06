'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function CopyText({ value }: { value: string }) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="text-xs break-all text-foreground">{value}</code>
      <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}
