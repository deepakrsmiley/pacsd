import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cornerstoneCodecDefaults() {
  return {
    name: "cornerstone-codec-defaults",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.includes("/@cornerstonejs/codec-") || !file.endsWith(".js")) return null;
      if (/\bexport\s+default\b/.test(code)) return null;
      const match = code.match(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*\(\(\)\s*=>/);
      if (!match) return null;
      return { code: `${code}\nexport default ${match[1]};\n`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [cornerstoneCodecDefaults(), react()],
  resolve: {
    alias: {
      events: path.resolve(repoRoot, "node_modules/events/events.js"),
    },
  },
  optimizeDeps: {
    exclude: ["@cornerstonejs/dicom-image-loader"],
    include: ["dicom-parser", "events", "xmlbuilder2"],
  },
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});
