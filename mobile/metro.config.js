const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// LiveKit currently imports event-target-shim with a deep subpath that triggers
// noisy exports warnings in Metro. Disabling package exports avoids the warning
// fallback spam while preserving runtime behavior for this app.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
