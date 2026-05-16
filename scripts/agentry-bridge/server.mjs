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

// reasoning_content 增量 — Pi SDK / openai-completions 解析为 thinking 块
function writeReasoning(res, id, model, reasoning) {
  const chunk = {
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// 一次性发送一条完整的 tool_call（id/name/arguments 同包）
// idx 为 OpenAI tool_calls 数组下标，需在同一 turn 内单调递增
function writeToolCall(res, id, model, idx, callId, name, argsObj) {
  const chunk = {
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: idx,
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(argsObj ?? {}) },
        }],
      },
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// 工具结果 — OpenAI 流协议无原生承载，妥协方案：以可折叠之 markdown 块作 text delta 透出
// 后续如 Hanako 支持自定义协议扩展可改为 structural delta
function writeToolResultBlock(res, id, model, toolName, callId, payload) {
  const text = typeof payload === "string" ? payload : safeStringify(payload);
  const preview = text.length > 4000 ? text.slice(0, 4000) + "\n…（截断）" : text;
  const header = `\n\n<details><summary>tool_result · ${toolName}${callId ? ` (${callId.slice(0, 8)})` : ""}</summary>\n\n\`\`\`\n${preview}\n\`\`\`\n\n</details>\n`;
  writeDelta(res, id, model, header);
}

function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
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
//   assistant.thinking   → delta.reasoning_content
//   assistant.tool_use   → delta.tool_calls[{ id, type:"function", function:{name, arguments} }]
//   user.tool_result     → 以 <details> 块作 text 透出（OpenAI 流协议无原生承载）
async function streamClaude({ res, id, model, prompt }) {
  const stream = claudeQuery({ prompt, options: {} });
  let usage = null;
  let toolCallIdx = 0;
  const toolNameById = new Map(); // id → name，用于 tool_result 时回查
  for await (const msg of stream) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          writeDelta(res, id, model, block.text);
        } else if (block.type === "thinking" && block.thinking) {
          writeReasoning(res, id, model, block.thinking);
        } else if (block.type === "tool_use") {
          toolNameById.set(block.id, block.name);
          writeToolCall(res, id, model, toolCallIdx++, block.id, block.name, block.input ?? {});
        }
      }
    } else if (msg.type === "user" && msg.message?.content) {
      const content = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const name = toolNameById.get(block.tool_use_id) || "tool";
          // tool_result.content 可能是 string 或 content blocks 数组
          let payload = block.content;
          if (Array.isArray(payload)) {
            payload = payload
              .map(b => b.type === "text" ? b.text : safeStringify(b))
              .join("\n");
          }
          writeToolResultBlock(res, id, model, name, block.tool_use_id, payload);
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
// 透传：
//   item.updated/agent_message  → delta.content（增量切片）
//   item.completed/reasoning    → delta.reasoning_content
//   item.completed/command_execution → tool_call name="bash" args={ command, exit_code, output? }
//   item.completed/file_change       → tool_call name="edit" args={ changes }
//   item.completed/mcp_tool_call     → tool_call name="<server>/<tool>" args=arguments
//                                       + tool_result block
//   item.completed/web_search        → tool_call name="web_search" args={ query }
async function streamCodex({ res, id, model, prompt }) {
  const codex = new Codex();
  const thread = codex.startThread({ sandboxMode: "read-only", skipGitRepoCheck: true, approvalPolicy: "never" });
  const streamed = await thread.runStreamed(prompt);

  let lastText = "";
  let usage = null;
  let toolCallIdx = 0;
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
        writeToolCall(res, id, model, toolCallIdx++, item.id, "bash", {
          command: item.command,
          exit_code: item.exit_code,
          status: item.status,
        });
        if (item.aggregated_output) {
          writeToolResultBlock(res, id, model, "bash", item.id, item.aggregated_output);
        }
      } else if (item.type === "file_change") {
        writeToolCall(res, id, model, toolCallIdx++, item.id, "edit", {
          changes: item.changes,
          status: item.status,
        });
      } else if (item.type === "mcp_tool_call") {
        const callName = `${item.server}/${item.tool}`;
        writeToolCall(res, id, model, toolCallIdx++, item.id, callName, item.arguments ?? {});
        if (item.result) {
          writeToolResultBlock(res, id, model, callName, item.id, item.result);
        } else if (item.error) {
          writeToolResultBlock(res, id, model, callName, item.id, `error: ${item.error.message}`);
        }
      } else if (item.type === "web_search") {
        writeToolCall(res, id, model, toolCallIdx++, item.id, "web_search", { query: item.query });
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
    let toolCallIdx = 0;
    const toolNameById = new Map();
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.type === "message" && evt.role === "assistant" && typeof evt.content === "string") {
        if (evt.content) writeDelta(res, id, model, evt.content);
      } else if (evt.type === "tool_use" && evt.tool_id) {
        toolNameById.set(evt.tool_id, evt.tool_name);
        writeToolCall(res, id, model, toolCallIdx++, evt.tool_id, evt.tool_name || "tool", evt.parameters ?? {});
      } else if (evt.type === "tool_result" && evt.tool_id) {
        const name = toolNameById.get(evt.tool_id) || "tool";
        const payload = evt.status === "error"
          ? `[error] ${evt.error?.message || evt.output || ""}`
          : (evt.output ?? "");
        writeToolResultBlock(res, id, model, name, evt.tool_id, payload);
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
