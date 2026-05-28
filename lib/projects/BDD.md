# Projects BDD

Full feature spec: `../../docs/specs/features/project-registry.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Module Responsibility

`lib/projects/` owns durable project registry data and validation. Routes and desktop settings adapt this contract for API and UI use.

## Core Scenarios

```gherkin
Feature: Project registry

  Scenario: Create and list a project registry entry [AG-BDD-PROJECT-001]
    Given the user data directory is available
    And the caller provides a project name, workspace root, docs root, test command, description, and modules
    When the project is created
    Then the registry stores a project with a stable prj_ id
    And listing projects returns the saved entry sorted by recent update time

  Scenario: Reject invalid project roots [AG-BDD-PROJECT-002]
    Given the caller provides a missing name or an invalid workspace/docs root
    When the project registry validates the input
    Then the write fails with an explicit validation error
    And no partial project entry is persisted

  Scenario: Project API writes emit app events [AG-BDD-PROJECT-003]
    Given a project entry is created, updated, or deleted through the API
    When the write succeeds
    Then the server emits a projects-changed app event
    And the payload includes the affected project id

  Scenario: Channel creation snapshots a selected project [AG-BDD-PROJECT-004]
    Given a project exists in the registry
    When the user creates a channel with that project id
    Then the channel frontmatter stores the project id and metadata snapshot
    And later channel list/read responses expose the linked project information
```

## Before Editing

Update `EARS.md`, this file, `TDD.md`, the full feature spec, and any channel spec that consumes project snapshots when changing project persistence, validation, app events, or channel project linking.
