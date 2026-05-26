# Agentry 文档体系巡检笺

这是周期性巡检任务。每次巡检都执行，不要因为已有执行记录就跳过。

## 目标

定期检查本项目的 EARS / BDD / TDD 文档体系是否存在、位置是否正确、内容是否仍然准确，并在发现问题时直接修正文档或留下明确待办。

## 巡检范围

重点检查：

- `docs/specs/README.md`
- `docs/specs/AUTHORING.md`
- `docs/specs/EARS.md`
- `docs/specs/BDD.md`
- `docs/specs/TDD.md`
- `docs/specs/GLOSSARY.md`
- `docs/specs/features/*.md`
- 模块本地三件套：`EARS.md`、`BDD.md`、`TDD.md`

当前已建立模块：

- `lib/channels/EARS.md`
- `lib/channels/BDD.md`
- `lib/channels/TDD.md`
- `lib/task-orchestration/EARS.md`
- `lib/task-orchestration/BDD.md`
- `lib/task-orchestration/TDD.md`

## 每次巡检步骤

1. 读取 `docs/specs/AUTHORING.md`，确认当前编写要求。
2. 检查 `docs/specs/` 入口、术语库、模板、feature 索引是否存在。
3. 检查每个模块本地三件套是否同时存在，不能只有 `BDD.md`。
4. 对照相关实现目录，判断文档是否明显过时：
   - 新增了重要模块但没有对应 feature spec 或模块三件套。
   - 文档中的测试文件已经不存在。
   - 文档中的代码路径已经不存在。
   - EARS/BDD/TDD ID 互相引用不一致。
   - `docs/specs/features/` 没有登记已有模块本地文档。
5. 如果只是文档缺漏或路径过时，直接修复。
6. 如果需要产品判断，不要猜；在执行记录中写清问题、影响和建议。
7. 如有修复，运行轻量检查：
   - `find docs/specs lib/channels lib/task-orchestration -maxdepth 2 -name '*.md'`
   - `rg -n "AG-EARS-|AG-BDD-|AG-TDD-" docs/specs lib/channels lib/task-orchestration`

## 输出要求

每次巡检结束后，把结果追加到本文件的执行记录区域。格式：

```text
- [YYYY-MM-DD HH:mm] 文档巡检 | 检查了哪些文件；发现了什么；修复了什么；仍有什么风险
```

如果没有问题，也要写：

```text
- [YYYY-MM-DD HH:mm] 文档巡检 | EARS/BDD/TDD 文档存在且引用一致；无需行动
```

## 注意事项

- 不要改业务代码。
- 不要改用户未要求的实现文件。
- 不要把 `docs/specs/` 当成唯一真相；能归属到具体模块的规则，模块下必须有 `EARS.md`、`BDD.md`、`TDD.md`。
- 发现文档和代码冲突时，优先判断是否是文档过时；如果涉及业务边界变化，记录待确认问题。

<!-- exec-log -->
- [2026-05-19 22:12] 文档巡检 | 检查了 docs/specs 入口、AUTHORING、feature 索引、features 规格及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 和已引用代码/测试路径均存在，EARS/BDD/TDD ID 互相引用一致；修复了 TDD 状态值与 AUTHORING 不一致的问题，将 covered-or-needs-review/needs-test 统一为 needs-review；轻量检查已从仓库根目录重跑通过，仍有 planned 项待后续实现或复核
- [2026-05-20 00:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记的测试文件存在，EARS/BDD/TDD ID 编号互相引用一致；未发现需直接修复的文档缺漏或路径过时；仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 02:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、features 索引与 feature 规格，及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，相关代码路径与已登记测试文件存在，docs/specs/features 已登记现有模块本地文档，EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 04:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 06:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 08:08] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 10:10] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 12:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 14:08] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 16:09] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 18:08] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；修复了 docs/specs/README.md 修改流程只提示 BDD 的过窄表述，并补齐 lib/channels/TDD.md 中 AG-TDD-CHANNEL-002 与路由最小验证命令的测试文件登记；轻量检查 find/rg 已通过；仍有 planned/needs-review 项待后续实现或复核
- [2026-05-20 22:23] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 02:01] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套；入口、模板、模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 04:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 06:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 08:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 14:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 16:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 18:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 20:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-21 22:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了已登记的 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 00:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 02:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 04:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 06:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 08:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 10:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 12:02] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 14:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，已登记代码路径与测试文件存在；发现 docs/specs/features/task-orchestration.md 中 AG-EARS-TASK-009/AG-BDD-TASK-010/AG-TDD-TASK-009 仍描述为创建 manual task 不启动编排，已按当前实现与 desktop 本地三件套修正为自动启动主 agent run，并补齐 tests/tasks-route.test.js 验证登记；轻量检查 find/rg 已通过；仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 16:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在；修复了 docs/specs/features/task-orchestration.md Code Map 的 Tests 列表遗漏 tests/tasks-route.test.js 的问题，使其与 AG-TDD-TASK-009 验证登记一致；轻量检查 find/rg 已从仓库根目录重跑通过；仍有 planned/needs-review 项待后续实现或复核
- [2026-05-22 18:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；整理了上一条执行记录的位置使其回到 exec-log 标签内；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-23 00:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration 模块三件套，并复核了 desktop task board UI 本地三件套；入口、模板、术语库、feature 索引和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项待后续实现或复核
- [2026-05-25 16:06] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记测试文件存在；发现 plugins/image-gen 已有本地三件套但未在 docs/specs/features 建立跨层登记，已新增 docs/specs/features/media-generation.md，并同步更新 docs/specs/features/README.md、docs/specs/BDD.md、docs/specs/README.md；轻量检查 find/rg 已从仓库根目录重跑通过；仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-25 18:07] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 00:07] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 02:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在；复核了本轮已变更的 agent-session-context 与 provider-model-settings 规格，新增的会话缓存/刷新调度/归档清理与欢迎页模型应用测试路径均已登记且存在，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 04:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；复核了近期 agent-session-context 与 provider-model-settings 规格中新增的会话缓存、刷新调度、归档清理和欢迎页模型应用路径，均已登记且存在；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 06:03] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；复核了近期 agent-session-context 与 provider-model-settings 规格中新增的会话缓存、刷新调度、归档清理和欢迎页模型应用路径，均已登记且存在；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 08:04] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记代码路径与测试文件存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；复核了近期 agent-session-context 与 provider-model-settings 规格中新增的会话缓存、刷新调度、归档清理和欢迎页模型应用路径，均已登记且存在；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
- [2026-05-26 12:05] 文档巡检 | 检查了 docs/specs/README.md、AUTHORING.md、EARS.md、BDD.md、TDD.md、GLOSSARY.md、templates、features 索引与现有 feature 规格，以及 lib/channels、lib/task-orchestration、desktop task board UI、plugins/image-gen 模块三件套；入口、模板、术语库和模块本地 EARS/BDD/TDD 均存在，未发现只有 BDD 的局部三件套，已登记实现/测试路径存在，docs/specs/features 已登记现有模块本地文档，feature/local EARS/BDD/TDD ID 引用一致；轻量检查 find/rg 已从仓库根目录重跑通过；未发现需直接修复的文档缺漏或路径过时，仍有 planned/needs-review 项和媒体生成 Open Questions 待后续实现或产品判断
<!-- /exec-log -->
