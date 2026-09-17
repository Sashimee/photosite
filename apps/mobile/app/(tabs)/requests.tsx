import { useTranslation } from 'react-i18next';

import { TabPlaceholderScreen } from '../../src/components/tab-placeholder-screen';

export default function RequestsScreen() {
  const { t } = useTranslation();
  return <TabPlaceholderScreen title={t('mobile.tabs.requests')} />;
}
