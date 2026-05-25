/**
 * Agentry Bridge provider plugin
 *
 * 本机 HTTP server（`scripts/agentry-bridge/server.mjs`）把三家 agent
 * runtime（@anthropic-ai/claude-agent-sdk / @openai/codex-sdk / gemini CLI / Antigravity CLI）
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
  _localCli: true, // UI filter：不在云端供应商列表显示
};

/**
 * 本机 Agent CLI 之 provider 注册项（隐藏，仅作"agent 选模型"之内部 provider id）。
 * 由 settings → Local CLI section 启用某 CLI 时，往 added-models.yaml 写
 * cli-<id> 之配置（base_url 指本机 bridge，models 由用户勾选）。
 */
export const localCliPlugins = [
  { id: "cli-claude-code", displayName: "Claude Code (local CLI)" },
  { id: "cli-codex", displayName: "Codex CLI (local)" },
  { id: "cli-gemini", displayName: "Gemini CLI (local)" },
  { id: "cli-antigravity", displayName: "Antigravity CLI (local)" },
  { id: "cli-qwen-code", displayName: "Qwen Code (local)" },
  { id: "cli-opencode", displayName: "OpenCode (local)" },
].map(p => ({
  ...p,
  authType: "api-key",
  defaultBaseUrl: "http://127.0.0.1:51720/v1",
  defaultApi: "openai-completions",
  _localCli: true, // UI filter
}));
