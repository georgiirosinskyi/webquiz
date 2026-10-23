import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Pages are built into the Python package (webquiz/ui/), so PyInstaller and
// the wheel ship them next to the server code. The server reads each page's
// HTML, injects its data in place of <!--WEBQUIZ_DATA--> and serves the
// hashed assets from /ui/.
const backend = process.env.WEBQUIZ_URL || "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  base: "/ui/",
  build: {
    outDir: resolve(__dirname, "../webquiz/ui"),
    emptyOutDir: true,
    // Shared chunks every page reuses from cache: React and antd with the rest of the libraries
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        "live-stats": resolve(__dirname, "live-stats.html"),
        admin: resolve(__dirname, "admin.html"),
        quiz: resolve(__dirname, "quiz.html"),
      },
      output: {
        manualChunks: (id) => {
          if (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return "react";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": backend,
      "/imgs": backend,
      "/attach": backend,
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});
