// Metro config for a pnpm + Turborepo monorepo.
//
// Expo (SDK 52+) auto-detects monorepos, but we set the two canonical options
// explicitly so resolution is predictable under pnpm's layout:
//   - watchFolders: watch the whole repo so Metro can read the symlinked
//     workspace packages (@platform/*) and their dependencies.
//   - nodeModulesPaths: resolve from the app first, then the workspace root.
// Expo's default config already enables symlink resolution. See:
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
