import { useTranslation } from 'react-i18next';

import { TabPlaceholderScreen } from '../../src/components/tab-placeholder-screen';

export default function AccountScreen() {
  const { t } = useTranslation();
  return <TabPlaceholderScreen title={t('mobile.tabs.account')} />;
}
