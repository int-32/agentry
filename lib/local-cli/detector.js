/**
 * detector.js — 扫 PATH 检测本机已装之 agent CLI
 *
 * agentry 之独家本机 CLI 集成层（非"云端 LLM 供应商"），返回每 CLI 之
 * 安装状态 / 路径 / 版本 / 模型清单（取自 lib/known-models.json）。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * agentry 内置之 CLI 清单。
 *   id           内部 id，前端展示 / 路由用
 *   binary       PATH 内之二进制名
 *   displayName  UI 显示名
 *   versionArg   取版本号之参数（默认 --version）
 *   knownModelsKey  指向 lib/known-models.json 之 provider key（取模型清单）
 *   versionRegex 从版本输出抽取语义版本号
 */
export const KNOWN_AGENT_CLIS = [
  {
    id: "claude-code",
    binary: "claude",
    displayName: "Claude Code",
    versionArg: "--version",
    knownModelsKey: "anthropic",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: "codex",
    binary: "codex",
    displayName: "Codex CLI",
    versionArg: "--version",
    knownModelsKey: "openai-codex-oauth",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: "gemini",
    binary: "gemini",
    displayName: "Gemini CLI",
    versionArg: "--version",
    knownModelsKey: "gemini",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: "antigravity",
    binary: "agy",
    displayName: "Antigravity CLI",
    versionArg: "--version",
    knownModelsKey: "antigravity",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: "qwen-code",
    binary: "qwen-code",
    displayName: "Qwen Code",
    versionArg: "--version",
    knownModelsKey: "dashscope-coding",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: "opencode",
    binary: "opencode",
    displayName: "OpenCode",
    versionArg: "--version",
    knownModelsKey: null, // 待维护
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
];

const COMMON_USER_BIN_DIRS = [
  ".local/bin",
  ".bun/bin",
  ".opencode/bin",
  ".npm-global/bin",
  ".cargo/bin",
];

export function buildAgentCliSearchPath({
  envPath = process.env.PATH || "",
  homeDir = os.homedir(),
} = {}) {
  const dirs = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    dirs.push(dir);
  };

  for (const dir of envPath.split(path.delimiter)) add(dir);

  if (homeDir) {
    for (const rel of COMMON_USER_BIN_DIRS) add(path.join(homeDir, rel));
  }

  return dirs;
}

export function resolveBinaryOnAgentCliPath(name, options = {}) {
  for (const dir of buildAgentCliSearchPath(options)) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && (stat.mode & 0o111)) return full;
    } catch {
      /* not here */
    }
  }
  return null;
}

async function probeVersion(binaryPath, versionArg, regex) {
  try {
    const { stdout, stderr } = await execFileP(binaryPath, [versionArg], { timeout: 5000 });
    const text = (stdout || "") + (stderr || "");
    const m = regex.exec(text);
    return m ? m[1] : (text.trim().slice(0, 40) || null);
  } catch {
    return null;
  }
}

let _knownModelsCache = null;
function loadKnownModels() {
  if (_knownModelsCache) return _knownModelsCache;
  const file = path.join(__dirname, "..", "known-models.json");
  try {
    _knownModelsCache = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    _knownModelsCache = {};
  }
  return _knownModelsCache;
}

/** 取某 CLI 之已知模型清单（id 数组 + 元信息）。 */
export function getCliModels(cli) {
  if (!cli?.knownModelsKey) return [];
  const km = loadKnownModels();
  const bucket = km[cli.knownModelsKey] || {};
  return Object.entries(bucket).map(([id, meta]) => ({
    id,
    name: meta?.name || id,
    context: meta?.context ?? null,
    maxOutput: meta?.maxOutput ?? null,
    image: !!meta?.image,
    reasoning: !!meta?.reasoning,
  }));
}

/**
 * 扫所有已知 CLI，返回它们的检测结果。
 * @returns {Promise<Array<{
 *   id, binary, displayName, installed, binaryPath?, version?, modelsCount: number
 * }>>}
 */
export async function scanAllAgentCliS() {
  const results = [];
  for (const cli of KNOWN_AGENT_CLIS) {
    const binaryPath = resolveBinaryOnAgentCliPath(cli.binary);
    const installed = !!binaryPath;
    let version = null;
    if (installed) {
      version = await probeVersion(binaryPath, cli.versionArg, cli.versionRegex);
    }
    const models = installed ? getCliModels(cli) : [];
    results.push({
      id: cli.id,
      binary: cli.binary,
      displayName: cli.displayName,
      installed,
      binaryPath: binaryPath || null,
      version,
      modelsCount: models.length,
    });
  }
  return results;
}

/** 取单 CLI 之全模型清单（带元信息）。 */
export function getModelsForCli(cliId) {
  const cli = KNOWN_AGENT_CLIS.find(c => c.id === cliId);
  if (!cli) return [];
  return getCliModels(cli);
}
