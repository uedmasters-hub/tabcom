/** NativeWind requires Tailwind v3 (the extension uses v4 — that's
 *  intentional; the two configs are independent). */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0F",
        surface: "#15151C",
        card: "#1D1D26",
        accent: "#7C6CF6",
        line: "#2A2A36",
      },
    },
  },
};
