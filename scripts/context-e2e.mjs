import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { routeToWorkDir } from "./context-router.mjs";
import { verifyEvidenceFiles } from "./jev-verifier.mjs";

const root = resolve(process.cwd());
const sourceWorkDir = resolve(root, ".pi/work");
const persistTrace = process.argv.includes("--persist-trace");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
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

const workDir = await mkdtemp(join(tmpdir(), "pi-context-e2e-"));
const trace = {
  schemaVersion: 1,
  type: "CONTEXT_E2E",
  startedAt: new Date().toISOString(),
  actors: ["REQUEST", "PI", "JEV_ROUTER", "LUNA", "TOOLS", "OPUS", "JEV_VERIFIER", "HUMAN"],
  steps: [],
};

try {
  await cp(sourceWorkDir, workDir, { recursive: true });
  const baseManifest = JSON.parse(await readFile(join(workDir, "CONTEXT-MANIFEST.json"), "utf8"));
  const request = {
    id: "request-stage-10-001",
    text: "Проверить воспроизводимый контекстный прогон TaskManager.",
    requiredFragmentIds: ["goal-001", "decision-001"],
  };
  trace.steps.push({ actor: "REQUEST", output: request });

  const candidates = [
    candidate("goal-001", "CANONICAL", baseManifest.fragments.find((item) => item.id === "goal-001")?.text ?? "goal"),
    candidate("decision-001", "DECISIONS", baseManifest.fragments.find((item) => item.id === "decision-001")?.text ?? "decision"),
    candidate("e2e-criteria-001", "TASK_STATE", "Stage 10 requires Router, Luna, tools, Opus and Verifier outputs."),
  ];
  trace.steps.push({
    actor: "PI",
    action: "candidate-retrieval",
    input: request,
    output: { candidateIds: candidates.map((item) => item.id) },
  });

  const lunaRoute = await routeToWorkDir(workDir, {
    role: "luna",
    candidates,
    requiredFragmentIds: request.requiredFragmentIds,
    decision: {
      state: "READY",
      selectedIds: ["goal-001", "decision-001"],
      excludedIds: ["e2e-criteria-001"],
      reason: "Luna receives task and governing decisions only",
    },
    now: "2026-10-25T14:00:00.000Z",
  });
  assert.equal(lunaRoute.state, "READY");
  trace.steps.push({
    actor: "JEV_ROUTER",
    role: "luna",
    output: { state: lunaRoute.state, manifestId: lunaRoute.manifest.manifestId, selectedIds: lunaRoute.selected.map((item) => item.id) },
  });
  assert.equal(lunaRoute.manifest.role, "luna");

  const toolEvidence = [
    run("dotnet", ["build", "TaskManager.sln", "--nologo"]),
    run("dotnet", ["test", "TaskManager.sln", "--nologo", "-v", "minimal"]),
    run("git", ["diff", "--check"]),
  ];
  assert.equal(toolEvidence[0].exitCode, 0, toolEvidence[0].output);
  assert.equal(toolEvidence[1].exitCode, 0, toolEvidence[1].output);
  assert.equal(toolEvidence[2].exitCode, 0, toolEvidence[2].output);
  trace.steps.push({ actor: "LUNA", output: { status: "executed", toolCount: toolEvidence.length } });

  const evidence = [
    { id: "e2e-build-001", kind: "build", text: toolEvidence[0].output, status: "verified" },
    { id: "e2e-test-001", kind: "test", text: toolEvidence[1].output, status: "verified" },
    { id: "e2e-diff-001", kind: "diff", text: toolEvidence[2].output || "git diff --check passed", status: "verified" },
    { id: "e2e-review-001", kind: "review", text: "Opus input contract reviewed by the deterministic E2E harness.", status: "verified" },
  ];
  await appendFile(join(workDir, "OBSERVATIONS.jsonl"), `${evidence.map((item) => JSON.stringify(item)).join("\n")}\n`);
  trace.steps.push({ actor: "TOOLS", output: { evidenceIds: evidence.map((item) => item.id) } });

  const opusCandidates = [
    ...candidates.filter((item) => item.id !== "e2e-criteria-001"),
    candidate("e2e-diff-001", "OBSERVATIONS", evidence[2].text, ["opus", "jev"]),
    candidate("e2e-criteria-001", "TASK_STATE", "Review diff against Stage 10 criteria.", ["opus", "jev"]),
  ];
  const opusRoute = await routeToWorkDir(workDir, {
    role: "opus",
    candidates: opusCandidates,
    requiredFragmentIds: ["goal-001", "decision-001", "e2e-diff-001"],
    decision: {
      state: "READY",
      selectedIds: ["goal-001", "decision-001", "e2e-diff-001", "e2e-criteria-001"],
      excludedIds: ["e2e-criteria-001"],
      reason: "Opus receives a separate review manifest with criteria and diff evidence",
    },
    now: "2026-10-25T14:01:00.000Z",
  });
  assert.equal(opusRoute.state, "READY");
  trace.steps.push({
    actor: "JEV_ROUTER",
    role: "opus",
    output: { state: opusRoute.state, manifestId: opusRoute.manifest.manifestId, selectedIds: opusRoute.selected.map((item) => item.id) },
  });
  assert.equal(opusRoute.manifest.role, "opus");
  assert.notEqual(lunaRoute.manifest.manifestId, opusRoute.manifest.manifestId);

  const opusOutput = {
    decision: "APPROVE",
    stopReason: "stop",
    confidence: 1,
    source: "deterministic-e2e-harness",
    note: "This is a typed fixture for the local pipeline boundary, not an external Opus call.",
  };
  await writeFile(join(workDir, "OPUS-REVIEW.json"), `${JSON.stringify(opusOutput, null, 2)}\n`);
  trace.steps.push({ actor: "OPUS", input: { manifest: opusRoute.routedPath }, output: opusOutput });

  const evidenceRefs = evidence.map((item) => item.id);
  const approveVerdict = await verifyEvidenceFiles({
    workDir,
    evidenceRefs,
    jevDecision: { decision: "APPROVE", stopReason: "stop", confidence: 1 },
  });
  assert.equal(approveVerdict.decision, "APPROVE");
  trace.steps.push({ actor: "JEV_VERIFIER", branch: "APPROVE", output: approveVerdict });

  const insufficientVerdict = await verifyEvidenceFiles({
    workDir,
    evidenceRefs: ["e2e-build-001", "e2e-test-001"],
    jevDecision: { decision: "APPROVE", stopReason: "stop", confidence: 1 },
  });
  assert.equal(insufficientVerdict.decision, "INSUFFICIENT_EVIDENCE");
  trace.steps.push({ actor: "JEV_VERIFIER", branch: "INSUFFICIENT_EVIDENCE", output: insufficientVerdict });

  trace.steps.push({
    actor: "HUMAN",
    output: { finalDecision: "manual approval remains outside the harness", commit: "not performed by E2E harness" },
  });
  trace.completedAt = new Date().toISOString();
  trace.result = "PASS";
  trace.limitation = "Opus and Jev calls are represented by typed boundary fixtures; build/test and filesystem routing/verifier paths are real.";

  if (persistTrace) {
    await writeFile(resolve(sourceWorkDir, "E2E-TRACE.json"), `${JSON.stringify(trace, null, 2)}\n`);
  }
  console.log(JSON.stringify({ result: trace.result, workDir, persisted: persistTrace, branches: [approveVerdict.decision, insufficientVerdict.decision] }, null, 2));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
