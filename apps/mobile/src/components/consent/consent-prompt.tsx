import { View } from 'react-native';

import { useConsent } from '../../lib/consent-context';
import { ConsentPanel } from './consent-panel';

const NONE = { analytics: false, adsMarketing: false };

export function ConsentPrompt() {
  const { promptVisible, decide } = useConsent();

  if (!promptVisible) {
    return null;
  }

  return (
    <View
      testID="consent-prompt"
      className="absolute inset-0 bg-background"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <ConsentPanel
        initial={NONE}
        onDecide={(categories) => {
          void decide(categories);
        }}
      />
    </View>
  );
}
