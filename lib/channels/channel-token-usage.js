import fs from "fs";
import path from "path";
import { safeConversationStem } from "../conversations/agent-phone-projection.js";
import { normalizeLlmUsage } from "../llm/usage-observer.js";

function safeAgentDir(agentsDir, agentId) {
  if (!agentsDir || !agentId || /[/\\]|\.\./.test(agentId)) return null;
  const resolved = path.resolve(path.join(agentsDir, agentId));
  const base = path.resolve(agentsDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export function startOfLocalDay(now = new Date()) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfLocalWeek(now = new Date()) {
  const date = startOfLocalDay(now);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function listSessionFiles(sessionDir) {
  try {
    return fs.readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(sessionDir, entry.name));
  } catch {
    return [];
  }
}

function addAssistantUsageFromFile(filePath, boundaries, totals) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
      const usage = normalizeLlmUsage(entry.message?.usage);
      if (!usage) continue;
      const ts = Date.parse(entry.timestamp || entry.message?.timestamp || "");
      if (Number.isNaN(ts)) continue;
      const total = usage.totalTokens || 0;
      if (ts >= boundaries.weekStartMs) totals.week += total;
      if (ts >= boundaries.dayStartMs) totals.today += total;
    } catch {
      // Ignore damaged JSONL rows; session history can survive partial writes.
    }
  }
}

export function readAgentChannelTokenUsage({ agentsDir, agentId, conversationId, now = new Date() } = {}) {
  const agentDir = safeAgentDir(agentsDir, agentId);
  if (!agentDir || !conversationId) return { today: 0, week: 0 };

  const sessionDir = path.join(agentDir, "phone", "sessions", safeConversationStem(conversationId));
  const totals = { today: 0, week: 0 };
  const boundaries = {
    dayStartMs: startOfLocalDay(now).getTime(),
    weekStartMs: startOfLocalWeek(now).getTime(),
  };

  for (const filePath of listSessionFiles(sessionDir)) {
    addAssistantUsageFromFile(filePath, boundaries, totals);
  }

  return totals;
}

export function readChannelTokenUsageByMember({ agentsDir, members = [], conversationId, now = new Date() } = {}) {
  const result = {};
  for (const memberId of members) {
    if (typeof memberId !== "string" || !memberId.trim()) continue;
    result[memberId] = readAgentChannelTokenUsage({
      agentsDir,
      agentId: memberId.trim(),
      conversationId,
      now,
    });
  }
  return result;
}
