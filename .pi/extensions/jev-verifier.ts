import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Observation = {
  id: string;
  kind: string;
  text: string;
  status: string;
};

type Verdict = {
  schemaVersion: 1;
  decision: "APPROVE" | "REQUEST_CHANGES" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
  confidence: number;
  evidenceRefs: string[];
  missingEvidence: string[];
  stopReason: "stop" | "error";
  source: {
    provider: string;
    model: string;
    api: string;
    verifier: string;
    jevApproved: boolean | null;
  };
};

const requiredEvidence = ["build", "test", "diff", "review"];

async function loadObservations(path: string): Promise<Observation[]> {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Observation);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("jev-verify", {
    description: "Run Jev Verifier against the current evidence set",
    handler: async (_args, ctx) => {
      const workDir = resolve(process.cwd(), ".pi/work");
      const observationsPath = resolve(workDir, "OBSERVATIONS.jsonl");
      const verdictPath = resolve(workDir, "VERDICT.json");
      const observations = await loadObservations(observationsPath);
      const verified = observations.filter((item) => item.status === "verified");
      const verifiedKinds = new Set(verified.map((item) => item.kind));
      const missingEvidence = requiredEvidence
        .filter((kind) => !verifiedKinds.has(kind))
        .map((kind) => `verified ${kind} evidence`);

      const jev = ctx.modelRegistry.findOfType(
        "classifier",
        "anymodel",
        "jev/jev-latest",
      );

      if (!jev) {
        throw new Error("Jev classifier is not available");
      }

      const result = await ctx.modelRegistry.classify(jev, {
        state: {
          evidence: verified.map(({ id, kind, text }) => ({ id, kind, text })),
          policy: "Approve only when build, test, diff and independent review evidence are verified.",
          missingEvidence,
        },
        questions: {
          approved: {
            type: "bool",
            instructions: "Which typed final decision follows from the evidence for stage 9? Return true only for APPROVE; false means the policy layer must keep the result non-approving.",
            criteria: {
              true: "All mandatory evidence is present and verified; policy may produce APPROVE",
              false: "Evidence is missing/unverified or the policy must produce REQUEST_CHANGES, BLOCKED, or INSUFFICIENT_EVIDENCE",
            },
          },
        },
      });

      const approvedAnswer = result.answers.approved;
      const jevApproved = result.stopReason === "stop" && approvedAnswer?.type === "bool"
        ? approvedAnswer.probability >= 0.5
        : null;
      const decision = jevApproved === true && missingEvidence.length === 0
        ? "APPROVE"
        : "INSUFFICIENT_EVIDENCE";
      const verdict: Verdict = {
        schemaVersion: 1,
        decision,
        confidence: result.stopReason === "stop"
          ? result.answers.approved?.probability ?? 0
          : 0,
        evidenceRefs: verified.map((item) => item.id),
        missingEvidence,
        stopReason: result.stopReason === "stop" ? "stop" : "error",
        source: {
          provider: "anymodel",
          model: "jev/jev-latest",
          api: "typesafe-system-one",
          verifier: "jev-verify",
          jevApproved,
        },
      };

      await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
      ctx.ui.notify(`Jev Verifier: ${decision}`, decision === "APPROVE" ? "info" : "warning");
    },
  });
}
