#!/bin/bash
set -e

# Run from your monorepo root (where package.json / pnpm-workspace.yaml live).

echo "== 1. Install deps (root, so the workspace links resolve) =="
pnpm install

echo "== 2. Typecheck both packages before building =="
(cd apps/backend && pnpm exec tsc --noEmit)
(cd apps/extension && pnpm exec tsc --noEmit)

echo "== 3. Confirm production env is what gets used (no local .env shadowing it) =="
if [ -f apps/extension/.env ]; then
  echo "WARNING: apps/extension/.env exists and will override .env.production."
  echo "Delete or rename it if you want the production URL to actually apply."
fi
cat apps/extension/.env.production

echo "== 4. Production build =="
cd apps/extension
pnpm exec wxt build

echo "== 5. Verify the production URL actually got baked in =="
echo "-- should print file matches --"
grep -rl "$(grep WXT_REALTIME_URL .env.production | cut -d= -f2)" .output/chrome-mv3/ || true
echo "-- should print NOTHING --"
grep -rl "localhost:3001" .output/chrome-mv3/ || true

echo "== 6. Package the store-ready zip =="
pnpm exec wxt zip

echo "== Done. Zip is at: =="
ls -la .output/*.zip