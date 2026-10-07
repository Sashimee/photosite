import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];

export type VerificationState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'missingProfile' }
  | { status: 'countryUnavailable' }
  | { status: 'error' }
  | {
      status: 'ready';
      requirements: RequiredDocument[];
      verificationCase: VerificationCase | null;
    };

export function useVerificationCase() {
  const [state, setState] = useState<VerificationState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<VerificationState> {
      const profile = await api.GET('/v1/me/photographer-profile');
      if (profile.response.status === 401) {
        return { status: 'unauthorized' };
      }
      if (profile.response.status === 404) {
        return { status: 'missingProfile' };
      }
      if (!profile.data) {
        return { status: 'error' };
      }

      const requirements = await api.GET('/v1/countries/{code}/verification-requirements', {
        params: { path: { code: profile.data.countryCode } },
      });
      if (requirements.response.status === 404) {
        return { status: 'countryUnavailable' };
      }
      if (!requirements.data) {
        return { status: 'error' };
      }

      const current = await api.GET('/v1/me/verification-case');
      if (current.response.status === 401) {
        return { status: 'unauthorized' };
      }
      if (!current.data && current.response.status !== 404) {
        return { status: 'error' };
      }
      return {
        status: 'ready',
        requirements: requirements.data.documents,
        verificationCase: current.data ?? null,
      };
    }

    setState({ status: 'loading' });
    load()
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const replaceCase = useCallback((verificationCase: VerificationCase) => {
    setState((current) =>
      current.status === 'ready' ? { ...current, verificationCase } : current,
    );
  }, []);

  const attachDocument = useCallback((document: VerificationDocument) => {
    setState((current) => {
      if (current.status !== 'ready' || !current.verificationCase) {
        return current;
      }
      return {
        ...current,
        verificationCase: {
          ...current.verificationCase,
          documents: [
            ...current.verificationCase.documents.filter(
              (existing) => existing.documentKey !== document.documentKey,
            ),
            document,
          ],
        },
      };
    });
  }, []);

  return { state, reload, replaceCase, attachDocument };
}
