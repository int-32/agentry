# 媒体生成插件

Status: draft
Last updated: 2026-05-25

## Scope

本规格覆盖 `plugins/image-gen/` 提供的非阻塞图片/视频生成工具、媒体适配器注册、任务持久化、轮询、生成文件登记和 iframe 结果卡片。Provider/model 配置与媒体能力发现的全局设置边界仍由 [供应商与模型设置](./provider-model-settings.md) 覆盖。

## Code Map

| Area | Path |
| --- | --- |
| Plugin entry | `plugins/image-gen/index.js`, `plugins/image-gen/manifest.json` |
| Tools | `plugins/image-gen/tools/generate-image.js`, `plugins/image-gen/tools/generate-video.js` |
| Adapters | `plugins/image-gen/adapters/`, `plugins/image-gen/lib/adapter-registry.js` |
| Task lifecycle | `plugins/image-gen/lib/task-store.js`, `plugins/image-gen/lib/poller.js`, `plugins/image-gen/lib/download.js` |
| Routes and cards | `plugins/image-gen/routes/tasks.js`, `plugins/image-gen/routes/media.js`, `plugins/image-gen/routes/card.js` |
| Local module specs | `plugins/image-gen/EARS.md`, `plugins/image-gen/BDD.md`, `plugins/image-gen/TDD.md` |
| Tests | `tests/image-gen-*.test.js`, `plugins/image-gen/tests/` |

## Terms

| Term | Meaning |
| --- | --- |
| Media generation task | 一次图片或视频生成请求在插件内保存的异步任务记录 |
| Adapter | 将统一工具参数转换为具体供应商生成 API 的插件内适配层 |
| Batch card | 聊天中展示一组生成任务状态和结果的 iframe 卡片 |
| SessionFile registration | 生成文件完成后进入会话文件体系，供桌面或 Bridge 后续呈现/发送 |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-MEDIA-001 | Ubiquitous | The plugin shall submit image and video generation through registered adapters and return immediately with a chat card instead of waiting for completion. | AG-BDD-MEDIA-001 | AG-TDD-MEDIA-001 |
| AG-EARS-MEDIA-002 | Event-driven | When a generation task completes, fails, or is cancelled, the plugin shall persist the task state and make completed media available through the plugin media routes and SessionFile registration. | AG-BDD-MEDIA-002 | AG-TDD-MEDIA-002 |
| AG-EARS-MEDIA-003 | Ubiquitous | The adapter registry shall support built-in adapters and external adapter registration/unregistration without requiring tool changes. | AG-BDD-MEDIA-003 | AG-TDD-MEDIA-003 |
| AG-EARS-MEDIA-004 | Unwanted behavior | If no suitable provider/adapter exists or submission fails, the tool shall return an explicit user-visible failure message and shall not create a dangling pending card. | AG-BDD-MEDIA-004 | AG-TDD-MEDIA-004 |
| AG-EARS-MEDIA-005 | Ubiquitous | Result cards shall poll batch task state and update only changed cells so completed media does not flicker or reload unnecessarily. | AG-BDD-MEDIA-005 | AG-TDD-MEDIA-005 |

## BDD Scenarios

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

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-MEDIA-001 | AG-EARS-MEDIA-001, AG-BDD-MEDIA-001 | `tests/image-gen-tool.test.js`, `tests/image-gen-provider-discovery.test.js` | non-blocking tool response, batch task creation, provider/default adapter selection | `npm test -- tests/image-gen-tool.test.js tests/image-gen-provider-discovery.test.js` | needs-review |
| AG-TDD-MEDIA-002 | AG-EARS-MEDIA-002, AG-BDD-MEDIA-002 | `plugins/image-gen/tests/task-store.test.js`, `plugins/image-gen/tests/poller.test.js`, `tests/image-gen-download.test.js` | task persistence, polling completion, download/media file handling | `npm test -- plugins/image-gen/tests/task-store.test.js plugins/image-gen/tests/poller.test.js tests/image-gen-download.test.js` | needs-review |
| AG-TDD-MEDIA-003 | AG-EARS-MEDIA-003, AG-BDD-MEDIA-003 | `plugins/image-gen/tests/adapter-registry.test.js`, `tests/image-gen-adapters.test.js` | adapter registration, lookup, built-in adapter behavior | `npm test -- plugins/image-gen/tests/adapter-registry.test.js tests/image-gen-adapters.test.js` | needs-review |
| AG-TDD-MEDIA-004 | AG-EARS-MEDIA-004, AG-BDD-MEDIA-004 | `tests/image-gen-tool.test.js`, `tests/image-gen-provider-discovery.test.js` | no-provider and submission failure messaging without dangling tasks | `npm test -- tests/image-gen-tool.test.js tests/image-gen-provider-discovery.test.js` | needs-review |
| AG-TDD-MEDIA-005 | AG-EARS-MEDIA-005, AG-BDD-MEDIA-005 | `tests/image-gen-card-route.test.js`, manual desktop verification | iframe card route rendering, batch polling behavior, stable completed cells | `npm test -- tests/image-gen-card-route.test.js` | needs-review |

## Manual Verification

1. Configure an image provider in Settings → Media.
2. Ask the Agent to generate multiple images and confirm the chat response immediately shows an iframe card.
3. Confirm pending cells become media cells without reloading already completed cells.
4. Open a completed image/video from the card and confirm the file is available in the session file flow.

## Open Questions

- 是否需要为第三方媒体适配器建立独立的兼容性声明或版本约束。
- 生成任务失败后的重试入口应由卡片承担，还是交回 Agent 工具重新发起。
