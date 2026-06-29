/* eslint-disable no-console */
// Usage (local):  git diff | npx tsx scripts/review.ts
// Usage (CI):     REVIEW_DIFF="..." npx tsx scripts/review.ts
// Requires CURSOR_API_KEY. CURSOR_REVIEW_MODEL is optional (defaults to "composer-2.5").
import { appendFileSync } from "node:fs";
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

function buildPromptInput(diff: string): string {
  const sections: string[] = [];

  const prTitle = process.env.REVIEW_PR_TITLE;
  const prBody = process.env.REVIEW_PR_BODY;

  if (prTitle) sections.push(`## PR Title\n\n${prTitle}`);
  if (prBody) sections.push(`## PR Description\n\n${prBody}`);
  sections.push(diff);

  return sections.join("\n\n");
}

function writeGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `${key}=${value}\n`, "utf8");
}

async function main(): Promise<void> {
  const ciDiff = process.env.REVIEW_DIFF;
  const diff = ciDiff ?? (await readStdin());

  const lineCount = diff.split("\n").length;
  if (lineCount > 500) {
    console.error(`WARNING: Large diff (${lineCount} lines) — review quality may be reduced`);
    writeGitHubOutput("REVIEW_LARGE_DIFF", "true");
  }

  const promptInput = buildPromptInput(diff);

  const result = await Agent.prompt(`${REVIEW_SYSTEM_PROMPT}\n\n${promptInput}`, {
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

  const json = JSON.stringify(parsed.data, null, 2);
  console.log(json);
  writeGitHubOutput("result", JSON.stringify(parsed.data));
  writeGitHubOutput("verdict", parsed.data.verdict);
  process.exit(parsed.data.verdict === "pass" ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
