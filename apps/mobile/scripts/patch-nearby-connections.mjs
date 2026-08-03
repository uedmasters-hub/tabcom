/**
 * expo-nearby-connections@1.1.0 ships `apply from: './fix-prefab.gradle'`
 * but omits that file from the npm `files` list, so Android Gradle fails.
 * Copy the identical script from react-native-nitro-modules after install.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function resolvePackageRoot(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    // Some packages block package.json via "exports" — resolve main then walk up.
    const main = require.resolve(name);
    let dir = dirname(main);
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, "package.json"))) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
          if (pkg.name === name) return dir;
        } catch {
          /* continue */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`Could not resolve package root for ${name}`);
  }
}

try {
  const nearbyRoot = resolvePackageRoot("expo-nearby-connections");
  const dest = join(nearbyRoot, "android", "fix-prefab.gradle");
  if (existsSync(dest)) {
    process.exit(0);
  }

  let src = null;
  try {
    const nitroRoot = resolvePackageRoot("react-native-nitro-modules");
    src = join(nitroRoot, "android", "fix-prefab.gradle");
  } catch {
    // Monorepo fallbacks
    const candidates = [
      join(here, "../../../node_modules/react-native-nitro-modules/android/fix-prefab.gradle"),
      join(here, "../../node_modules/react-native-nitro-modules/android/fix-prefab.gradle"),
    ];
    src = candidates.find((p) => existsSync(p)) ?? null;
  }

  if (!src || !existsSync(src)) {
    console.warn(
      "[tabcom] react-native-nitro-modules fix-prefab.gradle missing — Nearby Android build may fail"
    );
    process.exit(0);
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("[tabcom] restored expo-nearby-connections/android/fix-prefab.gradle");
} catch (err) {
  console.warn("[tabcom] nearby prefab patch skipped:", err?.message ?? err);
}
