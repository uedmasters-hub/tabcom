export const typography = {
  display: {
    fontSize: "2rem",      // 32px
    lineHeight: "2.5rem",
    fontWeight: 700,
    letterSpacing: "-0.04em",
  },

  h1: {
    fontSize: "1.75rem",   // 28px
    lineHeight: "2.25rem",
    fontWeight: 700,
    letterSpacing: "-0.03em",
  },

  h2: {
    fontSize: "1.5rem",    // 24px
    lineHeight: "2rem",
    fontWeight: 600,
  },

  h3: {
    fontSize: "1.25rem",   // 20px
    lineHeight: "1.75rem",
    fontWeight: 600,
  },

  body: {
    fontSize: "0.9375rem", // 15px
    lineHeight: "1.5rem",
    fontWeight: 400,
  },

  bodySmall: {
    fontSize: "0.875rem",  // 14px
    lineHeight: "1.375rem",
    fontWeight: 400,
  },

  caption: {
    fontSize: "0.75rem",   // 12px
    lineHeight: "1rem",
    fontWeight: 500,
    letterSpacing: "0.04em",
  },
} as const;