#!/usr/bin/env node
/**
 * agentry PoC #2 — Codex SDK 最小可跑
 *
 * 目的：验证 @openai/codex-sdk 之 Codex/Thread API（子进程包装 + JSONL）
 *      流式打印 ThreadEvent，看 item 形态以决 agentry provider 之事件映射。
 *
 * 跑法：node scripts/agentry-poc/codex-sdk-hello.mjs
 * 鉴权：自动用 codex CLI 之既有 login（~/.codex/auth.json 或 OAuth）
 */

import { Codex } from "@openai/codex-sdk";

const PROMPT = process.argv[2] || "用一句话介绍你自己，列出你能用的工具名。";

console.error(`[poc] codex.startThread(...).runStreamed("${PROMPT.slice(0, 60)}")`);
console.error(`[poc] streaming events ...`);
console.error("---");

let evtCount = 0;
let textBuf = "";

try {
  const codex = new Codex();   // 用默认 codex CLI 路径 + 默认 auth
  const thread = codex.startThread({
    sandboxMode: "read-only",   // PoC 不写文件，read-only 最安
    skipGitRepoCheck: true,
    approvalPolicy: "never",
  });

  const streamed = await thread.runStreamed(PROMPT);

  for await (const event of streamed.events) {
    evtCount += 1;
    const t = event.type;

    if (t === "thread.started") {
      console.error(`[poc][thread.started] id=${event.thread_id}`);
    } else if (t === "turn.started") {
      console.error(`[poc][turn.started]`);
    } else if (t === "turn.completed") {
      console.error(`[poc][turn.completed] usage=${JSON.stringify(event.usage).slice(0, 120)}`);
    } else if (t === "turn.failed") {
      console.error(`[poc][turn.failed] err=${event.error?.message}`);
    } else if (t === "item.started" || t === "item.updated" || t === "item.completed") {
      const item = event.item;
      const itype = item.type;
      const itag = `${t.split('.')[1]}#${itype}`;
      if (itype === "agent_message") {
        const txt = item.text || "";
        if (t === "item.completed") {
          process.stdout.write(txt);
          textBuf += txt;
        } else {
          // streaming 中间 update 也会带 partial text，但为避免重复仅在 completed 时打印
        }
      } else if (itype === "reasoning") {
        if (t === "item.completed") console.error(`\n[poc][${itag}] ${(item.text || "").slice(0, 100)}…`);
      } else if (itype === "command_execution") {
        if (t === "item.started") console.error(`\n[poc][${itag}] $ ${item.command.slice(0, 80)}`);
        if (t === "item.completed") console.error(`[poc][${itag}] exit=${item.exit_code} out=${(item.aggregated_output || "").slice(0, 80)}…`);
      } else if (itype === "file_change") {
        if (t === "item.completed") console.error(`\n[poc][${itag}] ${item.status}: ${item.changes.map(c => `${c.kind} ${c.path}`).join(", ")}`);
      } else if (itype === "mcp_tool_call") {
        if (t === "item.started") console.error(`\n[poc][${itag}] ${item.server}/${item.tool}(${JSON.stringify(item.arguments).slice(0, 60)})`);
        if (t === "item.completed") console.error(`[poc][${itag}] ${item.status}`);
      } else if (itype === "web_search") {
        if (t === "item.started") console.error(`\n[poc][${itag}] q="${item.query}"`);
      } else if (itype === "todo_list") {
        if (t === "item.completed") console.error(`\n[poc][${itag}] ${item.items.length} todos`);
      } else if (itype === "error") {
        console.error(`\n[poc][${itag}] ${item.message}`);
      }
    } else if (t === "error") {
      console.error(`\n[poc][stream.error] ${event.message}`);
    } else {
      console.error(`\n[poc][${t}] (unhandled)`);
    }
  }

  console.error(`\n---\n[poc] done: ${evtCount} events, ${textBuf.length} chars of final assistant text`);
  console.error(`[poc] thread.id = ${thread.id} (可 resumeThread 续会话)`);
} catch (err) {
  console.error(`\n[poc][ERROR] ${err?.name || ""}: ${err?.message || err}`);
  if (err?.stack) console.error(err.stack.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
}
