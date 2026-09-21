"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type StoredKit } from "../../../../../lib/api";

const CONFIDENCE_LABELS: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };

/**
 * lowest confidence first, unrated cards count as lower than a low rating
 * since they have not been checked at all yet.
 */
function orderForPractice(kit: StoredKit) {
  return [...kit.flashcards].sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
}

export default function PracticePage() {
  const params = useParams<{ id: string }>();
  const [kit, setKit] = useState<StoredKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionRatings, setSessionRatings] = useState<Record<string, 1 | 2 | 3>>({});
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    api
      .getKit(params.id)
      .then((loaded) => {
        setKit(loaded);
        setOrder(orderForPractice(loaded).map((c) => c.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "could not load this kit"));
  }, [params.id]);

  const seenCount = useMemo(() => (kit ? kit.flashcards.filter((c) => c.seen).length : 0), [kit]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!kit) return <p className="text-slate-500">Loading...</p>;
  if (kit.flashcards.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-slate-500">This kit has no flashcards yet.</p>
        <Link href={`/kits/${kit._id}`} className="text-sm font-medium underline">
          Back to kit
        </Link>
      </div>
    );
  }

  if (finished) {
    return <WeakSpotsView kit={kit} sessionRatings={sessionRatings} />;
  }

  const currentId = order[index];
  const current = kit.flashcards.find((c) => c.id === currentId);

  if (!current) {
    return <p className="text-slate-500">Nothing left to practice.</p>;
  }

  async function rate(confidence: 1 | 2 | 3) {
    setSessionRatings((prev) => ({ ...prev, [current!.id]: confidence }));
    const updated = await api.updateFlashcardPractice(kit!._id, current!.id, { confidence, seen: true });
    setKit(updated);

    if (index + 1 >= order.length) {
      setFinished(true);
    } else {
      setIndex(index + 1);
      setRevealed(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href={`/kits/${kit._id}`} className="text-sm font-medium underline">
          Back to kit
        </Link>
        <p className="text-sm text-slate-500">
          Card {index + 1} of {order.length} · Seen {seenCount}/{kit.flashcards.length}
        </p>
      </div>

      <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded border border-slate-200 p-8 text-center">
        <p className="text-lg font-medium">{current.front}</p>
        {revealed && <p className="text-slate-600">{current.back}</p>}
        {!revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Reveal answer
          </button>
        )}
      </div>

      {revealed && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-slate-500">How confident do you feel about this one?</p>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => rate(level)}
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                {CONFIDENCE_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WeakSpotsView({ kit, sessionRatings }: { kit: StoredKit; sessionRatings: Record<string, 1 | 2 | 3> }) {
  const lowConfidenceCards = kit.flashcards.filter((c) => sessionRatings[c.id] === 1);

  const uncoveredNiceRequirements = kit.role.requirements.filter(
    (req) => req.priority === "nice" && kit.coverage.uncovered_requirement_ids.includes(req.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Session complete</h1>
        <Link href={`/kits/${kit._id}`} className="text-sm font-medium underline">
          Back to kit
        </Link>
      </div>

      <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="text-lg font-semibold">Study this next</h2>
        <p className="text-sm text-slate-500">
          Cards you rated low confidence this session, plus nice-to-have requirements that no question
          covers yet — the gaps most worth closing before the interview.
        </p>

        {lowConfidenceCards.length === 0 && uncoveredNiceRequirements.length === 0 ? (
          <p className="text-sm text-slate-600">No weak spots found this session. Nice work.</p>
        ) : (
          <>
            {lowConfidenceCards.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-700">Low-confidence flashcards</h3>
                <ul className="mt-1 flex flex-col gap-2">
                  {lowConfidenceCards.map((card) => (
                    <li key={card.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                      <p className="font-medium">{card.front}</p>
                      <p className="text-slate-600">{card.back}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {uncoveredNiceRequirements.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-700">Uncovered nice-to-have requirements</h3>
                <ul className="mt-1 flex flex-col gap-2">
                  {uncoveredNiceRequirements.map((req) => (
                    <li key={req.id} className="rounded border border-slate-200 p-3 text-sm">
                      {req.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
