# Image Generation Plugin BDD

Status: draft
Last updated: 2026-05-23

## Feature

```gherkin
Feature: Non-blocking media generation

  Scenario: Submit image generation and receive a result card [AG-BDD-MEDIA-001]
    Given the image generation plugin is loaded
    And at least one image adapter is available
    When an Agent calls generate-image with a prompt
    Then the tool stores one or more generation tasks
    And the tool response contains an iframe card for the generated batch
    And the Agent does not wait for generation completion

  Scenario: Completed media is persisted and exposed [AG-BDD-MEDIA-002]
    Given a generation task has been submitted
    When the adapter reports generated files
    Then the task is marked done with file names
    And the generated media can be fetched through plugin media routes
    And the completed output is registered for the originating session

  Scenario: External adapters participate through the registry [AG-BDD-MEDIA-003]
    Given an external plugin registers a media generation adapter
    When media generation chooses an adapter for a compatible type
    Then the registered adapter can be selected
    And removing that adapter prevents future selection

  Scenario: Missing or failing provider is reported clearly [AG-BDD-MEDIA-004]
    Given no suitable adapter is available
    When an Agent calls generate-image or generate-video
    Then the tool returns a visible failure message
    And no pending generation task is added to the task store

  Scenario: Result cards update changed cells only [AG-BDD-MEDIA-005]
    Given a batch card contains pending and completed tasks
    When polling returns a status update for one task
    Then only that task cell is replaced
    And already completed media elements remain mounted
```

## Change Notes

Update this file together with `EARS.md` and `TDD.md` when changing observable media generation behavior.
