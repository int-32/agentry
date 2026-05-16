#!/usr/bin/env node
/**
 * agentry PoC #1 — Claude Agent SDK 最小可跑
 *
 * 目的：验证 @anthropic-ai/claude-agent-sdk 之 query() 同进程调用，
 *      流式打印消息事件，看其形态以决 agentry provider 适配层之事件映射。
 *
 * 跑法：node scripts/agentry-poc/claude-sdk-hello.mjs
 * 鉴权：自动用 ~/.claude/ 之 OAuth 或 $ANTHROPIC_API_KEY
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const PROMPT = process.argv[2] || "用一句话介绍你自己，并列出你能调用的工具名。";

console.error(`[poc] query("${PROMPT.slice(0, 60)}")`);
console.error(`[poc] streaming events ...`);
console.error("---");

let messageCount = 0;
let textBudget = 0;

try {
  const stream = query({
    prompt: PROMPT,
    options: {
      // 用 SDK 默认（cwd / 模型 / tools / hooks），先看裸跑形态
    },
  });

  for await (const msg of stream) {
    messageCount += 1;
    const type = msg.type;
    const subtype = msg.subtype || msg.event?.type || "";

    // 简表：type / subtype / 摘要
    if (type === "assistant" && msg.message?.content) {
      const blocks = msg.message.content;
      for (const block of blocks) {
        if (block.type === "text") {
          const text = block.text || "";
          textBudget += text.length;
          process.stdout.write(text);
        } else if (block.type === "tool_use") {
          console.error(`\n[poc][tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`);
        } else if (block.type === "thinking") {
          console.error(`\n[poc][thinking] ${(block.thinking || "").slice(0, 80)}…`);
        }
      }
    } else if (type === "user" && msg.message?.content) {
      // tool_result echoed back as user message
      for (const block of msg.message.content) {
        if (block.type === "tool_result") {
          const out = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          console.error(`\n[poc][tool_result#${block.tool_use_id?.slice(0, 8)}] ${out.slice(0, 100)}…`);
        }
      }
    } else if (type === "result") {
      console.error(`\n[poc][result] stop=${msg.subtype || msg.stop_reason}  usage=${JSON.stringify(msg.usage || {}).slice(0, 100)}`);
    } else if (type === "system") {
      console.error(`\n[poc][system] ${subtype}`);
    } else {
      console.error(`\n[poc][${type}${subtype ? ":" + subtype : ""}]`);
    }
  }

  console.error(`\n---\n[poc] done: ${messageCount} messages, ${textBudget} chars of assistant text`);
} catch (err) {
  console.error(`\n[poc][ERROR] ${err?.name || ""}: ${err?.message || err}`);
  if (err?.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}
