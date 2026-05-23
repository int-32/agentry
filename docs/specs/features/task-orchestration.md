# 任务编排图

Status: draft
Last updated: 2026-05-22

## Scope

本规格覆盖用户或 Agent 把一个目标拆成任务图、按依赖调度节点、跟踪节点状态、取消运行和在前端展示进度。第一阶段任务图运行会同步到轻量 Task Ledger，用于把执行图挂到可持久追踪的 Task 记录下；第二阶段 subagent 与 TaskRegistry 插件任务也会镜像到同一账本；第三阶段 cron job 会作为 recurring task source 进入账本；桌面顶部入口与路由键命名为「看板」/ `boards`，本地项目看板可以创建 manual task、选择主 agent 与协作 agent，并在创建看板任务时自动启动主 agent 执行。它不覆盖长期计划系统或频道消息本身。

## Code Map

| Area | Path |
| --- | --- |
| Local EARS | `lib/task-orchestration/EARS.md` |
| Local BDD | `lib/task-orchestration/BDD.md` |
| Local TDD | `lib/task-orchestration/TDD.md` |
| Local board UI EARS | `desktop/src/react/components/tasks/EARS.md` |
| Local board UI BDD | `desktop/src/react/components/tasks/BDD.md` |
| Local board UI TDD | `desktop/src/react/components/tasks/TDD.md` |
| Library | `lib/task-orchestration/task-orchestrator.js`, `lib/task-ledger.js` |
| Background integrations | `lib/tools/subagent-tool.js`, `lib/task-registry.js`, `lib/desk/cron-store.js`, `lib/desk/cron-scheduler.js` |
| Tools | `lib/tools/task-orchestrate-tool.js` |
| Server | `server/routes/tasks.js` |
| Desktop | `desktop/src/react/components/tasks/`, `desktop/src/react/stores/task-graph-slice.ts` |
| Tests | `tests/task-orchestrator.test.js`, `tests/task-ledger.test.js`, `tests/subagent-tool.test.js`, `tests/task-registry.test.js`, `tests/cron-store.test.js`, `tests/cron-scheduler.test.js`, `tests/tasks-route.test.js` |

## Terms

| Term | Meaning |
| --- | --- |
| Task | 用户或系统想完成的可追踪目标 |
| Run | 一次任务图执行，挂在 Task 下 |
| Node | 任务图里的单个工作节点 |
| Edge | 节点依赖关系 |
| Artifact | 节点执行产生的文件、摘要或其他输出 |
| Event | Task 或 Run 的状态变化记录 |

## EARS Requirements

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
| AG-EARS-TASK-009 | Ubiquitous | The local task board shall automatically start a coordinator-agent run when users create a manual Task Ledger task. | AG-BDD-TASK-010 | AG-TDD-TASK-009 |
| AG-EARS-TASK-010 | Ubiquitous | The local task board shall allow users to move a Task Ledger task between lightweight Kanban statuses without starting agent orchestration. | AG-BDD-TASK-011 | AG-TDD-TASK-010 |
| AG-EARS-TASK-011 | Ubiquitous | The local task board shall allow users to edit task details and add comments while preserving Task Ledger as the source of truth. | AG-BDD-TASK-012 | AG-TDD-TASK-011 |
| AG-EARS-TASK-012 | Ubiquitous | The desktop board tab shall use the `boards` route key and present project boards as the left-sidebar primary object, with a compact title-row create button and no project-group creation flow. | AG-BDD-TASK-013 | AG-TDD-TASK-012 |
| AG-EARS-TASK-013 | Ubiquitous | Each project board shall store a coordinator agent and collaborator agents, display their names in the title area, and manual tasks created inside it shall carry the board context. | AG-BDD-TASK-014 | AG-TDD-TASK-013 |

## BDD Scenarios

```gherkin
Feature: Task orchestration graph

  Scenario: Reject an empty task graph [AG-BDD-TASK-001]
    Given a task orchestration request has no nodes
    When the run is created
    Then the system rejects the request
    And no run is stored

  Scenario: Dependencies gate node execution [AG-BDD-TASK-002]
    Given a graph has node B depending on node A
    When the run starts
    Then node A can run
    And node B does not run until node A is done

  Scenario: Completed dependency starts the next node [AG-BDD-TASK-003]
    Given node B depends on node A
    And node A finishes successfully
    When the scheduler evaluates the run
    Then node B starts automatically
    And the run emits an update event

  Scenario: Canceling a run aborts unfinished nodes [AG-BDD-TASK-004]
    Given a run has running, pending, and blocked nodes
    When the user cancels the run
    Then unfinished nodes become aborted
    And the run status becomes aborted
    And the cancellation reason is visible

  Scenario: Task runs stay scoped to the originating session [AG-BDD-TASK-005]
    Given two sessions are open
    And session A creates a task graph
    When the task graph emits progress events
    Then session A can display the run
    And session B does not show session A's task graph as its own

  Scenario: Task orchestration creates a ledger task [AG-BDD-TASK-006]
    Given a user creates a task graph without an existing task id
    When the run is created
    Then the system creates a Task Ledger record
    And attaches the run id to that task
    And later run completion updates the task status and artifacts

  Scenario: Subagent work is visible as a ledger task [AG-BDD-TASK-007]
    Given a session dispatches a subagent task
    When the subagent starts and finishes
    Then the Task Ledger contains a task sourced from subagent
    And its final status and summary comment are preserved

  Scenario: Plugin registry work is visible as a ledger task [AG-BDD-TASK-008]
    Given a plugin registers a background task through TaskRegistry
    When the plugin reports progress or completion
    Then the Task Ledger mirrors the task status and result artifact

  Scenario: Cron jobs are visible as recurring ledger tasks [AG-BDD-TASK-009]
    Given an agent creates a cron job
    When the cron job runs or fails
    Then the Task Ledger contains a task sourced from cron
    And the latest run result is recorded as a cron event or comment

  Scenario: Users create manual tasks on the local board [AG-BDD-TASK-010]
    Given the user opens the local task board
    When they submit a title or task body
    Then a manual Task Ledger task is created
    And the task automatically starts a run with the board coordinator agent
    And the board displays it in the running workflow state

  Scenario: Users move manual tasks across local Kanban statuses [AG-BDD-TASK-011]
    Given the user selects a task on the local board
    When they choose another status in the detail panel
    Then the Task Ledger task status is updated
    And the board moves the card into the target column without creating a run

  Scenario: Users edit task details and comment locally [AG-BDD-TASK-012]
    Given the user selects a task on the local board
    When they edit its title or body or add a comment
    Then the Task Ledger record is updated
    And the detail panel renders the latest task and comment state

  Scenario: Users switch project boards from the board sidebar [AG-BDD-TASK-013]
    Given the user opens the desktop board tab
    When the left sidebar renders
    Then currentTab is "boards"
    And it is titled "看板"
    And it lists project boards directly
    And the title row contains the create-board button
    And no project-group creation card is shown

  Scenario: Users choose agents for a project board [AG-BDD-TASK-014]
    Given the user opens a project board
    When they select a coordinator agent and collaborator agents
    And create a manual task inside that board
    Then the task contains a task_board context reference
    And the task assignee defaults to the board coordinator agent
    And the title area displays the coordinator and collaborator agent names
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-TASK-001 | AG-EARS-TASK-001, AG-BDD-TASK-001 | `tests/task-orchestrator.test.js` | invalid graph rejection | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-002 | AG-EARS-TASK-002, AG-BDD-TASK-002 | `tests/task-orchestrator.test.js` | dependency gating | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-003 | AG-EARS-TASK-003, AG-BDD-TASK-003 | `tests/task-orchestrator.test.js` | scheduler progress | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-004 | AG-EARS-TASK-004, AG-BDD-TASK-004 | `tests/task-orchestrator.test.js` | cancellation | `npm test -- tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-005 | AG-EARS-TASK-005, AG-BDD-TASK-005 | `desktop/src/react/__tests__/stores/settings-modal-actions.test.ts`, future task graph store test | session scoped UI state | `npm test -- tests/task-orchestrator.test.js` | planned |
| AG-TDD-TASK-006 | AG-EARS-TASK-006, AG-BDD-TASK-006 | `tests/task-ledger.test.js`, `tests/task-orchestrator.test.js` | task records, comments, run status/artifact mapping | `npm test -- tests/task-ledger.test.js tests/task-orchestrator.test.js` | needs-review |
| AG-TDD-TASK-007 | AG-EARS-TASK-007, AG-BDD-TASK-007, AG-BDD-TASK-008 | `tests/subagent-tool.test.js`, `tests/task-registry.test.js` | subagent lifecycle and plugin registry task mirroring into Task Ledger | `npm test -- tests/subagent-tool.test.js tests/task-registry.test.js` | needs-review |
| AG-TDD-TASK-008 | AG-EARS-TASK-008, AG-BDD-TASK-009 | `tests/cron-store.test.js`, `tests/cron-scheduler.test.js` | cron job creation, run result, enable/disable and scheduler completion mirroring into Task Ledger | `npm test -- tests/cron-store.test.js tests/cron-scheduler.test.js` | needs-review |
| AG-TDD-TASK-009 | AG-EARS-TASK-009, AG-BDD-TASK-010 | typecheck, `tests/task-ledger.test.js`, `tests/tasks-route.test.js` | create manual Task Ledger tasks from desktop kanban and auto-start coordinator run | `npm run typecheck && npm test -- tests/task-ledger.test.js tests/tasks-route.test.js` | needs-review |
| AG-TDD-TASK-010 | AG-EARS-TASK-010, AG-BDD-TASK-011 | typecheck, `tests/task-ledger.test.js` | update Task Ledger task status from desktop kanban | `npm run typecheck && npm test -- tests/task-ledger.test.js` | needs-review |
| AG-TDD-TASK-011 | AG-EARS-TASK-011, AG-BDD-TASK-012 | typecheck, `tests/task-ledger.test.js` | edit task details and add comments from desktop kanban | `npm run typecheck && npm test -- tests/task-ledger.test.js` | needs-review |
| AG-TDD-TASK-012 | AG-EARS-TASK-012, AG-BDD-TASK-013 | typecheck, manual desktop verification | desktop tab route key, tab label, sidebar board list, create-board button, removal of project-group entry | `npm run typecheck` | needs-review |
| AG-TDD-TASK-013 | AG-EARS-TASK-013, AG-BDD-TASK-014 | typecheck, manual desktop verification | board-level agent names, selection, and task_board context reference on created manual tasks | `npm run typecheck` | needs-review |

## Manual Verification

- 打开顶部「看板」tab，确认左侧栏标题为「看板」，标题行右侧显示 `+` 新建看板入口。
- 确认左侧栏直接列出项目看板，例如「默认项目」，且不再显示「项目看板 / 新建 / N 个项目看板」介绍卡或任何「创建项目组」入口。
- 进入默认项目看板，选择主 agent 与协作 agent，创建一条 manual task，确认任务只出现在当前项目看板中，并自动以主 agent 启动执行。
- 通过任务编排入口创建一个包含依赖的任务图。
- 观察节点状态从 pending 到 running/done 的变化。
- 在运行中取消任务，确认 UI 和服务端状态都显示 aborted。

## Open Questions

- 是否需要持久化任务图运行历史，还是当前只保留进程内状态。
- 是否允许多个节点并发运行，以及并发数是否需要用户可配置。
