import Link from 'next/link';

import { getMessages } from '@photoo/i18n';
import { DEFAULT_LOCALE } from '@photoo/shared';

const messages = getMessages(DEFAULT_LOCALE).web.notFound;

export const dynamic = 'force-dynamic';

export default function RootNotFound() {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <section style={{ maxWidth: 480, margin: '6rem auto', textAlign: 'center' }}>
          <h1>{messages.title}</h1>
          <p>{messages.description}</p>
          <Link href={`/${DEFAULT_LOCALE}`}>{messages.backHome}</Link>
        </section>
      </body>
    </html>
  );
}
