# Computer Use 本机应用控制

Status: draft
Last updated: 2026-05-28

## Scope

本规格覆盖 Agent 通过 `computer` 工具查看受支持桌面应用、请求应用租约、读取带截图和元素树的应用状态、执行受能力约束的交互动作，以及用户在设置中启用 Computer Use、检查系统权限、管理应用授权。它不覆盖浏览器自动化、外部远程桌面协议、通用系统设置修改或绕过 Agentry 应用批准列表的 GUI 控制。

## Code Map

| Area | Path |
| --- | --- |
| Local EARS | `core/computer-use/EARS.md` |
| Local BDD | `core/computer-use/BDD.md` |
| Local TDD | `core/computer-use/TDD.md` |
| Host and lease policy | `core/computer-use/computer-host.js`, `core/computer-use/lease-registry.js`, `core/computer-use/model-policy.js`, `core/computer-use/settings.js` |
| Provider contract | `core/computer-use/provider-contract.js`, `core/computer-use/provider-registry.js`, `core/computer-use/platform-support.js` |
| Providers | `core/computer-use/providers/macos-cua-provider.js`, `core/computer-use/providers/windows-uia-provider.js`, `core/computer-use/providers/mock-provider.js` |
| Tool surface | `lib/tools/computer-use-tool.js` |
| Settings and routes | `server/routes/preferences.js`, `desktop/src/react/settings/tabs/ComputerUseTab.tsx` |
| Helper packaging | `scripts/build-computer-use-helper.mjs`, `scripts/macos-computer-use-fallback-helper.mjs`, `desktop/native/HanaComputerUseHelper/` |
| Tests | `tests/computer-use-host.test.js`, `tests/computer-use-tool.test.js`, `tests/computer-use-settings.test.js`, `tests/computer-use-preferences-route.test.js`, `tests/computer-use-macos-cua-provider.test.js`, `tests/computer-use-windows-uia-provider.test.js`, `tests/computer-use-helper-build-script.test.js`, `tests/engine-computer-use-lazy.test.js` |

## Terms

| Term | Meaning |
| --- | --- |
| Computer Host | Provider registry、settings、model policy 和 lease registry 之上的本机控制协调器。 |
| Provider | 单个平台或 helper 的实现，例如 macOS CUA helper、Windows UIA helper 或测试 mock provider。 |
| Lease | 一次 Agent 会话对目标应用/窗口的临时控制授权，绑定 session、agent、provider、app/window 与允许动作。 |
| Snapshot | Provider 返回并由 Host 记录的应用状态，包含截图、元素树、显示区域、可执行动作和 snapshotId。 |
| App approval | 用户对某个 provider/app 组合的显式授权，非隔离 provider 在启动控制前必须满足。 |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-COMPUTER-001 | Ubiquitous | The system shall expose Computer Use only when the feature is enabled, the current platform is supported, and the current model has vision input capability. | AG-BDD-COMPUTER-001 | AG-TDD-COMPUTER-001 |
| AG-EARS-COMPUTER-002 | State-driven | When an Agent starts control of an app, the system shall create or reuse a session-scoped lease containing provider id, app/window identity, provider state, and model-visible allowed actions. | AG-BDD-COMPUTER-002 | AG-TDD-COMPUTER-002 |
| AG-EARS-COMPUTER-003 | Unwanted behavior | If an action uses a stale snapshot, a missing element, an unsupported capability, or an unapproved foreground/input-injection path, the system shall reject the action before invoking unsafe provider behavior. | AG-BDD-COMPUTER-003 | AG-TDD-COMPUTER-003 |
| AG-EARS-COMPUTER-004 | Event-driven | When the computer tool lists, starts, snapshots, acts, or stops, the system shall emit session-scoped overlay events that let the UI explain the current control phase. | AG-BDD-COMPUTER-004 | AG-TDD-COMPUTER-004 |
| AG-EARS-COMPUTER-005 | Optional feature | When Computer Use settings are opened, the system shall show stored settings, selected provider status, permission state, app approvals, and shall avoid probing providers while disabled or unsupported. | AG-BDD-COMPUTER-005 | AG-TDD-COMPUTER-005 |
| AG-EARS-COMPUTER-006 | Event-driven | When a provider requires app approval, the tool shall surface an input-area confirmation request and only persist approval after the user confirms. | AG-BDD-COMPUTER-006 | AG-TDD-COMPUTER-006 |
| AG-EARS-COMPUTER-007 | Ubiquitous | The macOS provider shall prefer the bundled helper or development helper over external CUA binaries and normalize helper status, permissions, screenshots, elements, and actions. | AG-BDD-COMPUTER-007 | AG-TDD-COMPUTER-007 |
| AG-EARS-COMPUTER-008 | Ubiquitous | The Windows UIA provider shall use its helper contract over stdin/stdout, expose background semantic actions by default, and keep foreground raw input disabled unless the explicit settings opt-in allows it. | AG-BDD-COMPUTER-008 | AG-TDD-COMPUTER-008 |

## BDD Scenarios

```gherkin
Feature: Computer Use local app control

  Scenario: Reject Computer Use when prerequisites are not met [AG-BDD-COMPUTER-001]
    Given Computer Use is disabled, the platform is unsupported, or the selected model lacks vision input
    When an Agent tries to list apps or start control
    Then the tool returns a structured error
    And no app lease is created

  Scenario: Start a scoped app lease and read a snapshot [AG-BDD-COMPUTER-002]
    Given Computer Use is enabled and the provider can access the selected app
    When the Agent starts control and requests app state
    Then the response includes a lease id, provider id, screenshot, element list, action capabilities, and allowed actions
    And the lease is scoped to the current session and agent

  Scenario: Block unsafe or stale actions [AG-BDD-COMPUTER-003]
    Given a lease has a latest snapshot and provider capabilities
    When the Agent submits an action with a stale snapshot, missing element, unsupported capability, or foreground-only raw input without opt-in
    Then the Host rejects the action before dispatching it to the provider
    And the error includes a stable Computer Use error code

  Scenario: Emit overlay events during tool phases [AG-BDD-COMPUTER-004]
    Given a session-scoped computer tool call is running
    When the tool lists apps, starts, snapshots, acts, or stops
    Then the session receives computer_overlay events describing the phase and action

  Scenario: Open and update Computer Use settings [AG-BDD-COMPUTER-005]
    Given the user opens the Computer Use settings tab
    When Computer Use is supported and enabled
    Then the page shows selected provider status, permission summary, Windows input-injection opt-in, and approved apps
    And when Computer Use is disabled or unsupported, provider probing is skipped

  Scenario: Approve an app requested by the Agent [AG-BDD-COMPUTER-006]
    Given a provider requires per-app approval before control
    When the Agent starts an unapproved app
    Then the tool emits an input-area app approval request
    And approval is persisted only if the user confirms

  Scenario: macOS helper status and actions are normalized [AG-BDD-COMPUTER-007]
    Given Agentry runs on macOS with a bundled or development helper available
    When the provider checks status, requests permissions, lists apps, snapshots, or performs actions
    Then helper results are normalized into Agentry provider status, snapshots, and action results

  Scenario: Windows UIA uses semantic background control by default [AG-BDD-COMPUTER-008]
    Given Agentry runs on Windows with the UIA provider
    When the provider creates a lease and performs actions
    Then semantic element actions are sent through the helper
    And foreground raw input stays unavailable unless the user enabled the explicit opt-in
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-COMPUTER-001 | AG-EARS-COMPUTER-001, AG-BDD-COMPUTER-001 | `tests/computer-use-host.test.js`, `tests/computer-use-tool.test.js`, `tests/computer-use-preferences-route.test.js`, `tests/engine-computer-use-lazy.test.js` | model vision gate, feature enablement, unsupported Linux, lazy host initialization | `npm test -- tests/computer-use-host.test.js tests/computer-use-tool.test.js tests/computer-use-preferences-route.test.js tests/engine-computer-use-lazy.test.js` | needs-review |
| AG-TDD-COMPUTER-002 | AG-EARS-COMPUTER-002, AG-BDD-COMPUTER-002 | `tests/computer-use-host.test.js`, `tests/computer-use-lease-registry.test.js` | lease creation/reuse, provider selection, provider state, snapshot recording | `npm test -- tests/computer-use-host.test.js tests/computer-use-lease-registry.test.js` | needs-review |
| AG-TDD-COMPUTER-003 | AG-EARS-COMPUTER-003, AG-BDD-COMPUTER-003 | `tests/computer-use-host.test.js`, `tests/computer-use-tool.test.js` | stale snapshot, missing target, capability rejection, hidden unsafe action exposure | `npm test -- tests/computer-use-host.test.js tests/computer-use-tool.test.js` | needs-review |
| AG-TDD-COMPUTER-004 | AG-EARS-COMPUTER-004, AG-BDD-COMPUTER-004 | `tests/computer-use-tool.test.js` | session-scoped computer_overlay events for tool phases | `npm test -- tests/computer-use-tool.test.js` | needs-review |
| AG-TDD-COMPUTER-005 | AG-EARS-COMPUTER-005, AG-BDD-COMPUTER-005 | `tests/computer-use-preferences-route.test.js`, `desktop/src/react/settings/tabs/__tests__/ComputerUseTab.test.tsx` | settings response, disabled/unsupported behavior, permission request, approval revoke UI | `npm test -- tests/computer-use-preferences-route.test.js desktop/src/react/settings/tabs/__tests__/ComputerUseTab.test.tsx` | needs-review |
| AG-TDD-COMPUTER-006 | AG-EARS-COMPUTER-006, AG-BDD-COMPUTER-006 | `tests/computer-use-tool.test.js`, `tests/computer-use-settings.test.js` | app approval confirmation payload and persisted approval/revoke normalization | `npm test -- tests/computer-use-tool.test.js tests/computer-use-settings.test.js` | needs-review |
| AG-TDD-COMPUTER-007 | AG-EARS-COMPUTER-007, AG-BDD-COMPUTER-007 | `tests/computer-use-macos-cua-provider.test.js`, `tests/computer-use-helper-build-script.test.js`, `tests/computer-use-helper-cursor-source.test.js` | helper resolution, daemon/status/permission normalization, app state/action mapping, helper packaging | `npm test -- tests/computer-use-macos-cua-provider.test.js tests/computer-use-helper-build-script.test.js tests/computer-use-helper-cursor-source.test.js` | needs-review |
| AG-TDD-COMPUTER-008 | AG-EARS-COMPUTER-008, AG-BDD-COMPUTER-008 | `tests/computer-use-windows-uia-provider.test.js`, `tests/computer-use-host.test.js` | UIA helper contract, semantic actions, foreground input opt-in policy | `npm test -- tests/computer-use-windows-uia-provider.test.js tests/computer-use-host.test.js` | needs-review |

## Manual Verification

- 在设置中打开 Computer Use，确认当前平台的 provider、权限摘要、批准应用列表和 Windows 输入注入开关显示正确。
- 使用支持视觉输入的模型调用 `computer.status` 和 `computer.list_apps`，确认返回 provider 能力和应用列表。
- 启动一个已批准应用，读取状态，确认截图、元素列表和 lease id 存在。
- 对元素执行 click/type/scroll，再读取状态，确认 stale snapshot 会被拒绝。
- 对未批准应用启动控制，确认输入区出现应用批准请求；拒绝后不创建授权，确认后授权进入设置列表。

## Open Questions

- Linux 是否长期保持 unsupported，还是需要接入 Wayland/X11 provider；当前规格按 unsupported 处理。
- Windows foreground raw input 的用户提示和风险说明是否需要更强的二次确认；当前仅用显式设置 opt-in 表达。
