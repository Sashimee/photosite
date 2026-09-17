'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function DirectQuoteButton({
  locale,
  slug,
  productId,
  tierId,
  label,
}: {
  locale: Locale;
  slug: string;
  productId: string;
  tierId: string;
  label: string;
}) {
  const t = useTranslations('web.requests.new.directQuote');
  const tErrors = useTranslations('web.quotes');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const { data, error: apiError } = await api.POST(
        '/v1/photographers/{slug}/products/{productId}/quotes',
        { params: { path: { slug, productId } }, body: { productTierId: tierId } },
      );
      if (apiError) {
        setError(requestErrorMessage(tErrors, apiError));
        return;
      }
      router.push(`/${locale}/quotes/${data.id}`);
    } catch {
      setError(requestErrorMessage(tErrors, undefined));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void handleClick()}
      >
        {pending ? t('sending') : label}
      </Button>
      <FieldError id={`direct-quote-error-${tierId}`} message={error ?? undefined} />
    </div>
  );
}
