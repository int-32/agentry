# Agent 会话上下文

Status: draft
Last updated: 2026-05-26

## Scope

本规格覆盖聊天会话、Agent 身份、上下文注入、流式事件和前端会话归属。它不覆盖具体模型供应商协议，也不覆盖频道群聊路由。

## Code Map

| Area | Path |
| --- | --- |
| Core | `core/agent.js`, `core/engine.js`, `core/session-coordinator.js`, `core/session-list-projection-cache.js`, `core/agent-manager.js` |
| Server | `server/routes/chat.js`, `server/routes/sessions.js`, `server/session-stream-store.js` |
| Desktop | `desktop/src/react/stores/`, `desktop/src/react/components/chat/`, `desktop/src/react/services/ws-message-handler.ts`, `desktop/src/react/services/session-refresh-scheduler.ts` |
| Tests | `tests/session-*.test.js`, `tests/chat-*.test.js`, `tests/sessions-archived-route.test.js`, `desktop/src/react/__tests__/components/`, `desktop/src/react/__tests__/services/ws-message-handler.test.ts` |

## Terms

| Term | Meaning |
| --- | --- |
| Agent identity | Agent 的独立配置、人格、记忆、工具、头像和调度上下文 |
| Session | 单个对话或任务运行的消息历史和流式状态 |
| Stream event | 服务端通过 WebSocket 发给前端的增量事件 |
| Session path | 前后端用来定位会话归属的路径标识 |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-SESSION-001 | State-driven | While multiple sessions are active, the system shall tag stream events with the originating `sessionPath` before broadcasting them. | AG-BDD-SESSION-001 | AG-TDD-SESSION-001 |
| AG-EARS-SESSION-002 | Event-driven | When a user switches the visible session, the desktop UI shall render only messages, tool events, browser status, and compaction events that belong to that session. | AG-BDD-SESSION-002 | AG-TDD-SESSION-002 |
| AG-EARS-SESSION-003 | Event-driven | When an Agent profile, config, or memory source changes, newly created sessions shall use the updated context, while existing sessions shall not be silently rewritten unless the code path explicitly supports refresh. | AG-BDD-SESSION-003 | AG-TDD-SESSION-003 |
| AG-EARS-SESSION-004 | Unwanted behavior | If a WebSocket client disconnects during streaming, the system shall preserve the stream state during the grace window and shall abort only after the configured grace period without active clients. | AG-BDD-SESSION-004 | AG-TDD-SESSION-004 |
| AG-EARS-SESSION-005 | Event-driven | When a session turn settles after optimistic UI state, the desktop UI shall refresh the session list through a coalesced scheduler rather than issuing duplicate immediate reloads. | AG-BDD-SESSION-005 | AG-TDD-SESSION-005 |
| AG-EARS-SESSION-006 | State-driven | While listing sessions, the backend shall build session projections from JSONL files with cache invalidation based on file size and mtime, preserving malformed-line tolerance. | AG-BDD-SESSION-006 | AG-TDD-SESSION-006 |
| AG-EARS-SESSION-007 | Unwanted behavior | When a session is archived or permanently deleted, the backend shall discard runtime state for both the active and archived path variants before moving or removing files. | AG-BDD-SESSION-007 | AG-TDD-SESSION-007 |

## BDD Scenarios

```gherkin
Feature: Agent session context

  Scenario: Stream events stay in the originating session [AG-BDD-SESSION-001]
    Given two sessions are open for the same Agent
    And both sessions can receive WebSocket broadcasts
    When session A starts streaming a model response
    Then every stream event for session A includes session A's sessionPath
    And session B does not append session A's events to its transcript

  Scenario: Visible session switch does not replay another session's tool output [AG-BDD-SESSION-002]
    Given session A has a running tool call
    And the user switches to session B
    When session A emits a tool_start or tool_result event
    Then the UI keeps that event associated with session A
    And session B's timeline remains unchanged

  Scenario: Updated profile applies to a new session [AG-BDD-SESSION-003]
    Given the user saves updated profile or Agent config data
    When the user starts a new session after the save succeeds
    Then the new session context includes the updated data
    And older sessions keep their existing context unless a refresh path is invoked

  Scenario: Temporary WebSocket disconnect has a grace window [AG-BDD-SESSION-004]
    Given an assistant response is streaming
    When the only WebSocket client disconnects briefly
    Then the system waits through the disconnect grace window before aborting
    And a reconnect within that window can resume rendering the current stream state

  Scenario: Session list refresh is coalesced after stream settlement [AG-BDD-SESSION-005]
    Given the desktop has an optimistic current session while a turn is streaming
    When the stream settles or emits turn_end
    Then the UI schedules one session list refresh for the settled state
    And overlapping refresh requests are coalesced until the in-flight refresh finishes

  Scenario: Session history list tolerates stable JSONL projections [AG-BDD-SESSION-006]
    Given a session directory contains JSONL session files
    When the backend lists sessions repeatedly without file size or mtime changes
    Then unchanged projections can be reused from cache
    And malformed JSONL lines do not make the whole history list fail

  Scenario: Archive and delete discard runtime variants first [AG-BDD-SESSION-007]
    Given a session may still have active runtime, confirmations, deferred results, or terminals
    When the user archives or permanently deletes that session
    Then runtime state is discarded for both active and archived path variants before file movement or deletion
    And stale runtime state cannot continue writing to the old session path
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-SESSION-001 | AG-EARS-SESSION-001, AG-BDD-SESSION-001 | `tests/chat-route-switching.test.js`, `tests/session-stream-store.test.js` | cross-session stream routing | `npm test -- tests/chat-route-switching.test.js tests/session-stream-store.test.js` | needs-review |
| AG-TDD-SESSION-002 | AG-EARS-SESSION-002, AG-BDD-SESSION-002 | `desktop/src/react/__tests__/components/chat-timeline-anchors.test.ts` | visible timeline routing | `npm test -- desktop/src/react/__tests__/components/chat-timeline-anchors.test.ts` | needs-review |
| AG-TDD-SESSION-003 | AG-EARS-SESSION-003, AG-BDD-SESSION-003 | `tests/engine-ui-context.test.js`, `tests/session-coordinator.test.js` | context construction | `npm test -- tests/engine-ui-context.test.js tests/session-coordinator.test.js` | needs-review |
| AG-TDD-SESSION-004 | AG-EARS-SESSION-004, AG-BDD-SESSION-004 | `tests/session-stream-store.test.js`, `tests/session-teardown.test.js` | disconnect and teardown | `npm test -- tests/session-stream-store.test.js tests/session-teardown.test.js` | needs-review |
| AG-TDD-SESSION-005 | AG-EARS-SESSION-005, AG-BDD-SESSION-005 | `desktop/src/react/__tests__/services/ws-message-handler.test.ts` | coalesced session list refresh after stream settlement | `npm test -- desktop/src/react/__tests__/services/ws-message-handler.test.ts` | needs-review |
| AG-TDD-SESSION-006 | AG-EARS-SESSION-006, AG-BDD-SESSION-006 | `tests/session-coordinator.test.js`, `tests/session-meta-write-serialization.test.js` | session list projection cache and metadata list stability | `npm test -- tests/session-coordinator.test.js tests/session-meta-write-serialization.test.js` | needs-review |
| AG-TDD-SESSION-007 | AG-EARS-SESSION-007, AG-BDD-SESSION-007 | `tests/sessions-archived-route.test.js` | archive/delete runtime discard before file movement | `npm test -- tests/sessions-archived-route.test.js` | needs-review |

## Manual Verification

- 启动 `npm start`。
- 打开两个会话，让其中一个发起长响应或工具调用。
- 切换会话，确认流式输出、工具状态和浏览器状态不会串到另一个会话。

## Open Questions

- 旧会话是否需要显式“刷新个人资料上下文”的用户入口。
- 前端是否需要在调试面板暴露当前 sessionPath，方便定位串流问题。
