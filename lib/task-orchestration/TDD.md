# Task Orchestration TDD

Full feature spec: `../../docs/specs/features/task-orchestration.md`

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-TASK-001 | AG-EARS-TASK-001, AG-BDD-TASK-001 | `tests/task-orchestrator.test.js` | invalid graph rejection | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-002 | AG-EARS-TASK-002, AG-BDD-TASK-002 | `tests/task-orchestrator.test.js` | dependency gating | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-003 | AG-EARS-TASK-003, AG-BDD-TASK-003 | `tests/task-orchestrator.test.js` | scheduler progress | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-004 | AG-EARS-TASK-004, AG-BDD-TASK-004 | `tests/task-orchestrator.test.js` | cancellation | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-005 | AG-EARS-TASK-005, AG-BDD-TASK-005 | future task graph store test | session scoped UI state | TBD | planned |
| AG-TDD-TASK-006 | AG-EARS-TASK-006, AG-BDD-TASK-006 | `tests/task-ledger.test.js`, `tests/task-orchestrator.test.js` | task records, comments, persistence, run status/artifact mapping | `npm test -- tests/task-ledger.test.js tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-007 | AG-EARS-TASK-007, AG-BDD-TASK-007, AG-BDD-TASK-008 | `tests/subagent-tool.test.js`, `tests/task-registry.test.js` | subagent lifecycle and plugin registry task mirroring into Task Ledger | `npm test -- tests/subagent-tool.test.js tests/task-registry.test.js` | needs-review |
| AG-TDD-TASK-008 | AG-EARS-TASK-008, AG-BDD-TASK-009 | `tests/cron-store.test.js`, `tests/cron-scheduler.test.js` | cron job creation, run result, enable/disable and scheduler completion mirroring into Task Ledger | `npm test -- tests/cron-store.test.js tests/cron-scheduler.test.js` | needs-review |

## Minimum Verification

For scheduler, graph validation, cancellation, and run status changes, run:

```bash
npm test -- tests/task-orchestrator.test.js tests/task-ledger.test.js tests/task-registry.test.js tests/subagent-tool.test.js tests/cron-store.test.js tests/cron-scheduler.test.js
```

If the change touches server routes or desktop state, add the closest route/store/component test and record it in this matrix.
