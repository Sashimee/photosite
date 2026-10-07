import type { ExpoConfig } from 'expo/config';

const easProjectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: 'Photoo',
  slug: 'photoo',
  scheme: 'photoo',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'lu.photoo.app',
    supportsTablet: false,
    usesAppleSignIn: false,
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
  android: {
    package: 'lu.photoo.app',
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: [],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-status-bar',
    'expo-image',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    [
      'expo-location',
      {
        // Foreground-only: the "near me" search never runs in the background,
        // so the Always/background keys and the unrelated motion permission
        // are explicitly suppressed rather than left at the plugin's default.
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        locationWhenInUsePermission:
          'Photoo uses your location, rounded to about 1 km, only when you tap "Near me": to find photographers near you, or to set your request or studio location.',
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Photoo accesses your photos only when you choose one to attach to a message, add to your portfolio or use as a verification document.',
        cameraPermission:
          'Photoo uses the camera only when you take a photo to attach to a message or to capture a verification document.',
        microphonePermission: false,
      },
    ],
    'expo-document-picker',
    'expo-notifications',
    '@sentry/react-native',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ...(easProjectId
      ? {
          eas: {
            projectId: easProjectId,
          },
        }
      : {}),
  },
};

export default config;
