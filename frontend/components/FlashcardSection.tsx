"use client";

import { useState } from "react";
import { api, type StoredKit } from "../lib/api";
import { FlashcardItem } from "./FlashcardItem";

export function FlashcardSection({ kit, onUpdate }: { kit: StoredKit; onUpdate: (kit: StoredKit) => void }) {
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [adding, setAdding] = useState(false);
  const allIds = kit.flashcards.map((f) => f.id);

  async function addFlashcard() {
    if (!newFront.trim() || !newBack.trim()) return;
    setAdding(true);
    try {
      const updated = await api.createFlashcard(kit._id, { front: newFront.trim(), back: newBack.trim() });
      onUpdate(updated);
      setNewFront("");
      setNewBack("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="text-lg font-semibold">Flashcards</h2>

      {kit.flashcards.length === 0 ? (
        <p className="text-sm text-slate-500">No flashcards yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {kit.flashcards.map((card, i) => (
            <FlashcardItem
              key={card.id}
              kit={kit}
              card={card}
              isFirst={i === 0}
              isLast={i === kit.flashcards.length - 1}
              allIds={allIds}
              onUpdate={onUpdate}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={newFront}
          onChange={(e) => setNewFront(e.target.value)}
          placeholder="Front"
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
        <input
          type="text"
          value={newBack}
          onChange={(e) => setNewBack(e.target.value)}
          placeholder="Back"
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={addFlashcard}
          disabled={adding || !newFront.trim() || !newBack.trim()}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}
