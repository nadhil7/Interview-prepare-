# AI Interview Prep Kit

You give it a job description, the company's website, and how many days you have until the
interview. It researches the company, reads the job description, and puts together a prep kit:
a short brief on the company, a breakdown of what the role actually wants, a bank of interview
questions grouped by category, flashcards, and a day-by-day study schedule that puts the hardest
and most important material first.

The interesting part isn't the UI, it's the pipeline behind it: crawling a company site politely,
figuring out what's actually being asked for in a JD versus what's just "nice to have," generating
different kinds of interview questions for different rounds, checking that nothing important got
missed, and building a schedule around what's left. None of that is hand-wavy — it's built as
plain, testable code with the LLM used only where it actually adds value.

## Where things stand

Phases 1 through 6 are done: the data model, the retrieval/crawling layer, the generation pipeline,
coverage checking and scheduling, the backend API with job orchestration, and a CLI for batch runs.
The frontend is currently a placeholder page — the real UI (Phase 7) and deployment (Phase 8)
haven't been built yet. Everything described below reflects what's actually implemented and
tested, not what's planned.

## Stack, and why

- **TypeScript everywhere.** One language across the shared pipeline, the API, and the CLI means
  the exact same types and functions get reused instead of re-implemented three times.
- **Node.js + Express** for the backend. Nothing fancy is needed here — it's mostly job
  orchestration and a handful of REST endpoints.
- **Next.js (App Router) + Tailwind** for the frontend, once it's built. Not evaluated yet.
- **MongoDB / Mongoose.** The kit structure is naturally document-shaped (nested arrays of
  requirements, questions, flashcards) — forcing that into relational tables would have meant a
  lot of joins for no real benefit.
- **Google Gemini (`gemini-2.5-flash`, configurable via `GEMINI_MODEL`)** for the generation steps.
  It has a workable free tier, which matters because this whole thing needs to run without a
  billing account attached, and JSON response mode makes structured output reliable enough to
  build on. More on its actual free-tier limits below — they're tighter than you'd guess.
- **Cheerio + the native `fetch`** for crawling. No headless browser — company marketing/careers
  pages are static enough that a browser wasn't worth the overhead.
- **npm workspaces** for the monorepo, with a `pipeline` package that both the backend and the CLI
  import from directly. This was a deliberate choice made partway through the build: the batch CLI
  and the web app have to use the *exact same* generation logic, so that logic lives in one place
  neither of them owns.

## How a kit actually gets built

`pipeline/src/orchestrator/generate-kit.ts` is the whole sequence, and it's the one function both
the backend and the CLI call — there's no second copy of this logic anywhere.

1. **Validate the company URL.** Rejects anything that isn't http(s), and — outside of local
   testing — resolves the hostname and blocks private/loopback/link-local addresses (including the
   cloud metadata address, `169.254.169.254`) before ever fetching it. This is checked before any
   network request goes out.
2. **Crawl the company site.** Starts at the homepage, respects `robots.txt`, and follows real
   links rather than guessing at a fixed set of paths. It ranks links by how much they look like
   hiring or "about us" content, and will go a second hop deep from a careers-looking page so a
   homepage can still lead to a buried interview-process page. Capped on total pages fetched, with
   a bounded-concurrency fetcher and backoff on failures. A site that can't be reached, or turns up
   nothing useful, doesn't fail the kit — it just means the company brief section says so honestly
   instead of making something up.
3. **Search for public discussion of the interview process** (Glassdoor-style threads, blog posts,
   whatever turns up) through a keyless search, so there's no second API key to manage. Same
   principle: nothing found means the kit says nothing was found.
4. **Extract requirements from the JD** with one LLM call, explicitly instructed on the difference
   between "5+ years required" and "bonus points for" — priority comes from the actual wording, not
   a guess. A two-line JD produces a couple of honestly-thin requirements, not a padded list.
5. **Generate the company brief**, grounded only in whatever text was actually retrieved. Zero
   pages retrieved means zero LLM call here at all — there's nothing to ground a summary in, so it
   doesn't try.
6. **Generate questions**, one call per category — technical, behavioural, system design,
   company-fit — never a single call asked to produce everything. A company whose careers page
   mentions a take-home and a system-design round will visibly shape the system-design questions
   differently than one that publishes nothing about its process.
7. **Check coverage and fill gaps.** This part is plain code, not the model: it checks which
   requirements ended up with zero questions pointing at them, and if any did, runs one more
   scoped pass for just those. Capped at two passes total (see the design notes further down for
   why), and it never fakes the results — if something's still missing after that, it's recorded
   as such.
8. **Build flashcards** from whatever requirements and questions exist.
9. **Build the schedule.** Also plain code: score every question (a question tied to a "must-have"
   requirement always outranks a "nice-to-have" one, difficulty breaks ties), sort, and hand out
   the highest-scoring material to the earliest days. The idea is that the hardest, most important
   stuff shouldn't land the night before the interview.
10. **Validate the whole thing** against a Zod schema before it's returned or saved. If it doesn't
    match, the kit is treated as failed rather than persisted half-broken.

At every step that touches the LLM, whatever came from the internet or the pasted job description
is wrapped and explicitly marked as data to read, not instructions to follow — so a job posting (or
a scraped page) can't quietly hijack the prompt.

## What happens when the LLM fails, or isn't there at all

Every generation step has a plain-code fallback that kicks in if Gemini is unavailable after
retries, or if there's simply no API key configured. Requirement extraction falls back to
splitting the JD into lines and reusing that text directly. Questions fall back to one templated
question per requirement, reusing the requirement's own wording. Flashcards fall back to turning
whatever questions already exist into cards. None of these fallbacks invent anything — they only
reuse text that was already there. This isn't a theoretical safety net: running the batch CLI
against a fully rate-limited API key (see below) exercised this path for real, and it produced a
complete, valid kit every time.

## The free tier is tighter than it looks

While testing the batch CLI against a real key, `gemini-2.5-flash`'s free tier turned out to allow
**5 requests per minute and 20 requests per day** for that project. A single kit can need up to
around 11 Gemini calls in the worst case (1 for extraction, 1 for the brief, 4 for the question
categories, up to 4 more for a coverage gap-fill pass, 1 for flashcards), so a handful of kits in
one day can burn through that daily allowance fast — after which every further call gets a 429 and
falls back to the heuristic path described above.

The good news from that same test: a 5-case batch run still completed in under a minute even while
hitting that quota wall repeatedly (114 separate 429 responses across the run), because retries are
capped and back off quickly rather than hanging, and the fallback kicks in immediately once retries
are exhausted. That's comfortably inside the 15-minutes-for-5-cases target, just not with every kit
fully LLM-generated if the daily quota is already spent. Worth knowing before assuming a "failed"
number means something broke — it might just mean the day's quota ran out.

A single case run against fresh quota, for comparison, came back fully LLM-generated in well under
a minute with genuinely good output (real synthesized company summaries, questions specific to the
company and role, not templated text).

## Generated, edited, and pinned content

Every question and flashcard carries two extra fields beyond the graded structure: `origin`
(`"generated"` or `"user"`) and `status` (`"pristine"`, `"edited"`, or `"pinned"`). This is what
makes "regenerate just the technical questions" safe: regenerating a section only replaces items
that are still `generated` + `pristine`. Anything the user touched or pinned is left alone, and
coverage is rechecked against the merged result afterward. Regeneration doesn't re-run the full
gap-fill loop — if the one fresh LLM call leaves a must-have requirement uncovered, the whole
regeneration is rejected before anything is saved, rather than risking a half-broken kit. The user
just tries again.

## Batch evaluation

```
cp .env.example .env   # fill in GEMINI_API_KEY (and GEMINI_MODEL if you need to override it)
npm install
npm run evaluate -- --input cases.json --output kits.json
```

`npm install` builds the shared `pipeline` package automatically (via a `prepare` script) — there's
no separate build step to remember. `cases.json` is a plain array:

```json
[{ "id": "case-01", "jd": "Senior Backend Engineer\n\n...", "company_url": "https://example.com/", "days": 5 }]
```

The output is one entry per case, in the same order they came in, each either `"ok"` with a kit
attached or `"failed"` with a `{code, message}` explaining why. A case that only got partial
research — no hiring page found, nothing turned up in search — is still `"ok"`; the gap is recorded
honestly inside the kit rather than counted as a failure. `"failed"` is reserved for cases where no
kit could be produced at all: an unreachable/rejected company URL, or a result that didn't pass
structure validation. One bad case never stops the rest of the batch from running.

Two separate concurrency limits are in play: how many cases run at once (default 3, mostly to
avoid hammering memory/network with everything crawling simultaneously), and how many Gemini
requests are in flight across the whole run at once (default 2, shared across every case in the
process) — raising the first doesn't multiply the second, since every LLM call funnels through the
same limiter.

## Local development

```
cp .env.example .env
npm install
npm test
npm run dev:backend
npm run dev:frontend
```

`npm test` runs the test suites for every workspace — 165+ tests as of Phase 6, covering the SSRF
guard, link ranking, robots.txt parsing, the coverage checker and schedule allocator, requirement
extraction (including the fallback path), the full generation pipeline end-to-end against a mocked
LLM, the backend's job state machine, section regeneration and its pin-safety guarantees, and the
CLI's batch behavior including the ok-vs-failed boundary described above.

## A few known rough edges

- The "same company, different subdomain" check used while crawling is a simple last-two-labels
  heuristic. It works for `acme.com` and `careers.acme.com`, but gets it wrong for multi-part TLDs
  like `acme.co.uk`. Not a public-suffix-list implementation, on purpose — wasn't worth the
  dependency for this scope.
- There's no automatic recovery if a backend generation job partially completes and the process
  crashes mid-run — well, actually there is: a sweep marks anything stuck past 5 minutes as failed
  and lets you resubmit, and it also runs at startup so a crash doesn't leave a job stuck forever.
  But it can't resume a run partway through; it just fails clean and lets you try again.
- Section regeneration checks coverage but doesn't re-run the gap-fill loop if the fresh content
  leaves something uncovered — it just rejects the regeneration outright. Simple and safe, but it
  means an occasional regenerate click needs a retry.
- The frontend is a single placeholder page right now. No auth UI, no builder view, no practice
  mode yet — that's Phase 7.
