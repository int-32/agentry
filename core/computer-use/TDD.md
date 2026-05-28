# Computer Use TDD

Full feature spec: `../../docs/specs/features/computer-use.md`

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-COMPUTER-001 | AG-EARS-COMPUTER-001, AG-BDD-COMPUTER-001 | `tests/computer-use-host.test.js`, `tests/computer-use-tool.test.js`, `tests/computer-use-preferences-route.test.js`, `tests/engine-computer-use-lazy.test.js` | enabled/platform/session/agent/model gating, unsupported Linux, lazy host initialization | `npm test -- tests/computer-use-host.test.js tests/computer-use-tool.test.js tests/computer-use-preferences-route.test.js tests/engine-computer-use-lazy.test.js` | needs-review |
| AG-TDD-COMPUTER-002 | AG-EARS-COMPUTER-002, AG-BDD-COMPUTER-002 | `tests/computer-use-host.test.js`, `tests/computer-use-lease-registry.test.js`, `tests/computer-use-tool.test.js` | lease creation/reuse, provider selection, provider state, current lease resolution, snapshot recording | `npm test -- tests/computer-use-host.test.js tests/computer-use-lease-registry.test.js tests/computer-use-tool.test.js` | needs-review |
| AG-TDD-COMPUTER-003 | AG-EARS-COMPUTER-003, AG-BDD-COMPUTER-003 | `tests/computer-use-host.test.js`, `tests/computer-use-tool.test.js` | stale snapshot rejection, released lease rejection, missing target, capability checks, hidden unsafe action exposure | `npm test -- tests/computer-use-host.test.js tests/computer-use-tool.test.js` | needs-review |
| AG-TDD-COMPUTER-004 | AG-EARS-COMPUTER-004, AG-BDD-COMPUTER-004 | `tests/computer-use-tool.test.js` | session-scoped computer_overlay events for tool phases | `npm test -- tests/computer-use-tool.test.js` | needs-review |
| AG-TDD-COMPUTER-005 | AG-EARS-COMPUTER-005, AG-BDD-COMPUTER-005 | `tests/computer-use-preferences-route.test.js`, `desktop/src/react/settings/tabs/__tests__/ComputerUseTab.test.tsx`, `tests/computer-use-platform-support.test.js` | settings response, disabled/unsupported behavior, permission request, approval revoke UI, platform support reporting | `npm test -- tests/computer-use-preferences-route.test.js desktop/src/react/settings/tabs/__tests__/ComputerUseTab.test.tsx tests/computer-use-platform-support.test.js` | needs-review |
| AG-TDD-COMPUTER-006 | AG-EARS-COMPUTER-006, AG-BDD-COMPUTER-006 | `tests/computer-use-tool.test.js`, `tests/computer-use-settings.test.js`, `tests/computer-use-host.test.js` | app approval confirmation payload, persisted approval/revoke normalization, non-isolated provider approval flow | `npm test -- tests/computer-use-tool.test.js tests/computer-use-settings.test.js tests/computer-use-host.test.js` | needs-review |
| AG-TDD-COMPUTER-007 | AG-EARS-COMPUTER-007, AG-BDD-COMPUTER-007 | `tests/computer-use-macos-cua-provider.test.js`, `tests/computer-use-helper-build-script.test.js`, `tests/computer-use-helper-cursor-source.test.js` | helper resolution, daemon/status/permission normalization, app state/action mapping, helper packaging | `npm test -- tests/computer-use-macos-cua-provider.test.js tests/computer-use-helper-build-script.test.js tests/computer-use-helper-cursor-source.test.js` | needs-review |
| AG-TDD-COMPUTER-008 | AG-EARS-COMPUTER-008, AG-BDD-COMPUTER-008 | `tests/computer-use-windows-uia-provider.test.js`, `tests/computer-use-host.test.js` | UIA helper contract, semantic actions, foreground input opt-in policy | `npm test -- tests/computer-use-windows-uia-provider.test.js tests/computer-use-host.test.js` | needs-review |

## Minimum Verification

For Computer Use host or provider changes, run:

```bash
npm test -- tests/computer-use-host.test.js tests/computer-use-tool.test.js tests/computer-use-platform-support.test.js
```

For preferences or settings UI changes, also run:

```bash
npm test -- tests/computer-use-preferences-route.test.js desktop/src/react/settings/tabs/__tests__/ComputerUseTab.test.tsx
```

For native provider packaging or OS-specific behavior, run the corresponding provider/helper tests listed in the matrix.
