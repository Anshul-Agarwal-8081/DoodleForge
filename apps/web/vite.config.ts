import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.API_PORT || "4173";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      fs: { allow: ["../.."] },
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  };
});

