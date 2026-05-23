# Image Generation Plugin TDD

Status: draft
Last updated: 2026-05-23

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-MEDIA-001 | AG-EARS-MEDIA-001, AG-BDD-MEDIA-001 | `tests/image-gen-tool.test.js`, `tests/image-gen-provider-discovery.test.js` | non-blocking tool response, batch task creation, provider/default adapter selection | `npm test -- tests/image-gen-tool.test.js tests/image-gen-provider-discovery.test.js` | needs-review |
| AG-TDD-MEDIA-002 | AG-EARS-MEDIA-002, AG-BDD-MEDIA-002 | `plugins/image-gen/tests/task-store.test.js`, `plugins/image-gen/tests/poller.test.js`, `tests/image-gen-download.test.js` | task persistence, polling completion, download/media file handling | `npm test -- plugins/image-gen/tests/task-store.test.js plugins/image-gen/tests/poller.test.js tests/image-gen-download.test.js` | needs-review |
| AG-TDD-MEDIA-003 | AG-EARS-MEDIA-003, AG-BDD-MEDIA-003 | `plugins/image-gen/tests/adapter-registry.test.js`, `tests/image-gen-adapters.test.js` | adapter registration, lookup, built-in adapter behavior | `npm test -- plugins/image-gen/tests/adapter-registry.test.js tests/image-gen-adapters.test.js` | needs-review |
| AG-TDD-MEDIA-004 | AG-EARS-MEDIA-004, AG-BDD-MEDIA-004 | `tests/image-gen-tool.test.js`, `tests/image-gen-provider-discovery.test.js` | no-provider and submission failure messaging without dangling tasks | `npm test -- tests/image-gen-tool.test.js tests/image-gen-provider-discovery.test.js` | needs-review |
| AG-TDD-MEDIA-005 | AG-EARS-MEDIA-005, AG-BDD-MEDIA-005 | `tests/image-gen-card-route.test.js`, manual desktop verification | iframe card route rendering, batch polling behavior, stable completed cells | `npm test -- tests/image-gen-card-route.test.js` | needs-review |

## Supporting Tests

| Area | Test file |
| --- | --- |
| Image size utilities | `plugins/image-gen/tests/image-size.test.js` |
| Local CLI wrapper | `plugins/image-gen/tests/local-cli-wrapper.test.js` |
| Model catalog | `plugins/image-gen/tests/model-catalog.test.js` |

## Manual Verification

1. Configure an image provider in Settings → Media.
2. Ask the Agent to generate multiple images and confirm the chat response immediately shows an iframe card.
3. Confirm pending cells become media cells without reloading already completed cells.
4. Open a completed image/video from the card and confirm the file is available in the session file flow.

## Change Notes

When adding adapter types, task states, card routes, or generated file handling, update this matrix and add the smallest focused test first.
