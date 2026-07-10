/**
 * Single source of truth for features that are built but intentionally
 * hidden from the product surface right now.
 *
 * Rather than deleting working code (and the tests/wiring around it),
 * gate it behind a flag here. Flipping one boolean brings the feature
 * back everywhere it's wired in — no hunting through components.
 */

/**
 * The floating "pill" mini-app (chat popped into its own always-on-top
 * window — entrypoints/pip). One switch controls it everywhere it's
 * wired in — flip it off again if it needs parking for a future MVP
 * pass.
 *
 * Wired into:
 *  - features/workspace/views/chat/ChatView.tsx (header toggle button)
 *  - features/workspace/views/SettingsView.tsx (preference row)
 */
export const FLOATING_PILL_ENABLED = true;
