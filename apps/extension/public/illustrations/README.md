# Illustrations checklist

The app currently shows a clean dashed placeholder wherever a 3D
illustration is referenced but the file isn't here yet — nothing looks
broken, but this is the full list of what to drop in to finish the
visual pass matching the mockups.

**How it works:** each screen references a file by exact name below.
Export the artwork (PNG or SVG both work) from your design file with
that EXACT filename and save it directly into this folder
(`apps/extension/public/illustrations/`). No code changes needed —
just rebuild (`pnpm build`) and reload the extension. If a file is
missing, that screen automatically falls back to the dashed
placeholder box instead of breaking.

> ⚠️ **Common gotcha:** macOS's save/export dialog often appends the
> format extension a second time if the filename you type already ends
> in `.png` — you end up with `communities-empty.png.png` on disk
> instead of `communities-empty.png`, and it silently fails to load.
> After saving, always check with `ls -la` in this folder that the
> filename has exactly ONE `.png` at the end before rebuilding.

Recommended export size: roughly 500×500px (or square-ish), transparent
background, PNG. SVG works too if your source is vector.

| File name | Screen | What it should show |
|---|---|---|
| `communities-empty.png` | Communities → Groups (empty) | Group of people illustration (image 1) |
| `discover-empty.png` | Communities → Discover (empty) | Blocked/no-one-online person icon (image 5) |
| `tabs-empty.png` | Board → Tabs (empty) | Stack of pages with a pin and globe (image 2) |
| `pins-empty.png` | Board → Pins (empty) | Pinned note card (image 3) |
| `areas-empty.png` | Board → Areas (empty) | Grid/graph paper with a dashed selection (image 4) |
| `session-timeout.png` | Guest session expired screen | Hourglass + locked profile (image 6) |
| `invite-code.png` | Onboarding → invite code step | Unlocked padlock (image 7) |
| `connection-request.png` | DM consent screen (pending/blocked/none) | Envelope with a plus/star badge — same artwork reused across all consent states |
| `welcome.png` | First screen on install (before any account exists) | Envelope + username/password card + key + padlock — secure-account theme |

Every other empty state in the app (contacts, inbox, settings, etc.)
still uses the original small line-icon treatment on purpose — only
the seven screens above were called out for the illustration upgrade.
If more should get the same treatment, add a new row here, use the
same `illustrationName`/`illustrationAlt` props on `<EmptyState>` (see
`src/components/ui/EmptyState.tsx`) or drop `<Illustration name="..."
alt="..." />` directly in for a one-off spot (see
`src/components/ui/Illustration.tsx`), and list the new filename here.

## Still showing the placeholder after adding a file?

1. **Rebuild, don't just save the file.** `pnpm build` (from
   `apps/extension`) is what actually copies `public/illustrations/*`
   into `.output/chrome-mv3/illustrations/`. Confirm it's really there:
   ```bash
   ls .output/chrome-mv3/illustrations/
   ```
   If your file isn't listed, the build didn't pick it up — check
   you saved it into `apps/extension/public/illustrations/` (not
   `apps/extension/illustrations/` or the repo root).
2. **Reload the extension.** `chrome://extensions` → the reload icon
   on Tabcom. A rebuild alone doesn't push into an already-loaded
   extension.
3. **Check the exact filename**, including case — `Communities-Empty.png`
   and `communities-empty.png` are different files as far as the build
   is concerned, even if your Mac's Finder treats them the same.
4. **Still stuck?** Right-click the panel showing the placeholder →
   Inspect → Console tab. A failed load prints a line like:
   ```
   [tabcom] illustration failed to load: chrome-extension://.../illustrations/communities-empty.png — check that apps/extension/public/illustrations/communities-empty.png exists...
   ```
   That URL is exactly what Chrome tried to fetch — the Network tab
   will show its status. A 404 confirms it's a missing/misnamed file
   (steps 1–3); anything else, share that console line and we'll dig
   further from there.
