/**
 * Agentry Bridge provider plugin
 *
 * 本机 HTTP server（`scripts/agentry-bridge/server.mjs`）把三家 agent
 * runtime（@anthropic-ai/claude-agent-sdk / @openai/codex-sdk / gemini CLI）
 * 桥成 OpenAI 兼容协议，挂在 127.0.0.1:51720。
 *
 * 默认端口可由环境变量 AGENTRY_BRIDGE_PORT 覆写。
 *
 * 凭据按本机已装之 CLI / SDK 之 auth 自动用 ——
 * api_key 字段本机不验，留 "dummy" 即可。
 */

/** @type {import('../../core/provider-registry.js').ProviderPlugin} */
export const agentryBridgePlugin = {
  id: "agentry-bridge",
  displayName: "Agentry Bridge (local)",
  authType: "api-key",
  defaultBaseUrl: "http://127.0.0.1:51720/v1",
  defaultApi: "openai-completions",
};
