# Task Board UI EARS

Full feature spec: `../../../../../docs/specs/features/task-orchestration.md`

## Local Scope

`desktop/src/react/components/tasks/` owns the desktop board tab UI: board sidebar rendering, manual task creation/editing/status movement from the board, project board selection, board-level agent selection, and board-to-channel binding controls. Durable task data remains owned by Task Ledger and task routes.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-TASK-009 | Ubiquitous | The local task board shall automatically start a coordinator-agent run when users create a manual Task Ledger task. | AG-BDD-TASK-010 | AG-TDD-TASK-009 |
| AG-EARS-TASK-010 | Ubiquitous | The local task board shall allow users to move a Task Ledger task between lightweight Kanban statuses without starting agent orchestration. | AG-BDD-TASK-011 | AG-TDD-TASK-010 |
| AG-EARS-TASK-011 | Ubiquitous | The local task board shall allow users to edit task details and add comments while preserving Task Ledger as the source of truth. | AG-BDD-TASK-012 | AG-TDD-TASK-011 |
| AG-EARS-TASK-012 | Ubiquitous | The desktop board tab shall use the `boards` route key and present project boards as the left-sidebar primary object, with a compact title-row create button and no project-group creation flow. | AG-BDD-TASK-013 | AG-TDD-TASK-012 |
| AG-EARS-TASK-013 | Ubiquitous | Each project board shall store a coordinator agent and collaborator agents, display their names in the title area, and manual tasks created inside it shall carry the board context. | AG-BDD-TASK-014 | AG-TDD-TASK-013 |
| AG-EARS-TASK-015 | Event-driven | When users bind a project board to a channel, the board UI shall persist the channel task-board binding and keep the bound channel visible in board navigation/header context. | AG-BDD-TASK-016 | AG-TDD-TASK-015 |
