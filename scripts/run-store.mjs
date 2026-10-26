import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function runDirectory(workDir, runId) {
  return resolve(workDir, "runs", runId);
}

export async function createRunDirectory(workDir, run) {
  const directory = runDirectory(workDir, run.runId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function appendRunEvent(directory, event) {
  const record = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...event,
  };
  await appendFile(join(directory, "EVENTS.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function writeRunSnapshot(directory, run) {
  const snapshot = `${JSON.stringify(run, null, 2)}\n`;
  await writeFile(join(directory, "PI-RUN.json"), snapshot, "utf8");
  return join(directory, "PI-RUN.json");
}

export async function writeRunArtifact(directory, name, value) {
  const path = join(directory, name);
  await writeFile(path, `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
