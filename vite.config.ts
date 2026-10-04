// Emit the frontend bundle into the directory served by the application.
import { defineConfig } from "vite";

export default defineConfig({ build: { outDir: "dist/client" } });
