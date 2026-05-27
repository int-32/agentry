#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOME = path.join(os.homedir(), ".agentry-dev");
const agentryHome = process.env.AGENTRY_HOME || process.env.HANA_HOME || DEFAULT_HOME;
const logDir = path.join(agentryHome, "logs");
const TAIL_LINES = Number(process.env.AGENTRY_LOG_TAIL_LINES || 120);
const POLL_MS = Number(process.env.AGENTRY_LOG_POLL_MS || 500);
const AGENT_WATCH = process.argv.includes("--agent-watch") || process.env.AGENTRY_LOG_AGENT_WATCH === "1";

let currentFile = null;
let currentOffset = 0;
let latestTimer = null;
let pendingLine = "";
let diagnosticState = createDiagnosticState();

function latestLogFile() {
  try {
    const files = fs.readdirSync(logDir)
      .filter(file => file.endsWith(".log"))
      .map(file => {
        const filePath = path.join(logDir, file);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath || null;
  } catch {
    return null;
  }
}

function tailText(text, lineCount) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - lineCount - 1)).join("\n");
}

function createDiagnosticState() {
  return {
    traces: new Map(),
    lastWarnByKey: new Map(),
    lastPerfLoggedAt: null,
  };
}

function parseClockMs(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
}

function parsePerfLine(line) {
  if (!line.includes("[perf] welcome.agent.")) return null;
  const prefix = line.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[perf\]\s+(\S+)(?:\s+([0-9.]+)ms)?\s*(.*)$/);
  if (!prefix) return null;
  const [, loggedAt, label, durationText, detailText] = prefix;
  const detail = {};
  for (const part of detailText.split(/\s+/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index);
    detail[key] = part.slice(index + 1);
  }
  return {
    label,
    durationMs: durationText ? Number(durationText) : null,
    detail,
    loggedAtMs: parseClockMs(loggedAt),
    clientAtMs: detail.client ? parseClockMs(detail.client) : null,
  };
}

function diagnosticKey(kind, detail) {
  return `${kind}:${detail.trace || ""}:${detail.agent || ""}:${detail.phase || ""}`;
}

function printDiagnostic(kind, message, detail) {
  const key = diagnosticKey(kind, detail);
  const now = Date.now();
  const last = diagnosticState.lastWarnByKey.get(key) || 0;
  if (now - last < 2000) return;
  diagnosticState.lastWarnByKey.set(key, now);
  process.stdout.write(`[agent-watch] ${kind}: ${message}\n`);
}

function updateDiagnostics(line) {
  if (!AGENT_WATCH) return;
  const prefixedPerf = line.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[perf\]\s+/);
  if (prefixedPerf) diagnosticState.lastPerfLoggedAt = prefixedPerf[1];
  const diagnosticLine = !prefixedPerf && diagnosticState.lastPerfLoggedAt && /^welcome\.agent\./.test(line)
    ? `[${diagnosticState.lastPerfLoggedAt}] [INFO] [perf] ${line}`
    : line;

  const serverPerf = diagnosticLine.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[perf\]\s+server\.(eventLoopLag|route)\s+([0-9.]+)ms(?:\s+(.*))?$/);
  if (serverPerf) {
    const [, , kind, duration, detailText = ""] = serverPerf;
    printDiagnostic(
      kind === "eventLoopLag" ? "server-jank" : "slow-api",
      `${Number(duration).toFixed(0)}ms ${detailText}`.trim(),
      { trace: `server-${kind}`, phase: kind },
    );
    return;
  }

  const parsed = parsePerfLine(diagnosticLine);
  if (!parsed) return;

  const { label, durationMs, detail, loggedAtMs, clientAtMs } = parsed;
  const traceId = detail.trace;
  if (traceId) {
    const existing = diagnosticState.traces.get(traceId) || {};
    existing.agent = detail.agent || existing.agent;
    existing.version = detail.version || existing.version;
    existing.trace = traceId;
    if (detail.phase === "start" && clientAtMs !== null) existing.startedAtMs = clientAtMs;
    if (detail.phase) existing.lastPhase = detail.phase;
    if (clientAtMs !== null) existing.lastClientAtMs = clientAtMs;
    diagnosticState.traces.set(traceId, existing);
  }

  if (loggedAtMs !== null && clientAtMs !== null) {
    let lag = loggedAtMs - clientAtMs;
    if (lag < -12 * 60 * 60 * 1000) lag += 24 * 60 * 60 * 1000;
    if (lag > 700) {
      printDiagnostic(
        "log-lag",
        `${lag.toFixed(0)}ms agent=${detail.agent || "?"} phase=${detail.phase || label} trace=${traceId || "-"}`,
        detail,
      );
    }
  }

  if (label === "welcome.agent.eventLoopLag" || label === "welcome.agent.longtask") {
    printDiagnostic(
      "renderer-jank",
      `${durationMs?.toFixed(1) || "?"}ms phase=${detail.phase || "-"} trace=${traceId || "-"}`,
      detail,
    );
  }

  if (label === "welcome.agent.frame" && durationMs !== null && durationMs > 50) {
    printDiagnostic(
      "slow-frame",
      `${durationMs.toFixed(1)}ms agent=${detail.agent || "?"} phase=${detail.phase || "-"} trace=${traceId || "-"}`,
      detail,
    );
  }

  if (label === "welcome.agent.switch" && durationMs !== null && detail.phase === "commit" && durationMs > 260) {
    printDiagnostic(
      "slow-switch",
      `${durationMs.toFixed(1)}ms agent=${detail.agent || "?"} trace=${traceId || "-"}`,
      detail,
    );
  }

  if (label === "welcome.agent.deskFiles" && durationMs !== null && durationMs > 300) {
    printDiagnostic(
      "slow-desk-files",
      `${durationMs.toFixed(1)}ms agent=${detail.agent || "?"} root=${detail.root || ""} trace=${traceId || "-"}`,
      detail,
    );
  }

  if (
    label === "welcome.agent.switch.trace"
    && traceId
    && clientAtMs !== null
    && (detail.phase === "complete" || detail.phase === "complete-empty-root")
  ) {
    const trace = diagnosticState.traces.get(traceId);
    if (trace?.startedAtMs !== undefined) {
      let total = clientAtMs - trace.startedAtMs;
      if (total < -12 * 60 * 60 * 1000) total += 24 * 60 * 60 * 1000;
      if (total > 420) {
        printDiagnostic(
          "slow-trace",
          `${total.toFixed(0)}ms agent=${detail.agent || trace.agent || "?"} phase=${detail.phase} trace=${traceId}`,
          detail,
        );
      }
    }
  }

  if (diagnosticState.traces.size > 200) {
    const keys = Array.from(diagnosticState.traces.keys());
    for (const key of keys.slice(0, diagnosticState.traces.size - 120)) diagnosticState.traces.delete(key);
  }
}

function writeLogText(text) {
  process.stdout.write(text);
  if (!AGENT_WATCH) return;
  pendingLine += text;
  const lines = pendingLine.split(/\r?\n/);
  pendingLine = lines.pop() || "";
  for (const line of lines) updateDiagnostics(line);
}

function printInitialTail(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const tail = tailText(content, TAIL_LINES);
    if (tail) writeLogText(`${tail}${tail.endsWith("\n") ? "" : "\n"}`);
    currentOffset = stat.size;
  } catch {
    currentOffset = 0;
  }
}

function readNewBytes(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < currentOffset) currentOffset = 0;
    if (stat.size === currentOffset) return;
    const byteCount = stat.size - currentOffset;
    const buffer = Buffer.alloc(byteCount);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, byteCount, currentOffset);
    fs.closeSync(fd);
    const text = buffer.toString("utf8");
    currentOffset = stat.size;
    writeLogText(text);
  } catch {
    // The active log can disappear during restart; the latest-file poll will reattach.
  }
}

function follow(filePath) {
  if (currentFile === filePath) return;
  if (currentFile) fs.unwatchFile(currentFile);
  currentFile = filePath;
  currentOffset = 0;
  pendingLine = "";
  diagnosticState = createDiagnosticState();
  process.stdout.write(`\n[logs:tail] following ${filePath}\n`);
  if (AGENT_WATCH) process.stdout.write("[agent-watch] enabled for welcome.agent.* traces\n");
  printInitialTail(filePath);
  fs.watchFile(filePath, { interval: POLL_MS }, () => readNewBytes(filePath));
}

function pollLatest() {
  const filePath = latestLogFile();
  if (!filePath) {
    process.stdout.write(`[logs:tail] waiting for logs in ${logDir}\n`);
    return;
  }
  follow(filePath);
}

function stop() {
  if (latestTimer) clearInterval(latestTimer);
  if (currentFile) fs.unwatchFile(currentFile);
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

pollLatest();
latestTimer = setInterval(pollLatest, 1000);
