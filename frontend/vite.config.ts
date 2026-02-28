import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3002",
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
