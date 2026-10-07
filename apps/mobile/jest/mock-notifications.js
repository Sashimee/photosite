/* global jest */
// Plain functions, not jest.fn: suites that call jest.resetAllMocks() would wipe
// jest.fn implementations and break every render that touches these hooks.
jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getPermissionsAsync: () =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true, granted: false }),
  requestPermissionsAsync: () =>
    Promise.resolve({ status: 'denied', canAskAgain: false, granted: false }),
  getExpoPushTokenAsync: () => Promise.resolve({ data: 'ExponentPushToken[test]' }),
  getLastNotificationResponse: () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  setBadgeCountAsync: () => Promise.resolve(true),
}));
