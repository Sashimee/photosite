import { getTranslations } from 'next-intl/server';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

type ProfileLinksData = components['schemas']['ProfileLinks'];

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function ProfileLinks({ links, locale }: { links: ProfileLinksData; locale: Locale }) {
  const urls = [
    links.instagram,
    links.website,
    links.behance,
    ...links.other.map((link) => link.url),
  ].filter((url): url is string => Boolean(url));

  if (urls.length === 0) {
    return null;
  }

  const t = await getTranslations({ locale, namespace: 'web.profile' });

  return (
    <section>
      <h2 className="text-xl font-semibold text-foreground">{t('linksHeading')}</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {urls.map((url) => (
          <li key={url}>
            <a
              href={url}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {hostname(url)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
