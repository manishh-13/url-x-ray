"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const preference = window.matchMedia(query);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

/** Match server markup on hydration, then follow the user's live motion preference. */
export function useMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
