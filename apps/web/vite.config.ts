import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths so the same build works on a website and inside the Tauri .exe.
  base: "./",
  server: { host: true },
});
