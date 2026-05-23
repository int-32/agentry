# Task Orchestration EARS

Full feature spec: `../../docs/specs/features/task-orchestration.md`

## Module Scope

`lib/task-orchestration/` owns in-process task graph creation, validation, dependency scheduling, cancellation, run snapshots, progress event emission, and the Task Ledger bridge for task-graph runs. Adjacent subagent, TaskRegistry, and cron integrations mirror their work into the same ledger while retaining their own execution ownership.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-TASK-001 | Event-driven | When a task graph is created, the system shall validate that it contains at least one node and that dependencies only reference existing nodes. | AG-BDD-TASK-001 | AG-TDD-TASK-001 |
| AG-EARS-TASK-002 | State-driven | While a node has unmet dependencies, the system shall keep the node pending or blocked and shall not start execution. | AG-BDD-TASK-002 | AG-TDD-TASK-002 |
| AG-EARS-TASK-003 | Event-driven | When a dependency finishes successfully, the system shall schedule newly unblocked nodes without requiring a manual refresh. | AG-BDD-TASK-003 | AG-TDD-TASK-003 |
| AG-EARS-TASK-004 | Event-driven | When a run is canceled, the system shall abort running and pending nodes, emit an update, and preserve a final reason. | AG-BDD-TASK-004 | AG-TDD-TASK-004 |
| AG-EARS-TASK-005 | Ubiquitous | The system shall keep task graph state scoped to the originating session or root context so unrelated sessions do not display each other's task runs. | AG-BDD-TASK-005 | AG-TDD-TASK-005 |
| AG-EARS-TASK-006 | Event-driven | When a task graph is created without an existing task id, the system shall create a Task Ledger record and attach the run to it. | AG-BDD-TASK-006 | AG-TDD-TASK-006 |
| AG-EARS-TASK-007 | Event-driven | When subagent or TaskRegistry background work starts, progresses, or completes, the system shall mirror its visible lifecycle into the Task Ledger. | AG-BDD-TASK-007, AG-BDD-TASK-008 | AG-TDD-TASK-007 |
| AG-EARS-TASK-008 | Event-driven | When a cron job is created, runs, fails, or is disabled, the system shall mirror the recurring source and latest run result into the Task Ledger without changing cron scheduling ownership. | AG-BDD-TASK-009 | AG-TDD-TASK-008 |

## Non-goals

- Long-term automation scheduling belongs to cron and heartbeat code, not this module.
- Desktop task graph layout belongs to the React task UI and store.
