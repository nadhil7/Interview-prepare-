"use client";

import { useState } from "react";
import type { Flashcard } from "@aipk/pipeline";
import { api, type StoredKit } from "../lib/api";

export function FlashcardItem({
  kit,
  card,
  isFirst,
  isLast,
  allIds,
  onUpdate,
}: {
  kit: StoredKit;
  card: Flashcard;
  isFirst: boolean;
  isLast: boolean;
  allIds: string[];
  onUpdate: (kit: StoredKit) => void;
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [busy, setBusy] = useState(false);

  async function saveField(field: "front" | "back", value: string) {
    if (value === card[field]) return;
    setBusy(true);
    try {
      const updated = await api.updateFlashcard(kit._id, card.id, { [field]: value });
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function move(direction: -1 | 1) {
    const index = allIds.indexOf(card.id);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= allIds.length) return;
    const reordered = [...allIds];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith]!, reordered[index]!];
    setBusy(true);
    try {
      const updated = await api.reorderFlashcards(kit._id, reordered);
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function togglePin() {
    setBusy(true);
    try {
      const updated = await api.toggleFlashcardPin(kit._id, card.id);
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const updated = await api.deleteFlashcard(kit._id, card.id);
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
          <button type="button" aria-label="Move up" onClick={() => move(-1)} disabled={isFirst || busy} className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30">
            ▲
          </button>
          <button type="button" aria-label="Move down" onClick={() => move(1)} disabled={isLast || busy} className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30">
            ▼
          </button>
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {card.origin === "user" ? "your card" : "generated"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={togglePin} disabled={busy} className={`rounded border px-2 py-1 text-xs ${card.status === "pinned" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}>
            {card.status === "pinned" ? "Pinned" : "Pin"}
          </button>
          <button type="button" onClick={remove} disabled={busy} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Front</span>
        <textarea rows={2} value={front} onChange={(e) => setFront(e.target.value)} onBlur={() => saveField("front", front)} className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Back</span>
        <textarea rows={2} value={back} onChange={(e) => setBack(e.target.value)} onBlur={() => saveField("back", back)} className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none" />
      </label>
    </li>
  );
}
