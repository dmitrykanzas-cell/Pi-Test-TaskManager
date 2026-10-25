import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const routerStates = new Set([
  "READY",
  "CONFLICT",
  "MISSING_REQUIRED_CONTEXT",
  "INSUFFICIENT_EVIDENCE",
  "BLOCKED",
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function routerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireTypedDecision(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw routerError("INVALID_ROUTER_DECISION", "Jev Router decision must be an object");
  }
  if (!routerStates.has(decision.state)) {
    throw routerError("INVALID_ROUTER_DECISION", `unsupported router state ${decision.state}`);
  }
  if (!Array.isArray(decision.selectedIds)) {
    throw routerError("INVALID_ROUTER_DECISION", "selectedIds must be an array");
  }
  if (decision.excludedIds !== undefined && !Array.isArray(decision.excludedIds)) {
    throw routerError("INVALID_ROUTER_DECISION", "excludedIds must be an array");
  }
  if (!nonEmptyString(decision.reason)) {
    throw routerError("INVALID_ROUTER_DECISION", "reason must be a non-empty string");
  }
  if (decision.state === "CONFLICT" && (!Array.isArray(decision.conflicts) || decision.conflicts.length === 0)) {
    throw routerError("INVALID_ROUTER_DECISION", "CONFLICT requires conflicts");
  }
}

function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) throw routerError("INVALID_CANDIDATES", "candidates must be an array");
  const ids = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || !nonEmptyString(candidate.id)) {
      throw routerError("INVALID_CANDIDATES", "each candidate requires an id");
    }
    if (ids.has(candidate.id)) throw routerError("INVALID_CANDIDATES", `duplicate candidate ${candidate.id}`);
    ids.add(candidate.id);
    if (!nonEmptyString(candidate.kind) || !nonEmptyString(candidate.text)) {
      throw routerError("INVALID_CANDIDATES", `candidate ${candidate.id} is incomplete`);
    }
  }
  return ids;
}

function buildManifest({ baseManifest, role, selected, state, now, decision }) {
  const manifest = clone(baseManifest);
  manifest.manifestId = `${baseManifest.manifestId}-route-${role}-${now.replace(/[^0-9A-Za-z]/g, "")}`;
  manifest.previousManifestId = baseManifest.manifestId;
  manifest.role = role;
  manifest.status = state;
  manifest.createdAt = now;
  manifest.fragments = selected.map(clone);
  manifest.router = {
    state,
    decisionReason: decision.reason,
    selectedIds: selected.map((fragment) => fragment.id),
    excludedIds: decision.excludedIds ?? [],
  };
  return manifest;
}

export function routeCandidates({
  baseManifest,
  candidates,
  role,
  requiredFragmentIds = [],
  decision,
  allowSensitive = false,
  maxFragments = Number.POSITIVE_INFINITY,
  now = new Date().toISOString(),
}) {
  if (!baseManifest || typeof baseManifest !== "object") throw routerError("INVALID_MANIFEST", "baseManifest must be an object");
  if (!nonEmptyString(role)) throw routerError("INVALID_ROLE", "role must be a non-empty string");
  if (!Array.isArray(requiredFragmentIds)) throw routerError("INVALID_REQUIRED", "requiredFragmentIds must be an array");
  if (maxFragments !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxFragments) || maxFragments < 1)) throw routerError("INVALID_LIMIT", "maxFragments must be a positive integer");
  const candidateIds = validateCandidates(candidates);
  requireTypedDecision(decision);

  const selectedIds = [...new Set(decision.selectedIds)];
  const unknownSelected = selectedIds.filter((id) => !candidateIds.has(id));
  if (unknownSelected.length > 0) throw routerError("INVALID_ROUTER_DECISION", `selectedIds contain unknown candidates: ${unknownSelected.join(", ")}`);

  const missingRequired = requiredFragmentIds.filter((id) => !candidateIds.has(id) || !selectedIds.includes(id));
  if (missingRequired.length > 0) {
    const missingDecision = { ...decision, state: "MISSING_REQUIRED_CONTEXT", missingRequired };
    return {
      state: "MISSING_REQUIRED_CONTEXT",
      manifest: buildManifest({ baseManifest, role, selected: [], state: "MISSING_REQUIRED_CONTEXT", now, decision: missingDecision }),
      selected: [],
      excluded: candidates,
      missingRequired,
      reason: `required fragments are missing: ${missingRequired.join(", ")}`,
      decision,
    };
  }

  if (decision.state !== "READY") {
    return {
      state: decision.state,
      manifest: buildManifest({ baseManifest, role, selected: [], state: decision.state, now, decision }),
      selected: [],
      excluded: candidates,
      missingRequired: decision.missingRequired ?? [],
      conflicts: decision.conflicts ?? [],
      reason: decision.reason,
      decision,
    };
  }

  const selected = selectedIds.map((id) => candidates.find((candidate) => candidate.id === id));
  const sensitive = selected.filter((candidate) => candidate.sensitivity === "sensitive");
  if (sensitive.length > 0 && !allowSensitive) {
    return {
      state: "BLOCKED",
      manifest: buildManifest({ baseManifest, role, selected: [], state: "BLOCKED", now, decision }),
      selected: [],
      excluded: candidates,
      missingRequired: [],
      reason: `sensitive fragments require explicit policy: ${sensitive.map((item) => item.id).join(", ")}`,
      decision,
    };
  }
  if (selected.length > maxFragments) {
    return {
      state: "BLOCKED",
      manifest: buildManifest({ baseManifest, role, selected: [], state: "BLOCKED", now, decision }),
      selected: [],
      excluded: candidates,
      missingRequired: [],
      reason: `router limit exceeded: ${selected.length} > ${maxFragments}`,
      decision,
    };
  }

  return {
    state: "READY",
    manifest: buildManifest({ baseManifest, role, selected, state: "READY", now, decision }),
    selected,
    excluded: candidates.filter((candidate) => !selectedIds.includes(candidate.id)),
    missingRequired: [],
    reason: decision.reason,
    decision,
  };
}

export async function routeToWorkDir(targetDir, request) {
  const manifestPath = resolve(targetDir, "CONTEXT-MANIFEST.json");
  const routingPath = resolve(targetDir, "ROUTING.jsonl");
  const baseManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = routeCandidates({ ...request, baseManifest });
  const routedPath = resolve(targetDir, `CONTEXT-MANIFEST.${request.role}.json`);
  await mkdir(targetDir, { recursive: true });
  await writeFile(routedPath, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");
  await appendFile(routingPath, `${JSON.stringify({
    timestamp: request.now ?? new Date().toISOString(),
    manifestId: result.manifest.manifestId,
    baseManifestId: baseManifest.manifestId,
    role: request.role,
    type: "ROUTER",
    state: result.state,
    candidates: request.candidates.map((candidate) => candidate.id),
    included: result.selected.map((candidate) => candidate.id),
    excluded: result.excluded.map((candidate) => candidate.id),
    missingRequired: result.missingRequired,
    conflicts: result.conflicts ?? [],
    reason: result.reason,
  })}\n`, "utf8");
  return { ...result, routedPath };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [requestPath = "router-request.json"] = process.argv.slice(2);
  const request = JSON.parse(await readFile(resolve(requestPath), "utf8"));
  const result = await routeToWorkDir(resolve(request.workDir ?? ".pi/work"), request);
  console.log(JSON.stringify({ state: result.state, manifestId: result.manifest.manifestId, routedPath: result.routedPath }, null, 2));
}
