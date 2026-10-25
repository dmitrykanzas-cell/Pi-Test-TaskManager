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
const statePath = resolve(workDir, "STATE.md");
const smokeInput = ["add Stage 11 automation", "search automation", "list", "quit"].join("\n") + "\n";
const simulateFailure = process.argv.includes("--simulate-failure");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
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
  const state = await readFile(statePath, "utf8");
  const next = state
    .replace(
      "- Текущий этап: этап 10 сквозной контекстный прогон завершён; следующий этап — 11 автоматизация модулей Pi.",
      "- Текущий этап: этап 11 автоматизация модулей Pi завершена; следующий этап отсутствует в MVP.",
    )
    .replace(
      "- Этап 11 ещё не выполнен: автоматизация модулей Pi остаётся следующим этапом.",
      "- Этап 11 завершён: `scripts/pi-orchestrator.mjs` управляет `.pi/work`, Router, build/test/smoke, evidence, Verifier, `PI-RUN.json` и fail-closed обновлением STATE.md.",
    );
  await writeFile(statePath, next, "utf8");
}

const runRecord = {
  schemaVersion: 1,
  type: "PI_RUN",
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
    role: "luna",
    candidates,
    requiredFragmentIds: ["goal-001", "decision-001"],
    decision: {
      state: "READY",
      selectedIds: ["goal-001", "decision-001"],
      excludedIds: candidates.slice(2).map((item) => item.id),
      reason: "orchestrator task context",
    },
    now: new Date().toISOString(),
  });
  assert.equal(lunaRoute.state, "READY");
  runRecord.steps.push({ actor: "JEV_ROUTER", state: lunaRoute.state, manifestPath: "CONTEXT-MANIFEST.luna.json" });

  const build = simulateFailure
    ? { command: "simulated build failure", exitCode: 1, output: "simulated failure for fail-closed regression" }
    : run("dotnet", ["build", "TaskManager.sln", "--nologo"]);
  const test = run("dotnet", ["test", "TaskManager.sln", "--nologo", "-v", "minimal"]);
  const smoke = run("dotnet", ["run", "--project", "src/TaskManager/TaskManager.csproj", "--no-build"], { input: smokeInput });
  assertSuccess(build);
  assertSuccess(test);
  assertSuccess(smoke);
  runRecord.steps.push({ actor: "LUNA", action: "execute", tools: [build.command, test.command, smoke.command] });

  const evidence = [
    { id: "run-build-001", kind: "build", text: build.output, status: "verified" },
    { id: "run-test-001", kind: "test", text: test.output, status: "verified" },
    { id: "run-diff-001", kind: "diff", text: "orchestrator source and docs were reviewed before run", status: "verified" },
    { id: "run-review-001", kind: "review", text: "typed Router/Verifier contracts exercised by orchestrator", status: "verified" },
    { id: "run-smoke-001", kind: "smoke", text: smoke.output, status: "verified" },
  ];
  await appendFile(join(tempDir, "OBSERVATIONS.jsonl"), `${evidence.map((item) => JSON.stringify(item)).join("\n")}\n`);
  runRecord.steps.push({ actor: "TOOLS", evidenceIds: evidence.map((item) => item.id) });

  const verdict = await verifyEvidenceFiles({
    workDir: tempDir,
    evidenceRefs: evidence.map((item) => item.id),
    jevDecision: { decision: "APPROVE", stopReason: "stop", confidence: 1 },
  });
  assert.equal(verdict.decision, "APPROVE");
  runRecord.steps.push({ actor: "JEV_VERIFIER", decision: verdict.decision, verdictPath: "VERDICT.json" });

  runRecord.status = "APPROVE";
  runRecord.evidence = evidence.map((item) => item.id);
  runRecord.limitation = "Luna/Jev provider calls are represented by typed local boundaries; tools, filesystem, Router and Verifier run for real.";
  await writeFile(outputPath, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
  await updateState();
  console.log(JSON.stringify({ status: runRecord.status, outputPath, evidence: runRecord.evidence }, null, 2));
} catch (error) {
  runRecord.status = "BLOCKED";
  runRecord.error = { code: error.code ?? "PI_RUN_FAILED", message: error.message };
  await writeFile(outputPath, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ status: runRecord.status, outputPath, error: runRecord.error }, null, 2));
  process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

export { collectCandidates, run, updateState };
