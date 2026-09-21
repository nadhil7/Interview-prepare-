"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../hooks/useSession";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [session.status, router]);

  if (session.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  if (session.status === "unauthenticated") {
    return null;
  }

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/kits" className="font-semibold">
            AI Interview Prep Kit
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">{session.user.email}</span>
            <button type="button" onClick={handleLogout} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">
              Log out
            </button>
          </div>
        </nav>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
    </div>
  );
}
