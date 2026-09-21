"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type StoredKit } from "../../../lib/api";

const STATUS_LABELS: Record<StoredKit["job"]["status"], string> = {
  pending: "Queued",
  researching: "Researching company",
  generating: "Generating content",
  checking: "Checking coverage",
  ready: "Ready",
  failed: "Failed",
};

export default function KitsListPage() {
  const [kits, setKits] = useState<StoredKit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listKits()
      .then(setKits)
      .catch((err) => setError(err instanceof Error ? err.message : "could not load kits"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your prep kits</h1>
        <Link href="/kits/new" className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          New kit
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {kits === null && !error && <p className="text-slate-500">Loading...</p>}
      {kits !== null && kits.length === 0 && (
        <p className="text-slate-500">No kits yet. Create your first one to get started.</p>
      )}

      <ul className="flex flex-col gap-3">
        {kits?.map((kit) => (
          <li key={kit._id}>
            <Link
              href={`/kits/${kit._id}`}
              className="flex items-center justify-between rounded border border-slate-200 px-4 py-3 hover:border-slate-400"
            >
              <div>
                <p className="font-medium">{kit.source.company || kit.source.company_url || "Untitled kit"}</p>
                <p className="text-sm text-slate-500">{kit.role.title || kit.source.role || "Role pending"}</p>
              </div>
              <span className="text-sm text-slate-500">{STATUS_LABELS[kit.job.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
