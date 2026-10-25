import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyOperations, applyToWorkDir } from "./context-manager.mjs";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const work = resolve(root, ".pi/work");
const manifest = JSON.parse(await readFile(resolve(work, "CONTEXT-MANIFEST.json"), "utf8"));
const routingLines = (await readFile(resolve(work, "ROUTING.jsonl"), "utf8"))
  .split(/\r?\n/).filter((line) => line.trim());

const baseOperations = [
  {
    operationId: "add-observation-001",
    operation: "ADD",
    role: "luna",
    reason: "record a new verified observation",
    fragment: {
      id: "observation-stage7-001",
      kind: "OBSERVATIONS",
      text: "Context Manager scenario executed.",
      authority: "tool",
      source: ".pi/work/OBSERVATIONS.jsonl#stage7",
      sourceVersion: "stage-7-test",
      status: "active",
      freshness: "current",
      sensitivity: "public",
      targetModels: ["luna"],
      relatedFragments: [],
    },
  },
  {
    operationId: "update-hypothesis-001",
    operation: "UPDATE",
    role: "luna",
    fragmentId: "hypothesis-001",
    reason: "refresh hypothesis after the scenario",
    patch: { text: "Context Manager can apply typed operations after policy approval.", freshness: "current" },
  },
  {
    operationId: "obsolete-canonical-001",
    operation: "OBSOLETE",
    role: "luna",
    fragmentId: "goal-001",
    reason: "the stage-6 goal is superseded by stage 7",
  },
  {
    operationId: "add-transient-001",
    operation: "ADD",
    role: "luna",
    reason: "create temporary routing context",
    fragment: { id: "transient-stage7-001", kind: "TRANSIENT", text: "temporary context" },
  },
  {
    operationId: "remove-transient-001",
    operation: "REMOVE",
    role: "luna",
    fragmentId: "transient-stage7-001",
    reason: "temporary context is no longer needed",
  },
  {
    operationId: "conflict-001",
    operation: "CONFLICT",
    role: "luna",
    fragmentId: "observation-stage7-001",
    conflictWith: "hypothesis-001",
    reason: "observation and hypothesis require explicit reconciliation",
  },
];

const applied = await applyOperations({ manifest, routingLines, operations: baseOperations, now: "2026-10-25T15:00:00Z" });
const byId = new Map(applied.manifest.fragments.map((fragment) => [fragment.id, fragment]));
assert.equal(byId.get("observation-stage7-001").status, "conflict");
assert.equal(byId.get("observation-stage7-001").conflictWith, "hypothesis-001");
assert.equal(byId.get("hypothesis-001").text, "Context Manager can apply typed operations after policy approval.");
assert.equal(byId.get("goal-001").status, "obsolete");
assert.equal(byId.has("transient-stage7-001"), false);
assert.equal(applied.results.filter((item) => item.result === "APPLIED").length, 6);
assert.equal(applied.routing.slice(-6).every((line) => JSON.parse(line).result === "APPLIED"), true);

const rejectedCanonical = await applyOperations({ manifest, routingLines, operations: [{
  operationId: "reject-canonical-update-001",
  operation: "UPDATE",
  role: "luna",
  fragmentId: "goal-001",
  reason: "attempt to mutate canonical fact",
  patch: { text: "must not apply" },
}] });
assert.equal(rejectedCanonical.results[0].result, "REJECTED");
assert.equal(rejectedCanonical.results[0].errorCode, "POLICY_REJECTED");
assert.equal(rejectedCanonical.manifest.fragments.find((fragment) => fragment.id === "goal-001").text, manifest.fragments.find((fragment) => fragment.id === "goal-001").text);
assert.equal(JSON.parse(rejectedCanonical.routing.at(-1)).result, "REJECTED");

const rejectedTransient = await applyOperations({ manifest, routingLines, operations: [{
  operationId: "reject-transient-remove-001",
  operation: "REMOVE",
  role: "luna",
  fragmentId: "hypothesis-001",
  reason: "attempt to remove non-transient",
}] });
assert.equal(rejectedTransient.results[0].result, "REJECTED");
assert.equal(rejectedTransient.results[0].errorCode, "POLICY_REJECTED");
assert.equal(rejectedTransient.manifest.fragments.some((fragment) => fragment.id === "hypothesis-001"), true);

const rejectedMissing = await applyOperations({ manifest, routingLines, operations: [{
  operationId: "reject-missing-fragment-001",
  operation: "OBSOLETE",
  role: "luna",
  fragmentId: "missing-fragment",
  reason: "attempt to operate on an unknown fragment",
}] });
assert.equal(rejectedMissing.results[0].result, "REJECTED");
assert.equal(rejectedMissing.results[0].errorCode, "POLICY_REJECTED");

const temp = await mkdtemp(resolve(root, ".context-manager-test-"));
try {
  await cp(work, temp, { recursive: true });
  await writeFile(resolve(temp, "operations.json"), JSON.stringify(baseOperations));
  const persisted = await applyToWorkDir(temp, baseOperations);
  const persistedManifest = JSON.parse(await readFile(resolve(temp, "CONTEXT-MANIFEST.json"), "utf8"));
  const persistedRouting = (await readFile(resolve(temp, "ROUTING.jsonl"), "utf8")).trim().split(/\r?\n/);
  assert.equal(persisted.results.filter((item) => item.result === "APPLIED").length, 6);
  assert.equal(persistedManifest.manifestId, persisted.manifest.manifestId);
  assert.equal(persistedRouting.length, routingLines.length + 6);
  const validation = await execFileAsync("node", [resolve(root, "scripts/validate-context-contract.mjs"), temp], { cwd: root });
  assert.match(validation.stdout, /Context contract valid/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("Context Manager scenarios passed: add observation, update hypothesis, obsolete canonical, remove transient, reject canonical mutation, register conflict");
