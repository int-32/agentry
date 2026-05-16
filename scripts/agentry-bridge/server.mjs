#!/usr/bin/env node
/**
 * agentry-bridge — 本机 OpenAI 兼容 HTTP server，桥三家 SDK/CLI 到 chat completions 协议
 *
 * 监听 :51720，实现 POST /v1/chat/completions + SSE，按 model 字段路由：
 *   claude-* / opus / sonnet / haiku  → @anthropic-ai/claude-agent-sdk
 *   codex / gpt-codex                  → @openai/codex-sdk
 *   gemini / gemini-*                  → gemini CLI spawn `-o stream-json`
 *
 * Hanako / 任何 OpenAI 兼容 client 可注册为 API provider，
 *   base_url: http://127.0.0.1:51720/v1
 *   api_key:  任意（本机不验）
 *   model:    claude-opus-4-1 / codex / gemini-3 等
 *
 * 跑法：node scripts/agentry-bridge/server.mjs
 */

import { createServer } from "node:http";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.AGENTRY_BRIDGE_PORT || "51720", 10);

// ── 路由：按 model 名前缀选 backend ──
function routeBackend(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("codex") || m.includes("gpt-codex")) return "codex";
  if (m.includes("gemini")) return "gemini";
  // 默认 Claude
  return "claude";
}

// ── 提取最后一条 user message 作 prompt（最简语义；后续可改成完整 messages 透传）──
function extractPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  if (!lastUser) return "";
  if (typeof lastUser.content === "string") return lastUser.content;
  if (Array.isArray(lastUser.content)) {
    return lastUser.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  }
  return "";
}

// ── 写 SSE delta chunk ──
function writeDelta(res, id, model, content) {
  const chunk = {
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// reasoning_content 增量 — Pi SDK / openai-completions 解析为 thinking 块，Hanako UI 显 ThinkingBlock
function writeReasoning(res, id, model, reasoning) {
  const chunk = {
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// 工具调用 — 不发 delta.tool_calls（否则 Hanako agent loop 见 toolCall 块要本地执行，
// 找不到 Claude SDK 内部之 Read/Bash 等工具 → 报错重发 LLM → 死循环）。
// 改作 markdown 文本透出，UI 走 MarkdownContent 显条理。
function writeToolCallText(res, id, model, name, argsObj) {
  const argsStr = formatArgsInline(argsObj);
  const head = `\n\n**▸ ${name}**${argsStr ? `(${argsStr})` : "()"}\n`;
  writeDelta(res, id, model, head);
}

function writeToolResultText(res, id, model, name, payload) {
  const text = typeof payload === "string" ? payload : safeStringify(payload);
  const trimmed = text.length > 4000 ? text.slice(0, 4000) + "\n…（截断）" : text;
  writeDelta(res, id, model, `\n\`\`\`text\n${trimmed}\n\`\`\`\n`);
}

function formatArgsInline(argsObj) {
  if (!argsObj || typeof argsObj !== "object") return "";
  const entries = Object.entries(argsObj);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : safeStringify(v);
      const short = s.length > 120 ? s.slice(0, 120) + "…" : s;
      return `${k}=${short}`;
    })
    .join(", ");
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

function writeDone(res, id, model, finishReason = "stop", usage = null) {
  const chunk = {
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = usage;
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(`data: [DONE]\n\n`);
  res.end();
}

// ── Claude SDK ──
// 透传：
//   assistant.text       → delta.content
//   assistant.thinking   → delta.reasoning_content（pi-ai → thinking 块 / ThinkingBlock）
//   assistant.tool_use   → markdown 头 "▸ <name>(args)"（不发 delta.tool_calls，避免 Hanako 重执行死循环）
//   user.tool_result     → markdown fenced code block
async function streamClaude({ res, id, model, prompt }) {
  const stream = claudeQuery({ prompt, options: {} });
  let usage = null;
  const toolNameById = new Map();
  for await (const msg of stream) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          writeDelta(res, id, model, block.text);
        } else if (block.type === "thinking" && block.thinking) {
          writeReasoning(res, id, model, block.thinking);
        } else if (block.type === "tool_use") {
          toolNameById.set(block.id, block.name);
          writeToolCallText(res, id, model, block.name, block.input ?? {});
        }
      }
    } else if (msg.type === "user" && msg.message?.content) {
      const content = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const name = toolNameById.get(block.tool_use_id) || "tool";
          let payload = block.content;
          if (Array.isArray(payload)) {
            payload = payload
              .map(b => b.type === "text" ? b.text : safeStringify(b))
              .join("\n");
          }
          writeToolResultText(res, id, model, name, payload);
        }
      }
    } else if (msg.type === "result") {
      usage = msg.usage || null;
    }
  }
  writeDone(res, id, model, "stop", usage && {
    prompt_tokens: usage.input_tokens || 0,
    completion_tokens: usage.output_tokens || 0,
    total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
  });
}

// ── Codex SDK ──
// 透传（同 streamClaude 之 markdown 文本策略，避免 delta.tool_calls 引 Hanako 死循环）：
//   item.updated/agent_message      → delta.content
//   item.completed/reasoning        → delta.reasoning_content
//   item.completed/command_execution → markdown bash 行 + 输出块
//   item.completed/file_change       → markdown edit 行
//   item.completed/mcp_tool_call     → markdown 行 + 结果块
//   item.completed/web_search        → markdown web_search 行
async function streamCodex({ res, id, model, prompt }) {
  const codex = new Codex();
  const thread = codex.startThread({ sandboxMode: "read-only", skipGitRepoCheck: true, approvalPolicy: "never" });
  const streamed = await thread.runStreamed(prompt);

  let lastText = "";
  let usage = null;
  for await (const evt of streamed.events) {
    if (evt.type === "item.updated" && evt.item.type === "agent_message") {
      const cur = evt.item.text || "";
      const delta = cur.slice(lastText.length);
      if (delta) writeDelta(res, id, model, delta);
      lastText = cur;
    } else if (evt.type === "item.completed") {
      const item = evt.item;
      if (item.type === "agent_message") {
        const cur = item.text || "";
        const delta = cur.slice(lastText.length);
        if (delta) writeDelta(res, id, model, delta);
        lastText = cur;
      } else if (item.type === "reasoning") {
        if (item.text) writeReasoning(res, id, model, item.text);
      } else if (item.type === "command_execution") {
        writeToolCallText(res, id, model, "bash", { command: item.command });
        if (item.aggregated_output) {
          writeToolResultText(res, id, model, "bash", item.aggregated_output);
        }
      } else if (item.type === "file_change") {
        writeToolCallText(res, id, model, "edit", { changes: item.changes });
      } else if (item.type === "mcp_tool_call") {
        const callName = `${item.server}/${item.tool}`;
        writeToolCallText(res, id, model, callName, item.arguments ?? {});
        if (item.result) writeToolResultText(res, id, model, callName, item.result);
        else if (item.error) writeToolResultText(res, id, model, callName, `error: ${item.error.message}`);
      } else if (item.type === "web_search") {
        writeToolCallText(res, id, model, "web_search", { query: item.query });
      }
    } else if (evt.type === "turn.completed") {
      usage = evt.usage;
    }
  }
  writeDone(res, id, model, "stop", usage && {
    prompt_tokens: usage.input_tokens || 0,
    completion_tokens: usage.output_tokens || 0,
    total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
  });
}

// ── Gemini CLI spawn ──
// 透传：
//   { type:"message", role:"assistant", content, delta:true }   → delta.content
//   { type:"tool_use", tool_name, tool_id, parameters }         → tool_call
//   { type:"tool_result", tool_id, status, output, error }      → tool_result block
//   { type:"result", stats }                                    → usage
async function streamGemini({ res, id, model, prompt }) {
  return new Promise((resolve) => {
    const child = spawn(
      "gemini",
      ["-p", prompt, "-o", "stream-json"],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env }
    );
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let usage = null;
    const toolNameById = new Map();
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.type === "message" && evt.role === "assistant" && typeof evt.content === "string") {
        if (evt.content) writeDelta(res, id, model, evt.content);
      } else if (evt.type === "tool_use" && evt.tool_id) {
        toolNameById.set(evt.tool_id, evt.tool_name);
        writeToolCallText(res, id, model, evt.tool_name || "tool", evt.parameters ?? {});
      } else if (evt.type === "tool_result" && evt.tool_id) {
        const name = toolNameById.get(evt.tool_id) || "tool";
        const payload = evt.status === "error"
          ? `[error] ${evt.error?.message || evt.output || ""}`
          : (evt.output ?? "");
        writeToolResultText(res, id, model, name, payload);
      } else if (evt.type === "result" && evt.stats) {
        usage = evt.stats;
      }
    });
    child.on("close", () => {
      writeDone(res, id, model, "stop", usage && {
        prompt_tokens: usage.input_tokens || usage.input || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      });
      resolve();
    });
    child.on("error", (err) => {
      writeDelta(res, id, model, `\n[bridge:gemini-spawn-error] ${err.message}`);
      writeDone(res, id, model, "stop");
      resolve();
    });
  });
}

// ── HTTP server ──
const server = createServer(async (req, res) => {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      object: "list",
      data: [
        { id: "claude-opus-4-1", object: "model", owned_by: "agentry-bridge" },
        { id: "claude-sonnet-4-5", object: "model", owned_by: "agentry-bridge" },
        { id: "codex", object: "model", owned_by: "agentry-bridge" },
        { id: "gemini-3", object: "model", owned_by: "agentry-bridge" },
      ],
    }));
    return;
  }

  if (req.method === "POST" && (req.url === "/v1/chat/completions" || req.url === "/chat/completions")) {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400); res.end(`{"error":"invalid json"}`); return; }

      const model = payload.model || "claude-opus-4-1";
      const prompt = extractPrompt(payload.messages);
      const id = `chatcmpl-${randomUUID()}`;
      const backend = routeBackend(model);
      const wantStream = payload.stream === true;

      // ── 非流式 (stream: false) —— 累计后一次返完整 ChatCompletion JSON ──
      if (!wantStream) {
        let textBuf = "";
        let usageBuf = null;
        const fakeRes = {
          write: (line) => {
            // line: "data: <json>\n\n"
            const m = /^data:\s*(.+?)\n\n$/s.exec(line);
            if (!m) return;
            if (m[1] === "[DONE]") return;
            try {
              const chunk = JSON.parse(m[1]);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) textBuf += delta;
              if (chunk.usage) usageBuf = chunk.usage;
            } catch {}
          },
          end: () => {},
        };
        console.error(`[bridge] ${new Date().toISOString()} ${backend} ${model} (non-stream) prompt=${prompt.slice(0, 60).replace(/\n/g, "↵")}`);
        try {
          if (backend === "claude") await streamClaude({ res: fakeRes, id, model, prompt });
          else if (backend === "codex") await streamCodex({ res: fakeRes, id, model, prompt });
          else if (backend === "gemini") await streamGemini({ res: fakeRes, id, model, prompt });
        } catch (err) {
          console.error(`[bridge][ERROR non-stream] ${err.message}`);
          textBuf += `\n[bridge:error] ${err.message}`;
        }
        const completion = {
          id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: textBuf },
            finish_reason: "stop",
          }],
          usage: usageBuf || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(completion));
        return;
      }

      // ── 流式 SSE ──
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      console.error(`[bridge] ${new Date().toISOString()} ${backend} ${model} (stream) prompt=${prompt.slice(0, 60).replace(/\n/g, "↵")}`);

      try {
        if (backend === "claude") await streamClaude({ res, id, model, prompt });
        else if (backend === "codex") await streamCodex({ res, id, model, prompt });
        else if (backend === "gemini") await streamGemini({ res, id, model, prompt });
        else {
          writeDelta(res, id, model, `[bridge] unknown backend for model ${model}`);
          writeDone(res, id, model);
        }
      } catch (err) {
        console.error(`[bridge][ERROR] ${err.message}`);
        writeDelta(res, id, model, `\n[bridge:error] ${err.message}`);
        writeDone(res, id, model, "stop");
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found", note: "POST /v1/chat/completions or GET /v1/models" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[bridge] agentry-bridge listening at http://127.0.0.1:${PORT}`);
  console.error(`[bridge] POST /v1/chat/completions  GET /v1/models`);
  console.error(`[bridge] routes by model:`);
  console.error(`  claude-*  → @anthropic-ai/claude-agent-sdk`);
  console.error(`  codex     → @openai/codex-sdk`);
  console.error(`  gemini-*  → gemini CLI (-o stream-json)`);
});
