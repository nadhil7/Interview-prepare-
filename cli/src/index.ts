/**
 * `npm run evaluate -- --input <cases.json> --output <kits.json>`
 *
 * Phase 1 stub — argument parsing only, to prove the workspace wiring.
 * Real batch orchestration (calling the shared pipeline's generation entry
 * point, bounded concurrency, retry/error handling per Appendix B) lands in
 * Phase 6, once the pipeline's retrieval/generation modules exist.
 */
import "@aipk/pipeline";

function parseArgs(argv: string[]): { input?: string; output?: string } {
  const args: { input?: string; output?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
    if (argv[i] === "--output") args.output = argv[++i];
  }
  return args;
}

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(1);
  }
  console.log(`(stub) would read cases from ${input} and write kits to ${output}`);
}

main();
