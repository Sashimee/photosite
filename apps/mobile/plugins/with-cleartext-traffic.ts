import type { ConfigPlugin } from 'expo/config-plugins';
import { withAndroidManifest } from 'expo/config-plugins';

type Manifest = Parameters<Parameters<typeof withAndroidManifest>[1]>[0]['modResults'];

export function enableCleartextTraffic(manifest: Manifest): Manifest {
  const application = manifest.manifest.application?.[0];
  if (!application) {
    throw new Error(
      'AndroidManifest.xml has no <application> element to allow cleartext traffic on',
    );
  }
  application.$['android:usesCleartextTraffic'] = 'true';
  return manifest;
}

const withCleartextTraffic: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = enableCleartextTraffic(mod.modResults);
    return mod;
  });

export default withCleartextTraffic;
