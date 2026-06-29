import { z } from "zod";

// Single source of truth for the code review output shape, shared between the
// system prompt (prompt.ts) and the entry script's response validation.
//
// Cursor SDK's Agent.prompt() has no native structured-output / JSON-schema
// enforcement, so this schema is used purely for *validation* of the model's
// free-text JSON response (via safeParse), not for an `outputFormat`-style
// contract like Claude Agent SDK or Vercel AI SDK. That also means there is
// zero structural min/max enforcement on the score fields below — the 1-10
// scale lives only in each field's `.describe()`, which is the one lever we
// have to steer the model's output range.
export const ReviewSchema = z.object({
  implementationCorrectness: z
    .number()
    .describe(
      "Implementation correctness: does the code do what it claims to do (scale 1-10, 1 = broken, 10 = correct)",
    ),
  idiomaticity: z
    .number()
    .describe(
      "Idiomaticity: adherence to language and project conventions (scale 1-10, 1 = unidiomatic, 10 = idiomatic)",
    ),
  complexity: z
    .number()
    .describe(
      "Complexity: simplicity of the solution relative to the problem (scale 1-10, 1 = overcomplicated, 10 = simple)",
    ),
  testRiskCoverage: z
    .number()
    .describe(
      "Test coverage proportional to risk of the changed paths (scale 1-10, 1 = risky paths untested, 10 = well covered)",
    ),
  securitySafety: z
    .number()
    .describe("Security: absence of vulnerabilities and secret leaks (scale 1-10, 1 = unsafe, 10 = safe)"),
  documentation: z
    .number()
    .describe(
      "Documentation: non-obvious decisions and public surfaces explained where needed (scale 1-10, 1 = opaque, 10 = just enough docs)",
    ),
  verdict: z.enum(["pass", "fail"]).describe("Binding verdict for the whole change"),
  summary: z.string().describe("Markdown summary (2-3 sentences), ready to use as a PR comment"),
});

export type Review = z.infer<typeof ReviewSchema>;
