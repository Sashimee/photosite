import { getTranslations } from 'next-intl/server';

import { serverApi } from '@/lib/server-api';

import { DirectTakedownLookupForm } from './direct-takedown-lookup-form';
import { DirectTakedownResult } from './direct-takedown-result';
import {
  parseDirectTakedownSearchParams,
  type DirectTakedownTargetType,
  type RawDirectTakedownSearchParams,
} from './direct-takedown-search-params';

interface LookedUpTarget {
  targetId: string;
  targetLabel: string;
  slug: string;
}

// Only published/open content resolves through these public endpoints, so a
// slug that is already taken down 404s here exactly like one that never
// existed - which is correct: taking it down again isn't the next step, a
// restore from the moderation queue is (docs/steps/1D.6-moderation.md).
async function lookUp(
  api: Awaited<ReturnType<typeof serverApi>>,
  targetType: DirectTakedownTargetType,
  slug: string,
): Promise<LookedUpTarget | null> {
  if (targetType === 'photographer_profile') {
    const { data } = await api.GET('/v1/photographers/{slug}', { params: { path: { slug } } });
    return data ? { targetId: data.id, targetLabel: data.displayName, slug: data.slug } : null;
  }
  const { data } = await api.GET('/v1/job-offers/{slug}', { params: { path: { slug } } });
  return data ? { targetId: data.id, targetLabel: data.title, slug: data.slug } : null;
}

export default async function DirectTakedownPage({
  searchParams,
}: {
  searchParams: Promise<RawDirectTakedownSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseDirectTakedownSearchParams(raw);
  const t = await getTranslations('admin.moderation.directTakedown');

  const target = filters.slug
    ? await lookUp(await serverApi(), filters.targetType, filters.slug)
    : null;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <DirectTakedownLookupForm {...filters} />

      {filters.slug && !target ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-4" role="status">
          <p className="text-sm font-medium text-foreground">{t('notFound.title')}</p>
          <p className="text-sm text-muted-foreground">{t('notFound.description')}</p>
        </div>
      ) : null}

      {target ? (
        <DirectTakedownResult
          targetType={filters.targetType}
          targetId={target.targetId}
          targetLabel={target.targetLabel}
          slug={target.slug}
        />
      ) : null}
    </section>
  );
}
