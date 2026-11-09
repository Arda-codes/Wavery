import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isTauri } from "./services/adapter";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/fraunces/opsz.css";
import "./index.css";

if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  !isTauri &&
  (window.location.protocol === "http:" || window.location.protocol === "https:")
) {
  const registerSw = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration is non-fatal in restricted browser environments
    });
  };

  if (document.readyState === "complete") {
    registerSw();
  } else {
    window.addEventListener("load", registerSw);
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
