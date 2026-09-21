"use client";

import { useState } from "react";
import { api, type StoredKit } from "../lib/api";

export function CompanyBriefSection({ kit, onUpdate }: { kit: StoredKit; onUpdate: (kit: StoredKit) => void }) {
  const [summary, setSummary] = useState(kit.company_brief.summary);
  const [whatTheyDo, setWhatTheyDo] = useState(kit.company_brief.what_they_do);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function save(field: "summary" | "what_they_do", value: string) {
    if (value === kit.company_brief[field]) return;
    setSaving(true);
    try {
      const updated = await api.updateCompanyBrief(kit._id, { [field]: value });
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await api.regenerateSection(kit._id, "company_brief");
      onUpdate(updated);
      setSummary(updated.company_brief.summary);
      setWhatTheyDo(updated.company_brief.what_they_do);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Company brief</h2>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Summary</span>
        <textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => save("summary", summary)}
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">What they do</span>
        <textarea
          rows={3}
          value={whatTheyDo}
          onChange={(e) => setWhatTheyDo(e.target.value)}
          onBlur={() => save("what_they_do", whatTheyDo)}
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
      </label>

      {saving && <p className="text-xs text-slate-400">Saving...</p>}

      {kit.company_brief.sources.length > 0 && (
        <p className="text-xs text-slate-500">
          Sources: {kit.company_brief.sources.join(", ")}
        </p>
      )}
    </section>
  );
}
