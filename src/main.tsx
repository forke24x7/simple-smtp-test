// Browser entry point for the SMTP testing interface.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
