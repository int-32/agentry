# Channels BDD

Full feature spec: `../../docs/specs/features/channels-and-agent-collaboration.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Module Responsibility

`lib/channels/` owns the local channel file contract: channel metadata, message parsing, member validation, read/write locking, mention helpers, and background channel polling support. It should stay usable without assuming a specific desktop UI.

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
```

## Before Editing

Update `EARS.md`, this file, `TDD.md`, and the full feature spec when changing channel file format, member rules, locking behavior, or route eligibility.
