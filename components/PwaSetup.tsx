"use client";
import { useEffect } from "react";

// Registers the service worker (push notifications). No offline caching in v1.
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* non-fatal */ });
    }
  }, []);
  return null;
}
