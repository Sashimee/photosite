import { getTranslations } from 'next-intl/server';

import { DIRECT_TAKEDOWN_TARGET_TYPES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { DirectTakedownSearchParams } from './direct-takedown-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

// A plain GET form, like the queue's own filters: submitting it reloads this
// page with the new query string, which `page.tsx` uses to look the slug up.
export async function DirectTakedownLookupForm({ targetType, slug }: DirectTakedownSearchParams) {
  const t = await getTranslations('admin.moderation.directTakedown.form');
  const tTargetTypes = await getTranslations('admin.moderation.targetTypes');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="direct-takedown-target-type">{t('targetTypeLabel')}</Label>
        <select
          id="direct-takedown-target-type"
          name="targetType"
          defaultValue={targetType}
          className={SELECT_CLASSNAME}
        >
          {DIRECT_TAKEDOWN_TARGET_TYPES.map((value) => (
            <option key={value} value={value}>
              {tTargetTypes(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:min-w-64 sm:flex-1">
        <Label htmlFor="direct-takedown-slug">{t('slugLabel')}</Label>
        <Input
          id="direct-takedown-slug"
          name="slug"
          defaultValue={slug ?? ''}
          placeholder={t('slugPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('slugHint')}</p>
      </div>

      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}
