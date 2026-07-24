/** Design tokens matched to the extension's globals.css.
 *  Extension: white bg, #f8fafc surface, #2563eb primary,
 *  #0f172a text, #64748b muted, #e2e8f0 border.
 *
 *  Typeface: system default (San Francisco / Roboto) for body,
 *  monospace for code/invite fields.
 *
 *  Radius scale: 8 (sm), 12 (md/default), 14 (lg), 20 (xl), 9999 (full).
 */
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
        placeholder: "#94a3b8",
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "12px",
        md: "12px",
        lg: "14px",
        xl: "20px",
      },
      fontSize: {
        "heading-xl": ["30px", { lineHeight: "38px", letterSpacing: "-0.5px", fontWeight: "800" }],
        "heading-lg": ["24px", { lineHeight: "30px", letterSpacing: "-0.3px", fontWeight: "800" }],
        "heading-md": ["20px", { lineHeight: "26px", letterSpacing: "-0.2px", fontWeight: "700" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["15px", { lineHeight: "22px", fontWeight: "400" }],
        "body-sm": ["13px", { lineHeight: "18px", fontWeight: "400" }],
        label: ["13px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.1px" }],
        caption: ["11px", { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.8px" }],
      },
      spacing: {
        "field-h": "52px",
      },
    },
  },
};
