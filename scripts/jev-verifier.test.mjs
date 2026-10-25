import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidence, verifyEvidenceFiles } from "./jev-verifier.mjs";

const observations = [
  { id: "build-1", kind: "build", status: "verified" },
  { id: "test-1", kind: "test", status: "verified" },
  { id: "diff-1", kind: "diff", status: "verified" },
  { id: "review-1", kind: "review", status: "verified" },
  { id: "observed-1", kind: "smoke", status: "observed" },
];
const refs = ["build-1", "test-1", "diff-1", "review-1"];

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "APPROVE", confidence: 0.91, stopReason: "stop" },
}).decision, "APPROVE");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: ["build-1", "test-1"],
  jevDecision: { decision: "APPROVE", confidence: 0.99, stopReason: "stop" },
}).decision, "INSUFFICIENT_EVIDENCE");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: [...refs, "observed-1"],
  jevDecision: { decision: "APPROVE", confidence: 0.99, stopReason: "stop" },
}).decision, "INSUFFICIENT_EVIDENCE");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "REQUEST_CHANGES", confidence: 0.82, stopReason: "stop" },
}).decision, "REQUEST_CHANGES");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "APPROVE", confidence: 0.99, stopReason: "stop" },
  conflict: true,
}).decision, "BLOCKED");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "INSUFFICIENT_EVIDENCE", confidence: 0.2, stopReason: "stop" },
}).decision, "INSUFFICIENT_EVIDENCE");

assert.equal(verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "APPROVE", confidence: 0.99, stopReason: "error" },
}).decision, "BLOCKED");

assert.throws(() => verifyEvidence({
  observations,
  evidenceRefs: refs,
  jevDecision: { decision: "NOT_A_DECISION", stopReason: "stop" },
}), /Unsupported Jev decision/);

const tempRoot = await mkdtemp(join(tmpdir(), "jev-verifier-"));
await mkdir(tempRoot, { recursive: true });
await writeFile(join(tempRoot, "OBSERVATIONS.jsonl"), `${observations.map((item) => JSON.stringify(item)).join("\n")}\n`);
const fileVerdict = await verifyEvidenceFiles({
  workDir: tempRoot,
  evidenceRefs: refs,
  jevDecision: { decision: "APPROVE", confidence: 0.91, stopReason: "stop" },
});
assert.equal(fileVerdict.decision, "APPROVE");
assert.equal(JSON.parse(await readFile(join(tempRoot, "VERDICT.json"), "utf8")).decision, "APPROVE");

console.log("Jev Verifier scenarios passed: approve, insufficient, unverified, request changes, blocked, explicit insufficient, provider error, invalid decision, filesystem integration");
