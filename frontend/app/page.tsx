import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold">AI Interview Prep Kit</h1>
      <p className="text-slate-600">
        Paste a job description and a company URL. It researches the company, breaks down the
        role, and builds a question bank, flashcards, and a day-by-day study schedule.
      </p>
      <div className="flex gap-3">
        <Link href="/register" className="rounded bg-slate-900 px-4 py-2 font-medium text-white">
          Get started
        </Link>
        <Link href="/login" className="rounded border border-slate-300 px-4 py-2 font-medium">
          Log in
        </Link>
      </div>
    </main>
  );
}
