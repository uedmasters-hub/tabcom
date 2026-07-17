import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  hooks: {
    // Guard against ever shipping a store zip that falls back to
    // localhost:3001 (this happened once — the released build ran in
    // permanent offline/demo mode). Production builds MUST have the
    // real backend URL baked in via .env.production or the shell env.
    "build:before": (wxt) => {
      const readEnvFile = (name: string): string | undefined => {
        const file = resolve(wxt.config.root, name);
        if (!existsSync(file)) return undefined;
        for (const line of readFileSync(file, "utf8").split("\n")) {
          const match = line.match(/^\s*WXT_REALTIME_URL\s*=\s*(.+?)\s*$/);
          if (match) return match[1].replace(/^["']|["']$/g, "");
        }
        return undefined;
      };
      const url =
        process.env.WXT_REALTIME_URL ??
        readEnvFile(`.env.${wxt.config.mode}`) ??
        readEnvFile(".env");
      if (wxt.config.mode === "production") {
        if (!url) {
          throw new Error(
            "[tabcom] WXT_REALTIME_URL is not set for a production build — refusing to bake in the localhost fallback. Set it in apps/extension/.env.production."
          );
        }
        if (url.includes("localhost") || url.includes("127.0.0.1")) {
          throw new Error(
            `[tabcom] WXT_REALTIME_URL points at ${url} in a production build — refusing to ship a localhost backend.`
          );
        }
      }
    },
  },

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  manifest: {
    name: "Tabcom",
    short_name: "Tabcom",
    description: "Browser-first communication platform",

    permissions: ["storage", "sidePanel", "tabs", "scripting", "notifications", "alarms"],

    host_permissions: ["<all_urls>"],

    action: {
      default_title: "Tabcom",
    },

    icons: {
      "16": "/icon/16.png",
      "32": "/icon/32.png",
      "48": "/icon/48.png",
      "96": "/icon/96.png",
      "128": "/icon/128.png",
    },
  },
});