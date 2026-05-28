# Computer Use BDD

Full feature spec: `../../docs/specs/features/computer-use.md`
Local EARS: `./EARS.md`
Local TDD: `./TDD.md`

## Module Responsibility

`core/computer-use/` owns the runtime safety and provider contract for Computer Use. Routes, tools, and settings UI adapt the same behavior for users and agents.

## Core Scenarios

```gherkin
Feature: Computer Use runtime

  Scenario: Block Computer Use when runtime prerequisites are not satisfied [AG-BDD-COMPUTER-001]
    Given Computer Use is disabled, the platform is unsupported, the session is read-only, the agent is not primary, or the model lacks vision input
    When the agent tries to list apps or create a lease
    Then the request fails closed with a structured Computer Use error
    And no provider action is executed

  Scenario: Create and reuse a session lease [AG-BDD-COMPUTER-002]
    Given Computer Use is enabled with a supported provider and model
    When the agent starts control for a target app or window
    Then the host returns a lease id and a provider-backed snapshot
    And later state or action calls in the same session may use the current lease without repeating the lease id

  Scenario: Reject stale, unsupported, or unsafe actions [AG-BDD-COMPUTER-003]
    Given the agent has a Computer Use lease and snapshot
    When the agent sends an action using an old snapshot id, a released lease, an unsupported capability, or foreground input without explicit opt-in
    Then the host rejects the action with a structured error
    And the unsafe action is not forwarded to the provider

  Scenario: Emit overlay events during tool phases [AG-BDD-COMPUTER-004]
    Given a session-scoped Computer Use tool call is running
    When the tool lists apps, starts control, reads a snapshot, performs an action, or stops control
    Then the session receives computer_overlay events describing the phase and action

  Scenario: Report settings, permissions, approvals, and unsupported platforms [AG-BDD-COMPUTER-005]
    Given stored Computer Use settings are enabled on a supported or unsupported platform
    When the user opens Computer Use preferences
    Then the response shows selected provider status, permission summary, Windows input-injection opt-in, and approved apps when supported
    And unsupported or disabled states avoid probing providers while preserving stored choices

  Scenario: Ask for approval before controlling apps through a non-isolated provider [AG-BDD-COMPUTER-006]
    Given the selected provider is not isolated and the app has not been approved
    When the agent starts Computer Use for that app
    Then the system surfaces an app approval confirmation
    And the lease is created only after approval is recorded for that provider/app pair

  Scenario: Normalize macOS helper status and actions [AG-BDD-COMPUTER-007]
    Given Agentry runs on macOS with a bundled or development helper available
    When the provider checks status, requests permissions, lists apps, reads app state, or performs an action
    Then helper results are normalized into Agentry provider status, snapshots, element actions, and action results

  Scenario: Use Windows UIA semantic background control by default [AG-BDD-COMPUTER-008]
    Given Agentry runs on Windows with the UIA provider
    When the provider creates a lease and performs actions
    Then semantic element actions are sent through the helper contract
    And foreground raw input remains unavailable unless the user enabled the explicit opt-in
```

## Before Editing

Update `EARS.md`, this file, `TDD.md`, and the full feature spec when changing provider selection, platform gating, lease semantics, action safety, overlay events, app approval, preference events, OS helper normalization, or tool schema capabilities.
