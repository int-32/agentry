const os = require("os");
const path = require("path");
const fs = require("fs");

const PI_SDK_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const AGENTRY_HOME_ENV = "AGENTRY_HOME";
const LEGACY_HOME_ENV = "HANA_HOME";
const DEFAULT_HOME_DIR = ".agentry";
const LEGACY_HOME_DIR = ".hanako";

let _legacyEnvWarned = false;

function expandHome(input, homeDir = os.homedir()) {
  if (!input) return input;
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~" + path.sep)) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

// 解析 Agentry 用户数据目录。
// 优先级：input > env AGENTRY_HOME > env HANA_HOME (deprecated) > ~/.agentry
// 不做数据迁移，仅解析路径。迁移由 migrateLegacyHomeIfNeeded() 负责。
function resolveAgentryHome(input, opts = {}) {
  // 兼容旧签名 resolveHanakoHome(input, homeDir: string)
  if (typeof opts === "string") opts = { homeDir: opts };
  const homeDir = opts.homeDir || os.homedir();
  const env = opts.env || process.env;

  let raw = input;
  if (!raw) raw = env[AGENTRY_HOME_ENV];
  if (!raw && env[LEGACY_HOME_ENV]) {
    raw = env[LEGACY_HOME_ENV];
    if (!_legacyEnvWarned && !opts.silent) {
      console.warn(
        `[agentry] HANA_HOME 已废弃，请改用 AGENTRY_HOME（继续使用旧名兼容）`,
      );
      _legacyEnvWarned = true;
    }
  }
  if (!raw) raw = path.join(homeDir, DEFAULT_HOME_DIR);
  return path.resolve(expandHome(raw, homeDir));
}

// 旧名 alias — upstream merge / 外部脚本兼容
const resolveHanakoHome = resolveAgentryHome;

function resolveAgentryPiRoot(agentryHome) {
  if (!agentryHome || typeof agentryHome !== "string") {
    throw new Error("resolveAgentryPiRoot: agentryHome is required");
  }
  return path.join(agentryHome, ".pi");
}

function resolveAgentryPiAgentDir(agentryHome) {
  return path.join(resolveAgentryPiRoot(agentryHome), "agent");
}

function resolveAgentryPiProjectDir(agentryHome) {
  return path.join(resolveAgentryPiRoot(agentryHome), "project");
}

function withAgentryPiSdkEnv(env, agentryHome) {
  return {
    ...env,
    [PI_SDK_AGENT_DIR_ENV]: resolveAgentryPiAgentDir(agentryHome),
  };
}

function ensureAgentryPiSdkDirs(agentryHome) {
  fs.mkdirSync(resolveAgentryPiAgentDir(agentryHome), { recursive: true });
  fs.mkdirSync(resolveAgentryPiProjectDir(agentryHome), { recursive: true });
}

function configureProcessPiSdkEnv(agentryHome, env = process.env) {
  const agentDir = resolveAgentryPiAgentDir(agentryHome);
  env[PI_SDK_AGENT_DIR_ENV] = agentDir;
  return agentDir;
}

// 旧名 aliases — Phase 3 全量 rename 后可移除
const resolveHanaPiRoot = resolveAgentryPiRoot;
const resolveHanaPiAgentDir = resolveAgentryPiAgentDir;
const resolveHanaPiProjectDir = resolveAgentryPiProjectDir;
const withHanaPiSdkEnv = withAgentryPiSdkEnv;
const ensureHanaPiSdkDirs = ensureAgentryPiSdkDirs;

// 老数据迁移：~/.hanako → ~/.agentry（含 dev 变体 ~/.hanako-dev → ~/.agentry-dev）。
// 仅当目标不存在且源存在时执行，原子 rename + 留 symlink 兼容老脚本。
function migrateLegacyHomeIfNeeded(targetHome, opts = {}) {
  const homeDir = opts.homeDir || os.homedir();
  const log = opts.log || console.log;

  // 自动推导对应的 legacy 路径：~/.agentry → ~/.hanako, ~/.agentry-dev → ~/.hanako-dev
  let legacyHome = opts.legacyHome;
  if (!legacyHome) {
    const base = path.basename(targetHome);
    if (base.startsWith(".agentry")) {
      const suffix = base.slice(".agentry".length);
      legacyHome = path.join(path.dirname(targetHome), `.hanako${suffix}`);
    } else {
      legacyHome = path.join(homeDir, LEGACY_HOME_DIR);
    }
  }

  if (fs.existsSync(targetHome)) {
    return { migrated: false, reason: "target_exists", target: targetHome };
  }
  if (!fs.existsSync(legacyHome)) {
    return { migrated: false, reason: "legacy_missing", target: targetHome };
  }
  // 老路径已经是 symlink → 已经被迁移过，跳过
  try {
    if (fs.lstatSync(legacyHome).isSymbolicLink()) {
      return { migrated: false, reason: "legacy_is_symlink", target: targetHome };
    }
  } catch {}

  try {
    fs.renameSync(legacyHome, targetHome);
    try {
      fs.symlinkSync(targetHome, legacyHome, "dir");
    } catch {
      // symlink 失败不致命（Windows 非管理员可能无权创建）
    }
    log(`[agentry] 数据已迁移：${legacyHome} → ${targetHome}`);
    return { migrated: true, from: legacyHome, to: targetHome };
  } catch (err) {
    log(`[agentry] 数据迁移失败：${err.message}（继续使用旧路径 ${legacyHome}）`);
    return { migrated: false, reason: "rename_failed", error: err };
  }
}

module.exports = {
  PI_SDK_AGENT_DIR_ENV,
  AGENTRY_HOME_ENV,
  LEGACY_HOME_ENV,
  configureProcessPiSdkEnv,
  ensureAgentryPiSdkDirs,
  ensureHanaPiSdkDirs,
  migrateLegacyHomeIfNeeded,
  resolveAgentryHome,
  resolveHanakoHome,
  resolveAgentryPiAgentDir,
  resolveAgentryPiProjectDir,
  resolveAgentryPiRoot,
  resolveHanaPiAgentDir,
  resolveHanaPiProjectDir,
  resolveHanaPiRoot,
  withAgentryPiSdkEnv,
  withHanaPiSdkEnv,
};
