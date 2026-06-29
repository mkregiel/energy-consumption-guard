/* eslint-disable no-console */
// Usage: git diff | npx tsx scripts/review.ts  (or: git diff | npm run review --silent)
// Requires CURSOR_API_KEY. CURSOR_REVIEW_MODEL is optional (defaults to "composer-2.5").
import { Agent } from "@cursor/sdk";
import { ReviewSchema } from "./review/schema";
import { REVIEW_SYSTEM_PROMPT } from "./review/prompt";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

async function main(): Promise<void> {
  const diff = await readStdin();

  const result = await Agent.prompt(`${REVIEW_SYSTEM_PROMPT}\n\n${diff}`, {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: process.env.CURSOR_REVIEW_MODEL ?? "composer-2.5" },
    local: { cwd: process.cwd() },
  });

  if (result.status !== "finished") {
    throw new Error(`Cursor agent did not finish (status: ${result.status}). ${result.result ?? ""}`.trim());
  }

  const raw = result.result ?? "";
  const candidate = extractJson(raw);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch {
    console.error("Failed to parse agent response as JSON. Raw response (truncated):");
    console.error(raw.slice(0, 2000));
    process.exit(1);
    return;
  }

  const parsed = ReviewSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error("Agent response did not match the expected review schema:");
    console.error(parsed.error.toString());
    console.error("Raw response (truncated):");
    console.error(raw.slice(0, 2000));
    process.exit(1);
    return;
  }

  console.log(JSON.stringify(parsed.data, null, 2));
  process.exit(parsed.data.verdict === "pass" ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
