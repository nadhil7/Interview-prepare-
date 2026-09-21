"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useKit } from "../../../../hooks/useKit";
import { ProgressView } from "../../../../components/ProgressView";
import { CompanyBriefSection } from "../../../../components/CompanyBriefSection";
import { RoleSection } from "../../../../components/RoleSection";
import { QuestionBankSection } from "../../../../components/QuestionBankSection";
import { FlashcardSection } from "../../../../components/FlashcardSection";
import { ScheduleSection } from "../../../../components/ScheduleSection";

export default function KitDetailPage() {
  const params = useParams<{ id: string }>();
  const { kit, loadError, setKit } = useKit(params.id);

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  if (!kit) {
    return <p className="text-slate-500">Loading...</p>;
  }

  if (kit.job.status !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{kit.source.company || "New kit"}</h1>
        <ProgressView job={kit.job} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{kit.source.company || kit.role.title || "Prep kit"}</h1>
        <Link
          href={`/kits/${kit._id}/practice`}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Practice flashcards
        </Link>
      </div>

      <CompanyBriefSection kit={kit} onUpdate={setKit} />
      <RoleSection kit={kit} />
      <QuestionBankSection kit={kit} onUpdate={setKit} />
      <FlashcardSection kit={kit} onUpdate={setKit} />
      <ScheduleSection kit={kit} />
    </div>
  );
}
