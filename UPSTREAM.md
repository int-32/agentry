# Upstream Watch

Agentry 是 [OpenHanako](https://github.com/liliMozi/openhanako) (by liliMozi) 的 fork。我们不再自动从 upstream merge，但保留 `upstream` remote 作为参考。

## 工作流

### 看上游有什么新动作

```bash
node scripts/upstream-diff.mjs           # 默认对比 main
node scripts/upstream-diff.mjs <branch>  # 对比指定分支
```

输出会列出 upstream/main 比当前分支多的 commit。

### 借鉴上游 commit

**不要直接 cherry-pick** — 上游用 Hana / Hanako / HANA_HOME 命名，cherry-pick 会把这些名字带回 Agentry。

正确流程：

1. 用 `git show <sha>` 读上游 commit 理解意图。
2. 在 Agentry 这边手动实现等价改动，命名按 Agentry 约定（Agentry / AGENTRY_HOME 等）。
3. 提交时在 message 注明 "ported from upstream `<sha>`"，便于追溯。

### 何时跑

建议每 1-2 周跑一次。也可以在准备发布新版本前跑一次，看是否漏了 upstream 的关键修复。

## remote 配置

```bash
git remote -v
# origin    git@github.com:int-32/agentry.git
# upstream  git@github.com:liliMozi/openhanako.git
```

如果 upstream remote 没配：

```bash
git remote add upstream git@github.com:liliMozi/openhanako.git
```

## 不会做的事

- 不会 `git merge upstream/main`（会引入命名冲突）
- 不会 `git pull upstream main`（同上）
- 不会自动 cherry-pick（人工 port 才能保证命名约定）
