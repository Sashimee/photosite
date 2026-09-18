import { useTranslation } from 'react-i18next';

import { RequireSession } from '../../src/components/require-session';
import { TabPlaceholderScreen } from '../../src/components/tab-placeholder-screen';

export default function MessagesScreen() {
  const { t } = useTranslation();
  return (
    <RequireSession>
      <TabPlaceholderScreen title={t('mobile.tabs.messages')} />
    </RequireSession>
  );
}
