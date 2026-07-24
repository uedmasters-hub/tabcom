/**
 * ══════════════════════════════════════════════════════════════
 *  TABCOM DESIGN TOKENS — SINGLE SOURCE OF TRUTH
 * ══════════════════════════════════════════════════════════════
 *
 *  Every colour, size, space, and radius in the app comes from here.
 *  Nothing is hardcoded anywhere else. If a value isn't in this file,
 *  it does not exist in the design system.
 *
 *  Adding a new value? Add it HERE first, then reference the token.
 *  Never inline a hex code or a pixel number in a component.
 */

/* ═══════════════════ COLOUR ═══════════════════ */

export const color = {
  /** Screen backgrounds */
  background: "#ffffff",
  /** Cards, input fills, secondary surfaces */
  surface: "#f8fafc",
  /** Slightly deeper surface — section separators, rails */
  surfaceAlt: "#f1f5f9",

  /** Primary text, headings, primary CTA fill */
  ink: "#0f172a",
  /** Secondary text, descriptions, inactive labels */
  muted: "#64748b",
  /** Placeholders, tertiary text, disabled labels */
  subtle: "#94a3b8",
  /** Faintest text — footers, version strings */
  faint: "#cbd5e1",

  /** Accent — links, active states, selection, badges */
  primary: "#2563eb",
  primaryPressed: "#1d4ed8",
  /** 5% primary — selected row backgrounds */
  primaryWash: "#eff6ff",

  /** Borders, dividers, input outlines */
  border: "#e2e8f0",
  /** Lighter divider for dense lists */
  borderLight: "#f1f5f9",

  /** Semantic */
  success: "#16a34a",
  successWash: "#dcfce7",
  warning: "#d97706",
  warningWash: "#fef3c7",
  danger: "#dc2626",
  dangerWash: "#fef2f2",

  /** Disabled control fill + label */
  disabled: "#e2e8f0",
  disabledText: "#94a3b8",

  white: "#ffffff",
} as const;

/* ═══════════════════ TYPOGRAPHY ═══════════════════ */

/**
 * Ten roles. Every piece of text in the app is exactly one of these.
 * If you're reaching for a size not in this list, you're introducing
 * drift — pick the nearest role instead.
 */
export const type = {
  /** Onboarding hero only — the single largest text in the app. */
  hero: { fontSize: 36, lineHeight: 44, fontWeight: "800", letterSpacing: -0.6 },

  /** Tab screen titles: Chat, Communities, Contacts, Settings. */
  screenTitle: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.5 },

  /** Every push-screen heading: register, sign-in, settings sub-pages. */
  pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.4 },

  /** Detail-screen headers (SecondaryHeader), modal titles. */
  sectionTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.3 },

  /** Empty-state headlines, card headlines. */
  headline: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2 },

  /** List row names, member names, conversation titles. */
  itemTitle: { fontSize: 17, lineHeight: 22, fontWeight: "700" },

  /** Text inputs and message composer. */
  input: { fontSize: 16, lineHeight: 22, fontWeight: "400" },

  /** CTA button labels and header actions. */
  action: { fontSize: 16, lineHeight: 20, fontWeight: "600" },

  /** Default body copy, descriptions, list previews. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },

  /** Secondary metadata: timestamps, usernames, row sub-text. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },

  /** Section labels — always UPPERCASE with wide tracking. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.8 },

  /** Badge pills, unread counts, the smallest text in the app. */
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 0.5 },
} as const;

export type TypeRole = keyof typeof type;

/* ═══════════════════ SPACING ═══════════════════ */

/**
 * 4pt grid. Screen gutters are always `screen` (20). Vertical rhythm
 * between sections is always `section` (24).
 */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,

  /** Horizontal screen gutter — the same on every screen. */
  screen: 20,
  /** Vertical gap between major sections. */
  section: 24,
  /** Vertical padding inside a list row. */
  row: 14,
  /** Composer and toolbar vertical padding. */
  composer: 8,
} as const;

/* ═══════════════════ RADIUS ═══════════════════ */

export const radius = {
  /** Badges, small chips. */
  sm: 8,
  /** Inputs, small cards — the app's default. */
  md: 12,
  /** Buttons and CTAs. */
  lg: 14,
  /** Cards, sheets, panels. */
  xl: 16,
  /** Large cards, modals. */
  xxl: 20,
  /** Pills, avatars, circular controls. */
  full: 9999,
} as const;

/* ═══════════════════ CONTROL SIZES ═══════════════════ */

export const size = {
  /** Standard CTA button height. */
  button: 54,
  /** Standard text input height. */
  input: 52,
  /** Circular icon buttons in headers. */
  iconButton: 44,
  /** Small circular controls (send, mic). */
  iconButtonSm: 44,
  /** Minimum touch target — never go below this. */
  touchTarget: 44,
  /** Standard icon in a list row. */
  icon: 20,
  /** Icon in a header action. */
  iconLg: 22,
  /** Empty-state illustration icon. */
  iconEmpty: 56,
} as const;

/* ═══════════════════ ELEVATION ═══════════════════ */

export const elevation = {
  none: {},
  /** Floating buttons, small popovers. */
  low: {
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  /** Colour pickers, dropdowns, action sheets. */
  medium: {
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
} as const;

/* ═══════════════════ MOTION ═══════════════════ */

/**
 * No springs, no bounce — timing curves only. Motion should feel like
 * the interface settling, never performing.
 */
export const motion = {
  /** Micro-feedback: press states, small toggles. */
  fast: 140,
  /** Default: fades, reveals, layout shifts. */
  base: 240,
  /** Deliberate: sheet reveals, screen-level transitions. */
  slow: 320,
  /** Stagger delay between siblings in a cascade. */
  stagger: 45,
} as const;

/* ═══════════════════ PRESENCE ═══════════════════ */

export const presenceColor: Record<string, string> = {
  online: color.success,
  away: color.warning,
  busy: color.danger,
  offline: color.subtle,
};

/* ═══════════════════ AVATAR SCALE ═══════════════════ */

export const avatarSize = {
  xs: 32,
  sm: 40,
  md: 48,
  lg: 52,
  xl: 80,
} as const;
