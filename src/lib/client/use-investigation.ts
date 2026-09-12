"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Investigation } from "@/lib/types";
import { readInvestigationStream } from "./stream";

export function useInvestigation() {
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    controller.current?.abort();
    generation.current += 1;
    setRunning(false);
    setInvestigation((current) => current ? {
      ...current,
      providers: Object.fromEntries(Object.entries(current.providers).map(([key, value]) => [
        key, value.status === "pending" || value.status === "investigating"
          ? { status: "unavailable", message: "Investigation stopped. This layer wasn't completed." }
          : value,
      ])) as Investigation["providers"],
    } : null);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setInvestigation(null);
    setError(null);
  }, [cancel]);

  const run = useCallback(async (url: string) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const requestId = ++generation.current;
    setRunning(true);
    setError(null);
    setInvestigation(null);
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: request.signal,
        cache: "no-store",
        credentials: "omit",
      });
      await readInvestigationStream(response, (event) => {
        if (generation.current !== requestId) return;
        if (event.type === "error") {
          setError(event.message);
          setRunning(false);
        } else {
          setInvestigation(event.investigation);
          if (event.type === "complete") setRunning(false);
        }
      }, request.signal);
    } catch (cause) {
      if (generation.current !== requestId || request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The investigation was interrupted. Please try again.");
      setInvestigation((current) => current ? {
        ...current,
        providers: Object.fromEntries(Object.entries(current.providers).map(([key, value]) => [
          key, value.status === "pending" || value.status === "investigating"
            ? { status: "unavailable", message: "The connection ended before this layer arrived." }
            : value,
        ])) as Investigation["providers"],
      } : null);
    } finally {
      if (generation.current === requestId) setRunning(false);
    }
  }, []);

  useEffect(() => () => controller.current?.abort(), []);
  return { investigation, running, error, run, cancel, reset };
}
