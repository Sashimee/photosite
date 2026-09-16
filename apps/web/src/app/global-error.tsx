'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { getMessages } from '@photoo/i18n';
import { DEFAULT_LOCALE } from '@photoo/shared';

const messages = getMessages(DEFAULT_LOCALE).web.globalError;
const common = getMessages(DEFAULT_LOCALE).common;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <section style={{ maxWidth: 480, margin: '6rem auto', textAlign: 'center' }}>
          <h1>{messages.title}</h1>
          <p>{messages.description}</p>
          <button
            type="button"
            onClick={() => {
              reset();
            }}
          >
            {common.retry}
          </button>
        </section>
      </body>
    </html>
  );
}
