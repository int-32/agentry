# 频道与多 Agent 协作

Status: draft
Last updated: 2026-05-28

## Scope

本规格覆盖频道文件、成员关系、消息追加、阅读位置、Agent 间频道路由、频道关联项目快照、频道绑定看板执行域、频道沟通形成任务的账本保存和桌面端频道 UI。它不覆盖外部桥接平台的群聊协议，也不覆盖项目登记本身。

## Code Map

| Area | Path |
| --- | --- |
| Local EARS | `lib/channels/EARS.md` |
| Local BDD | `lib/channels/BDD.md` |
| Local TDD | `lib/channels/TDD.md` |
| Library | `lib/channels/channel-store.js`, `lib/channels/channel-ticker.js`, `lib/channels/channel-mentions.js` |
| Project registry consumer | `lib/projects/project-registry.js`, `server/routes/projects.js` |
| Hub | `hub/channel-router.js` |
| Tools | `lib/tools/channel-tool.js` |
| Task bridge | `hub/channel-router.js`, `lib/tools/task-create-tool.js`, `lib/task-ledger.js` |
| Server | `server/routes/channels.js` |
| Desktop | `desktop/src/react/components/ChannelsPanel.tsx`, `desktop/src/react/components/channels/` |
| Tests | `tests/channel-*.test.js` |

## Terms

| Term | Meaning |
| --- | --- |
| Channel file | 一个 Markdown 文件，frontmatter 保存频道元数据，正文保存消息流 |
| Member | 加入频道的 Agent ID |
| Bookmark | Agent 在频道里的阅读位置 |
| Mention | 频道消息触发某个 Agent 关注或回复的信号 |
| Project snapshot | 创建频道时写入频道 frontmatter 的项目元数据快照 |
| Channel task | 频道沟通中形成、需要后续跟踪的工作项，保存到 Task Ledger 而不是只留在聊天文本 |
| Bound board | 频道 frontmatter 中记录的默认看板执行域，包含 board id/title、主 agent 和可协作 agent |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-CHANNEL-001 | Ubiquitous | The system shall persist each channel as a local Markdown file with frontmatter metadata and append-only message history. | AG-BDD-CHANNEL-001 | AG-TDD-CHANNEL-001 |
| AG-EARS-CHANNEL-002 | Ubiquitous | The system shall require at least two Agent members for a channel intended for Agent collaboration. | AG-BDD-CHANNEL-002 | AG-TDD-CHANNEL-002 |
| AG-EARS-CHANNEL-003 | Event-driven | When a message is appended to a channel, the system shall serialize writes to the same channel file to avoid interleaved or corrupted content. | AG-BDD-CHANNEL-003 | AG-TDD-CHANNEL-003 |
| AG-EARS-CHANNEL-004 | State-driven | While an Agent is not a channel member, the system shall not route private channel messages to that Agent. | AG-BDD-CHANNEL-004 | AG-TDD-CHANNEL-004 |
| AG-EARS-CHANNEL-005 | Event-driven | When channel UI is disabled, empty, or filtered, the system shall distinguish hidden data from missing channel data in diagnostics. | AG-BDD-CHANNEL-005 | AG-TDD-CHANNEL-005 |
| AG-EARS-CHANNEL-006 | Event-driven | When a channel is created with a project id, the system shall store the selected project's metadata as channel frontmatter and expose it in channel list/read responses. | AG-BDD-CHANNEL-006, AG-BDD-PROJECT-004 | AG-TDD-CHANNEL-006 |
| AG-EARS-CHANNEL-007 | Event-driven | When channel discussion creates follow-up work, the system shall provide a channel-scoped task tool that persists the work into Task Ledger with channel/project/board context instead of relying on chat text or session todo state. | AG-BDD-CHANNEL-007, AG-BDD-TASK-015 | AG-TDD-CHANNEL-007 |
| AG-EARS-CHANNEL-008 | Event-driven | When a channel is bound to a project board, the channel frontmatter shall store the board id/title/coordinator/collaborators, channel list/read responses shall expose that binding, and channel task creation shall default to that board execution domain. | AG-BDD-CHANNEL-008 | AG-TDD-CHANNEL-008 |

## BDD Scenarios

```gherkin
Feature: Channels and Agent collaboration

  Scenario: Create a channel file with valid members [AG-BDD-CHANNEL-001]
    Given a channels directory exists
    And the user creates a channel with two Agent members
    When the channel store writes the channel
    Then a Markdown file is created
    And the frontmatter contains the channel id and members

  Scenario: Reject a channel with too few Agent members [AG-BDD-CHANNEL-002]
    Given a channel creation request has fewer than two Agent members
    When the channel store validates members
    Then the creation fails with a clear error
    And no partial channel file is left behind

  Scenario: Concurrent channel writes stay serialized [AG-BDD-CHANNEL-003]
    Given two messages are appended to the same channel at nearly the same time
    When both writes complete
    Then both messages are present in the channel file
    And neither message header or body is interleaved with the other

  Scenario: Non-member does not receive private channel routing [AG-BDD-CHANNEL-004]
    Given a channel has members A and B
    And Agent C is not a member
    When a private channel message is routed
    Then Agent C is not selected as a recipient

  Scenario: Empty channel UI keeps diagnostics precise [AG-BDD-CHANNEL-005]
    Given channel files exist on disk
    But the channel panel is filtered or feature-hidden
    When diagnostics are collected
    Then the system reports that channels exist
    And distinguishes UI visibility from storage absence

  Scenario: Create a channel linked to a project snapshot [AG-BDD-CHANNEL-006]
    Given a project exists in the project registry
    When the user creates a channel with that project id
    Then the channel file stores project id, name, roots, test command, and description in frontmatter
    And channel list/read responses include the linked project snapshot

  Scenario: Save channel follow-up work as a durable task [AG-BDD-CHANNEL-007]
    Given an Agent processes channel messages
    And the discussion produces work that must be tracked
    When the Agent calls the channel task creation tool
    Then the Task Ledger contains a task sourced from the channel
    And the task keeps channel and linked project context
    And read-only channel tool mode saves the task without auto-starting execution

  Scenario: Bind a channel to a project board [AG-BDD-CHANNEL-008]
    Given a project board has a coordinator agent and collaborators
    When the user binds a channel to that board
    Then the channel frontmatter stores the board execution-domain fields
    And channel list/read responses expose the bound board
    And channel-created tasks default to the bound board and coordinator
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-CHANNEL-001 | AG-EARS-CHANNEL-001, AG-BDD-CHANNEL-001 | `tests/channel-store-locking.test.js` | channel file write/read | `npm test -- tests/channel-store-locking.test.js` | needs-review |
| AG-TDD-CHANNEL-002 | AG-EARS-CHANNEL-002, AG-BDD-CHANNEL-002 | `tests/channel-router-agent-order.test.js`, `tests/channel-router-trigger.test.js` | member and route constraints | `npm test -- tests/channel-router-agent-order.test.js tests/channel-router-trigger.test.js` | needs-review |
| AG-TDD-CHANNEL-003 | AG-EARS-CHANNEL-003, AG-BDD-CHANNEL-003 | `tests/channel-store-locking.test.js` | concurrent write serialization | `npm test -- tests/channel-store-locking.test.js` | needs-review |
| AG-TDD-CHANNEL-004 | AG-EARS-CHANNEL-004, AG-BDD-CHANNEL-004 | `tests/channel-router-reply-tools.test.js`, `tests/channel-router-memory-master.test.js` | routing and reply tools | `npm test -- tests/channel-router-reply-tools.test.js tests/channel-router-memory-master.test.js` | needs-review |
| AG-TDD-CHANNEL-005 | AG-EARS-CHANNEL-005, AG-BDD-CHANNEL-005 | `desktop/src/react/__tests__/components/session-sections.test.ts` | UI visibility states | `npm test -- desktop/src/react/__tests__/components/session-sections.test.ts` | planned |
| AG-TDD-CHANNEL-006 | AG-EARS-CHANNEL-006, AG-BDD-CHANNEL-006, AG-BDD-PROJECT-004 | `tests/channels-route.test.js` | project id validation, channel frontmatter project snapshot, channel list/read projection | `npm test -- tests/channels-route.test.js` | needs-review |
| AG-TDD-CHANNEL-007 | AG-EARS-CHANNEL-007, AG-BDD-CHANNEL-007, AG-BDD-TASK-015 | `tests/channel-router-reply-tools.test.js` | channel phone task tool writes Task Ledger records with channel/project context and read-only auto-start guard | `npm test -- tests/channel-router-reply-tools.test.js` | needs-review |
| AG-TDD-CHANNEL-008 | AG-EARS-CHANNEL-008, AG-BDD-CHANNEL-008 | `tests/channels-route.test.js`, `tests/channel-router-reply-tools.test.js` | channel board binding persistence/projection and bound-board task execution defaults | `npm test -- tests/channels-route.test.js tests/channel-router-reply-tools.test.js` | needs-review |

## Manual Verification

- 在开发数据目录准备一个频道文件。
- 启动桌面端，确认频道面板能区分“没有频道”和“频道入口被隐藏/过滤”。
- 让两个 Agent 在同一频道内互相回复，确认未加入成员不会收到消息。
- 创建项目登记后在新建频道弹窗选择该项目，确认频道头部显示关联项目名称。

## Open Questions

- 是否需要把频道文件 schema 写成单独的 machine-readable contract。
- 频道 UI 是否需要显式暴露 storage path 和成员诊断入口。
