#!/usr/bin/env node
/**
 * import-court — 把 court (Discord 朝廷) 之 persona 数据导入 agentry / Hanako 之 agents 目录
 *
 * 用法：
 *   node scripts/import-court.mjs \
 *     --from ~/Workspace/court \
 *     --target-data-root ~/.hanako-dev \
 *     --workers master,yanliben \
 *     [--overwrite] [--dry-run]
 *
 * 来源：
 *   <court>/config/workers.yaml                            朝籍（master 隐式，无条目时由 IDENTITY.md 推 fallback）
 *   <court>/config/personas/_global/{SOUL,AGENTS}.md       全员共享朝规
 *   <court>/config/personas/<key>/{IDENTITY,SOUL,AGENTS,TOOLS}.md  个人四件套
 *
 * 落地：
 *   <target>/agents/<key>/
 *     config.yaml         agentry 之 agent 配置（yuan=hanako 以适配既有 prompt 流，name 用中文姓名）
 *     identity.md         直接来自 IDENTITY.md
 *     ishiki.md           合并 _global/SOUL + <key>/SOUL + _global/AGENTS + <key>/AGENTS + <key>/TOOLS
 *                         (agentry buildSystemPrompt 实际读此文件作 personality)
 *     public-ishiki.md    简化版（guest 会话用）
 *     soul.md             brief 之独立文件：合并 _global/SOUL + <key>/SOUL（供未来 spec 演进）
 *     agents.md           brief：合并 _global/AGENTS + <key>/AGENTS
 *     tools.md            brief：<key>/TOOLS
 *     public.md           brief：IDENTITY 摘要 + description
 *   <target>/added-models.yaml.providers.cli-claude-code.models  补全 claude-opus-4-7 / claude-sonnet-4-6
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "js-yaml";

// ── 参数解析 ──
function parseArgs(argv) {
  const opts = { from: "", targetDataRoot: "", workers: null, overwrite: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") opts.from = argv[++i];
    else if (a === "--target-data-root") opts.targetDataRoot = argv[++i];
    else if (a === "--workers") opts.workers = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--overwrite") opts.overwrite = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
    else { console.error(`[import] 未知参数: ${a}`); process.exit(2); }
  }
  if (!opts.from || !opts.targetDataRoot) { printHelp(); process.exit(2); }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  node scripts/import-court.mjs \\
    --from <court-repo-path> \\
    --target-data-root <hanako-home> \\
    [--workers key1,key2,...] [--overwrite] [--dry-run]`);
}

// ── IO helpers ──
function expandHome(p) { return p.replace(/^~/, os.homedir()); }
function readFileOr(p, fallback = "") {
  try { return fs.readFileSync(p, "utf-8"); } catch { return fallback; }
}
function writeFile(p, content, { dryRun }) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}

// ── 从 IDENTITY.md 推断 fallback meta（master 不在 workers.yaml）──
function inferMetaFromIdentity(identityMd) {
  const meta = {};
  const nameM = identityMd.match(/\*\*姓名\*\*\s*[：:]\s*([^\n]+)/);
  if (nameM) meta.name = nameM[1].trim();
  const titleM = identityMd.match(/\*\*职位\*\*\s*[：:]\s*([^\n（(]+)/);
  if (titleM) meta.title = titleM[1].trim();
  const deptM = identityMd.match(/\*\*部门\*\*\s*[：:]\s*([^\n]+)/);
  if (deptM) meta.department = deptM[1].trim();
  // description 取第一段非标题正文
  const lines = identityMd.split("\n");
  let desc = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("- **") || t.startsWith("**")) continue;
    desc = t;
    break;
  }
  if (desc) meta.description = desc;
  return meta;
}

// ── 合并 markdown 片段：global 先 + 私人后 ──
function mergeMarkdown(globalMd, personalMd, headerHint) {
  const parts = [];
  if (globalMd?.trim()) parts.push(globalMd.trim());
  if (personalMd?.trim()) parts.push(personalMd.trim());
  if (parts.length === 0) return "";
  if (headerHint) return `# ${headerHint}\n\n${parts.join("\n\n---\n\n")}\n`;
  return parts.join("\n\n---\n\n") + "\n";
}

// ── 摘 IDENTITY 头部 + description 作 public.md ──
function buildPublic(identityMd, description) {
  const lines = identityMd.split("\n");
  const head = [];
  let inListBlock = false;
  for (const line of lines) {
    head.push(line);
    if (line.startsWith("## ")) break;
    if (line.startsWith("- **") || line.startsWith("**")) inListBlock = true;
    else if (inListBlock && !line.trim()) break;
  }
  const summary = description ? `\n\n> ${description}\n` : "";
  return head.join("\n").trim() + summary;
}

// ── 构造 agent config.yaml（schema 参考既有 hanako/config.yaml）──
function buildAgentConfig({ key: _key, name, title }) {
  // yuan 保持 hanako：agentry buildSystemPrompt 读 lib/yuan/<yuan>.md，
  // master/yanliben 在 productDir 内无对应 yuan 模板，用 hanako 兜底，persona 在 identity.md / ishiki.md 表达
  const config = {
    agent: { name, yuan: "hanako" },
    user: { name: "陛下" },
    api: { provider: "cli-claude-code" },
    embedding_api: { provider: "" },
    models: {
      chat: { id: "claude-opus-4-7", provider: "cli-claude-code" },
      utility: "",
      utility_large: "",
      embedding: "",
      embedding_dimensions: 1024,
    },
    memory: {
      enabled: false, token_budget: 2500, decay_per_day: 0.02, hit_bonus: 5,
      base_importance: 10, compile_threshold: 4.5, forget_speed: 1,
    },
    experience: { enabled: false },
    search: { provider: "bing_browser", api_key: "" },
    skills: { enabled: ["skill-creator"] },
    desk: { heartbeat_enabled: false, heartbeat_interval: 31, home_folder: "" },
  };
  if (title) config.agent.title = title;
  return config;
}

// ── 确保 added-models.yaml 含 cli-claude-code provider + 必备 models ──
function ensureCliClaudeCodeProvider(addedModelsPath, { dryRun }) {
  const REQUIRED_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];
  let raw = {};
  try { raw = YAML.load(fs.readFileSync(addedModelsPath, "utf-8")) || {}; } catch { /* fresh */ }
  if (!raw.providers) raw.providers = {};
  const prev = raw.providers["cli-claude-code"] || {};
  const existingModels = Array.isArray(prev.models) ? prev.models.map(m => typeof m === "string" ? m : m?.id).filter(Boolean) : [];
  const merged = [...existingModels];
  for (const m of REQUIRED_MODELS) if (!merged.includes(m)) merged.push(m);
  raw.providers["cli-claude-code"] = {
    base_url: prev.base_url || "http://127.0.0.1:51720/v1",
    api_key: prev.api_key || "dummy",
    api: prev.api || "openai-completions",
    models: merged,
  };
  if (!raw._migrated) raw._migrated = true;
  if (dryRun) {
    console.log(`[import] would write added-models.yaml providers.cli-claude-code.models=${JSON.stringify(merged)}`);
    return;
  }
  const header = "# Hanako 供应商配置（全局，跨 agent 共享）\n# 由设置页面管理\n\n";
  const yamlStr = header + YAML.dump(raw, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"", forceQuotes: false });
  fs.mkdirSync(path.dirname(addedModelsPath), { recursive: true });
  fs.writeFileSync(addedModelsPath, yamlStr, "utf-8");
}

// ── 主流程 ──
function main() {
  const opts = parseArgs(process.argv);
  const courtRoot = path.resolve(expandHome(opts.from));
  const targetRoot = path.resolve(expandHome(opts.targetDataRoot));
  const personasDir = path.join(courtRoot, "config", "personas");
  const workersYamlPath = path.join(courtRoot, "config", "workers.yaml");
  const agentsDir = path.join(targetRoot, "agents");

  if (!fs.existsSync(personasDir)) {
    console.error(`[import] personas dir 不存在: ${personasDir}`);
    process.exit(1);
  }

  let workersYaml = {};
  try { workersYaml = YAML.load(fs.readFileSync(workersYamlPath, "utf-8")) || {}; } catch { /* allow missing */ }
  const workersMap = workersYaml.workers || {};

  // 取 candidate keys：personas 目录下除 _global 之外的子目录
  const personaKeys = fs.readdirSync(personasDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "_global")
    .map(d => d.name);

  const requestedKeys = opts.workers || personaKeys;
  for (const k of requestedKeys) {
    if (!personaKeys.includes(k)) {
      console.error(`[import] 未在 personas 找到 key=${k}，跳过`);
    }
  }
  const importKeys = requestedKeys.filter(k => personaKeys.includes(k));
  if (importKeys.length === 0) {
    console.error("[import] 无可导入 worker，退出");
    process.exit(1);
  }

  const globalSoul = readFileOr(path.join(personasDir, "_global", "SOUL.md"));
  const globalAgents = readFileOr(path.join(personasDir, "_global", "AGENTS.md"));

  const summary = { imported: [], skipped: [] };
  for (const key of importKeys) {
    const pDir = path.join(personasDir, key);
    const identityMd = readFileOr(path.join(pDir, "IDENTITY.md"));
    const soulMd = readFileOr(path.join(pDir, "SOUL.md"));
    const agentsMd = readFileOr(path.join(pDir, "AGENTS.md"));
    const toolsMd = readFileOr(path.join(pDir, "TOOLS.md"));

    if (!identityMd) {
      console.error(`[import] ${key}: 缺 IDENTITY.md，跳过`);
      summary.skipped.push(key);
      continue;
    }

    // meta 优先 workers.yaml；缺则从 IDENTITY 推
    const wMeta = workersMap[key] || {};
    const inferred = inferMetaFromIdentity(identityMd);
    const name = wMeta.name || inferred.name || key;
    const title = wMeta.title || inferred.title || "";
    const description = wMeta.description || inferred.description || "";

    const targetAgentDir = path.join(agentsDir, key);
    if (fs.existsSync(targetAgentDir) && !opts.overwrite) {
      console.error(`[import] ${key}: target 已存在 ${targetAgentDir}（用 --overwrite 覆盖），跳过`);
      summary.skipped.push(key);
      continue;
    }

    const config = buildAgentConfig({ key, name, title });
    const configYaml = "# 由 import-court.mjs 自 court 朝廷导入\n\n" +
      YAML.dump(config, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"", forceQuotes: false });

    // ishiki.md：合并所有 persona 段落 — agentry 之 buildSystemPrompt 实际读此文件作 personality
    const fullIshiki = [
      globalSoul, soulMd,
      globalAgents, agentsMd,
      toolsMd,
    ].map(s => (s || "").trim()).filter(Boolean).join("\n\n---\n\n") + "\n";

    const soulMerged = mergeMarkdown(globalSoul, soulMd);
    const agentsMerged = mergeMarkdown(globalAgents, agentsMd);
    const publicMd = buildPublic(identityMd, description);

    writeFile(path.join(targetAgentDir, "config.yaml"), configYaml, opts);
    writeFile(path.join(targetAgentDir, "identity.md"), identityMd.trim() + "\n", opts);
    writeFile(path.join(targetAgentDir, "ishiki.md"), fullIshiki, opts);
    writeFile(path.join(targetAgentDir, "public-ishiki.md"), publicMd + "\n", opts);
    writeFile(path.join(targetAgentDir, "soul.md"), soulMerged, opts);
    writeFile(path.join(targetAgentDir, "agents.md"), agentsMerged, opts);
    writeFile(path.join(targetAgentDir, "tools.md"), toolsMd.trim() + "\n", opts);
    writeFile(path.join(targetAgentDir, "public.md"), publicMd + "\n", opts);

    console.log(`[import] ${key} ← court personas/${key}/  (name=${name}${title ? `, title=${title}` : ""})`);
    summary.imported.push(key);
  }

  // 确保 cli-claude-code provider 注册（不动其他 provider）
  ensureCliClaudeCodeProvider(path.join(targetRoot, "added-models.yaml"), opts);

  console.log("");
  console.log(`[import] done — imported=${summary.imported.join(",") || "(none)"}  skipped=${summary.skipped.join(",") || "(none)"}${opts.dryRun ? "  (dry-run, 未实际写入)" : ""}`);
}

main();
