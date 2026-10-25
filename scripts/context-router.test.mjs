import assert from "node:assert/strict";
import { routeCandidates } from "./context-router.mjs";

const baseManifest = {
  schemaVersion: 1,
  manifestId: "stage-7-context-001",
  role: "luna",
  status: "READY",
  fragments: [],
};

const candidates = [
  { id: "goal-001", kind: "CANONICAL", text: "goal", sensitivity: "public" },
  { id: "rule-001", kind: "DECISIONS", text: "rule", sensitivity: "public" },
  { id: "secret-001", kind: "OBSERVATIONS", text: "secret", sensitivity: "sensitive" },
];

const ready = routeCandidates({
  baseManifest,
  candidates,
  role: "luna",
  requiredFragmentIds: ["goal-001"],
  decision: {
    state: "READY",
    selectedIds: ["goal-001", "rule-001"],
    excludedIds: ["secret-001"],
    reason: "task and policy context",
  },
  now: "2026-10-25T13:00:00.000Z",
});
assert.equal(ready.state, "READY");
assert.deepEqual(ready.selected.map((fragment) => fragment.id), ["goal-001", "rule-001"]);
assert.equal(ready.manifest.role, "luna");
assert.deepEqual(ready.manifest.fragments.map((fragment) => fragment.id), ["goal-001", "rule-001"]);
assert.equal(ready.manifest.status, "READY");

const missing = routeCandidates({
  baseManifest,
  candidates,
  role: "opus",
  requiredFragmentIds: ["missing-001"],
  decision: { state: "READY", selectedIds: ["goal-001"], reason: "incomplete request" },
});
assert.equal(missing.state, "MISSING_REQUIRED_CONTEXT");
assert.deepEqual(missing.missingRequired, ["missing-001"]);
assert.equal(missing.manifest.fragments.length, 0);

const blockedSensitive = routeCandidates({
  baseManifest,
  candidates,
  role: "luna",
  decision: { state: "READY", selectedIds: ["secret-001"], reason: "secret requested" },
});
assert.equal(blockedSensitive.state, "BLOCKED");
assert.match(blockedSensitive.reason, /sensitive/);
assert.equal(blockedSensitive.manifest.fragments.length, 0);

const conflict = routeCandidates({
  baseManifest,
  candidates,
  role: "opus",
  decision: {
    state: "CONFLICT",
    selectedIds: [],
    conflicts: [["goal-001", "rule-001"]],
    reason: "conflicting requirements",
  },
});
assert.equal(conflict.state, "CONFLICT");
assert.deepEqual(conflict.conflicts, [["goal-001", "rule-001"]]);

const limited = routeCandidates({
  baseManifest,
  candidates,
  role: "luna",
  maxFragments: 1,
  decision: { state: "READY", selectedIds: ["goal-001", "rule-001"], reason: "too many" },
});
assert.equal(limited.state, "BLOCKED");
assert.match(limited.reason, /limit/);

assert.throws(
  () => routeCandidates({
    baseManifest,
    candidates,
    role: "luna",
    decision: { state: "READY", selectedIds: ["unknown"], reason: "bad decision" },
  }),
  /unknown candidates/,
);

assert.throws(
  () => routeCandidates({
    baseManifest,
    candidates,
    role: "luna",
    decision: { state: "READY", selectedIds: [], reason: "" },
  }),
  /reason/,
);

console.log("Context Router scenarios passed: ready, missing required, conflict, sensitive block, limit block, invalid decisions");

const result = await import("node:fs/promises").then(({ mkdtemp, cp, readFile, rm }) => ({ mkdtemp, cp, readFile, rm }));
const tempDir = await result.mkdtemp(".router-test-");
try {
  await result.cp(".pi/work", tempDir, { recursive: true });
  const routed = (await import("./context-router.mjs")).routeToWorkDir(tempDir, {
    role: "opus",
    candidates,
    decision: { state: "READY", selectedIds: ["goal-001"], reason: "opus review context" },
    now: "2026-10-25T13:01:00.000Z",
  });
  const routedResult = await routed;
  const routedText = await result.readFile(routedResult.routedPath, "utf8");
  assert.equal(JSON.parse(routedText).role, "opus");
  assert.equal(JSON.parse(routedText).fragments[0].id, "goal-001");
  const routingText = await result.readFile(`${tempDir}/ROUTING.jsonl`, "utf8");
  assert.equal(JSON.parse(routingText.trim().split(/\r?\n/).at(-1)).type, "ROUTER");
} finally {
  await result.rm(tempDir, { recursive: true, force: true });
}

console.log("Context Router filesystem integration passed");
