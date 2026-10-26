import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, recordStep } from "./pi-pipeline-core.mjs";
import { appendRunEvent, createRunDirectory, runDirectory, writeRunArtifact, writeRunSnapshot } from "./run-store.mjs";

const workDir = await mkdtemp(join(tmpdir(), "pi-run-store-"));
try {
  const run = recordStep(createRun("store test"), { actor: "PI", status: "RUNNING" });
  const directory = await createRunDirectory(workDir, run);
  assert.equal(directory, runDirectory(workDir, run.runId));
  await appendRunEvent(directory, { actor: "PI", action: "created", runId: run.runId });
  await appendRunEvent(directory, { actor: "TOOLS", action: "evidence", runId: run.runId });
  await writeRunSnapshot(directory, run);
  await writeRunArtifact(directory, "VERDICT.json", { decision: "BLOCKED", runId: run.runId });

  const events = (await readFile(join(directory, "EVENTS.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events.length, 2);
  assert.equal(events[0].action, "created");
  assert.equal(events[1].action, "evidence");
  assert.equal(JSON.parse(await readFile(join(directory, "VERDICT.json"), "utf8")).runId, run.runId);
  console.log("Run store append-only snapshot test passed");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
