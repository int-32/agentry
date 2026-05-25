#!/usr/bin/env node
/**
 * agentry-bridge — 本机 OpenAI 兼容 HTTP server，桥本机 SDK/CLI 到 chat completions 协议
 *
 * 监听 :51720，实现 POST /v1/chat/completions + SSE，按 model 字段路由：
 *   claude-* / opus / sonnet / haiku  → @anthropic-ai/claude-agent-sdk
 *   codex / gpt-codex                  → @openai/codex-sdk
 *   gemini / gemini-*                  → gemini CLI spawn `-o stream-json`
 *   antigravity / agy                  → Antigravity CLI spawn `--print`
 *
 * Hanako / 任何 OpenAI 兼容 client 可注册为 API provider，
 *   base_url: http://127.0.0.1:51720/v1
 *   api_key:  任意（本机不验）
 *   model:    claude-opus-4-1 / codex / gemini-3 / antigravity 等
 *
 * 跑法：node scripts/agentry-bridge/server.mjs
 */

import { createServer } from "node:http";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { randomUUID, createHash } from "node:crypto";
import YAML from "js-yaml";

const PORT = parseInt(process.env.AGENTRY_BRIDGE_PORT || "51720", 10);
const AGENTRY_HOME = process.env.AGENTRY_HOME
  || process.env.HANA_HOME
  || path.join(os.homedir(), ".agentry");

let cliWorkspaceCache = { mtimeMs: 0, providers: {} };

function cleanPath(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function cleanPathList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const folder = cleanPath(item);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    out.push(folder);
  }
  return out;
}

function loadCliProviderConfig(providerId) {
  const configPath = path.join(AGENTRY_HOME, "added-models.yaml");
  try {
    const stat = fs.statSync(configPath);
    if (cliWorkspaceCache.mtimeMs !== stat.mtimeMs) {
      const raw = YAML.load(fs.readFileSync(configPath, "utf-8")) || {};
      cliWorkspaceCache = {
        mtimeMs: stat.mtimeMs,
        providers: raw && typeof raw.providers === "object" && raw.providers ? raw.providers : {},
      };
    }
  } catch {
    cliWorkspaceCache = { mtimeMs: 0, providers: {} };
  }
  const cfg = cliWorkspaceCache.providers[providerId] || {};
  return {
    workspaceRoot: cleanPath(cfg.workspace_root || cfg.workspaceRoot),
    workspaceFolders: cleanPathList(cfg.workspace_folders || cfg.workspaceFolders),
  };
}

// ── conversation → backend session 映射 ──
// Hanako 每轮发完整 messages 历史给 bridge，但 Claude / Codex SDK 之 query 之 prompt 只取最后一条
// （丢历史）。修法：bridge 维护 fingerprint(model + system + 首 user 内容) → SDK session_id 之
// 映射；首轮新建并捕 session_id 入表，次轮起以 resume / resumeThread 续接 SDK 端持化之 session。
// Gemini / Antigravity CLI 之 --resume/--continue 取 project-scoped index 不利多 conv 并存，降级走 history concat。
const conversationSessions = new Map(); // fp -> { backend, sessionId, lastAccessed }
const CONV_CACHE_MAX = 200; // 简易 LRU 上限

function fingerprintConversation(model, systemPrompt, messages) {
  // 首条 user 消息 + system 前 1000 字 + model：可对一条 conv 跨轮稳定标识
  const firstUser = Array.isArray(messages) ? messages.find(m => m && m.role === "user") : null;
  const firstUserText = firstUser ? flattenContent(firstUser.content) : "";
  const sysPart = (systemPrompt || "").slice(0, 1000);
  const usrPart = firstUserText.slice(0, 1000);
  return createHash("sha256").update(`${model}\0${sysPart}\0${usrPart}`).digest("hex").slice(0, 16);
}

function rememberSession(fp, backend, sessionId) {
  if (!fp || !sessionId) return;
  if (conversationSessions.size >= CONV_CACHE_MAX) {
    // 淘汰最久未访问
    let oldest = null, oldestT = Infinity;
    for (const [k, v] of conversationSessions) {
      if (v.lastAccessed < oldestT) { oldest = k; oldestT = v.lastAccessed; }
    }
    if (oldest) conversationSessions.delete(oldest);
  }
  conversationSessions.set(fp, { backend, sessionId, lastAccessed: Date.now() });
}

function lookupSession(fp, backend) {
  const entry = conversationSessions.get(fp);
  if (!entry || entry.backend !== backend) return null;
  entry.lastAccessed = Date.now();
  return entry.sessionId;
}

// ── 路由：按 model 名前缀选 backend ──
function routeBackend(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("codex") || m.includes("gpt-codex")) return "codex";
  if (m.includes("antigravity") || m === "agy" || m.startsWith("agy-")) return "antigravity";
  if (m.includes("gemini")) return "gemini";
  // 默认 Claude
  return "claude";
}

function cliProviderForBackend(backend) {
  if (backend === "claude") return "cli-claude-code";
  if (backend === "codex") return "cli-codex";
  if (backend === "gemini") return "cli-gemini";
  if (backend === "antigravity") return "cli-antigravity";
  return null;
}

// ── 把 OpenAI 消息 content（string / 多模 array）拼成纯文本 ──
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === "text" && typeof c.text === "string")
      .map(c => c.text)
      .join("\n");
  }
  return "";
}

// ── 抽 system prompt：合并所有 role==='system' 消息（OpenAI 协议允许多条 system）──
function extractSystemPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  return messages
    .filter(m => m && m.role === "system")
    .map(m => flattenContent(m.content))
    .filter(Boolean)
    .join("\n\n");
}

// ── 抽 user prompt：最后一条 user（简化：暂不透传历史；agentry chat 历史由 Hanako 自管）──
function extractPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  const lastUser = [...messages].reverse().find(m => m && m.role === "user");
  if (!lastUser) return "";
  return flattenContent(lastUser.content);
}

// ── system + user 组装供 Codex / Gemini 等无 system 槽位之 backend 用 ──
function composeForNoSystemBackend(systemPrompt, userPrompt) {
  if (!systemPrompt) return userPrompt;
  return `=== SYSTEM ===\n${systemPrompt}\n\n=== USER ===\n${userPrompt}`;
}

// ── CLI 用：把完整 conversation 历史拍平为单段 text（approach A — token 倍增但能跑）──
// 用于 Gemini / Antigravity 因 CLI 续接是 project-scoped，不利多 conv 并存，故走 history concat 代替
function flattenHistoryForCli(systemPrompt, messages) {
  const parts = [];
  if (systemPrompt) parts.push(`=== SYSTEM ===\n${systemPrompt}`);
  if (!Array.isArray(messages)) return parts.join("\n\n");
  const turns = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .map(m => `=== ${m.role.toUpperCase()} ===\n${flattenContent(m.content)}`);
  if (turns.length > 0) parts.push(turns.join("\n\n"));
  return parts.join("\n\n");
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
async function streamClaude({ res, id, model, prompt, systemPrompt, conversationFp, workspaceConfig = {} }) {
  // Claude SDK 隔离配置：
  //   - settingSources: [] —— 禁加载 ~/.claude/settings.json + project/.claude/settings.json
  //     避免本机 CC session 之 SessionStart hook（persona-inject 等）污染 bridge 子进程之 persona
  //   - systemPrompt 接受 string；非空时覆盖 claude_code preset，纯由 Hanako 注入之 persona 定调
  //   - disallowedTools 屏蔽交互式 UI 工具（AskUserQuestion / ExitPlanMode）。bridge 之 ④ 仅作
  //     markdown 文本透传，无 GUI prompt 通道；若 agent 调 AskUserQuestion，raw call 会作 markdown
  //     落 Hanako 对话页，陛下无法用 GUI 答 — UX 错位。屏蔽后 agent 改在 text 内列选项让陛下下条
  //     message 答（兼容 GUI 单文本输入框）
  //   - resume: <sessionId> —— 次轮起续命 SDK 端存于 ~/.claude/projects/ 之 session，保 chat 上下文
  const options = {
    settingSources: [],
    disallowedTools: ["AskUserQuestion", "ExitPlanMode"],
  };
  if (workspaceConfig.workspaceRoot) options.cwd = workspaceConfig.workspaceRoot;
  if (workspaceConfig.workspaceFolders?.length) {
    options.additionalDirectories = workspaceConfig.workspaceFolders;
  }
  if (systemPrompt) options.systemPrompt = systemPrompt;
  const resumeId = conversationFp ? lookupSession(conversationFp, "claude") : null;
  if (resumeId) options.resume = resumeId;
  const stream = claudeQuery({ prompt, options });
  let usage = null;
  let capturedSessionId = null;
  const toolNameById = new Map();
  for await (const msg of stream) {
    // SDK 每条消息皆带 session_id（首轮自生新 UUID，续轮等于 resume 之值）
    if (msg && typeof msg.session_id === "string" && !capturedSessionId) {
      capturedSessionId = msg.session_id;
    }
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
  if (conversationFp && capturedSessionId) {
    rememberSession(conversationFp, "claude", capturedSessionId);
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
async function streamCodex({ res, id, model, prompt, systemPrompt, conversationFp, workspaceConfig = {} }) {
  // Codex SDK ThreadOptions 无 system/instructions 槽，把 systemPrompt prepend 到 prompt
  // 次轮起以 resumeThread 续命 codex 端存于 ~/.codex/sessions/ 之 thread，保 chat 上下文
  const codex = new Codex();
  const threadOpts = { sandboxMode: "read-only", skipGitRepoCheck: true, approvalPolicy: "never" };
  if (workspaceConfig.workspaceRoot) threadOpts.cwd = workspaceConfig.workspaceRoot;
  const resumeId = conversationFp ? lookupSession(conversationFp, "codex") : null;
  const thread = resumeId ? codex.resumeThread(resumeId, threadOpts) : codex.startThread(threadOpts);
  // 续命时 system prompt 不必再 prepend（前轮已植）；首轮才注入
  const finalPrompt = resumeId ? prompt : composeForNoSystemBackend(systemPrompt, prompt);
  const streamed = await thread.runStreamed(finalPrompt);

  let lastText = "";
  let usage = null;
  let capturedThreadId = resumeId || null;
  for await (const evt of streamed.events) {
    if (evt.type === "thread.started" && evt.thread_id) {
      capturedThreadId = evt.thread_id; // 首轮 codex 生成新 thread_id；续轮等于 resume 之值
    } else if (evt.type === "item.updated" && evt.item.type === "agent_message") {
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
  if (conversationFp && capturedThreadId) {
    rememberSession(conversationFp, "codex", capturedThreadId);
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
async function streamGemini({ res, id, model, fullHistoryPrompt, workspaceConfig = {} }) {
  // gemini CLI 无 --system flag，把 systemPrompt + full history prepend 到 -p prompt（approach A）。
  // --resume 取 project-scoped index 不利多 conv 并存，故 bridge 每轮重发完整 history 代替续命。
  // --approval-mode yolo：bridge 无 GUI 接通道，缺省 default 模式会等用户确认致流挂死
  return new Promise((resolve) => {
    const child = spawn(
      "gemini",
      ["-p", fullHistoryPrompt, "-o", "stream-json", "--approval-mode", "yolo"],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env, cwd: workspaceConfig.workspaceRoot || undefined }
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

// ── Antigravity CLI spawn ──
// agy 1.x 当前仅公开 --print 文本模式，未提供 gemini CLI 的 stream-json 事件流。
// 因此这里把 stdout 直接作为 assistant text 增量透出，tool/usage 先降级为空。
async function streamAntigravity({ res, id, model, fullHistoryPrompt, workspaceConfig = {} }) {
  return new Promise((resolve) => {
    const args = ["--print", fullHistoryPrompt, "--print-timeout", process.env.AGENTRY_BRIDGE_AGY_PRINT_TIMEOUT || "10m"];
    for (const folder of workspaceConfig.workspaceFolders || []) {
      args.push("--add-dir", folder);
    }
    if (process.env.AGENTRY_BRIDGE_AGY_SKIP_PERMISSIONS !== "0") {
      args.push("--dangerously-skip-permissions");
    }

    const child = spawn(
      "agy",
      args,
      { stdio: ["ignore", "pipe", "pipe"], env: process.env, cwd: workspaceConfig.workspaceRoot || undefined }
    );
    let stderr = "";
    let wrote = false;
    let finished = false;

    const finish = (finishReason = "stop") => {
      if (finished) return;
      finished = true;
      if (!wrote && stderr.trim()) {
        writeDelta(res, id, model, `\n[bridge:antigravity] ${stderr.trim()}`);
      }
      writeDone(res, id, model, finishReason);
      resolve();
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      if (!text) return;
      wrote = true;
      writeDelta(res, id, model, text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("close", () => finish("stop"));
    child.on("error", (err) => {
      writeDelta(res, id, model, `\n[bridge:antigravity-spawn-error] ${err.message}`);
      wrote = true;
      finish("stop");
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
        { id: "antigravity", object: "model", owned_by: "agentry-bridge" },
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
      const systemPrompt = extractSystemPrompt(payload.messages);
      const conversationFp = fingerprintConversation(model, systemPrompt, payload.messages);
      const id = `chatcmpl-${randomUUID()}`;
      const backend = routeBackend(model);
      const cliProviderId = cliProviderForBackend(backend);
      const workspaceConfig = cliProviderId ? loadCliProviderConfig(cliProviderId) : {};
      const wantStream = payload.stream === true;
      // CLI 后端走 approach A（history concat），SDK 后端走 B（SDK resume by sessionId）
      const fullHistoryPrompt = (backend === "gemini" || backend === "antigravity")
        ? flattenHistoryForCli(systemPrompt, payload.messages)
        : null;

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
        console.error(`[bridge] ${new Date().toISOString()} ${backend} ${model} (non-stream) sys=${systemPrompt.length}B fp=${conversationFp.slice(0, 8)} prompt=${prompt.slice(0, 60).replace(/\n/g, "↵")}`);
        try {
          if (backend === "claude") await streamClaude({ res: fakeRes, id, model, prompt, systemPrompt, conversationFp, workspaceConfig });
          else if (backend === "codex") await streamCodex({ res: fakeRes, id, model, prompt, systemPrompt, conversationFp, workspaceConfig });
          else if (backend === "gemini") await streamGemini({ res: fakeRes, id, model, fullHistoryPrompt, workspaceConfig });
          else if (backend === "antigravity") await streamAntigravity({ res: fakeRes, id, model, fullHistoryPrompt, workspaceConfig });
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

      console.error(`[bridge] ${new Date().toISOString()} ${backend} ${model} (stream) sys=${systemPrompt.length}B fp=${conversationFp.slice(0, 8)} prompt=${prompt.slice(0, 60).replace(/\n/g, "↵")}`);

      try {
        if (backend === "claude") await streamClaude({ res, id, model, prompt, systemPrompt, conversationFp, workspaceConfig });
        else if (backend === "codex") await streamCodex({ res, id, model, prompt, systemPrompt, conversationFp, workspaceConfig });
        else if (backend === "gemini") await streamGemini({ res, id, model, fullHistoryPrompt, workspaceConfig });
        else if (backend === "antigravity") await streamAntigravity({ res, id, model, fullHistoryPrompt, workspaceConfig });
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
  console.error(`  antigravity / agy → Antigravity CLI (--print)`);
});
