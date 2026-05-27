# Agentry EARS / BDD / TDD 文档体系

这套文档用于让后续修改先对齐业务契约，再进入实现。它不替代代码和测试，而是把“需求、行为、验证”串成可追踪链路：

1. EARS 写清楚系统必须满足的规则。
2. BDD 写清楚用户或 Agent 可观察到的行为。
3. TDD 写清楚对应测试应该落在哪里、怎么跑。

## 目录

| 文件 | 用途 |
| --- | --- |
| [EARS.md](./EARS.md) | 项目级需求规则和 EARS 写法约定 |
| [BDD.md](./BDD.md) | 项目级行为场景约定和 feature 索引 |
| [TDD.md](./TDD.md) | 测试策略、测试位置、验证命令 |
| [GLOSSARY.md](./GLOSSARY.md) | 项目术语库，统一业务概念、页面区域和日常沟通称呼 |
| [AUTHORING.md](./AUTHORING.md) | 混合放置、编写格式、同步流程和质量标准 |
| [ARCHITECTURE_BOUNDARIES.md](./ARCHITECTURE_BOUNDARIES.md) | 项目级架构边界表，记录领域 owner、持久化源、读写入口、事件面和验证入口 |
| [features/](./features/) | 重点功能的规格文件，按功能域拆分 |
| [templates/feature-spec.md](./templates/feature-spec.md) | 新功能规格模板 |
| [templates/module-readme.md](./templates/module-readme.md) | 模块目录 README 模板 |

## 放置规则

项目级或跨层能力放在 `docs/specs/features/<feature>.md`。如果一个功能已经有明确实现目录，例如 `lib/channels/`、`lib/task-orchestration/`、`server/routes/` 或 `desktop/src/react/settings/`，应在实现目录旁边增加 `EARS.md`、`BDD.md`、`TDD.md` 三件套，再从 `docs/specs/features/` 链接过去。

这条规则的目标是：负责改代码的人不需要猜文档在哪，也不需要只靠全局搜索找业务边界。

## 推荐结构

采用混合结构：

```text
docs/specs/
  README.md                  # 文档体系入口
  EARS.md                    # 项目级需求规则
  BDD.md                     # 项目级行为索引
  TDD.md                     # 测试策略
  GLOSSARY.md                # 项目术语库
  features/<feature>.md      # 跨层 feature 规格

lib/channels/EARS.md         # 模块本地需求规则
lib/channels/BDD.md          # 模块本地行为场景
lib/channels/TDD.md          # 模块本地测试映射
lib/task-orchestration/EARS.md
lib/task-orchestration/BDD.md
lib/task-orchestration/TDD.md
plugins/image-gen/EARS.md
plugins/image-gen/BDD.md
plugins/image-gen/TDD.md
```

判断标准：

- 单一模块能独立承担的行为，放到模块目录，并拆成 `EARS.md`、`BDD.md`、`TDD.md`。
- 横跨 core/server/desktop 的能力，先放到 `docs/specs/features/`，等某一层成为主要修改面时再拆本地规格。
- `docs/specs/` 负责索引、模板、跨模块规则；不要让它变成唯一入口，否则后续实现时容易漏读。

## ID 规则

稳定 ID 用于串起规格、测试和实现备注。

| 层 | 格式 | 示例 |
| --- | --- | --- |
| EARS | `AG-EARS-<DOMAIN>-NNN` | `AG-EARS-PROVIDER-001` |
| BDD | `AG-BDD-<DOMAIN>-NNN` | `AG-BDD-CHANNEL-002` |
| TDD | `AG-TDD-<DOMAIN>-NNN` | `AG-TDD-TASK-001` |

同一个 feature 内，EARS/BDD/TDD 应互相引用。测试名可以包含规格 ID；如果测试名太长，至少在测试文件顶部或 case 附近写一行规格 ID 注释。

## 修改流程

详细编写要求见 [AUTHORING.md](./AUTHORING.md)。日常修改按这个最小流程走：

1. 先查 [GLOSSARY.md](./GLOSSARY.md)，确认概念和页面区域称呼是否已有定义。
2. 找到模块本地 `EARS.md` / `BDD.md` / `TDD.md` 或全局 feature 规格。
3. 先补 EARS：只写系统应当保证的规则，不写实现步骤。
4. 再补 BDD：把主要成功路径、失败路径、边界路径写成 Given/When/Then。
5. 最后补 TDD：列出新增或修改的测试文件、要覆盖的规格 ID、运行命令。
6. 实现代码。
7. 运行目标测试；风险较高时再运行 `npm test` 和 `npm run typecheck`。

## 首批覆盖范围

首批规格聚焦当前项目最容易改错的几条主线：

- [Agent 会话上下文](./features/agent-session-context.md)
- [供应商与模型设置](./features/provider-model-settings.md)
- [频道与多 Agent 协作](./features/channels-and-agent-collaboration.md)
- [任务编排图](./features/task-orchestration.md)
- [媒体生成插件](./features/media-generation.md)

已建立模块本地三件套的重点实现目录：

- `lib/channels/`
- `lib/task-orchestration/`
- `desktop/src/react/components/tasks/`
- `plugins/image-gen/`
