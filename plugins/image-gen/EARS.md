# Image Generation Plugin EARS

Status: draft
Last updated: 2026-05-23

## Scope

`plugins/image-gen/` owns non-blocking image/video generation tools, media adapter registration, task persistence, polling, generated file registration, and iframe result cards. Provider/model discovery remains covered by `docs/specs/features/provider-model-settings.md`.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-MEDIA-001 | Ubiquitous | The plugin shall submit image and video generation through registered adapters and return immediately with a chat card instead of waiting for completion. | AG-BDD-MEDIA-001 | AG-TDD-MEDIA-001 |
| AG-EARS-MEDIA-002 | Event-driven | When a generation task completes, fails, or is cancelled, the plugin shall persist the task state and make completed media available through the plugin media routes and SessionFile registration. | AG-BDD-MEDIA-002 | AG-TDD-MEDIA-002 |
| AG-EARS-MEDIA-003 | Ubiquitous | The adapter registry shall support built-in adapters and external adapter registration/unregistration without requiring tool changes. | AG-BDD-MEDIA-003 | AG-TDD-MEDIA-003 |
| AG-EARS-MEDIA-004 | Unwanted behavior | If no suitable provider/adapter exists or submission fails, the tool shall return an explicit user-visible failure message and shall not create a dangling pending card. | AG-BDD-MEDIA-004 | AG-TDD-MEDIA-004 |
| AG-EARS-MEDIA-005 | Ubiquitous | Result cards shall poll batch task state and update only changed cells so completed media does not flicker or reload unnecessarily. | AG-BDD-MEDIA-005 | AG-TDD-MEDIA-005 |

## Change Notes

Update this file, `BDD.md`, `TDD.md`, and relevant global feature specs when changing image/video tool behavior, adapter selection, task lifecycle, card rendering, media routes, or generated file registration.
