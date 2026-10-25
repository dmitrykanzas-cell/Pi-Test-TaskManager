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

try {
  const validDir = await copyFixture("valid");
  const valid = await runValidator(validDir);
  if (!valid.success) {
    throw new Error(`valid fixture failed: ${valid.output}`);
  }

  const missingRelationDir = await copyFixture("missing-relation");
  const manifestPath = resolve(missingRelationDir, "CONTEXT-MANIFEST.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.fragments[0].relatedFragments = ["missing-fragment"];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const missingRelation = await runValidator(missingRelationDir);
  if (missingRelation.success || !missingRelation.output.includes("references missing fragment")) {
    throw new Error("missing relation was not rejected");
  }

  const incompleteApproveDir = await copyFixture("incomplete-approve");
  const verdictPath = resolve(incompleteApproveDir, "VERDICT.json");
  const verdict = JSON.parse(await readFile(verdictPath, "utf8"));
  verdict.decision = "APPROVE";
  verdict.missingEvidence = [];
  verdict.evidenceRefs = ["build-001", "test-001"];
  await writeFile(verdictPath, JSON.stringify(verdict, null, 2));
  const incompleteApprove = await runValidator(incompleteApproveDir);
  if (incompleteApprove.success || !incompleteApprove.output.includes("APPROVE requires diff evidence")) {
    throw new Error("incomplete APPROVE was not rejected");
  }

  console.log("Context contract negative tests passed: valid, missing relation, incomplete APPROVE");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}