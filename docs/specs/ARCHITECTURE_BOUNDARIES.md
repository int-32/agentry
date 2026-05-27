# Agentry 架构边界表

Status: draft
Last updated: 2026-05-27

## Purpose

这份文档用于回答一个问题：改某个能力时，应该先看哪个 owner、哪个持久化源、哪个读写入口、哪个事件同步面和哪个测试入口。

它不是重构方案，也不替代 EARS / BDD / TDD。它是 P0 级别的边界地图，后续 P1/P2 重构应先更新这里，再改代码。

## Boundary Rules

| Rule | Meaning |
| --- | --- |
| Explicit identity first | 后端逻辑优先使用显式 `agentId`、`sessionPath`、`providerId`、`workspaceRoot`，不要默认从 UI 焦点状态推导。 |
| Durable source beats projection | 文件、YAML、JSONL、ledger 这类持久化源优先于前端 store、summary response、cache 和运行时派生值。 |
| One owner per domain | 每个领域对象必须能说清“谁负责写入和校验”，route 和 UI 只做协议适配。 |
| Events are sync contracts | `app_event` / WebSocket 事件不是随手通知，必须视为前后端状态同步契约。 |
| Bridge is runtime, not script | 本机 CLI bridge 已经承担模型路由、会话续接和工作区授权，后续按 runtime adapter 管理。 |

## Domain Boundaries

| Domain | Owner | Durable Source | Write Entry | Read / Projection Entry | Event / Sync Surface | Verification Entry | Current Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agent | `core/agent-manager.js`, `core/agent.js` | `AGENTRY_HOME/agents/<agentId>/config.yaml`, identity files, memory files | `server/routes/agents.js`, `server/routes/config.js`, `ConfigCoordinator.updateConfig()` | `engine.getAgent()`, `engine.listAgents()`, `/api/agents`, `/api/config` | `agent-created`, `agent-deleted`, `agent-updated`, `agent-switched`, `agent-config-changed`, `memory-master-changed` | `tests/agents-route.test.js`, `tests/update-config-non-focus.test.js`, desktop app-event tests | Some paths still fall back to `engine.currentAgentId`; non-focus writes need explicit `agentId`. |
| Session | `core/session-coordinator.js` | Agent session JSONL files, session meta, session file registry cache | `server/routes/chat.js`, `server/routes/sessions.js`, `Hub.send()`, `engine.promptSession()` | `engine.getSessionByPath()`, `/api/sessions`, `/api/chat/messages`, WebSocket stream state | chat stream events with `sessionPath`, `status`, `stream_resume`, `compaction_*`, session list refresh | `tests/session-*.test.js`, `tests/chat-route-switching.test.js`, `desktop/src/react/__tests__/services/ws-message-handler.test.ts` | New-session workspace history writes use returned `agentId`; remaining focus session APIs must stay path-aware. |
| Provider | `core/provider-settings-service.js`, `core/provider-registry.js` | `AGENTRY_HOME/added-models.yaml`, OAuth/auth storage, provider plugin declarations | `ProviderSettingsService.applyProvidersPatch()`, `ProviderRegistry.saveProvider()`, provider settings UI | `ProviderSettingsService.getConfigProviders()`, `ProviderSettingsService.getProviderSummary()`, `engine.resolveProviderCredentials()` | `models-changed`, provider summary response, config cache invalidation | `tests/provider-settings-service.test.js`, `tests/provider-registry-crud.test.js`, `tests/model-sync*.test.js`, provider route tests | Provider settings projection now has a service boundary; model discovery and local CLI workspace enforcement still cross route/bridge code. |
| Model | `core/model-manager.js`, `core/provider-model-discovery-service.js`, `core/model-sync.js`, `shared/model-capabilities.js`, `core/provider-compat.js` | `models.json`, `known-models.json`, provider model entries, `models-cache.json` | `ProviderModelDiscoveryService.fetchModels()`, provider model save paths, `/api/models/set`, `/api/models/switch`, `/api/models/health` | `/api/models`, `engine.availableModels`, `engine.resolveModelWithCredentials()`, `ProviderModelDiscoveryService.getCachedDiscoveredModels()` | `models-changed`, context usage refresh, model selector state | `tests/provider-model-discovery-service.test.js`, `tests/model-*.test.js`, `tests/known-models.test.js`, `tests/provider-compat*.test.js` | Model discovery now has a service boundary; chat model availability and media capability must remain separate. |
| Workspace | `core/workspace-service.js`, `core/config-coordinator.js`, `shared/workspace-history.js`, `shared/workspace-scope.js` | Agent `config.yaml` fields such as `desk.home_folder`, `last_cwd`, `cwd_history`; workspace UI preferences | `/api/agents/:id/config`, `/api/config/workspaces/recent`, session creation/switch paths | `WorkspaceService.getHomeFolder()`, `engine.getHomeCwd()`, `/api/config`, `/api/agents/switch`, desktop workspace store | `agent-workspace-changed`, `agent-switched`, workspace UI persistence | `tests/workspace-service.test.js`, `tests/workspace-scope.test.js`, `tests/config-workspaces-route.test.js`, desktop desk-action tests | Recent workspace writes accept explicit `agentId`; session cwd behavior still crosses agent switch and session creation. |
| Desk | `server/routes/desk.js`, `desktop/src/react/stores/desk-actions.ts`, `lib/desk/*` | Workspace files, `jian.md`, heartbeat/activity files, persisted workspace UI state | `/api/desk/*`, desktop desk actions, heartbeat scheduler | Desk route responses, `RightWorkspacePanel`, `DeskTree`, activity panel | file-change events, activity updates, workspace activation | desk route tests, desktop `DeskSection` / `desk-actions` tests, heartbeat tests | UI state, filesystem state and heartbeat execution are adjacent but not one domain; avoid letting Desk own general Workspace semantics. |
| Bridge | `lib/bridge/bridge-manager.js`, `lib/bridge/local-cli-runtime-config.js`, `scripts/agentry-bridge/server.mjs`, `core/bridge-session-manager.js` | Bridge config/index files, external platform state, in-memory CLI conversation map, `added-models.yaml` for CLI workspace | `/api/bridge/*`, bridge adapters, local OpenAI-compatible `/v1/chat/completions` | bridge manager state, `BridgeSessionManager`, bridge panel, local CLI model list, `resolveBridgeRuntimeConfig()` | external delivery events, bridge session events, pending interaction replies | `tests/bridge-*.test.js`, `tests/bridge-local-cli-runtime-config.test.js`, `node --check scripts/agentry-bridge/server.mjs` | Local CLI runtime config now has a module boundary; the bridge script still owns streaming process orchestration. |
| Task | `lib/task-ledger.js`, `lib/task-orchestration/task-orchestrator.js`, `lib/task-registry.js` | `.ephemeral/task-ledger.json`, `.ephemeral/task-runs.json`, plugin task records, cron records | `server/routes/tasks.js`, task tools, subagent tool, cron scheduler, board UI | `/api/tasks`, `/api/tasks/runs`, `TaskPage`, task graph store | task ledger updates, task graph progress events, app events | `tests/task-ledger.test.js`, `tests/task-orchestrator.test.js`, `tests/task-registry.test.js`, `tests/tasks-route.test.js` | Task Ledger is the durable source, but orchestration, plugin tasks, cron and board UI each still own execution details. |
| Channel | `lib/channels/`, `hub/channel-router.js` | Channel Markdown files, per-agent channel membership/read position | `server/routes/channels.js`, channel tools, channel router | `/api/channels`, channel page, channel store | channel WebSocket messages, channel activity events | `tests/channels-route.test.js`, `lib/channels/TDD.md` mapped tests | Channel file contract is clear; bridge group protocol is intentionally outside this module. |
| Plugin | `core/plugin-manager.js`, `packages/plugin-*`, `server/routes/plugins.js` | plugin directories, install records, plugin config store | plugin install/update routes, plugin runtime registration, marketplace/settings UI | plugin manager projections, plugin UI host, plugin routes | plugin task events, plugin UI events, route registry | `tests/plugin-*.test.js`, package tests | Plugin capabilities cross tools, routes, UI, providers and background tasks; each capability needs explicit ownership. |

## Cross-Layer Surfaces

| Surface | Owner | Contract | Risk to Watch |
| --- | --- | --- | --- |
| App events | `server/app-events.js`, `desktop/src/react/services/app-event-actions.ts` | Server emits named app events; desktop invalidates caches and refreshes focused state. | Event payloads are stringly typed and can silently drift. |
| Chat WebSocket | `server/routes/chat.js`, `desktop/src/react/services/ws-message-handler.ts` | Stream events must carry enough identity to route to the right session or channel. | Focus fallback can leak events into the visible session if `sessionPath` is missing. |
| Provider compatibility | `core/provider-compat.js`, `core/provider-compat/*` | All provider-specific outbound payload fixes go through one dispatcher. | This is a good boundary; preserve it and avoid route-level provider patches. |
| Config scope split | `shared/config-scope.js`, `server/routes/config.js`, `server/routes/agents.js` | Global fields and agent fields are split before persistence. | Providers are special-cased as global added-models config, which makes local CLI workspace semantics less obvious. |
| Runtime home | `shared/agentry-runtime-paths.js`, `desktop/main.cjs`, `server/index.js`, `scripts/launch.js` | `AGENTRY_HOME` / compatibility `HANA_HOME` define the data root. | Bridge/server/desktop must read the same home or provider/workspace changes have no runtime effect. |

## Established Good Boundaries

| Boundary | Evidence | Keep This Discipline |
| --- | --- | --- |
| Provider payload compatibility | `core/provider-compat.js`, `core/provider-compat/README.md` | Provider-specific request quirks stay in submodules behind `normalizeProviderPayload()`. |
| Provider settings projection | `core/provider-settings-service.js` | Config, agent config and provider summary route shapes go through one provider settings service. |
| Provider model discovery | `core/provider-model-discovery-service.js` | Remote catalog fetch, registry/default fallback, capability inference and discovered-model cache stay behind one service. |
| Workspace root approval | `core/workspace-service.js` | Explicit agent home folders and Desk/Workspace approved root lists stay behind one service. |
| Local CLI bridge runtime config | `lib/bridge/local-cli-runtime-config.js` | Model backend routing, local CLI provider IDs and CLI workspace authorization config are shared runtime rules, not script-local helpers. |
| Channel file contract | `lib/channels/EARS.md`, `lib/channels/BDD.md`, `lib/channels/TDD.md` | Channel Markdown persistence and member validation stay under `lib/channels/`. |
| Task orchestration contract | `lib/task-orchestration/EARS.md`, `desktop/src/react/components/tasks/EARS.md` | Durable task data stays in Task Ledger; board UI owns presentation and local board interactions. |
| Spec placement | `docs/specs/AUTHORING.md` | Cross-layer features live under `docs/specs/features/`; module-owned behavior gets colocated EARS/BDD/TDD. |

## P1 Candidates From This Map

| Priority | Candidate | Why |
| --- | --- | --- |
| P1 | Provider / Model / Workspace service boundary | The same capability crosses settings UI, config routes, provider registry, model sync and local CLI bridge. |
| P1 | Explicit identity enforcement | Several back-end paths still tolerate focus-derived `currentAgentId` / `currentSessionPath`; multi-agent and multi-session behavior needs explicit identity. |
| P1 | Typed app-event contract | Frontend cache invalidation and refresh behavior depends on string events and ad hoc payload shapes. |
| P2 | Bridge runtime module split | `scripts/agentry-bridge/server.mjs` should become a thin process entry over testable routing/workspace/session modules. |
| P2 | Engine facade thinning | Keep `AgentryEngine` as compatibility facade, but move new domain behavior behind services with owned tests. |

## Update Rule

When a change moves ownership, storage, event names, route contracts, or test responsibility for any domain above, update this file in the same change.
