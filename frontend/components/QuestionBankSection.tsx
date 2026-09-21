"use client";

import { useState } from "react";
import type { QuestionCategory } from "@aipk/pipeline";
import { api, type StoredKit } from "../lib/api";
import { QuestionItem } from "./QuestionItem";

const CATEGORIES: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System Design",
  "company-fit": "Company Fit",
};

function CategorySection({
  kit,
  category,
  onUpdate,
}: {
  kit: StoredKit;
  category: QuestionCategory;
  onUpdate: (kit: StoredKit) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");

  const questions = kit.questions.filter((q) => q.category === category);
  const categoryIds = questions.map((q) => q.id);

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await api.regenerateSection(kit._id, category);
      onUpdate(updated);
    } finally {
      setRegenerating(false);
    }
  }

  async function addQuestion() {
    if (!newPrompt.trim()) return;
    setAdding(true);
    try {
      const updated = await api.createQuestion(kit._id, { category, prompt: newPrompt.trim(), difficulty: 2 });
      onUpdate(updated);
      setNewPrompt("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{CATEGORY_LABELS[category]}</h3>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-slate-500">No questions in this category yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((q, i) => (
            <QuestionItem
              key={q.id}
              kit={kit}
              question={q}
              isFirst={i === 0}
              isLast={i === questions.length - 1}
              categoryIds={categoryIds}
              onUpdate={onUpdate}
            />
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="Write your own question"
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={addQuestion}
          disabled={adding || !newPrompt.trim()}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}

export function QuestionBankSection({ kit, onUpdate }: { kit: StoredKit; onUpdate: (kit: StoredKit) => void }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Question bank</h2>
      {CATEGORIES.map((category) => (
        <CategorySection key={category} kit={kit} category={category} onUpdate={onUpdate} />
      ))}
    </section>
  );
}
