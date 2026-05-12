import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "src");

export default defineConfig({
  root,
  publicDir: path.resolve(__dirname, "public"),
  server: {
    watch: {
      usePolling: true,
      interval: 200,
      ignored: ["**/node_modules/**", "**/.git/**", "**/.venv/**", "**/venv/**"],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "local-dist"),
    emptyOutDir: true,
  },
});
