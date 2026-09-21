"use client";

import { useEffect, useState } from "react";
import { api, type UserSummary } from "../lib/api";

export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; user: UserSummary }
  | { status: "unauthenticated" };

export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then((user) => {
        if (!cancelled) setSession({ status: "authenticated", user });
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "unauthenticated" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
