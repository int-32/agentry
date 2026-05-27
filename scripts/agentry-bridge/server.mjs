#!/usr/bin/env node
/**
 * agentry-bridge — 本机 OpenAI 兼容 HTTP server，桥本机 SDK/CLI 到 chat completions 协议
 *
 * 监听 :51720，实现 POST /v1/chat/completions + SSE，按 model 字段路由：
 *   claude-* / opus / sonnet / haiku  → @anthropic-ai/claude-agent-sdk
 *   codex / gpt-codex                  → @openai/codex-sdk
 *   gemini / gemini-*                  → gemini CLI spawn `-o stream-json`
 *   antigravity / agy                  → Antigravity App local RPC, fallback to agy `--print`
 *
 * Hanako / 任何 OpenAI 兼容 client 可注册为 API provider，
 *   base_url: http://127.0.0.1:51720/v1
 *   api_key:  任意（本机不验）
 *   model:    claude-opus-4-1 / codex / gemini-3 / antigravity 等
 *
 * 跑法：node scripts/agentry-bridge/server.mjs
 */

import { createServer } from "node:http";
import { createCliProviderConfigLoader, resolveBridgeAgentryHome } from "../../lib/bridge/local-cli-runtime-config.js";
import { createBridgeRequestHandler } from "./bridge-router.mjs";

const PORT = parseInt(process.env.AGENTRY_BRIDGE_PORT || "51720", 10);
const AGENTRY_HOME = resolveBridgeAgentryHome(process.env);
const cliProviderConfigLoader = createCliProviderConfigLoader({ agentryHome: AGENTRY_HOME });

const handleBridgeRequest = createBridgeRequestHandler({ cliProviderConfigLoader });
const server = createServer(handleBridgeRequest);

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[bridge] agentry-bridge listening at http://127.0.0.1:${PORT}`);
  console.error(`[bridge] POST /v1/chat/completions  GET /v1/models`);
  console.error(`[bridge] routes by model:`);
  console.error(`  claude-*  → @anthropic-ai/claude-agent-sdk`);
  console.error(`  codex     → @openai/codex-sdk`);
  console.error(`  gemini-*  → gemini CLI (-o stream-json)`);
  console.error(`  antigravity / agy → Antigravity App RPC (fallback: agy --print)`);
});
