import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve, blocked, createRun, PIPELINE_ROLES, recordStep, writeRun } from "./pi-pipeline-core.mjs";

const temp = await mkdtemp(join(tmpdir(), "pi-pipeline-test-"));
try {
  assert.deepEqual(PIPELINE_ROLES, ["ROUTER", "LUNA", "TOOLS_EVIDENCE", "OPUS", "JEV_VERIFIER"]);
  assert.throws(() => createRun(""), /non-empty/);
  const run = createRun("test request");
  recordStep(run, { actor: "ROUTER", status: "COMPLETED" });
  blocked(run, "ROLE_UNAVAILABLE", "live provider unavailable", "LUNA");
  assert.equal(run.status, "BLOCKED");
  assert.equal(run.blocked.role, "LUNA");
  const incomplete = createRun("incomplete");
  recordStep(incomplete, { actor: "ROUTER", status: "COMPLETED" });
  assert.equal(approve(incomplete, { decision: "APPROVE" }).status, "BLOCKED");
  const path = await writeRun(temp, run);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).blocked, run.blocked);
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log("Pi Pipeline core regression passed: typed roles, fail-closed, trace write");
