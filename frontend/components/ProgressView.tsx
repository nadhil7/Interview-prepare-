import type { JobStatus } from "../lib/api";

const STAGE_LABELS: Record<string, string> = {
  pending: "Queued",
  researching: "Researching the company",
  generating: "Generating the prep kit",
  checking: "Checking coverage",
};

export function ProgressView({ job }: { job: JobStatus }) {
  if (job.status === "failed") {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4">
        <p className="font-medium text-red-700">This kit could not be generated.</p>
        <p className="mt-1 text-sm text-red-600">{job.error?.message ?? "Unknown error."}</p>
        {job.error?.code && <p className="mt-1 text-xs text-red-400">Error code: {job.error.code}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-slate-200 p-6">
      <p className="font-medium">{STAGE_LABELS[job.status] ?? job.status}</p>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-slate-900 transition-all"
          style={{ width: `${Math.max(5, job.progress)}%` }}
        />
      </div>
      <p className="text-sm text-slate-500">This can take a minute or two, this page will update on its own.</p>
    </div>
  );
}
