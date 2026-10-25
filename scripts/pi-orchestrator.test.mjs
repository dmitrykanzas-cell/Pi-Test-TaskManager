import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const script = resolve(root, "scripts/pi-orchestrator.mjs");
const runPath = resolve(root, ".pi/work/PI-RUN.json");

function execute(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
  });
}

const positive = execute([]);
assert.equal(positive.status, 0, positive.stdout + positive.stderr);
assert.match(positive.stdout, /"status": "APPROVE"/);
assert.equal(JSON.parse(await readFile(runPath, "utf8")).status, "APPROVE");

const failure = execute(["--simulate-failure"]);
assert.notEqual(failure.status, 0, failure.stdout + failure.stderr);
assert.match(failure.stdout + failure.stderr, /"status": "BLOCKED"/);
assert.equal(JSON.parse(await readFile(runPath, "utf8")).status, "BLOCKED");

const recovery = execute([]);
assert.equal(recovery.status, 0, recovery.stdout + recovery.stderr);
assert.equal(JSON.parse(await readFile(runPath, "utf8")).status, "APPROVE");

console.log("Pi orchestrator scenarios passed: APPROVE, fail-closed BLOCKED, recovery APPROVE");
