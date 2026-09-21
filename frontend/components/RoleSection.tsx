import type { StoredKit } from "../lib/api";

export function RoleSection({ kit }: { kit: StoredKit }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="text-lg font-semibold">Role</h2>
      <p className="text-sm text-slate-600">
        {kit.role.title || "Untitled role"} · {kit.role.seniority || "seniority unknown"}
      </p>
      <ul className="flex flex-col gap-1.5">
        {kit.role.requirements.map((req) => (
          <li key={req.id} className="flex items-center gap-2 text-sm">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                req.priority === "must" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {req.priority}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{req.kind}</span>
            <span>{req.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-400">
        Requirements come from the job description via extraction, not editable here.
      </p>
    </section>
  );
}
