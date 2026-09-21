"use client";

import { useState } from "react";
import type { Question, QuestionCategory } from "@aipk/pipeline";
import { api, type StoredKit } from "../lib/api";

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System Design",
  "company-fit": "Company Fit",
};

export function QuestionItem({
  kit,
  question,
  isFirst,
  isLast,
  categoryIds,
  onUpdate,
}: {
  kit: StoredKit;
  question: Question;
  isFirst: boolean;
  isLast: boolean;
  categoryIds: string[];
  onUpdate: (kit: StoredKit) => void;
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [answerOutline, setAnswerOutline] = useState(question.answer_outline);
  const [busy, setBusy] = useState(false);

  async function saveField(field: "prompt" | "answer_outline", value: string) {
    if (value === question[field]) return;
    setBusy(true);
    try {
      const updated = await api.updateQuestion(kit._id, question.id, { [field]: value });
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function changeCategory(category: QuestionCategory) {
    setBusy(true);
    try {
      const updated = await api.updateQuestion(kit._id, question.id, { category });
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function changeDifficulty(difficulty: 1 | 2 | 3) {
    setBusy(true);
    try {
      const updated = await api.updateQuestion(kit._id, question.id, { difficulty });
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function move(direction: -1 | 1) {
    const index = categoryIds.indexOf(question.id);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= categoryIds.length) return;
    const reordered = [...categoryIds];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith]!, reordered[index]!];
    setBusy(true);
    try {
      const updated = await api.reorderQuestions(kit._id, question.category, reordered);
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function togglePin() {
    setBusy(true);
    try {
      const updated = await api.toggleQuestionPin(kit._id, question.id);
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const updated = await api.deleteQuestion(kit._id, question.id);
      onUpdate(updated);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Move up"
            onClick={() => move(-1)}
            disabled={isFirst || busy}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="Move down"
            onClick={() => move(1)}
            disabled={isLast || busy}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30"
          >
            ▼
          </button>
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {question.origin === "user" ? "your question" : "generated"} · {question.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-slate-500">Difficulty</span>
            <select
              value={question.difficulty}
              onChange={(e) => changeDifficulty(Number(e.target.value) as 1 | 2 | 3)}
              disabled={busy}
              className="rounded border border-slate-300 px-1 py-0.5"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-slate-500">Category</span>
            <select
              value={question.category}
              onChange={(e) => changeCategory(e.target.value as QuestionCategory)}
              disabled={busy}
              className="rounded border border-slate-300 px-1 py-0.5"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={togglePin}
            disabled={busy}
            className={`rounded border px-2 py-1 text-xs ${question.status === "pinned" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
          >
            {question.status === "pinned" ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Question</span>
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => saveField("prompt", prompt)}
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Answer outline</span>
        <textarea
          rows={2}
          value={answerOutline}
          onChange={(e) => setAnswerOutline(e.target.value)}
          onBlur={() => saveField("answer_outline", answerOutline)}
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
      </label>
    </li>
  );
}
