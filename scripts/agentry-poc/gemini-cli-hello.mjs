#!/usr/bin/env node
/**
 * agentry PoC #3 — Gemini CLI 子进程包装（JSONL）
 *
 * 目的：验证 gemini CLI 之 `-p "..." -o stream-json` 模式，
 *      child_process spawn + JSONL 解析 + event 类型分类。
 *
 * 跑法：node scripts/agentry-poc/gemini-cli-hello.mjs
 * 鉴权：自动用 gemini CLI 之既有 login（~/.gemini/ 之 OAuth）
 */

import { spawn } from "node:child_process";
import readline from "node:readline";

const PROMPT = process.argv[2] || "用一句话介绍你自己，列出你能用的三个工具名。";

console.error(`[poc] spawn: gemini -p "${PROMPT.slice(0, 60)}" -o stream-json --approval-mode plan`);
console.error(`[poc] streaming JSONL events ...`);
console.error("---");

const child = spawn(
  "gemini",
  ["-p", PROMPT, "-o", "stream-json", "--approval-mode", "plan"],
  { stdio: ["ignore", "pipe", "pipe"], env: process.env }
);

let evtCount = 0;
let textBuf = "";
const eventTypes = new Map();

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

rl.on("line", (line) => {
  if (!line.trim()) return;
  evtCount += 1;
  let evt;
  try {
    evt = JSON.parse(line);
  } catch {
    console.error(`\n[poc][bad-json] ${line.slice(0, 120)}`);
    return;
  }

  const t = evt.type || evt.event || "(no-type)";
  eventTypes.set(t, (eventTypes.get(t) || 0) + 1);

  // 摘要：常见字段
  if (t === "content" || t === "text" || t === "message") {
    const text = evt.text || evt.content || evt.message || "";
    if (typeof text === "string") {
      textBuf += text;
      process.stdout.write(text);
    } else {
      console.error(`\n[poc][${t}] ${JSON.stringify(text).slice(0, 100)}`);
    }
  } else if (t === "tool_call" || t === "tool_use" || t === "tool_request") {
    console.error(`\n[poc][${t}] ${evt.name || evt.tool || "?"}(${JSON.stringify(evt.input || evt.args || {}).slice(0, 80)})`);
  } else if (t === "tool_result" || t === "tool_response") {
    console.error(`\n[poc][${t}] ${JSON.stringify(evt).slice(0, 120)}`);
  } else if (t === "error") {
    console.error(`\n[poc][error] ${evt.message || JSON.stringify(evt).slice(0, 200)}`);
  } else if (t === "done" || t === "complete" || t === "end" || t === "session_end") {
    console.error(`\n[poc][${t}] ${JSON.stringify(evt).slice(0, 200)}`);
  } else {
    // 未知 type —— 先 dump 头一发，避免刷屏
    console.error(`\n[poc][?${t}] ${JSON.stringify(evt).slice(0, 200)}`);
  }
});

let stderrBuf = "";
child.stderr.on("data", (chunk) => {
  stderrBuf += chunk.toString();
});

child.on("close", (code) => {
  if (stderrBuf.trim()) {
    console.error(`\n[poc][stderr]\n${stderrBuf.slice(0, 600)}`);
  }
  console.error(`\n---`);
  console.error(`[poc] exit=${code}, events=${evtCount}, assistant chars=${textBuf.length}`);
  console.error(`[poc] event type counts:`);
  for (const [t, n] of [...eventTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${t}: ${n}`);
  }
  process.exit(code || 0);
});

child.on("error", (err) => {
  console.error(`[poc][spawn-error] ${err.message}`);
  process.exit(1);
});
