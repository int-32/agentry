# Channels BDD

Full feature spec: `../../docs/specs/features/channels-and-agent-collaboration.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Module Responsibility

`lib/channels/` owns the local channel file contract: channel metadata, optional project snapshot metadata, optional task-board execution-domain metadata, message parsing, member validation, read/write locking, mention helpers, and background channel polling support. It should stay usable without assuming a specific desktop UI.

## Core Scenarios

```gherkin
Feature: Channel file contract

  Scenario: Create a channel file with valid members [AG-BDD-CHANNEL-001]
    Given a channels directory exists
    And the caller provides at least two Agent members
    When the channel is created
    Then the channel file contains frontmatter with id and members
    And the optional intro is written as a system message

  Scenario: Reject invalid member lists [AG-BDD-CHANNEL-002]
    Given a member list has fewer than two non-empty Agent IDs
    When the member list is validated
    Then validation fails
    And the caller receives a clear error

  Scenario: Same-file writes are serialized [AG-BDD-CHANNEL-003]
    Given two appends target the same channel file
    When both writes run concurrently
    Then the module writes both messages without interleaving message bodies or headers

  Scenario: Non-member routing is rejected [AG-BDD-CHANNEL-004]
    Given a private channel has members A and B
    And Agent C is not a member
    When routing decides whether Agent C should receive the channel message
    Then the message is not routed to Agent C
    And reply tools do not expose private channel context to Agent C

  Scenario: Project metadata is snapshotted into channel frontmatter [AG-BDD-CHANNEL-006]
    Given the caller provides a valid project snapshot while creating a channel
    When the channel file is written
    Then the frontmatter contains the project id and metadata fields
    And channel projections can expose the linked project without re-reading the project registry

  Scenario: Task board execution domain is snapshotted into channel frontmatter [AG-BDD-CHANNEL-008]
    Given the caller provides a task board binding while creating or updating a channel
    When the channel file is written
    Then the frontmatter contains the board id, title, coordinator agent, and selected agent ids
    And channel projections can expose the bound board without re-reading the board UI state
```

## Before Editing

Update `EARS.md`, this file, `TDD.md`, and the full feature spec when changing channel file format, member rules, project snapshot metadata, task-board metadata, locking behavior, or route eligibility.
