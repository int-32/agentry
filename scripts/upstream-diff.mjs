#!/usr/bin/env node
/**
 * upstream-diff — 列出 upstream (liliMozi/openhanako) 相对当前分支多出的 commit
 *
 * 用法：
 *   node scripts/upstream-diff.mjs            # 默认对比 main
 *   node scripts/upstream-diff.mjs <branch>   # 对比指定分支
 *
 * Agentry 是 OpenHanako 的 fork，不再自动 merge upstream。
 * 用这个脚本定期看上游有什么值得手动 port 过来。
 */
import { execSync } from "node:child_process";

const base = process.argv[2] || "main";

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

try {
  git("remote get-url upstream");
} catch {
  console.error("upstream remote 未配置。运行：");
  console.error("  git remote add upstream git@github.com:liliMozi/openhanako.git");
  process.exit(1);
}

console.log(`fetching upstream/main ...`);
execSync("git fetch upstream main --quiet", { stdio: "inherit" });

const log = git(`log --oneline --no-merges ${base}..upstream/main`);
if (!log) {
  console.log(`\n(无新 commit) ${base} 已包含 upstream/main 所有改动`);
  process.exit(0);
}

const lines = log.split("\n");
console.log(`\nupstream/main 比 ${base} 多 ${lines.length} 个 commit：\n`);
console.log(log);
console.log(`\n如需查看具体改动：`);
console.log(`  git show <sha>                    # 单 commit diff`);
console.log(`  git diff ${base}..upstream/main   # 全量 diff`);
console.log(`\n借鉴方式（不直接 merge / cherry-pick，避免带回 Hana 命名）：`);
console.log(`  1. 读 commit 理解意图`);
console.log(`  2. 手动 port 到 Agentry 命名`);
console.log(`  3. 提交时注明 "ported from upstream <sha>"`);
