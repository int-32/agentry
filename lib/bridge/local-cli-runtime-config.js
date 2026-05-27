/**
 * Local CLI runtime config for agentry-bridge.
 *
 * The bridge process consumes provider settings from added-models.yaml at
 * runtime. Keep model routing, cli provider ids, and workspace authorization
 * normalization here instead of in the HTTP process entrypoint.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "js-yaml";

export function resolveBridgeAgentryHome(env = process.env) {
  return env.AGENTRY_HOME || env.HANA_HOME || path.join(os.homedir(), ".agentry");
}

export function cleanWorkspacePath(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function cleanWorkspacePathList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const folder = cleanWorkspacePath(item);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    out.push(folder);
  }
  return out;
}

export function normalizeCliProviderWorkspaceConfig(config = {}) {
  return {
    workspaceRoot: cleanWorkspacePath(config.workspace_root || config.workspaceRoot),
    workspaceFolders: cleanWorkspacePathList(config.workspace_folders || config.workspaceFolders),
  };
}

export function routeBackend(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("codex") || m.includes("gpt-codex")) return "codex";
  if (m.includes("antigravity") || m === "agy" || m.startsWith("agy-")) return "antigravity";
  if (m.includes("gemini")) return "gemini";
  return "claude";
}

export function cliProviderForBackend(backend) {
  if (backend === "claude") return "cli-claude-code";
  if (backend === "codex") return "cli-codex";
  if (backend === "gemini") return "cli-gemini";
  if (backend === "antigravity") return "cli-antigravity";
  return null;
}

export function createCliProviderConfigLoader({ agentryHome, fsImpl = fs, yaml = YAML } = {}) {
  const home = agentryHome || resolveBridgeAgentryHome();
  let cache = { mtimeMs: 0, providers: {} };

  function loadProviderMap() {
    const configPath = path.join(home, "added-models.yaml");
    try {
      const stat = fsImpl.statSync(configPath);
      if (cache.mtimeMs !== stat.mtimeMs) {
        const raw = yaml.load(fsImpl.readFileSync(configPath, "utf-8")) || {};
        cache = {
          mtimeMs: stat.mtimeMs,
          providers: raw && typeof raw.providers === "object" && raw.providers ? raw.providers : {},
        };
      }
    } catch {
      cache = { mtimeMs: 0, providers: {} };
    }
    return cache.providers;
  }

  return {
    loadProviderConfig(providerId) {
      const providers = loadProviderMap();
      return normalizeCliProviderWorkspaceConfig(providers[providerId] || {});
    },
  };
}

export function resolveBridgeRuntimeConfig(model, loader) {
  const backend = routeBackend(model);
  const cliProviderId = cliProviderForBackend(backend);
  const workspaceConfig = cliProviderId ? loader.loadProviderConfig(cliProviderId) : {};
  return { backend, cliProviderId, workspaceConfig };
}
