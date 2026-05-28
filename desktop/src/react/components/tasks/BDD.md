# Task Board UI BDD

Full feature spec: `../../../../../docs/specs/features/task-orchestration.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Local Scope

`desktop/src/react/components/tasks/` owns observable board-tab behavior: task cards, columns, detail editing, project board switching, board agent controls, and board-to-channel binding controls. Server persistence, Task Ledger data shape, and graph scheduling are validated by the shared task orchestration specs.

## Scenarios

```gherkin
Feature: Desktop task board UI

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

  Scenario: Users bind a project board to a channel [AG-BDD-TASK-016]
    Given the user opens a project board
    When they select a channel in the project Agent panel
    Then the board stores the channel id locally
    And the channel task-board binding is persisted through the channel route
    And the board header and sidebar show the bound channel
```

## Maintenance Note

Update `EARS.md`, this file, `TDD.md`, and the full feature spec when changing board routes, board sidebar structure, manual task UI, Kanban status movement, board agent selection, or board-channel binding.
