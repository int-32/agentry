# Computer Use EARS

Full feature spec: `../../docs/specs/features/computer-use.md`

## Module Scope

`core/computer-use/` owns Computer Use provider contracts, platform/provider selection, feature/model/settings policy, app leases, snapshot validation, capability checks, app approval enforcement, and provider-specific normalization for macOS CUA and Windows UIA. It does not own browser automation, desktop settings presentation, or non-approved GUI scripting paths.

## Requirements

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

## Non-goals

- Computer Use does not replace browser automation.
- Computer Use does not bypass app approval or OS permission prompts.
- Computer Use does not own settings UI layout beyond the data/permission contract.
