/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 30000,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFiles: ['<rootDir>/jest/setup-env.js'],
  moduleNameMapper: {
    '\\.css$': '<rootDir>/jest/style-mock.js',
  },
  collectCoverage: true,
  // Scoped to app/ and src/ so root config files (babel.config.js,
  // metro.config.js, tailwind.config.js, app.config.ts) and jest/ test
  // helpers never enter the coverage denominator.
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'src/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 71,
      branches: 49,
      functions: 72,
      lines: 70,
    },
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|intl-messageformat|@formatjs))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
};
