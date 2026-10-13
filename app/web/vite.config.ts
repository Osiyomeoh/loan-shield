import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The chain reader stays one dependency-free file, ../public/shield.js, which the tests and e2e scripts import too.
// Vite bundles it into the app and also copies it to the site root, so /shield.js can still be read on its own.
export default defineConfig({
  plugins: [react()],
  publicDir: "../public",
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
