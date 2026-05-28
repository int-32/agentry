# 项目登记与频道关联

Status: draft
Last updated: 2026-05-28

## Scope

本规格覆盖用户在设置中维护本地项目登记、服务端通过 `/api/projects` 暴露增删改查、项目变更事件同步，以及创建频道时把某个项目作为上下文快照写入频道元数据。它不覆盖任务看板的执行流、workspace 授权策略、频道成员路由规则或外部项目管理系统。

## Code Map

| Area | Path |
| --- | --- |
| Local EARS | `lib/projects/EARS.md` |
| Local BDD | `lib/projects/BDD.md` |
| Local TDD | `lib/projects/TDD.md` |
| Registry library | `lib/projects/project-registry.js` |
| Server routes | `server/routes/projects.js`, `server/routes/channels.js` |
| Server wiring | `server/index.js`, `shared/app-events.js` |
| Desktop settings | `desktop/src/react/settings/tabs/ProjectsTab.tsx`, `desktop/src/react/settings/SettingsContent.tsx`, `desktop/src/react/settings/SettingsNav.tsx` |
| Channel UI | `desktop/src/react/components/channels/ChannelCreateOverlay.tsx`, `desktop/src/react/components/channels/ChannelHeader.tsx`, `desktop/src/react/stores/channel-actions.ts`, `desktop/src/react/types.ts` |
| Tests | `tests/projects-route.test.js`, `tests/channels-route.test.js` |

## Terms

| Term | Meaning |
| --- | --- |
| Project registry | 用户维护的本地项目清单，持久化在 Agentry user data 目录下。 |
| Project entry | 单个项目登记项，包含名称、工作区根目录、文档目录、测试命令、描述和模块列表。 |
| Project snapshot | 频道创建时复制到频道 frontmatter 的项目元数据；后续项目登记变化不自动改写既有频道文件。 |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-PROJECT-001 | Ubiquitous | The system shall persist user project registry entries in a local JSON file under the Agentry user data directory. | AG-BDD-PROJECT-001 | AG-TDD-PROJECT-001 |
| AG-EARS-PROJECT-002 | Unwanted behavior | If a project name or workspace root is missing, or if workspace/docs roots are not absolute existing directories, the system shall reject the write with an explicit error and shall not create a partial project. | AG-BDD-PROJECT-002 | AG-TDD-PROJECT-002 |
| AG-EARS-PROJECT-003 | Event-driven | When a project is created, updated, or deleted through the API, the system shall emit a `projects-changed` app event carrying the affected project id. | AG-BDD-PROJECT-003 | AG-TDD-PROJECT-003 |
| AG-EARS-PROJECT-004 | Event-driven | When a channel is created with a project id, the channel shall store a snapshot of the project metadata and later expose that snapshot with the channel record. | AG-BDD-PROJECT-004, AG-BDD-CHANNEL-006 | AG-TDD-PROJECT-004, AG-TDD-CHANNEL-006 |

## BDD Scenarios

```gherkin
Feature: Project registry and channel association

  Scenario: Create and list a project registry entry [AG-BDD-PROJECT-001]
    Given the user data directory is available
    And the caller provides a project name, workspace root, docs root, test command, description, and modules
    When the project is created
    Then the registry stores a project with a stable prj_ id
    And listing projects returns the saved entry sorted by recent update time

  Scenario: Reject invalid project roots [AG-BDD-PROJECT-002]
    Given the caller provides a missing name or an invalid workspace/docs root
    When the project registry validates the input
    Then the write fails with an explicit validation error
    And no partial project entry is persisted

  Scenario: Project API writes emit app events [AG-BDD-PROJECT-003]
    Given a project entry is created, updated, or deleted through the API
    When the write succeeds
    Then the server emits a projects-changed app event
    And the payload includes the affected project id

  Scenario: Channel creation snapshots a selected project [AG-BDD-PROJECT-004]
    Given a project exists in the registry
    When the user creates a channel with that project id
    Then the channel frontmatter stores the project id and metadata snapshot
    And later channel list/read responses expose the linked project information
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-PROJECT-001 | AG-EARS-PROJECT-001, AG-BDD-PROJECT-001 | `tests/projects-route.test.js` | create/list/update/delete project registry entries and JSON-backed projections | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-002 | AG-EARS-PROJECT-002, AG-BDD-PROJECT-002 | `tests/projects-route.test.js` | missing name and invalid workspace/docs root rejection | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-003 | AG-EARS-PROJECT-003, AG-BDD-PROJECT-003 | `tests/projects-route.test.js` | `projects-changed` app event emission on successful writes | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-004 | AG-EARS-PROJECT-004, AG-BDD-PROJECT-004, AG-BDD-CHANNEL-006 | `tests/channels-route.test.js` | channel creation with project id and project snapshot exposure | `npm test -- tests/channels-route.test.js` | needs-review |

## Manual Verification

- 打开设置中的「项目」tab，新增一个项目，确认工作区目录和文档目录只能选择本地目录。
- 修改项目名称或测试命令，确认列表刷新后显示最新内容。
- 创建频道时选择该项目，确认频道头部显示关联项目名称。
- 读取频道详情或频道列表，确认返回的 `project` 字段包含创建时的项目快照。

## Open Questions

- 既有频道关联的是项目快照还是项目 id 动态投影；当前实现采用快照，若未来需要动态投影应另行确认迁移规则。
