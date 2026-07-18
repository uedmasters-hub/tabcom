/** Design tokens matched to the extension's globals.css.
 *  Extension: white bg, #f8fafc surface, #2563eb primary,
 *  #0f172a text, #64748b muted, #e2e8f0 border, rounded-xl. */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#ffffff",
        surface: "#f8fafc",
        primary: "#2563eb",
        "primary-hover": "#1d4ed8",
        ink: "#0f172a",
        muted: "#64748b",
        border: "#e2e8f0",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
    },
  },
};
