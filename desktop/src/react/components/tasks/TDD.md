# Task Board UI TDD

Full feature spec: `../../../../../docs/specs/features/task-orchestration.md`

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-TASK-009 | AG-EARS-TASK-009, AG-BDD-TASK-010 | typecheck, `tests/task-ledger.test.js`, `tests/tasks-route.test.js` | create manual Task Ledger tasks from desktop kanban and auto-start coordinator run | `npm run typecheck && npm test -- tests/task-ledger.test.js tests/tasks-route.test.js` | needs-review |
| AG-TDD-TASK-010 | AG-EARS-TASK-010, AG-BDD-TASK-011 | typecheck, `tests/task-ledger.test.js` | update Task Ledger task status from desktop kanban | `npm run typecheck && npm test -- tests/task-ledger.test.js` | needs-review |
| AG-TDD-TASK-011 | AG-EARS-TASK-011, AG-BDD-TASK-012 | typecheck, `tests/task-ledger.test.js` | edit task details and add comments from desktop kanban | `npm run typecheck && npm test -- tests/task-ledger.test.js` | needs-review |
| AG-TDD-TASK-012 | AG-EARS-TASK-012, AG-BDD-TASK-013 | typecheck, manual desktop verification | desktop tab route key, tab label, sidebar board list, create-board button, removal of project-group entry | `npm run typecheck` | needs-review |
| AG-TDD-TASK-013 | AG-EARS-TASK-013, AG-BDD-TASK-014 | typecheck, manual desktop verification | board-level agent names, selection, and task_board context reference on created manual tasks | `npm run typecheck` | needs-review |
| AG-TDD-TASK-015 | AG-EARS-TASK-015, AG-BDD-TASK-016 | typecheck, `tests/channels-route.test.js`, `tests/channel-router-reply-tools.test.js` | board-to-channel binding projection and channel task execution-domain defaults | `npm run typecheck && npm test -- tests/channels-route.test.js tests/channel-router-reply-tools.test.js` | needs-review |

## Minimum Verification

For board UI changes, run:

```bash
npm run typecheck && npm test -- tests/task-ledger.test.js tests/tasks-route.test.js
```

Then manually open the desktop board tab and verify the board sidebar, project board switching, manual task creation, status movement, detail editing, comments, board agent selection, and board-channel binding.
