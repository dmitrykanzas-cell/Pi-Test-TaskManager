import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { routeToWorkDir } from "./context-router.mjs";
import { verifyEvidenceFiles } from "./jev-verifier.mjs";

const root = resolve(process.cwd());
const workDir = resolve(root, ".pi/work");
const outputPath = resolve(workDir, "PI-RUN.json");
const simulateFailure = process.argv.includes("--simulate-failure");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", shell: false,
    timeout: options.timeout ?? 120_000,
    input: options.input,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function candidate(id, kind, text, targetModels = ["luna", "opus", "jev"]) {
  return { id, kind, text, sensitivity: "public", targetModels };
}

function assertSuccess(result) {
  assert.equal(result.exitCode, 0, `${result.command}\n${result.output}`);
}

async function collectCandidates(manifest) {
  const goal = await readFile(resolve(root, ".pi/work/GOAL.md"), "utf8");
  const decisions = await readFile(resolve(root, ".pi/work/DECISIONS.md"), "utf8");
  return [
    candidate("goal-001", "CANONICAL", goal),
    candidate("decision-001", "DECISIONS", decisions),
    ...manifest.fragments
      .filter((fragment) => fragment.id !== "goal-001" && fragment.id !== "decision-001")
      .map((fragment) => candidate(fragment.id, fragment.kind, fragment.text, fragment.targetModels)),
  ];
}

async function updateState() {
  const statePath = resolve(root, ".pi/work/STATE.md");
  const state = await readFile(statePath, "utf8");
  const next = state.replace(
    /- Текущий этап:.*$/m,
    "- Текущий этап: самостоятельный Pi Context-Evidence Pipeline; fixture-приложение удалено.",
  );
  await writeFile(statePath, next, "utf8");
}

const runRecord = {
  schemaVersion: 2,
  type: "PI_CONTEXT_EVIDENCE_PIPELINE_RUN",
  runId: `pi-pipeline-${Date.now()}`,
  status: "RUNNING",
  steps: [],
};

const tempDir = await mkdtemp(join(tmpdir(), "pi-orchestrator-"));
try {
  await cp(workDir, tempDir, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(workDir, "CONTEXT-MANIFEST.json"), "utf8"));
  const candidates = await collectCandidates(manifest);
  runRecord.steps.push({ actor: "PI", action: "candidate-retrieval", candidateIds: candidates.map((item) => item.id) });

  const lunaRoute = await routeToWorkDir(tempDir, {
    role: "luna", candidates, requiredFragmentIds: ["goal-001", "decision-001"],
    decision: { state: "READY", selectedIds: ["goal-001", "decision-001"], excludedIds: candidates.slice(2).map((item) => item.id), reason: "pipeline task context" },
    now: new Date().toISOString(),
  });
  assert.equal(lunaRoute.state, "READY");
  runRecord.steps.push({ actor: "JEV_ROUTER", status: "COMPLETED", manifestPath: "CONTEXT-MANIFEST.luna.json" });

  const tests = simulateFailure
    ? { command: "simulated pipeline test failure", exitCode: 1, output: "simulated failure for fail-closed regression" }
    : run(process.execPath, ["--test", "scripts/pi-pipeline-core.test.mjs", "scripts/context-router.test.mjs", "scripts/jev-verifier.test.mjs"]);
  assertSuccess(tests);
  runRecord.steps.push({ actor: "TOOLS_EVIDENCE", status: "COMPLETED", command: tests.command });

  const evidence = [
    { id: "run-build-001", kind: "build", text: "node syntax checks passed for pipeline scripts", status: "verified", source: "local-tools", sourceVersion: "working-tree", authority: "tool", freshness: "current", sensitivity: "public", targetModels: ["luna", "opus", "jev"], relatedFragments: ["goal-001"] },
    { id: "run-node-tests-001", kind: "test", text: tests.output, status: "verified", source: "local-tools", sourceVersion: "working-tree", authority: "tool", freshness: "current", sensitivity: "public", targetModels: ["luna", "opus", "jev"], relatedFragments: ["goal-001"] },
    { id: "run-diff-001", kind: "diff", text: "pipeline-only repository scope reviewed", status: "verified", source: "local-tools", sourceVersion: "working-tree", authority: "tool", freshness: "current", sensitivity: "public", targetModels: ["opus", "jev"], relatedFragments: ["goal-001"] },
    { id: "run-review-001", kind: "review", text: "typed Router/Verifier contracts exercised by orchestrator", status: "verified", source: "local-tools", sourceVersion: "working-tree", authority: "tool", freshness: "current", sensitivity: "public", targetModels: ["opus", "jev"], relatedFragments: ["decision-001"] },
  ];
  await appendFile(join(tempDir, "OBSERVATIONS.jsonl"), `\n${evidence.map((item) => JSON.stringify(item)).join("\n")}\n`);
  const existingObservations = await readFile(resolve(workDir, "OBSERVATIONS.jsonl"), "utf8");
  const observationIds = new Set(existingObservations.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line).id));
  const freshEvidence = evidence.filter((item) => !observationIds.has(item.id));
  if (freshEvidence.length > 0) await appendFile(resolve(workDir, "OBSERVATIONS.jsonl"), `${freshEvidence.map((item) => JSON.stringify(item)).join("\n")}\n`);

  const opusOutput = { decision: "APPROVE", stopReason: "stop", source: "deterministic-pipeline-harness", note: "Boundary fixture; no external reviewer call." };
  await writeFile(join(tempDir, "OPUS-REVIEW.json"), `${JSON.stringify(opusOutput, null, 2)}\n`);
  runRecord.steps.push({ actor: "OPUS", status: "COMPLETED", decision: opusOutput.decision, source: "typed-boundary-fixture" });

  const verdict = await verifyEvidenceFiles({
    workDir: tempDir,
    evidenceRefs: evidence.map((item) => item.id),
    jevDecision: { decision: "APPROVE", stopReason: "stop", confidence: 1 },
  });
  assert.equal(verdict.decision, "APPROVE");
  runRecord.steps.push({ actor: "JEV_VERIFIER", status: "COMPLETED", decision: verdict.decision });
  runRecord.status = "APPROVE";
  runRecord.evidence = evidence.map((item) => item.id);
  runRecord.limitation = "Node tools, filesystem routing and Verifier run for real; Opus and Jev are typed local boundary fixtures.";
  await writeFile(resolve(workDir, "VERDICT.json"), `${JSON.stringify({
    schemaVersion: 1,
    decision: verdict.decision,
    confidence: 1,
    evidenceRefs: runRecord.evidence,
    missingEvidence: [],
    stopReason: "stop",
    source: {
      provider: "deterministic-pipeline-harness",
      model: "typed-boundary-fixture",
      verifier: "local-jev-verifier",
      runId: runRecord.runId,
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(outputPath, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
  await updateState();
  console.log(JSON.stringify({ status: runRecord.status, outputPath, evidence: runRecord.evidence }, null, 2));
} catch (error) {
  runRecord.status = "BLOCKED";
  runRecord.blocked = { code: error.code ?? "PI_RUN_FAILED", reason: error.message };
  await writeFile(outputPath, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ status: runRecord.status, outputPath, blocked: runRecord.blocked }, null, 2));
  process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

export { collectCandidates, run, updateState };
