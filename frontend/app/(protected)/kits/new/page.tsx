"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../../lib/api";

interface BatchCase {
  jd: string;
  company_url: string;
  days: number;
}

function isBatchCase(value: unknown): value is BatchCase {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jd === "string" && typeof v.company_url === "string" && typeof v.days === "number";
}

export default function NewKitPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "batch">("single");

  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSingleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const kit = await api.createKit({ jd, companyUrl, days });
      router.push(`/kits/${kit._id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not create kit, try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBatchSubmit(event: FormEvent) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("choose a JSON file first");
      return;
    }

    setSubmitting(true);
    setError(null);
    setBatchStatus(null);

    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw)) throw new Error("file must contain a JSON array of cases");
      const cases = raw.filter(isBatchCase);
      if (cases.length === 0) throw new Error("no valid cases found (each needs jd, company_url, days)");

      let created = 0;
      for (const c of cases) {
        try {
          await api.createKit({ jd: c.jd, companyUrl: c.company_url, days: c.days });
          created++;
          setBatchStatus(`Submitted ${created} of ${cases.length}...`);
        } catch {
          // one bad case shouldn't stop the rest of the batch
        }
      }
      setBatchStatus(`Submitted ${created} of ${cases.length} kits. Redirecting to your kits list...`);
      setTimeout(() => router.push("/kits"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not read that file");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New prep kit</h1>

      <div className="flex gap-2" role="tablist" aria-label="Kit creation mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          onClick={() => setMode("single")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${mode === "single" ? "bg-slate-900 text-white" : "border border-slate-300"}`}
        >
          Single kit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "batch"}
          onClick={() => setMode("batch")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${mode === "batch" ? "bg-slate-900 text-white" : "border border-slate-300"}`}
        >
          Batch upload
        </button>
      </div>

      {mode === "single" ? (
        <form onSubmit={handleSingleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Job description</span>
            <textarea
              required
              rows={10}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full job description here"
              className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Company URL</span>
            <input
              type="url"
              required
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://example.com"
              className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Days until interview</span>
            <input
              type="number"
              required
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-32 rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create kit"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleBatchSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            Upload a JSON file with an array of cases, each shaped like{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
              {"{ jd, company_url, days }"}
            </code>
            . Each case becomes its own kit.
          </p>
          <input ref={fileInputRef} type="file" accept="application/json" required className="text-sm" />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {batchStatus && <p className="text-sm text-slate-600">{batchStatus}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit batch"}
          </button>
        </form>
      )}
    </div>
  );
}
