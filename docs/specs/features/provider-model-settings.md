# 供应商与模型设置

Status: draft
Last updated: 2026-05-26

## Scope

本规格覆盖 provider 注册、API key/base URL/OAuth 状态、模型发现、模型缓存、Agent 配置缓存刷新、媒体能力和设置页展示。它不覆盖具体模型调用 payload 的完整兼容层。

## Code Map

| Area | Path |
| --- | --- |
| Core | `core/provider-registry.js`, `core/provider-auth-migration.js` |
| Library | `lib/llm/provider-client.js`, `lib/providers/`, `lib/default-models.json`, `lib/known-models.json` |
| Server | `server/routes/providers.js`, `server/routes/models.js`, `server/routes/local-cli.js`, `server/routes/agents.js` |
| Media plugin | `plugins/image-gen/`, `plugins/image-gen/adapters/`, `plugins/image-gen/tools/` |
| Desktop | `desktop/src/react/settings/`, `desktop/src/react/settings/tabs/providers/`, `desktop/src/react/settings/tabs/media/`, `desktop/src/react/components/WelcomeScreen.tsx`, `desktop/src/react/services/app-event-actions.ts`, `desktop/src/react/utils/agent-config-cache.ts` |
| Tests | `tests/provider-*.test.js`, `tests/model-*.test.js`, `tests/agents-route.test.js`, `desktop/src/react/__tests__/settings/`, `desktop/src/react/__tests__/components/WelcomeScreen.test.tsx`, `desktop/src/react/__tests__/services/app-event-actions.test.ts` |

## Terms

| Term | Meaning |
| --- | --- |
| ProviderRegistry | 判断 provider 类型、OAuth、auth key、默认能力的权威注册表 |
| added models | 用户或迁移写入的 provider/model 配置 |
| known model | 项目维护的模型元数据与能力补充 |
| media capability | 图片、视频等输出能力，不等同普通聊天模型能力 |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-PROVIDER-001 | Ubiquitous | The system shall use ProviderRegistry as the authority for provider auth type, OAuth eligibility, auth storage key, and built-in provider visibility. | AG-BDD-PROVIDER-001 | AG-TDD-PROVIDER-001 |
| AG-EARS-PROVIDER-002 | Event-driven | When the settings page summarizes providers, the system shall surface missing credentials, missing models, OAuth login state, and config errors as explicit status fields. | AG-BDD-PROVIDER-002 | AG-TDD-PROVIDER-002 |
| AG-EARS-PROVIDER-003 | Unwanted behavior | If a provider probe, OAuth launch, model fetch, or local CLI scan fails, the system shall expose an actionable error instead of presenting a silent no-op. | AG-BDD-PROVIDER-003 | AG-TDD-PROVIDER-003 |
| AG-EARS-PROVIDER-004 | Ubiquitous | The system shall keep chat model availability and media generation capability as separate decisions, even when both are backed by the same provider. | AG-BDD-PROVIDER-004 | AG-TDD-PROVIDER-004 |
| AG-EARS-PROVIDER-005 | Event-driven | When discovered model metadata is incomplete, the system shall keep conservative defaults and shall not infer unsupported output capabilities from the model name alone. | AG-BDD-PROVIDER-005 | AG-TDD-PROVIDER-005 |
| AG-EARS-PROVIDER-006 | Event-driven | When switching to an Agent with a configured chat model, the desktop shall ask the server to apply that model directly and shall preserve the previous current model with a visible warning if the server rejects it. | AG-BDD-PROVIDER-006 | AG-TDD-PROVIDER-006 |
| AG-EARS-PROVIDER-007 | Event-driven | When an Agent config change can affect welcome-screen model selection or provider-backed model state, the system shall emit an Agent config change event and the desktop shall invalidate the matching Agent config cache before refreshing dependent state. | AG-BDD-PROVIDER-007 | AG-TDD-PROVIDER-007 |

## BDD Scenarios

```gherkin
Feature: Provider and model settings

  Scenario: Provider summary marks incomplete setup [AG-BDD-PROVIDER-001]
    Given a provider exists without API key or models
    When the settings UI requests the provider summary
    Then the provider is returned with config_status "needs_setup"
    And missing_fields names the missing inputs

  Scenario: OAuth provider reports login state [AG-BDD-PROVIDER-002]
    Given an OAuth provider is registered by ProviderRegistry
    And auth storage has credentials for the provider auth key
    When the provider summary is built
    Then the provider reports supports_oauth true
    And logged_in reflects the credential state

  Scenario: Provider verification failure is visible [AG-BDD-PROVIDER-003]
    Given a provider has an unreachable base URL or invalid key
    When the user runs verification
    Then the UI receives a failure status with a reason
    And the failure is not swallowed by the desktop shell

  Scenario: Media capability is not implied by chat visibility [AG-BDD-PROVIDER-004]
    Given a provider has a valid chat model
    But no image or video output capability is registered
    When the media settings tab lists generation providers
    Then that model is not shown as a usable media model
    And the chat model remains available for ordinary chat

  Scenario: Incomplete discovered metadata stays conservative [AG-BDD-PROVIDER-005]
    Given the provider model list returns names without capability metadata
    When models are normalized
    Then the system preserves the model as selectable for configured usage
    And does not mark image or video generation support without a positive signal

  Scenario: Agent switch applies configured model through server validation [AG-BDD-PROVIDER-006]
    Given an Agent has a configured chat model from its provider
    And the current desktop model list may contain only a local CLI model
    When the user switches to that Agent from the welcome screen
    Then the desktop posts the configured model to the server without forcing a full model list reload
    And if the server rejects the model, the previous current model remains selected and a warning toast is shown

  Scenario: Agent config changes invalidate cached welcome config [AG-BDD-PROVIDER-007]
    Given the welcome screen has cached an Agent config
    When the server saves a config change for that Agent
    Then the server emits an agent-config-changed app event
    And the desktop invalidates that Agent config cache entry
    And dependent Agent or model state is refreshed from current data
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-PROVIDER-001 | AG-EARS-PROVIDER-001, AG-BDD-PROVIDER-001 | `tests/provider-registry-crud.test.js`, `tests/model-manager-auth-storage.test.js` | registry/auth authority | `npm test -- tests/provider-registry-crud.test.js tests/model-manager-auth-storage.test.js` | needs-review |
| AG-TDD-PROVIDER-002 | AG-EARS-PROVIDER-002, AG-BDD-PROVIDER-002 | `tests/model-sync-routes.test.js`, `tests/model-sync-oauth-alias.test.js` | summary and OAuth aliasing | `npm test -- tests/model-sync-routes.test.js tests/model-sync-oauth-alias.test.js` | needs-review |
| AG-TDD-PROVIDER-003 | AG-EARS-PROVIDER-003, AG-BDD-PROVIDER-003 | `desktop/src/react/__tests__/settings/SettingsContent.test.tsx`, `desktop/src/react/__tests__/settings/MediaTab.test.tsx` | UI visible failures | `npm test -- desktop/src/react/__tests__/settings/SettingsContent.test.tsx desktop/src/react/__tests__/settings/MediaTab.test.tsx` | needs-review |
| AG-TDD-PROVIDER-004 | AG-EARS-PROVIDER-004, AG-BDD-PROVIDER-004 | `tests/provider-media-capabilities.test.js`, `tests/image-gen-provider-discovery.test.js`, `tests/image-gen-adapters.test.js`, `tests/image-gen-tool.test.js` | media capability split and image adapter selection | `npm test -- tests/provider-media-capabilities.test.js tests/image-gen-provider-discovery.test.js tests/image-gen-adapters.test.js tests/image-gen-tool.test.js` | needs-review |
| AG-TDD-PROVIDER-005 | AG-EARS-PROVIDER-005, AG-BDD-PROVIDER-005 | `tests/model-known-enrichment.test.js`, `tests/known-models.test.js` | conservative metadata enrichment | `npm test -- tests/model-known-enrichment.test.js tests/known-models.test.js` | needs-review |
| AG-TDD-PROVIDER-006 | AG-EARS-PROVIDER-006, AG-BDD-PROVIDER-006 | `desktop/src/react/__tests__/components/WelcomeScreen.test.tsx` | agent configured model application and rejection rollback | `npm test -- desktop/src/react/__tests__/components/WelcomeScreen.test.tsx` | needs-review |
| AG-TDD-PROVIDER-007 | AG-EARS-PROVIDER-007, AG-BDD-PROVIDER-007 | `tests/agents-route.test.js`, `desktop/src/react/__tests__/services/app-event-actions.test.ts` | agent config app event emission and desktop cache invalidation | `npm test -- tests/agents-route.test.js desktop/src/react/__tests__/services/app-event-actions.test.ts` | covered |

## Manual Verification

- 打开设置页的 Providers、Media、Local CLI 区域。
- 分别检查 API key provider、OAuth provider、未配置 provider、媒体 provider 的状态文案。
- 清空或伪造配置后，确认错误不会静默消失。

## Open Questions

- 是否需要把 provider probe 的错误码标准化成前端 i18n key。
- 媒体能力的“保守推断”是否需要在 UI 中解释给用户。
