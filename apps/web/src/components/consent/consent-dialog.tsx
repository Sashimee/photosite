'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

import { useConsent } from './consent-provider';

export function ConsentDialog() {
  const t = useTranslations('web.consent.dialog');
  const tCategories = useTranslations('web.consent.categories');
  const { manageOpen, closeManage, decision, savePreferences } = useConsent();
  const [analytics, setAnalytics] = useState(false);
  const [adsMarketing, setAdsMarketing] = useState(false);

  useEffect(() => {
    if (manageOpen) {
      setAnalytics(decision?.categories.analytics ?? false);
      setAdsMarketing(decision?.categories.adsMarketing ?? false);
    }
  }, [manageOpen, decision]);

  return (
    <Dialog
      open={manageOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeManage();
        }
      }}
    >
      <DialogContent aria-describedby="consent-dialog-description">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription id="consent-dialog-description">{t('description')}</DialogDescription>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p id="consent-category-necessary" className="text-sm font-medium text-foreground">
              {tCategories('necessary.title')}
            </p>
            <p className="text-sm text-muted-foreground">{tCategories('necessary.description')}</p>
          </div>
          <Switch checked disabled aria-labelledby="consent-category-necessary" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p id="consent-category-analytics" className="text-sm font-medium text-foreground">
              {tCategories('analytics.title')}
            </p>
            <p className="text-sm text-muted-foreground">{tCategories('analytics.description')}</p>
          </div>
          <Switch
            checked={analytics}
            onChange={(event) => {
              setAnalytics(event.target.checked);
            }}
            aria-labelledby="consent-category-analytics"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p id="consent-category-ads-marketing" className="text-sm font-medium text-foreground">
              {tCategories('adsMarketing.title')}
            </p>
            <p className="text-sm text-muted-foreground">
              {tCategories('adsMarketing.description')}
            </p>
          </div>
          <Switch
            checked={adsMarketing}
            onChange={(event) => {
              setAdsMarketing(event.target.checked);
            }}
            aria-labelledby="consent-category-ads-marketing"
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              savePreferences({ analytics, adsMarketing });
            }}
          >
            {t('save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
