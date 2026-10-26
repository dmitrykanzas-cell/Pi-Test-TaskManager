import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validator = resolve(root, "scripts/validate-context-contract.mjs");
const sourceWorkDir = resolve(root, ".pi/work");
const tempRoot = await mkdtemp(resolve(root, ".contract-test-"));

async function copyFixture(name) {
  const workDir = resolve(tempRoot, name);
  await cp(sourceWorkDir, workDir, { recursive: true });
  return workDir;
}

async function runValidator(workDir) {
  try {
    await execFileAsync(process.execPath, [validator, workDir]);
    return { success: true, output: "" };
  } catch (error) {
    return { success: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

async function readJson(workDir, file) {
  return JSON.parse(await readFile(resolve(workDir, file), "utf8"));
}

async function writeJson(workDir, file, value) {
  await writeFile(resolve(workDir, file), JSON.stringify(value, null, 2));
}

function assertRejected(result, needle, message) {
  if (result.success || !result.output.includes(needle)) throw new Error(message);
}

try {
  const validDir = await copyFixture("valid");
  const valid = await runValidator(validDir);
  if (!valid.success) throw new Error(`valid fixture failed: ${valid.output}`);

  const missingRelationDir = await copyFixture("missing-relation");
  const manifest = await readJson(missingRelationDir, "CONTEXT-MANIFEST.json");
  manifest.fragments[0].relatedFragments = ["missing-fragment"];
  await writeJson(missingRelationDir, "CONTEXT-MANIFEST.json", manifest);
  assertRejected(await runValidator(missingRelationDir), "references missing fragment", "missing relation was not rejected");

  const incompleteApproveDir = await copyFixture("incomplete-approve");
  const verdict = await readJson(incompleteApproveDir, "VERDICT.json");
  verdict.decision = "APPROVE";
  verdict.missingEvidence = [];
  verdict.evidenceRefs = ["build-001", "test-001"];
  await writeJson(incompleteApproveDir, "VERDICT.json", verdict);
  assertRejected(await runValidator(incompleteApproveDir), "APPROVE requires diff evidence", "incomplete APPROVE was not rejected");

  const observedApproveDir = await copyFixture("observed-approve");
  const observedVerdict = await readJson(observedApproveDir, "VERDICT.json");
  const observedLines = (await readFile(resolve(observedApproveDir, "OBSERVATIONS.jsonl"), "utf8"))
    .trim().split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const review = observedLines.find((item) => item.id === "review-001");
  review.id = "review-001";
  review.status = "observed";
  observedVerdict.decision = "APPROVE";
  observedVerdict.missingEvidence = [];
  observedVerdict.evidenceRefs = ["build-001", "test-001", "diff-002", "review-001"];
  await writeJson(observedApproveDir, "VERDICT.json", observedVerdict);
  await writeFile(resolve(observedApproveDir, "OBSERVATIONS.jsonl"), `${observedLines.map((item) => JSON.stringify(item)).join("\n")}\n`);
  assertRejected(await runValidator(observedApproveDir), "APPROVE evidence must be verified", "observed APPROVE was accepted");

  const sensitiveDir = await copyFixture("sensitive-external");
  const sensitiveManifest = await readJson(sensitiveDir, "CONTEXT-MANIFEST.json");
  sensitiveManifest.fragments[0].sensitivity = "sensitive";
  sensitiveManifest.fragments[0].targetModels = ["external"];
  await writeJson(sensitiveDir, "CONTEXT-MANIFEST.json", sensitiveManifest);
  assertRejected(await runValidator(sensitiveDir), "targets external model", "sensitive external fragment was accepted");

  const typedDir = await copyFixture("typed-fields");
  const typedManifest = await readJson(typedDir, "CONTEXT-MANIFEST.json");
  typedManifest.fragments[0].text = null;
  await writeJson(typedDir, "CONTEXT-MANIFEST.json", typedManifest);
  assertRejected(await runValidator(typedDir), "text must be a non-empty string", "invalid typed field was accepted");

  const malformedRoutingDir = await copyFixture("malformed-routing");
  await writeFile(resolve(malformedRoutingDir, "ROUTING.jsonl"), "{not-json}\n");
  assertRejected(await runValidator(malformedRoutingDir), "ROUTING.jsonl:1: invalid JSON", "malformed routing was accepted");

  const brokenRoutingRefDir = await copyFixture("broken-routing-ref");
  await writeFile(resolve(brokenRoutingRefDir, "ROUTING.jsonl"), `${JSON.stringify({
    timestamp: "2026-10-25T12:00:00Z",
    manifestId: "stage-6-contract-001",
    role: "luna",
    candidates: ["missing-fragment"],
    included: [],
    excluded: [],
    reasons: {},
  })}\n`);
  assertRejected(await runValidator(brokenRoutingRefDir), "routing references missing fragment", "broken routing reference was accepted");

  const missingRoleDir = await copyFixture("missing-role");
  const routing = JSON.parse((await readFile(resolve(missingRoleDir, "ROUTING.jsonl"), "utf8")).trim().split(/\r?\n/)[0]);
  delete routing.role;
  await writeFile(resolve(missingRoleDir, "ROUTING.jsonl"), `${JSON.stringify(routing)}\n`);
  assertRejected(await runValidator(missingRoleDir), "timestamp, manifestId and role must be non-empty strings", "missing routing role was accepted");

  console.log("Context contract negative tests passed: relation, incomplete/observed APPROVE, sensitivity, types, routing");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}