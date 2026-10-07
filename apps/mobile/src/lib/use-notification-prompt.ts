import { useCallback, useEffect, useState } from 'react';

import {
  dismissPrompt,
  getPushPermission,
  isPromptDismissed,
  registerPushDevice,
  requestPushPermission,
} from './push';

export function useNotificationPrompt(hasMessages: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasMessages) {
      return;
    }
    let cancelled = false;
    void Promise.all([getPushPermission(), isPromptDismissed()])
      .then(([permission, dismissed]) => {
        if (!cancelled) {
          setVisible(permission === 'undetermined' && !dismissed);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hasMessages]);

  const enable = useCallback(async () => {
    setVisible(false);
    await dismissPrompt();
    if (await requestPushPermission()) {
      await registerPushDevice();
    }
  }, []);

  const dismiss = useCallback(async () => {
    setVisible(false);
    await dismissPrompt();
  }, []);

  return { visible, enable, dismiss };
}
