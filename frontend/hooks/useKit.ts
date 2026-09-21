"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type StoredKit } from "../lib/api";

const POLL_INTERVAL_MS = 2000;

function isTerminal(status: StoredKit["job"]["status"]): boolean {
  return status === "ready" || status === "failed";
}

export function useKit(id: string) {
  const [kit, setKit] = useState<StoredKit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<StoredKit | null> => {
    try {
      const fresh = await api.getKit(id);
      setKit(fresh);
      setLoadError(null);
      return fresh;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "failed to load kit");
      return null;
    }
  }, [id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function tick() {
      const fresh = await refresh();
      if (!stopped && fresh && !isTerminal(fresh.job.status)) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, refresh]);

  return { kit, loadError, refresh, setKit };
}
