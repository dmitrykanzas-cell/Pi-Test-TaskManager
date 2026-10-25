import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workDir = resolve(process.argv[2] ?? ".pi/work");
const manifestPath = resolve(workDir, "CONTEXT-MANIFEST.json");
const observationsPath = resolve(workDir, "OBSERVATIONS.jsonl");
const verdictPath = resolve(workDir, "VERDICT.json");

const requiredFragmentFields = [
  "id",
  "kind",
  "text",
  "source",
  "sourceVersion",
  "authority",
  "status",
  "freshness",
  "sensitivity",
  "targetModels",
  "relatedFragments",
];

const errors = [];

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

const manifest = await loadJson(manifestPath);
const verdict = await loadJson(verdictPath);
const observationEntries = await loadJsonLines(observationsPath);
const observations = new Map();

for (const { value, number } of observationEntries) {
  if (!value.id || observations.has(value.id)) {
    errors.push(`${observationsPath}:${number}: observation id must be unique and non-empty`);
  } else {
    observations.set(value.id, value);
  }

  for (const field of ["id", "kind", "source", "sourceVersion", "status"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      errors.push(`${observationsPath}:${number}: missing ${field}`);
    }
  }
}

if (manifest) {
  if (manifest.schemaVersion !== 1) {
    errors.push(`${manifestPath}: schemaVersion must be 1`);
  }
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    errors.push(`${manifestPath}: fragments must be a non-empty array`);
  } else {
    const fragmentIds = new Set();
    for (const fragment of manifest.fragments) {
      for (const field of requiredFragmentFields) {
        if (!(field in fragment)) {
          errors.push(`${manifestPath}: fragment ${fragment.id ?? "<unknown>"} is missing ${field}`);
        }
      }
      if (fragmentIds.has(fragment.id)) {
        errors.push(`${manifestPath}: duplicate fragment id ${fragment.id}`);
      }
      fragmentIds.add(fragment.id);
      if (!Array.isArray(fragment.targetModels) || !Array.isArray(fragment.relatedFragments)) {
        errors.push(`${manifestPath}: fragment ${fragment.id ?? "<unknown>"} metadata arrays are invalid`);
      }
      if (fragment.kind === "OBSERVATIONS" && fragment.authority === "canonical") {
        errors.push(`${manifestPath}: observation ${fragment.id} cannot be canonical`);
      }
      if (fragment.sensitivity === "sensitive" && fragment.targetModels?.includes("external")) {
        errors.push(`${manifestPath}: sensitive fragment ${fragment.id} targets external model`);
      }
    }
    for (const fragment of manifest.fragments) {
      for (const relatedId of fragment.relatedFragments ?? []) {
        if (!fragmentIds.has(relatedId)) {
          errors.push(`${manifestPath}: fragment ${fragment.id} references missing fragment ${relatedId}`);
        }
      }
    }
  }
}

if (verdict) {
  const allowedDecisions = new Set([
    "APPROVE",
    "REQUEST_CHANGES",
    "BLOCKED",
    "INSUFFICIENT_EVIDENCE",
  ]);
  if (!allowedDecisions.has(verdict.decision)) {
    errors.push(`${verdictPath}: unsupported decision ${verdict.decision}`);
  }
  if (!Array.isArray(verdict.evidenceRefs)) {
    errors.push(`${verdictPath}: evidenceRefs must be an array`);
  } else {
    for (const ref of verdict.evidenceRefs) {
      if (!observations.has(ref)) {
        errors.push(`${verdictPath}: evidence ref does not exist: ${ref}`);
      }
    }
    if (verdict.decision === "APPROVE") {
      const evidenceKinds = new Set(verdict.evidenceRefs.map((ref) => observations.get(ref)?.kind));
      for (const requiredKind of ["build", "test", "diff", "review"]) {
        if (!evidenceKinds.has(requiredKind)) {
          errors.push(`${verdictPath}: APPROVE requires ${requiredKind} evidence`);
        }
      }
    }
  }
  if (verdict.decision === "APPROVE" && verdict.evidenceRefs.length === 0) {
    errors.push(`${verdictPath}: APPROVE requires evidenceRefs`);
  }
  if (verdict.stopReason !== "stop") {
    errors.push(`${verdictPath}: stopReason must be stop for a completed verdict`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Context contract valid: ${manifest.fragments.length} fragments, ${observations.size} observations, verdict=${verdict.decision}`);
