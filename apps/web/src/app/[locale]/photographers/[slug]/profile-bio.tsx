import type { Locale } from '@photoo/shared';

import { resolveLocalizedText, type LocalizedText } from '@/lib/localized-text';

export function ProfileBio({ bio, locale }: { bio: LocalizedText; locale: Locale }) {
  const resolved = resolveLocalizedText(bio, locale);
  if (!resolved) {
    return null;
  }

  return (
    <section>
      <p
        className="whitespace-pre-line text-foreground"
        {...(resolved.locale !== locale ? { lang: resolved.locale } : {})}
      >
        {resolved.text}
      </p>
    </section>
  );
}
