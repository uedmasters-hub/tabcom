import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  manifest: {
    name: "Tabcom",
    short_name: "Tabcom",
    description: "Browser-first communication platform",

    permissions: ["storage", "sidePanel", "tabs", "scripting"],

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