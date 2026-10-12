import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];

export type OwnProfileState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; profile: OwnPhotographerProfile };

export function useOwnPhotographerProfile() {
  const [state, setState] = useState<OwnProfileState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .GET('/v1/me/photographer-profile')
      .then(({ data, response }) => {
        if (cancelled) {
          return;
        }
        if (data) {
          setState({ status: 'ready', profile: data });
        } else if (response.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (response.status === 404) {
          setState({ status: 'missing' });
        } else {
          setState({ status: 'error' });
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

  const replace = useCallback((profile: OwnPhotographerProfile) => {
    setState({ status: 'ready', profile });
  }, []);

  return { state, reload, replace };
}
