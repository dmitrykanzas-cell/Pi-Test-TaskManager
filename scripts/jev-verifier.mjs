import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const verifierDecisions = new Set([
  "APPROVE",
  "REQUEST_CHANGES",
  "BLOCKED",
  "INSUFFICIENT_EVIDENCE",
]);

const requiredEvidenceKinds = ["build", "test", "diff", "review"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeDecision(jevDecision) {
  if (!jevDecision || typeof jevDecision !== "object") {
    fail("INVALID_JEV_DECISION", "Jev decision must be an object");
  }
  const { decision, stopReason } = jevDecision;
  if (!verifierDecisions.has(decision)) {
    fail("INVALID_JEV_DECISION", `Unsupported Jev decision: ${decision}`);
  }
  if (stopReason !== "stop") {
    return { decision: "BLOCKED", reason: "Jev did not return a completed decision" };
  }
  return { decision, reason: nonEmpty(jevDecision.reason) ? jevDecision.reason : "Jev typed decision" };
}

export function verifyEvidence({ observations, evidenceRefs, jevDecision, conflict = false }) {
  if (!Array.isArray(observations) || !Array.isArray(evidenceRefs)) {
    fail("INVALID_EVIDENCE_INPUT", "observations and evidenceRefs must be arrays");
  }
  const byId = new Map(observations.map((item) => [item?.id, item]));
  const refs = [...new Set(evidenceRefs)];
  if (refs.length !== evidenceRefs.length || refs.some((ref) => !nonEmpty(ref))) {
    fail("INVALID_EVIDENCE_REFS", "evidenceRefs must contain unique non-empty strings");
  }
  const evidence = refs.map((ref) => byId.get(ref));
  const missingRefs = refs.filter((_ref, index) => !evidence[index]);
  const unverifiedRefs = evidence
    .map((item, index) => (item?.status === "verified" ? null : refs[index]))
    .filter(Boolean);
  const kinds = new Set(evidence.filter(Boolean).map((item) => item.kind));
  const missingKinds = requiredEvidenceKinds.filter((kind) => !kinds.has(kind));
  const normalized = normalizeDecision(jevDecision);

  let decision = normalized.decision;
  const reasons = [normalized.reason];
  if (conflict) {
    decision = "BLOCKED";
    reasons.push("conflicting requirements or evidence");
  } else if (missingRefs.length > 0 || unverifiedRefs.length > 0 || missingKinds.length > 0) {
    decision = "INSUFFICIENT_EVIDENCE";
    if (missingRefs.length) reasons.push(`missing refs: ${missingRefs.join(", ")}`);
    if (unverifiedRefs.length) reasons.push(`unverified refs: ${unverifiedRefs.join(", ")}`);
    if (missingKinds.length) reasons.push(`missing kinds: ${missingKinds.join(", ")}`);
  }

  return {
    schemaVersion: 1,
    decision,
    confidence: typeof jevDecision.confidence === "number" ? jevDecision.confidence : null,
    evidenceRefs: refs,
    missingEvidence: [...missingRefs, ...unverifiedRefs, ...missingKinds.map((kind) => `verified ${kind} evidence`)],
    reason: reasons.join("; "),
    stopReason: "stop",
    source: { type: "jev", decision: normalized.decision },
  };
}

export async function verifyEvidenceFiles({ workDir = ".pi/work", jevDecision, evidenceRefs, conflict = false }) {
  const root = resolve(workDir);
  const observations = (await readFile(resolve(root, "OBSERVATIONS.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const verdict = verifyEvidence({ observations, evidenceRefs, jevDecision, conflict });
  await writeFile(resolve(root, "VERDICT.json"), `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  return verdict;
}

export { requiredEvidenceKinds };
