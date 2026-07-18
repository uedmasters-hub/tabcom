// Metro config for a pnpm monorepo.
//
// Two things break Expo-in-a-monorepo if missed:
//   1. Metro doesn't watch outside the app dir by default, so edits to
//      packages/shared would not trigger reloads -> watchFolders.
//   2. pnpm's symlinked node_modules confuses Metro's resolver ->
//      nodeModulesPaths covers both the app's and the root's stores.
//
// If you hit "Unable to resolve module" errors for transitive deps
// after this, the escape hatch is a root .npmrc with
// `node-linker=hoisted` — but try without it first; SDK 57 handles
// isolated installs fine in most cases.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./global.css" });
