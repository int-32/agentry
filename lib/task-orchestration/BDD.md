# Task Orchestration BDD

Full feature spec: `../../docs/specs/features/task-orchestration.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Module Responsibility

`lib/task-orchestration/` owns in-process task graph creation, validation, dependency scheduling, cancellation, run snapshots, and progress event emission. The first Task Ledger bridge records created runs under durable task records so future board views, comments, events, and artifacts have a common backing model. It should not depend on a specific desktop component.

## Core Scenarios

```gherkin
Feature: Task graph orchestration

  Scenario: Reject an empty task graph [AG-BDD-TASK-001]
    Given a task orchestration request has no nodes
    When the run is created
    Then the system rejects the request
    And no run is stored

  Scenario: Dependency gates node execution [AG-BDD-TASK-002]
    Given node B depends on node A
    When the run starts
    Then node A can run
    And node B waits until node A is done

  Scenario: Completed dependency starts the next node [AG-BDD-TASK-003]
    Given node B depends on node A
    And node A finishes successfully
    When the scheduler processes the completion event
    Then node B becomes eligible to run
    And no manual refresh is required

  Scenario: Canceling aborts unfinished work [AG-BDD-TASK-004]
    Given a run has running, pending, or blocked nodes
    When the run is canceled
    Then unfinished nodes become aborted
    And the cancellation reason remains visible

  Scenario: Runs stay scoped to the originating session [AG-BDD-TASK-005]
    Given two sessions are open
    And session A creates a task graph
    When session B renders task graph state
    Then session B does not display session A's run

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
```

## Before Editing

Update `EARS.md`, this file, `TDD.md`, and the full feature spec when changing graph validation, dependency scheduling, cancellation, run status, event payload, or artifact summarization.
