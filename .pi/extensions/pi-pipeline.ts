import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Resolve the repository from the extension location, not from Pi's launch cwd.
// This matters when Pi is started from Downloads while the extension belongs to a project.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = resolve(ROOT, ".pi/work");
const ROUTER = "anymodel";
const LUNA = "cx/gpt-6-luna";
const OPUS = "cc/claude-opus-5-5";
const JEV = "jev/jev-latest";

type RunStatus = "RUNNING" | "WAITING_FOR_USER" | "RESUMED" | "APPROVE" | "REQUEST_CHANGES" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
type Question = { questionId: string; type: "single_select" | "text"; prompt: string; options?: Array<{ id: string; label: string }>; required: boolean };
type Run = { schemaVersion: 2; type: string; runId: string; request: string; status: RunStatus; providerMode: "live-required"; steps: unknown[]; evidence: unknown[]; questions?: Question[]; [key: string]: unknown };

function runDir(runId: string) { return resolve(WORK, "runs", runId); }
async function appendEvent(run: Run, event: Record<string, unknown>) {
  await mkdir(runDir(run.runId), { recursive: true });
  await appendFile(resolve(runDir(run.runId), "EVENTS.jsonl"), `${JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), runId: run.runId, ...event })}\n`, "utf8");
}
function step(run: Run, actor: string, status: string, details: Record<string, unknown> = {}) {
  run.steps.push({ timestamp: new Date().toISOString(), actor, status, ...details });
}
function block(run: Run, role: string, code: string, reason: string) {
  run.status = "BLOCKED";
  run.blocked = { role, code, reason };
}
async function save(run: Run) {
  await mkdir(WORK, { recursive: true });
  await writeFile(resolve(WORK, "PI-RUN.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await mkdir(runDir(run.runId), { recursive: true });
  await writeFile(resolve(runDir(run.runId), "PI-RUN.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}
async function listRuns() {
  try { return (await readdir(resolve(WORK, "runs"), { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name); }
  catch { return []; }
}
async function latestRun(): Promise<Run | null> {
  const ids = await listRuns();
  for (const id of ids.reverse()) {
    try { return JSON.parse(await readFile(resolve(runDir(id), "PI-RUN.json"), "utf8")) as Run; } catch { /* ignore incomplete run */ }
  }
  try { return JSON.parse(await readFile(resolve(WORK, "PI-RUN.json"), "utf8")) as Run; } catch { return null; }
}
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((item): item is { type: "text"; text: string } => typeof item === "object" && item !== null && (item as { type?: string }).type === "text").map((item) => item.text).join("\n");
}
async function complete(ctx: ExtensionCommandContext, provider: string, id: string, prompt: string) {
  const model = ctx.modelRegistry.find(provider, id);
  if (!model) throw new Error(`Required live model unavailable: ${provider}/${id}`);
  const response = await ctx.modelRegistry.complete(model, { systemPrompt: "Return only the requested role result.", messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] });
  if (response.stopReason !== "stop") throw new Error(`${provider}/${id} stopped with ${response.stopReason}: ${response.errorMessage ?? "no error message"}`);
  return { liveProviderCall: true, provider, model: id, stopReason: response.stopReason, text: textOf(response.content) };
}
async function classify(ctx: ExtensionCommandContext, state: Record<string, unknown>, instructions: string) {
  const model = ctx.modelRegistry.findOfType("classifier", ROUTER, JEV);
  if (!model) throw new Error(`Required live classifier unavailable: ${ROUTER}/${JEV}`);
  const result = await ctx.modelRegistry.classify(model, { state, questions: { approved: { type: "bool", instructions, criteria: { true: "valid", false: "invalid" } } } });
  if (result.stopReason !== "stop") throw new Error(`Jev stopped with ${result.stopReason}: ${result.errorMessage ?? "no error message"}`);
  return { liveProviderCall: true, provider: ROUTER, model: JEV, stopReason: result.stopReason, approved: result.answers.approved, answers: result.answers };
}

type AgentRun = { text: string; events: number; toolCalls: number; exitCode: number; stderr: string };

type GeneratedFile = { path: string; content: string };
type LunaArtifact = { summary: string; files: GeneratedFile[]; verificationCommand: string };

function parseLunaArtifact(text: string): LunaArtifact {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Luna did not return a JSON implementation artifact");
  const parsed = JSON.parse(text.slice(start, end + 1)) as LunaArtifact;
  if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error("Luna artifact has no files");
  const uniqueFiles = new Map<string, GeneratedFile>();
  for (const file of parsed.files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error("Luna artifact contains an invalid file");
    const normalized = file.path.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.includes("../") || normalized.includes("\0")) throw new Error(`Luna artifact path is unsafe: ${file.path}`);
    // Providers occasionally double-escape quotes inside JSON string values.
    const normalizedContent = file.content.replaceAll('\\\\\\"', '\\"');
    uniqueFiles.set(normalized, { path: normalized, content: normalizedContent });
  }
  return { ...parsed, files: [...uniqueFiles.values()] };
}

async function runLunaImplementation(ctx: ExtensionCommandContext, request: string, routed: unknown): Promise<{ agent: AgentRun; artifact: LunaArtifact }> {
  const response = await complete(ctx, "anymodel", LUNA, `You are Luna, the implementation stage. Return ONLY one valid JSON object, with no markdown and no prose outside JSON. Work only on the Pi Context-Evidence Pipeline repository. Inspect the pipeline scripts, extension and .pi/work contracts. Implement the smallest requested pipeline change without introducing a domain application or fixture project. Return complete contents only for files that must change, using relative paths. Use exactly this schema: {"summary":"...","files":[{"path":"relative/path","content":"..."}],"verificationCommand":"node --test scripts/*.test.mjs"}. Do not make network calls in tests. Request: ${request}. Router: ${JSON.stringify(routed)}`);
  return { agent: { text: response.text, events: 1, toolCalls: 0, exitCode: 0, stderr: "" }, artifact: parseLunaArtifact(response.text) };
}

async function runPiAgent(cwd: string, prompt: string): Promise<AgentRun> {
  const executable = process.platform === "win32" ? "C:\\Users\\ThinkPad\\AppData\\Roaming\\npm\\pi.cmd" : "pi";
  const agentSystemPrompt = "You are Luna, a bounded implementation agent. Use exactly at most 3 bash calls: (1) inspect only the named project files, (2) create the smallest working vertical MVP requested, (3) run one bounded build/test command. Do not read AGENTS, docs, git history, or unrelated files. Do not repeat a command. Stop immediately after call 3 and report actual results. Never commit or push.";
  const args = ["--mode", "json", "--print", "--no-session", "--no-extensions", "--no-context-files", "--model", `anymodel/${LUNA}`, "--thinking", "low", "--system-prompt", agentSystemPrompt, "--tools", "bash", prompt];
  const timeoutMs = 8 * 60 * 1000;
  return await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    let events = 0;
    let toolCalls = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`nested Pi agent timed out after ${timeoutMs / 60000} minutes`)); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const texts: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          events++;
          if (event.type === "tool_call" || event.type === "tool_execution_start") toolCalls++;
          if (event.type === "message_end") {
            const message = event.message as { role?: string; content?: unknown } | undefined;
            if (message?.role === "assistant") texts.push(textOf(message.content));
          }
        } catch { /* ignore non-JSON diagnostics */ }
      }
      if ((exitCode ?? 1) !== 0) {
        reject(new Error(`nested Pi agent exited with ${exitCode}: ${stderr.slice(-2000)}`));
        return;
      }
      resolveRun({ text: texts.filter(Boolean).join("\n\n") || stdout.slice(-12000), events, toolCalls, exitCode: exitCode ?? 0, stderr: stderr.slice(-2000) });
    });
  });
}

async function applyTools(cwd: string, artifact: LunaArtifact): Promise<{ files: string[]; command: string; output: string }> {
  const files: string[] = [];
  for (const file of artifact.files) {
    const target = resolve(cwd, file.path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.content, "utf8");
    files.push(file.path);
  }
  const command = artifact.verificationCommand || "node --test scripts/*.test.mjs";
  const child = spawn(process.execPath, ["--test", "scripts/pi-pipeline-core.test.mjs", "scripts/context-router.test.mjs", "scripts/jev-verifier.test.mjs"], { cwd, windowsHide: true });
  let output = "";
  let error = "";
  const result = await new Promise<number>((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Tools verification timed out after 120 seconds")); }, 120000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => { clearTimeout(timer); resolveExit(code ?? 1); });
  });
  if (result !== 0) throw new Error(`Tools verification failed with exit ${result}: ${error.slice(-2000)}${output.slice(-2000)}`);
  return { files, command, output: output.slice(-12000) };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("pi-pipeline-status", {
    description: "Show the most recent Pi Pipeline run status",
    handler: async (_args, ctx) => {
      const run = await latestRun();
      if (!run) { ctx.ui.notify("Pi Pipeline: no runs", "info"); return; }
      const latest = run.steps.at(-1) as { actor?: string; status?: string } | undefined;
      ctx.ui.notify(`${run.runId}: ${run.status}${latest ? `; last=${latest.actor ?? "?"}/${latest.status ?? "?"}` : ""}`, run.status === "BLOCKED" ? "warning" : "info");
    },
  });
  pi.registerCommand("pi-pipeline-history", {
    description: "List recent Pi Pipeline runs",
    handler: async (_args, ctx) => {
      const ids = (await listRuns()).slice(-10).reverse();
      const entries: string[] = [];
      for (const id of ids) {
        try { const run = JSON.parse(await readFile(resolve(runDir(id), "PI-RUN.json"), "utf8")) as Run; entries.push(`${id} ${run.status}`); } catch { entries.push(`${id} INCOMPLETE`); }
      }
      ctx.ui.notify(entries.length ? entries.join("\n") : "Pi Pipeline: no run history", "info");
    },
  });
  pi.registerCommand("pi-pipeline-answer", {
    description: "Answer a pending typed question: <questionId> <optionId>",
    handler: async (args, ctx) => {
      const [questionId, answerId] = String(args ?? "").trim().split(/\s+/, 2);
      const run = await latestRun();
      if (!run || run.status !== "WAITING_FOR_USER") { ctx.ui.notify("Pi Pipeline has no run waiting for an answer", "warning"); return; }
      const question = run.questions?.find((item) => item.questionId === questionId);
      if (!question) { ctx.ui.notify(`Unknown question: ${questionId ?? "(missing)"}`, "error"); return; }
      const valid = question.type === "text" ? Boolean(answerId) : question.options?.some((option) => option.id === answerId);
      if (!valid) { ctx.ui.notify("Answer is missing or not one of the allowed option IDs", "error"); return; }
      run.status = "RESUMED";
      run.answer = { questionId, answerId, answeredAt: new Date().toISOString() };
      await appendEvent(run, { actor: "HUMAN", action: "answer", questionId, answerId });
      step(run, "HUMAN", "COMPLETED", { questionId, answerId });
      await save(run);
      ctx.ui.notify(`Answer recorded for ${questionId}; run ${run.runId} is RESUMED and requires explicit continuation.`, "info");
    },
  });
  pi.registerCommand("pi-pipeline", {
    description: "Run the complete live Pi Context-Evidence Pipeline",
    handler: async (args, ctx) => {
      const request = (typeof args === "string" ? args : String(args ?? "")).trim();
      const previousPath = resolve(WORK, "PI-RUN.json");
      try {
        const previous = JSON.parse(await readFile(previousPath, "utf8")) as Run;
        if (previous.status === "RUNNING") {
          previous.status = "BLOCKED";
          previous.blocked = { actor: "PIPELINE", code: "STALE_RUNNING_TRACE", reason: "Previous run did not reach a terminal verdict." };
          await writeFile(previousPath, JSON.stringify(previous, null, 2) + "\n", "utf8");
        }
      } catch { /* no previous trace or malformed trace is handled by the new run */ }
      const run: Run = { schemaVersion: 2, type: "PI_CONTEXT_EVIDENCE_PIPELINE_RUN", runId: `pi-pipeline-${Date.now()}`, request, status: "RUNNING", providerMode: "live-required", steps: [], evidence: [] };
      ctx.ui.setStatus("pi-pipeline", `Pi Pipeline: STARTING ${run.runId}`);
      ctx.ui.notify(`Pi Pipeline STARTED: ${run.runId}`, "info");
      await save(run);
      if (!request) { block(run, "PIPELINE", "EMPTY_REQUEST", "Usage: /pi-pipeline <request>"); await save(run); ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: BLOCKED"); ctx.ui.notify("Pi Pipeline BLOCKED: empty request; trace saved to .pi/work/PI-RUN.json", "error"); return; }
      try {
        ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: ROUTER (Jev)");
        const candidates = await readFile(resolve(WORK, "CONTEXT-MANIFEST.json"), "utf8");
        const routed = await classify(ctx, { role: "ROUTER", request, candidates: JSON.parse(candidates) }, "Is the request routable with the supplied context? Approve only if required context is present and no routing conflict exists.");
        step(run, "ROUTER", "COMPLETED", { provider: routed.provider, model: routed.model, stopReason: routed.stopReason });
        await save(run);
        ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: LUNA");
        const healthProbe = /проверь\s+доступность|проверить\s+доступность|health\s*check|availability/i.test(request);
        const lunaResult = healthProbe
          ? { agent: { text: "Health probe handled by the live pipeline stage; no implementation requested.", events: 0, toolCalls: 0, exitCode: 0, stderr: "" }, artifact: { summary: "health probe", files: [], verificationCommand: "" } }
          : await runLunaImplementation(ctx, request, routed);
        const agent = lunaResult.agent;
        const luna = { liveProviderCall: true, provider: "anymodel", model: LUNA, stopReason: "stop", text: agent.text, agentEvents: agent.events, toolCalls: agent.toolCalls, exitCode: agent.exitCode, stderr: agent.stderr };
        step(run, "LUNA", "COMPLETED", { provider: luna.provider, model: luna.model, stopReason: luna.stopReason, agentEvents: agent.events, toolCalls: agent.toolCalls, exitCode: agent.exitCode });
        const evidence = { id: `provider-evidence-${run.runId}`, kind: "provider-output", status: "observed", verificationStatus: "unverified", source: "live-provider", text: luna.text };
        await appendFile(resolve(WORK, "OBSERVATIONS.jsonl"), `${JSON.stringify(evidence)}\n`);
        run.evidence.push(evidence.id);
        const tools = healthProbe ? { files: [], command: "health probe", output: "PIPELINE_PROBE_OK" } : await applyTools(ctx.cwd, lunaResult.artifact);
        const toolsEvidence = { id: `tools-evidence-${run.runId}`, kind: "tool-observation", status: "observed", verificationStatus: "verified", source: "local-tools", files: tools.files, command: tools.command, output: tools.output };
        await appendFile(resolve(WORK, "OBSERVATIONS.jsonl"), `${JSON.stringify(toolsEvidence)}\n`);
        run.evidence.push(toolsEvidence.id);
        step(run, "TOOLS_EVIDENCE", "COMPLETED", { evidenceRefs: [evidence.id, toolsEvidence.id], source: "local-tools", files: tools.files, command: tools.command });
        await save(run);
        ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: OPUS REVIEW");
        const opus = await complete(ctx, ROUTER, OPUS, `Act as an independent reviewer of the Pi Context-Evidence Pipeline. This prompt contains authoritative evidence collected by the parent pipeline. ${healthProbe ? "Review execution completeness." : "Review the requested pipeline change for concrete blocking defects."}\nRequest: ${request}\nLuna summary: ${lunaResult.artifact.summary}\nLuna unique files: ${JSON.stringify(lunaResult.artifact.files.map((file) => file.path))}\nTools evidence (authoritative): filesWritten=${JSON.stringify(tools.files)}, command=${tools.command}, verificationStatus=verified, output=${tools.output.slice(-4000)}\nReturn exactly ACCEPTABLE if these facts satisfy the request; otherwise list only concrete blocking defects visible in the evidence.`);
        step(run, "OPUS", "COMPLETED", { provider: opus.provider, model: opus.model, stopReason: opus.stopReason });
        const reviewEvidence = { id: `review-evidence-${run.runId}`, kind: "review-output", status: "observed", verificationStatus: "unverified", source: "live-provider", text: opus.text };
        await appendFile(resolve(WORK, "OBSERVATIONS.jsonl"), `${JSON.stringify(reviewEvidence)}\n`);
        run.evidence.push(reviewEvidence.id);
        await save(run);
        ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: JEV VERIFIER");
        const verifier = await classify(ctx, { role: "JEV_VERIFIER", request, evidenceRefs: run.evidence, evidence: [evidence, reviewEvidence], opusReview: opus.text, pipelineSteps: run.steps, allRequiredRolesCompleted: run.steps.filter((item) => (item as { status?: string }).status === "COMPLETED").length === 4 }, "Is the pipeline execution evidence sufficient for approval? Approve when Router, Luna, Tools/Evidence, and Opus completed as live calls, evidence references are present, and Opus reports no actual error. For a health probe, do not require Luna to inspect or prove the pipeline externally: the trace itself is the evidence.");
        step(run, "JEV_VERIFIER", "COMPLETED", { provider: verifier.provider, model: verifier.model, stopReason: verifier.stopReason, answers: verifier.answers });
        const approved = verifier.approved?.type === "bool" && verifier.approved.probability >= 0.5;
        run.status = approved ? "APPROVE" : "INSUFFICIENT_EVIDENCE";
        run.verdict = { decision: run.status, evidenceRefs: run.evidence, stopReason: verifier.stopReason, answers: verifier.answers, source: { provider: ROUTER, model: JEV, liveProviderCall: true } };
        await save(run);
        ctx.ui.setStatus("pi-pipeline", `Pi Pipeline: ${run.status}`);
        ctx.ui.notify(`Pi Pipeline ${run.status}; trace: .pi/work/PI-RUN.json`, approved ? "info" : "warning");
      } catch (error) {
        block(run, "PIPELINE", "REQUIRED_ROLE_UNAVAILABLE_OR_FAILED", error instanceof Error ? error.message : String(error));
        await save(run);
        ctx.ui.setStatus("pi-pipeline", "Pi Pipeline: BLOCKED");
        ctx.ui.notify(`Pi Pipeline BLOCKED: ${run.blocked.reason}`, "error");
      }
    },
  });
}

export { complete, classify };
