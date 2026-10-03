import express from "express";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const app = createApp();
if (process.env.NODE_ENV === "production") {
  const directory = fileURLToPath(new URL("../client/", import.meta.url));
  app.use(express.static(directory));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3008);
const server = app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`Simple SMTP Test läuft auf Port ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
