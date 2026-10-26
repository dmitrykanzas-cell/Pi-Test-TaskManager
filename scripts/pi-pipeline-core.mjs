import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const PIPELINE_ROLES = ["ROUTER", "LUNA", "TOOLS_EVIDENCE", "OPUS", "JEV_VERIFIER"];

export function createRun(request) {
  if (typeof request !== "string" || request.trim().length === 0) {
    throw new Error("A non-empty pipeline request is required");
  }
  return {
    schemaVersion: 2,
    type: "PI_CONTEXT_EVIDENCE_PIPELINE_RUN",
    runId: `pi-pipeline-${Date.now()}`,
    request,
    status: "RUNNING",
    providerMode: "live-required",
    steps: [],
    evidence: [],
  };
}

export function recordStep(run, step) {
  run.steps.push({ timestamp: new Date().toISOString(), ...step });
  return run;
}

export function blocked(run, code, reason, role, extra = {}) {
  run.status = "BLOCKED";
  run.blocked = { code, reason, role, ...extra };
  return run;
}

export function approve(run, verdict) {
  if (run.steps.length < PIPELINE_ROLES.length || run.steps.some((step) => step.status === "BLOCKED")) {
    return blocked(run, "PIPELINE_INCOMPLETE", "APPROVE requires every mandatory live stage", "PIPELINE");
  }
  run.status = verdict.decision;
  run.verdict = verdict;
  return run;
}

export async function writeRun(workDir, run) {
  const outputPath = resolve(workDir, "PI-RUN.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return outputPath;
}

export function assertLiveResult(result, role) {
  if (!result || result.liveProviderCall !== true) {
    throw new Error(`${role} did not produce a live provider result`);
  }
  return result;
}

export function projectRootFromExtension(extensionUrl) {
  return resolve(dirname(fileURLToPath(extensionUrl)), "../..");
}

export function recoverStaleRun(run) {
  if (run?.status !== "RUNNING") return run;
  return blocked(run, "STALE_RUNNING_TRACE", "Previous run did not reach a terminal verdict", "PIPELINE");
}
