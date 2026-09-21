import type { StoredKit } from "../lib/api";

export function ScheduleSection({ kit }: { kit: StoredKit }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="text-lg font-semibold">Study schedule</h2>
      <p className="text-sm text-slate-500">
        Built from the question bank above. Editing questions updates this automatically.
      </p>
      <ol className="flex flex-col gap-2">
        {kit.schedule.days.map((day) => (
          <li key={day.day} className="rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Day {day.day}</span>
              <span className="text-sm text-slate-500">{day.minutes} min</span>
            </div>
            <p className="text-sm text-slate-600">{day.focus}</p>
            <p className="text-xs text-slate-400">{day.question_ids.length} question(s)</p>
          </li>
        ))}
      </ol>
      {kit.coverage.uncovered_requirement_ids.length > 0 && (
        <p className="text-sm text-amber-600">
          {kit.coverage.uncovered_requirement_ids.length} requirement(s) still have no question covering them.
        </p>
      )}
    </section>
  );
}
