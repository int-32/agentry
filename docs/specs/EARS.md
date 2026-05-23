# EARS Requirements

EARS 用来记录“系统必须如何表现”。每条需求应当稳定、可测试、避免把当前实现细节误写成业务目标。

## 句式

| 类型 | 句式 |
| --- | --- |
| Ubiquitous | The system shall ... |
| Event-driven | When `<event>`, the system shall ... |
| State-driven | While `<state>`, the system shall ... |
| Optional feature | Where `<feature is enabled>`, the system shall ... |
| Unwanted behavior | If `<bad condition>`, the system shall ... |
| Complex | While `<state>`, when `<event>`, the system shall ... |

中文文档可以保留 EARS 的英文骨架，也可以写成“当/在/如果...系统必须...”。关键是每条只表达一件事，并能被 BDD 或测试验证。

## 项目级规则

| ID | 类型 | 需求 |
| --- | --- | --- |
| AG-EARS-GLOBAL-001 | Ubiquitous | The system shall keep user-owned runtime data local-first under `AGENTRY_HOME`, with legacy `HANA_HOME` only used as an explicit fallback or migration source. |
| AG-EARS-GLOBAL-002 | Ubiquitous | The system shall preserve separate agent identities, memories, tools, scheduled tasks, channels, and bridge sessions unless a user action explicitly merges or deletes them. |
| AG-EARS-GLOBAL-003 | State-driven | While an operation can affect local files, external accounts, or bridge delivery, the system shall keep the permission and path boundary explicit before the operation executes. |
| AG-EARS-GLOBAL-004 | Event-driven | When user-visible text is added or changed in the desktop UI, the system shall update all supported locale files or mark the string as intentionally shared. |
| AG-EARS-GLOBAL-005 | Ubiquitous | The system shall route user-visible errors through a diagnosable surface instead of silently swallowing provider, bridge, filesystem, or launch failures. |
| AG-EARS-GLOBAL-006 | Ubiquitous | The system shall treat plugin, provider, bridge, media, and ordinary chat capabilities as related but separate registries. A capability visible in one registry shall not imply support in another. |
| AG-EARS-GLOBAL-007 | Event-driven | When a user switches sessions, agents, workspaces, or channels, the system shall keep events scoped to the intended target and avoid leaking output into the wrong visible context. |
| AG-EARS-GLOBAL-008 | Unwanted behavior | If a remote bridge, media route, or public URL is unavailable, the system shall fail with an actionable reason and shall not open a tunnel or public endpoint without explicit user configuration. |

## 写新需求时

每条需求应包含：

- `ID`：按 `AG-EARS-<DOMAIN>-NNN` 命名。
- `Source`：来自用户反馈、产品决策、bug、README、代码事实还是外部平台限制。
- `Rationale`：为什么这是业务规则，而不是当前实现偶然如此。
- `Linked BDD`：至少一个行为场景。
- `Linked Tests`：至少一个测试，或明确说明当前还没有测试。

## 不要写成 EARS 的内容

- “调用某个函数”这类实现步骤。
- 临时 UI 文案或按钮摆放，除非它本身就是验收条件。
- “以后可以考虑”这类想法。
- 只描述当前代码现状、但没有产品约束意义的事实。
