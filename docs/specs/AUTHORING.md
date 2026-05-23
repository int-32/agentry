# EARS / BDD / TDD 编写要求

本项目采用混合文档结构：全局索引 + 模块本地契约。

目标不是增加文档负担，而是让后续修改前能快速知道：这个功能应该满足什么、哪些行为不能破坏、改完要跑哪些测试。

## 1. 放置要求

| 类型 | 放置位置 | 何时使用 |
| --- | --- | --- |
| 项目级规则 | `docs/specs/EARS.md`, `docs/specs/BDD.md`, `docs/specs/TDD.md` | 影响全项目的原则、模板、测试策略 |
| 项目术语库 | `docs/specs/GLOSSARY.md` | 统一产品概念、页面区域、数据对象和日常沟通称呼 |
| 跨层 feature | `docs/specs/features/<feature>.md` | 同时涉及 core/server/desktop/lib/plugins 的能力 |
| 模块本地契约 | `<module>/EARS.md`, `<module>/BDD.md`, `<module>/TDD.md` | 主要由一个实现模块承担的行为 |
| 模块入口说明 | `<module>/README.md` | 模块复杂、容易改错，且需要告诉后续维护者先读哪个规格 |

### 判断标准

- 能明确归属到单一模块的行为，优先放在模块旁边，例如 `lib/channels/EARS.md`、`lib/channels/BDD.md`、`lib/channels/TDD.md`。
- 横跨多层的产品能力，先放到 `docs/specs/features/`，例如 provider 设置、会话上下文。
- 如果跨层 feature 的某一层开始承担大量规则，应在对应模块旁边拆本地 `EARS.md`、`BDD.md`、`TDD.md`，并从全局 feature 文件链接过去。
- `docs/specs/` 是索引和跨模块规则，不应成为所有细节的唯一存放地。

## 2. 主契约规则

同一个功能可能有全局 feature spec 和模块本地 EARS/BDD/TDD。两者职责不同：

| 文档 | 角色 |
| --- | --- |
| `docs/specs/features/<feature>.md` | 说明跨层目标、术语、业务边界、端到端场景、测试矩阵 |
| `docs/specs/GLOSSARY.md` | 说明全项目通用术语、页面区域命名、数据对象命名和沟通优先说法 |
| `<module>/EARS.md` | 说明该模块必须守住的本地规则 |
| `<module>/BDD.md` | 说明该模块的可观察行为、文件格式、状态转换、错误边界 |
| `<module>/TDD.md` | 说明该模块的测试映射、最小验证命令和测试缺口 |

如果两者冲突，不能直接按其中一个改代码。先同步文档，明确新的业务决策，再实现。

## 3. 每个 feature spec 必须包含

| Section | 要求 |
| --- | --- |
| `Scope` | 写清覆盖范围和不覆盖范围 |
| `Code Map` | 列出核心实现路径、UI 路径、路由路径、测试路径 |
| `Terms` | 定义容易混淆的业务词 |
| `EARS Requirements` | 使用稳定 ID，表达系统必须满足的规则 |
| `BDD Scenarios` | 至少覆盖成功路径、失败路径或边界路径 |
| `TDD Matrix` | 映射规格 ID、测试文件、命令、覆盖类型和状态 |
| `Manual Verification` | 无法自动化时写清手动验证入口 |
| `Open Questions` | 未决事项不能混进需求里 |

## 4. EARS 编写要求

EARS 写系统规则，不写实现步骤。

必须做到：

- 每条只有一个行为约束。
- 使用稳定 ID：`AG-EARS-<DOMAIN>-NNN`。
- 能被 BDD 或测试验证。
- 区分业务目标和当前代码事实。
- 错误、权限、数据归属、跨会话隔离这类高风险规则必须显式写出。

不要写：

- “调用某函数”“设置某变量”这类实现细节。
- 没有验收方式的愿望。
- 只描述 UI 长什么样、但没有行为约束的内容。
- 临时方案，除非标为 `Open Questions` 或 `Temporary Decision`。

## 5. BDD 编写要求

BDD 写可观察行为。

必须做到：

- 使用 `Given / When / Then`。
- 标注稳定 ID：`AG-BDD-<DOMAIN>-NNN`。
- 场景标题说明用户、Agent、外部平台或系统操作者能观察到什么。
- 至少包含一个非 happy path 场景。
- 避免依赖内部函数名；可以提路径，但不要让场景只有开发者才能读懂。

推荐覆盖：

- 正常路径。
- 权限不足、配置缺失、网络失败、外部平台失败。
- 会话切换、Agent 切换、工作区切换、频道成员变化。
- 数据迁移、缓存、并发写、取消/中断/重试。

## 6. TDD 编写要求

TDD 写验证入口和测试责任。

必须做到：

- 使用稳定 ID：`AG-TDD-<DOMAIN>-NNN`。
- 关联至少一个 EARS 或 BDD ID。
- 写出最小测试命令。
- 标明状态：`planned`、`covered`、`manual-only`、`needs-review`。
- 如果暂时不补自动化测试，必须说明手动验证方式和残余风险。

高风险改动必须补测试：

- 会话、Agent、工作区、频道、任务图、桥接、权限、provider、媒体能力。
- WebSocket、REST response、插件协议、模型能力字段。
- 文件持久化、迁移、缓存、锁、并发控制。
- 前端状态归属、设置保存、国际化文案。

## 7. 修改流程

每次改功能前按这个顺序走：

1. 先查 `docs/specs/GLOSSARY.md`，确认要讨论的概念、页面区域或数据对象是否已有统一称呼。
2. 找到模块本地 `EARS.md` / `BDD.md` / `TDD.md` 或全局 feature spec。
3. 如果没有，先复制 `docs/specs/templates/feature-spec.md` 新建。
4. 更新 EARS，明确系统规则。
5. 更新 BDD，补成功/失败/边界场景。
6. 更新 TDD Matrix，列出测试文件和命令。
7. 改代码。
8. 跑最小测试；必要时跑 `npm test` 和 `npm run typecheck`。
9. 如果实现改变了业务边界，回写规格，不让文档滞后。

## 8. 命名要求

| 内容 | 命名 |
| --- | --- |
| 全局 feature spec | `docs/specs/features/<kebab-case>.md` |
| 项目术语库 | `docs/specs/GLOSSARY.md` |
| 模块本地需求规则 | `EARS.md` |
| 模块本地行为契约 | `BDD.md` |
| 模块本地测试映射 | `TDD.md` |
| 需求 ID | `AG-EARS-<DOMAIN>-NNN` |
| 场景 ID | `AG-BDD-<DOMAIN>-NNN` |
| 测试 ID | `AG-TDD-<DOMAIN>-NNN` |

`DOMAIN` 用大写短词，例如 `SESSION`、`PROVIDER`、`CHANNEL`、`TASK`、`BRIDGE`、`MEDIA`。

## 9. 文档同步要求

- 新增 feature spec 时，更新 `docs/specs/features/README.md` 和 `docs/specs/BDD.md` 的索引。
- 新增概念、页面区域、业务对象或容易混淆的 UI 称呼时，更新 `docs/specs/GLOSSARY.md`。
- 新增模块本地 EARS/BDD/TDD 时，在对应全局 feature spec 的 `Code Map` 中登记。
- 修改测试文件时，回看 TDD Matrix 是否还准确。
- 修改文件格式、协议字段、状态机、错误语义时，必须同步 EARS 和 BDD。

## 10. 质量标准

一份合格规格应让后续维护者能回答：

- 这个功能的边界是什么？
- 哪些行为不能改坏？
- 哪些场景能证明它工作正常？
- 最小测试命令是什么？
- 哪些问题还没有决定？

如果文档回答不了这些问题，就先补文档再改实现。
