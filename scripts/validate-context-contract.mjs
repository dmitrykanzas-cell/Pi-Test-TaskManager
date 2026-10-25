import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workDir = resolve(process.argv[2] ?? ".pi/work");
const manifestPath = resolve(workDir, "CONTEXT-MANIFEST.json");
const observationsPath = resolve(workDir, "OBSERVATIONS.jsonl");
const routingPath = resolve(workDir, "ROUTING.jsonl");
const verdictPath = resolve(workDir, "VERDICT.json");

const requiredFragmentFields = [
  "id", "kind", "text", "source", "sourceVersion", "authority",
  "status", "freshness", "sensitivity", "targetModels", "relatedFragments",
];
const requiredObservationFields = [
  "id", "kind", "text", "source", "sourceVersion", "authority",
  "status", "freshness", "sensitivity", "targetModels", "relatedFragments",
];
const requiredEvidenceKinds = ["build", "test", "diff", "review"];
const routingOperations = new Set(["RETAIN", "ADD", "UPDATE", "OBSOLETE", "REMOVE", "ROUTE", "CONFLICT"]);
const errors = [];

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: invalid JSON (${error.message})`);
    return null;
  }
}

async function loadJsonLines(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    errors.push(`${path}: cannot read (${error.message})`);
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .flatMap(({ line, number }) => {
      try {
        return [{ value: JSON.parse(line), number }];
      } catch (error) {
        errors.push(`${path}:${number}: invalid JSON (${error.message})`);
        return [];
      }
    });
}

function validateTypedRecord(record, fields, path, number, arrays) {
  for (const field of fields) {
    if (!(field in record)) {
      errors.push(`${path}:${number}: missing ${field}`);
    } else if (["id", "kind", "text", "source", "sourceVersion", "authority", "status", "freshness", "sensitivity"].includes(field) && !nonEmptyString(record[field])) {
      errors.push(`${path}:${number}: ${field} must be a non-empty string`);
    }
  }
  for (const field of arrays) {
    if (!hasStringArray(record[field])) {
      errors.push(`${path}:${number}: ${field} must be an array of non-empty strings`);
    }
  }
}

const manifest = await loadJson(manifestPath);
const verdict = await loadJson(verdictPath);
const observationEntries = await loadJsonLines(observationsPath);
const routingEntries = await loadJsonLines(routingPath);
const observations = new Map();

for (const { value, number } of observationEntries) {
  validateTypedRecord(value, requiredObservationFields, observationsPath, number, ["targetModels", "relatedFragments"]);
  if (!nonEmptyString(value.id) || observations.has(value.id)) {
    errors.push(`${observationsPath}:${number}: observation id must be unique and non-empty`);
  } else {
    observations.set(value.id, value);
  }
}

const fragmentIds = new Set();
const validManifestIds = new Set([
  ...(nonEmptyString(manifest?.manifestId) ? [manifest.manifestId] : []),
  ...(Array.isArray(manifest?.manifestHistory) ? manifest.manifestHistory : []),
]);
if (manifest) {
  if (manifest.schemaVersion !== 1) errors.push(`${manifestPath}: schemaVersion must be 1`);
  if (!nonEmptyString(manifest.manifestId)) errors.push(`${manifestPath}: manifestId must be a non-empty string`);
  if (!nonEmptyString(manifest.role)) errors.push(`${manifestPath}: role must be a non-empty string`);
  if (!nonEmptyString(manifest.status)) errors.push(`${manifestPath}: status must be a non-empty string`);
  if (!nonEmptyString(manifest.createdAt)) errors.push(`${manifestPath}: createdAt must be a non-empty string`);
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    errors.push(`${manifestPath}: fragments must be a non-empty array`);
  } else {
    for (const [index, fragment] of manifest.fragments.entries()) {
      const number = index + 1;
      validateTypedRecord(fragment, requiredFragmentFields, manifestPath, number, ["targetModels", "relatedFragments"]);
      if (!nonEmptyString(fragment.id) || fragmentIds.has(fragment.id)) {
        errors.push(`${manifestPath}:${number}: fragment id must be unique and non-empty`);
      } else {
        fragmentIds.add(fragment.id);
      }
      if (fragment.kind === "OBSERVATIONS" && fragment.authority === "canonical") {
        errors.push(`${manifestPath}:${number}: observation ${fragment.id} cannot be canonical`);
      }
      if (fragment.sensitivity === "sensitive" && fragment.targetModels?.includes("external")) {
        errors.push(`${manifestPath}:${number}: sensitive fragment ${fragment.id} targets external model`);
      }
    }
    for (const [index, fragment] of manifest.fragments.entries()) {
      for (const relatedId of fragment.relatedFragments ?? []) {
        if (!fragmentIds.has(relatedId)) {
          errors.push(`${manifestPath}:${index + 1}: fragment ${fragment.id} references missing fragment ${relatedId}`);
        }
      }
    }
  }
}

const historicalFragmentIds = new Set(Array.isArray(manifest?.fragmentHistory) ? manifest.fragmentHistory : []);
const routingAddedFragmentIds = new Set(
  routingEntries
    .filter(({ value }) => value.operation === "ADD" && nonEmptyString(value.fragmentId))
    .map(({ value }) => value.fragmentId),
);
for (const { value, number } of routingEntries) {
  const path = `${routingPath}:${number}`;
  if (!nonEmptyString(value.timestamp) || !nonEmptyString(value.manifestId) || !nonEmptyString(value.role)) {
    errors.push(`${path}: timestamp, manifestId and role must be non-empty strings`);
  }
  if (!validManifestIds.has(value.manifestId)) errors.push(`${path}: manifestId does not match current or historical manifest`);
  if (value.operation !== undefined) {
    if (!routingOperations.has(value.operation)) errors.push(`${path}: unsupported operation ${value.operation}`);
    if (!nonEmptyString(value.fragmentId)) errors.push(`${path}: operation requires fragmentId`);
    if (!nonEmptyString(value.result)) errors.push(`${path}: operation requires result`);
    if (!nonEmptyString(value.reason)) errors.push(`${path}: operation requires reason`);
    const historicalFragment = historicalFragmentIds.has(value.fragmentId);
    const removedAddedFragment = value.operation === "REMOVE" && routingAddedFragmentIds.has(value.fragmentId);
    if (nonEmptyString(value.fragmentId) && !fragmentIds.has(value.fragmentId) && !historicalFragment && !removedAddedFragment)
      errors.push(`${path}: operation references missing fragment ${value.fragmentId}`);
  } else {
    for (const field of ["candidates", "included", "excluded"]) {
      if (!hasStringArray(value[field])) errors.push(`${path}: ${field} must be an array of non-empty strings`);
    }
    for (const id of [...(value.candidates ?? []), ...(value.included ?? []), ...(value.excluded ?? [])]) {
      if (!fragmentIds.has(id)) errors.push(`${path}: routing references missing fragment ${id}`);
    }
    if (!value.reasons || typeof value.reasons !== "object" || Array.isArray(value.reasons)) {
      errors.push(`${path}: routing entry requires reasons object`);
    }
  }
}

if (verdict) {
  const allowedDecisions = new Set(["APPROVE", "REQUEST_CHANGES", "BLOCKED", "INSUFFICIENT_EVIDENCE"]);
  if (!allowedDecisions.has(verdict.decision)) errors.push(`${verdictPath}: unsupported decision ${verdict.decision}`);
  if (!Array.isArray(verdict.evidenceRefs) || !verdict.evidenceRefs.every(nonEmptyString)) {
    errors.push(`${verdictPath}: evidenceRefs must be an array of non-empty strings`);
  } else {
    const uniqueRefs = new Set(verdict.evidenceRefs);
    if (uniqueRefs.size !== verdict.evidenceRefs.length) errors.push(`${verdictPath}: evidenceRefs must be unique`);
    for (const ref of verdict.evidenceRefs) {
      if (!observations.has(ref)) errors.push(`${verdictPath}: evidence ref does not exist: ${ref}`);
    }
    if (verdict.decision === "APPROVE") {
      if (!Array.isArray(verdict.missingEvidence) || verdict.missingEvidence.length !== 0) {
        errors.push(`${verdictPath}: APPROVE requires empty missingEvidence`);
      }
      const referenced = verdict.evidenceRefs.map((ref) => observations.get(ref));
      const evidenceKinds = new Set(referenced.map((item) => item?.kind));
      for (const requiredKind of requiredEvidenceKinds) {
        if (!evidenceKinds.has(requiredKind)) errors.push(`${verdictPath}: APPROVE requires ${requiredKind} evidence`);
      }
      for (const item of referenced) {
        if (!item || item.status !== "verified") errors.push(`${verdictPath}: APPROVE evidence must be verified`);
      }
    }
  }
  if (verdict.stopReason !== "stop") errors.push(`${verdictPath}: stopReason must be stop for a completed verdict`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Context contract valid: ${manifest.fragments.length} fragments, ${observations.size} observations, verdict=${verdict.decision}`);

export { loadJsonLines, nonEmptyString };
