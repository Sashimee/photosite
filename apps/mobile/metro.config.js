const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// expo-router turns every file under app/ into a route, so co-located tests
// would otherwise be bundled into release builds and pull in node-only modules.
config.resolver.blockList = [].concat(
  config.resolver.blockList ?? [],
  /[/\\]app[/\\].*\.test\.[jt]sx?$/,
);

module.exports = withNativeWind(config, { input: './global.css' });
