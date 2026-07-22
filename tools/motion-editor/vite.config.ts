/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react() as PluginOption],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@ltypet/character-motion": path.resolve(__dirname, "../../packages/character-motion/src"),
    },
  },
  server: {
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "../.."),
      ],
    },
  },
  test: {
    environment: "jsdom",
  },
});
