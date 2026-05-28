# BDD Scenarios

BDD 用来记录“用户、Agent、外部平台或系统操作者能观察到什么”。它应当比 EARS 更接近交互和验收，但仍然不绑定具体函数名。

## 场景格式

优先使用 Gherkin：

```gherkin
Feature: <功能名>

  Rule: <业务规则>

    Scenario: <场景标题> [AG-BDD-XXX-001]
      Given <前置条件>
      When <触发动作>
      Then <可观察结果>
      And <额外结果>
```

如果一个行为需要表格，可以使用决策表。不要只写 happy path；每个 feature 至少应覆盖一个失败路径或边界路径。

## 场景粒度

一个 BDD 场景应满足：

- 能被产品、实现和测试共同读懂。
- 不要求读者知道内部类名。
- 有清楚的输入、动作、输出。
- 可以映射到测试文件或手动验证步骤。

## Feature 索引

| Feature | 规格文件 | 主要代码面 |
| --- | --- | --- |
| Agent 会话上下文 | [agent-session-context.md](./features/agent-session-context.md) | `core/`, `server/routes/chat.js`, `server/routes/sessions.js`, `desktop/src/react/stores/`, `desktop/src/react/services/` |
| 供应商与模型设置 | [provider-model-settings.md](./features/provider-model-settings.md) | `core/provider-registry.js`, `server/routes/providers.js`, `server/routes/agents.js`, `desktop/src/react/settings/`, `desktop/src/react/services/app-event-actions.ts` |
| 频道与多 Agent 协作 | [channels-and-agent-collaboration.md](./features/channels-and-agent-collaboration.md) | `lib/channels/`, `hub/channel-router.js`, `server/routes/channels.js`, `desktop/src/react/components/channels/` |
| 任务编排图 | [task-orchestration.md](./features/task-orchestration.md) | `lib/task-orchestration/`, `lib/tools/task-orchestrate-tool.js`, `server/routes/tasks.js`, `desktop/src/react/components/tasks/` |
| 媒体生成插件 | [media-generation.md](./features/media-generation.md) | `plugins/image-gen/`, `tests/image-gen-*.test.js` |
| 项目登记与频道关联 | [project-registry.md](./features/project-registry.md) | `lib/projects/`, `server/routes/projects.js`, `server/routes/channels.js`, `desktop/src/react/settings/tabs/ProjectsTab.tsx`, `desktop/src/react/components/channels/` |
| Computer Use 本机应用控制 | [computer-use.md](./features/computer-use.md) | `core/computer-use/`, `lib/tools/computer-use-tool.js`, `server/routes/preferences.js`, `desktop/src/react/settings/tabs/ComputerUseTab.tsx` |

## 反模式

- BDD 只重复 UI 控件名字，没有表达业务状态。
- 只写“点击按钮后成功”，没有说明成功的可观察证据。
- 没有失败路径。
- 文档放在离实现太远的位置，后续修改时没人会看到。
