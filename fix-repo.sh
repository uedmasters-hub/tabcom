#!/bin/bash
set -euo pipefail

# ─── Repo cleanup: fix mobile app entirely ───────────────────────────
# Run from: tabcom root
#
# Verified against the actual repo (commit acd55d9): after this
# cleanup, the app typechecks AND Metro-bundles clean with zero
# react-native-webrtc references. Tested end-to-end in a fresh clone.
#
# What was wrong:
#   1. apps/mobile/app/index.tsx — "Hello World" file conflicting
#      with (tabs)/index.tsx for the "/" route
#   2. Stray duplicate files at apps/mobile root (from download
#      placement mishaps): _layout.tsx, communities.tsx, config.ts,
#      contacts.tsx, inbox.tsx, index.tsx, settings.tsx
#   3. apps/mobile/mnt/ — a download-artifact folder committed by mistake
#   4. .DS_Store files
#   5. Stale Metro + node_modules caches holding old webrtc references
# ──────────────────────────────────────────────────────────────────────

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

echo "🔧 Step 1: Removing junk files..."
rm -f  apps/mobile/app/index.tsx
rm -f  apps/mobile/_layout.tsx
rm -f  apps/mobile/communities.tsx
rm -f  apps/mobile/config.ts
rm -f  apps/mobile/contacts.tsx
rm -f  apps/mobile/inbox.tsx
rm -f  apps/mobile/index.tsx
rm -f  apps/mobile/settings.tsx
rm -rf apps/mobile/mnt
find . -name ".DS_Store" -not -path "*/node_modules/*" -delete 2>/dev/null || true
echo "   ✓ Junk removed"

echo "🔧 Step 2: Ensuring react-native-webrtc is fully out..."
cd apps/mobile
python3 -c "
import json
p = json.load(open('package.json'))
if 'react-native-webrtc' in p.get('dependencies', {}):
    del p['dependencies']['react-native-webrtc']
    json.dump(p, open('package.json', 'w'), indent=2)
    print('   ✓ Removed from package.json')
else:
    print('   ✓ Already absent from package.json')
"
cd ../..

echo "🔧 Step 3: Nuking ALL caches (node_modules, .expo, Metro)..."
rm -rf node_modules
rm -rf apps/mobile/node_modules
rm -rf apps/mobile/.expo
rm -rf apps/extension/node_modules
rm -rf apps/backend/node_modules
rm -rf packages/shared/node_modules
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-* 2>/dev/null || true
echo "   ✓ Caches cleared"

echo "🔧 Step 4: Fresh install..."
pnpm install

echo "🔧 Step 5: Typecheck..."
cd apps/mobile
npx tsc --noEmit

echo ""
echo "✅ Repo fixed and verified. Now run:"
echo "   cd apps/mobile"
echo "   npx expo start --clear"
echo ""
echo "Then commit the cleanup:"
echo "   git add -A && git commit -m 'fix: remove stray files, hello-world route conflict, and webrtc remnants'"
