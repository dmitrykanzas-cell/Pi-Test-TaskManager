import { readFile, writeFile, rename, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const workDir = resolve(process.argv[2] ?? ".pi/work");
const operationsPath = resolve(process.argv[3] ?? "operations.json");
const manifestPath = resolve(workDir, "CONTEXT-MANIFEST.json");
const routingPath = resolve(workDir, "ROUTING.jsonl");

const allowedOperations = new Set(["ADD", "UPDATE", "OBSOLETE", "REMOVE", "RETAIN", "CONFLICT"]);
const canonicalKinds = new Set(["CANONICAL", "DECISIONS"]);
const mutableKinds = new Set(["OBSERVATIONS", "HYPOTHESES", "TASK_STATE", "TRANSIENT"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeError(code, message, operation) {
  const error = new Error(message);
  error.code = code;
  error.operation = operation;
  return error;
}

function validateOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw makeError("INVALID_OPERATION", "operation must be an object", operation);
  }
  if (!allowedOperations.has(operation.operation)) {
    throw makeError("INVALID_OPERATION", `unsupported operation ${operation.operation}`, operation);
  }
  if (!nonEmptyString(operation.role)) {
    throw makeError("INVALID_OPERATION", "role must be a non-empty string", operation);
  }
  if (!nonEmptyString(operation.reason)) {
    throw makeError("INVALID_OPERATION", "reason must be a non-empty string", operation);
  }
  if (operation.operation !== "ADD" && !nonEmptyString(operation.fragmentId)) {
    throw makeError("INVALID_OPERATION", "fragmentId is required", operation);
  }
  if (operation.operation === "ADD" && (!operation.fragment || typeof operation.fragment !== "object")) {
    throw makeError("INVALID_OPERATION", "ADD requires fragment", operation);
  }
  if (operation.operation === "CONFLICT" && !nonEmptyString(operation.conflictWith)) {
    throw makeError("INVALID_OPERATION", "CONFLICT requires conflictWith", operation);
  }
}

function policyCheck(operation, fragments) {
  validateOperation(operation);
  const fragment = fragments.get(operation.fragmentId);
  if (operation.operation === "ADD") {
    const candidate = operation.fragment;
    if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.kind) || !nonEmptyString(candidate.text)) {
      throw makeError("POLICY_REJECTED", "ADD fragment requires non-empty id, kind and text", operation);
    }
    if (fragments.has(candidate.id)) throw makeError("POLICY_REJECTED", `fragment already exists: ${candidate.id}`, operation);
    if (!mutableKinds.has(candidate.kind)) throw makeError("POLICY_REJECTED", `ADD is forbidden for kind ${candidate.kind}`, operation);
    return { allowed: true, reason: "new mutable fragment" };
  }
  if (!fragment) throw makeError("POLICY_REJECTED", `fragment does not exist: ${operation.fragmentId}`, operation);
  if (operation.operation === "UPDATE" && !mutableKinds.has(fragment.kind)) {
    throw makeError("POLICY_REJECTED", `UPDATE is forbidden for ${fragment.kind}`, operation);
  }
  if (operation.operation === "REMOVE" && fragment.kind !== "TRANSIENT") {
    throw makeError("POLICY_REJECTED", "REMOVE is allowed only for TRANSIENT", operation);
  }
  if (operation.operation === "OBSOLETE" && !canonicalKinds.has(fragment.kind)) {
    throw makeError("POLICY_REJECTED", "OBSOLETE is allowed only for CANONICAL or DECISIONS", operation);
  }
  if (operation.operation === "CONFLICT" && !fragments.has(operation.conflictWith)) {
    throw makeError("POLICY_REJECTED", `conflict target does not exist: ${operation.conflictWith}`, operation);
  }
  return { allowed: true, reason: `${operation.operation} allowed by context policy` };
}

function applyOperation(manifest, operation) {
  const next = clone(manifest);
  next.previousManifestId = manifest.manifestId;
  next.manifestHistory = [...new Set([...(manifest.manifestHistory ?? []), manifest.manifestId])];
  next.fragmentHistory = [...new Set(manifest.fragmentHistory ?? [])];
  const fragments = new Map(next.fragments.map((fragment) => [fragment.id, fragment]));
  const policy = policyCheck(operation, fragments);
  let changedFragmentId = operation.fragmentId;

  if (operation.operation === "ADD") {
    const fragment = clone(operation.fragment);
    fragment.status ??= "active";
    fragment.freshness ??= "current";
    fragment.sensitivity ??= "public";
    fragment.targetModels ??= [];
    fragment.relatedFragments ??= [];
    fragment.sourceVersion ??= `context-manager:${operation.operationId ?? randomUUID()}`;
    fragment.source ??= ".pi/work/context-manager";
    fragment.authority ??= "tool";
    next.fragments.push(fragment);
    changedFragmentId = fragment.id;
  } else if (operation.operation === "UPDATE") {
    const fragment = fragments.get(operation.fragmentId);
    if (!operation.patch || typeof operation.patch !== "object" || Array.isArray(operation.patch)) {
      throw makeError("INVALID_OPERATION", "UPDATE requires patch object", operation);
    }
    Object.assign(fragment, clone(operation.patch), { id: fragment.id, kind: fragment.kind });
  } else if (operation.operation === "OBSOLETE") {
    fragments.get(operation.fragmentId).status = "obsolete";
    fragments.get(operation.fragmentId).freshness = "stale";
  } else if (operation.operation === "REMOVE") {
    next.fragmentHistory.push(operation.fragmentId);
    next.fragments = next.fragments.filter((fragment) => fragment.id !== operation.fragmentId);
  } else if (operation.operation === "CONFLICT") {
    const fragment = fragments.get(operation.fragmentId);
    fragment.status = "conflict";
    fragment.conflictWith = operation.conflictWith;
  }

  next.manifestId = `${manifest.manifestId.split("-cm-")[0]}-cm-${Date.now()}`;
  next.createdAt = new Date().toISOString();
  next.status = "READY";
  return { manifest: next, policy, changedFragmentId };
}

async function atomicWrite(path, content, tempDir) {
  const tempPath = resolve(tempDir, `${path.split(/[\\/]/).pop()}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

export async function applyOperations({ manifest, routingLines, operations, now = new Date().toISOString() }) {
  let current = clone(manifest);
  const routing = [...routingLines];
  const results = [];
  for (const operation of operations) {
    const operationId = operation.operationId ?? randomUUID();
    const stamped = { ...operation, operationId };
    try {
      const result = applyOperation(current, stamped);
      current = result.manifest;
      routing.push(JSON.stringify({
        timestamp: now,
        manifestId: current.manifestId,
        role: stamped.role,
        operation: stamped.operation,
        fragmentId: result.changedFragmentId,
        result: "APPLIED",
        reason: stamped.reason,
        operationId,
        policy: result.policy.reason,
      }));
      results.push({ operationId, operation: stamped.operation, result: "APPLIED", manifestId: current.manifestId });
    } catch (error) {
      routing.push(JSON.stringify({
        timestamp: now,
        manifestId: current.manifestId,
        role: stamped.role ?? "unknown",
        operation: stamped.operation ?? "UNKNOWN",
        fragmentId: stamped.fragmentId ?? null,
        result: "REJECTED",
        reason: stamped.reason ?? error.message,
        operationId,
        errorCode: error.code ?? "ERROR",
      }));
      results.push({ operationId, operation: stamped.operation, result: "REJECTED", errorCode: error.code ?? "ERROR", message: error.message });
      continue;
    }
  }
  return { manifest: current, routing, results };
}

export async function applyToWorkDir(targetDir, operations) {
  const targetManifestPath = resolve(targetDir, "CONTEXT-MANIFEST.json");
  const targetRoutingPath = resolve(targetDir, "ROUTING.jsonl");
  const manifest = JSON.parse(await readFile(targetManifestPath, "utf8"));
  const routingLines = (await readFile(targetRoutingPath, "utf8")).split(/\r?\n/).filter((line) => line.trim());
  const result = await applyOperations({ manifest, routingLines, operations });
  const tempDir = await mkdtemp(resolve(targetDir, ".context-manager-"));
  try {
    await atomicWrite(targetManifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, tempDir);
    await atomicWrite(targetRoutingPath, `${result.routing.join("\n")}\n`, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  return result;
}

export async function run() {
  const operations = JSON.parse(await readFile(operationsPath, "utf8"));
  if (!Array.isArray(operations) || operations.length === 0) throw new Error("operations file must contain a non-empty array");
  const result = await applyToWorkDir(workDir, operations);
  console.log(JSON.stringify({ results: result.results, manifestId: result.manifest.manifestId }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  run().catch((error) => {
    console.error(JSON.stringify({ error: error.code ?? "ERROR", message: error.message, results: error.results ?? [] }, null, 2));
    process.exitCode = 1;
  });
}
