# Agentry 术语库

这份术语库用于统一产品、代码、文档和日常沟通里的称呼。后续讨论 UI 问题、规格、测试或实现时，优先使用“推荐中文名”；需要定位代码时再补“代码/英文名”。

## 使用规则

- 说页面位置时，先说页面/区域，再说具体部件，例如“聊天页 / 输入区 / 任务浮窗”。
- 说业务对象时，优先说业务对象，不直接用 store 字段代替，例如说“任务看板”，不要只说 `activeTaskBoardId`。
- 代码名只用于补充定位，不作为对用户展示的文案。
- 如果新增概念、页面区域或状态字段，先补本文件，再在对应 EARS / BDD / TDD 中复用同一称呼。

## 产品与业务概念

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| Agentry | `Agentry` | 这个桌面 Agent 工作台产品本身。 | 不等同某一个 Agent。 |
| Agent | `Agent` | 一个可独立配置人格、头像、记忆、工具、模型和调度上下文的工作主体。 | 不要和模型 provider 混用。 |
| 当前 Agent | `currentAgentId` | 当前聊天、频道或任务默认归属的 Agent。 | 切换当前 Agent 不应改写旧会话历史。 |
| 元 | `yuan` | Agent 的外观/人格族群标识，例如 `hanako`。 | 是身份风格，不是 provider。 |
| 会话 | `Session` | 一次聊天或任务过程的消息历史、流式状态、附件和上下文集合。 | 不是浏览器 session，也不是任务运行。 |
| 会话路径 | `sessionPath` | 前后端定位会话归属的路径标识。 | 用于隔离流事件、附件、任务和滚动状态。 |
| 用户轮次 | `SessionUserTurn` | 会话中由用户发起的一次输入，用于内容导航。 | 不等同所有消息；assistant/tool 消息不是用户轮次。 |
| 工作区 | `workspace`, `cwd`, `deskBasePath` | 当前会话、书桌、任务或工具运行绑定的本地目录。 | 不等同应用窗口，也不等同项目看板。 |
| 书桌 | `Desk` | 右侧工作区里浏览和编辑本地文件的能力。 | 书桌是文件工作区视图，不是聊天输入区。 |
| 笺 | `Jian` | 右侧工作区中的可编辑巡检/便签文本。 | “笺侧栏”是右侧整体入口，“笺抽屉”是工作区卡片里的折叠编辑区域。 |
| 频道 | `Channel` | 多 Agent 协作的群聊式本地对话空间。 | 频道消息持久化到 channel file，不是普通会话消息。 |
| 私聊 | `DM` | 用户和单个 Agent 的频道式直接对话。 | UI 属于频道页，但成员和写入规则不同。 |
| 桥接 | `Bridge` | 连接外部聊天平台或远端消息入口的能力。 | 桥接面板是控制台；外部平台消息不等同本地频道消息。 |
| 供应商 | `Provider` | 模型或媒体能力的服务来源，例如 OpenAI 兼容、Anthropic、Ollama。 | Provider 决定鉴权/发现方式，不直接等于模型。 |
| 模型 | `Model` | 可被选择用于聊天、工具、视觉或媒体任务的具体模型配置。 | 聊天模型能力和媒体生成能力必须分开说。 |
| 插件 | `Plugin` | 可贡献工具、页面、侧栏 widget、路由、provider 或后台任务的扩展。 | 插件页面和插件 widget 是两种 UI 宿主。 |

## 应用外壳与导航

| 推荐中文名 | 代码/英文名 | 位置/职责 | 沟通示例 |
| --- | --- | --- | --- |
| 应用外壳 | `App`, app shell | titlebar、左侧栏、主内容区、右侧工作区和全局 overlay 的总布局。 | “应用外壳的左右栏宽度冲突”。 |
| 标题栏 | `.titlebar` | 顶部窗口栏，放左右栏开关、频道标签、插件按钮和窗口控制。 | “标题栏右侧的笺按钮”。 |
| 左侧栏 | `sidebar`, `#sidebar` | 左侧主导航和列表区域。 | “左侧栏折叠后会话列表隐藏”。 |
| 侧栏内容页 | `sidebar-chat-content`, `sidebar-channel-content`, `sidebar-board-content` | 左侧栏内部随当前 tab 切换的内容。 | “看板 tab 的侧栏内容页”。 |
| 频道标签栏 | `ChannelTabBar` | 标题栏中的主 tab 入口：聊天、频道、看板、插件页。 | “频道标签栏切到看板页”。 |
| 主内容区 | `MainContent`, `.main-content` | 当前主页面的承载区。 | “主内容区右侧留给浮窗的空白 lane”。 |
| 当前页签 | `currentTab` | 当前激活的主页面：`chat`、`channels`、`boards`、`plugin:<id>`。 | “currentTab 为 boards 时右侧 rail 换成任务详情”。 |
| 全局浮层 | overlay | 独立覆盖在应用外壳之上的界面，例如设置、媒体查看、技能查看、选中文本输入。 | “这是全局浮层，不应该影响主内容区布局”。 |

## 聊天页区域

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| 聊天页 | `ChatPage` | `currentTab === 'chat'` 时的主页面，包含聊天区和输入区。 | 不包含右侧预览面板和右侧工作区。 |
| 欢迎页 | `WelcomeScreen` | 尚未进入具体会话时的空态/引导界面。 | 不是聊天消息空态。 |
| 聊天区 | `ChatArea`, `.chat-area` | 聊天消息滚动区的组件入口。 | 不要用“主区”泛指。 |
| 会话面板 | `sessionPanel`, `[data-chat-scroll-panel]` | 当前会话的原生滚动容器。 | 滚动问题通常定位到这里。 |
| 会话消息列 | `sessionMessages`, `[data-chat-content-column]` | 消息实际排布的内容列。 | 右侧浮窗会根据它计算空白 lane。 |
| 聊天记录 | `ChatTranscript` | 渲染用户、assistant、tool、插件卡片等消息块的列表。 | 不负责滚动容器。 |
| 内容导航浮窗 | `ChatTimelineNavigator`, `[data-chat-timeline-navigator="side"]` | 右侧空白 lane 中按用户轮次生成的跳转导航。 | 也可简称“内容导航”；不要叫“滚动条”。 |
| 回到底部按钮 | `ScrollToBottomBtn`, `scrollToBottomFab` | 用户上滑离底部后出现的回到底部按钮。 | 不等同内容导航浮窗。 |
| 输入区 | `InputArea`, `.input-area` | 聊天页底部的输入整体区域。 | 包含输入卡片、任务浮窗、状态条、确认卡。 |
| 输入卡片 | `input-wrapper`, `[data-input-wrapper]` | 真正包住编辑器和控制栏的卡片。 | 截图里的“输入的浮窗”通常指这里。 |
| 输入面 | `input-surface`, `[data-input-surface]` | 输入区的定位外壳，用于挂状态条、确认卡和任务浮窗。 | 定位问题常需要区分输入面和输入卡片。 |
| 输入编辑器 | TipTap editor | 用户输入正文的富文本编辑器。 | 不包含模型选择、发送按钮、附件栏。 |
| 输入上下文行 | `InputContextRow` | 输入卡片上方/内部用于展示文件、技能、引用、任务等上下文的行。 | 任务浮窗由其中的 `TodoDisplay` 负责。 |
| 输入控制栏 | `InputControlBar` | 模型、思考强度、权限模式、发送等控制按钮区域。 | 不包含正文编辑器。 |
| 输入状态条 | `InputStatusBars` | 显示错误、截图进度、slash 执行结果等临时状态。 | 不等同 toast。 |
| 任务浮窗 | `TodoDisplay`, `todo-bar-side` | 当前会话 Todo 列表的右侧浮动展示。 | 和看板页/项目看板不是一回事。 |
| 输入确认卡 | `SessionConfirmationPrompt` | 工具或电脑控制等需要用户确认时，贴着输入区出现的确认卡。 | 不要叫 toast 或 modal。 |

## 右侧区域与文件预览

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| 右侧伴随栏 | `WorkspaceCompanionRail` | 主内容区右侧的持久 companion rail 容器，承载笺侧栏或任务详情。 | 是右侧结构总称。 |
| 笺侧栏 | `jian-sidebar`, `#jianSidebar` | 可折叠的右侧栏，聊天/频道下显示右侧工作区，看板页下显示任务右栏。 | 不等同“笺抽屉”。 |
| 右侧工作区 | `RightWorkspacePanel` | 笺侧栏内的文件/会话文件/插件 widget 工作区。 | 当看板页激活时会被 `TaskRightRail` 替换。 |
| 工作区卡片 | `workspaceCard`, `[data-right-workspace-card]` | 右侧工作区内部的主卡片外壳。 | 包含 tabs、内容区和笺抽屉。 |
| 工作区标签 | `RightWorkspaceTab` | 右侧工作区的 tab：`session-files`、`workspace`、`plugin-widget:<id>`。 | 不等同顶部主 tab。 |
| 会话文件页 | `session-files` | 右侧工作区中展示当前会话登记文件的 tab。 | 不是预览面板。 |
| 工作区文件页 | `workspace` | 右侧工作区中展示书桌目录树和文件操作的 tab。 | 不是本地项目根目录本身。 |
| 笺抽屉 | `JianDrawer` | 工作区卡片底部可展开/收起的笺编辑区域。 | 这是卡片内区域，不是整条右侧栏。 |
| 预览面板 | `PreviewPanel`, `#previewPanel` | 聊天页右侧的文件/产物预览与编辑面板。 | 不在 `jianSidebar` 内。 |
| 预览项 | `PreviewItem` | 前端预览池中的一个文件、代码、Markdown、媒体或插件产物快照。 | `content` 是视图快照；有 `filePath` 时文件系统是源。 |
| 预览标签栏 | `TabBar` | 预览面板顶部的多标签切换。 | 不等同主 tab。 |
| 预览正文 | `previewBody`, `PreviewRenderer`, `PreviewEditor` | 预览面板内展示或编辑内容的区域。 | 编辑模式只适用于可编辑文件类型。 |
| 预览浮动操作 | `FloatingActions` | 预览面板内复制、Markdown 预览切换等悬浮操作。 | 不等同全局浮层。 |
| 侧栏预览卡 | `FloatPreviewCard` | 鼠标悬停左右栏开关时出现的轻量预览卡。 | 不要和 `PreviewPanel` 混用。 |

## 频道页区域

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| 频道页 | `ChannelPage` | `currentTab === 'channels'` 时的主页面。 | 频道列表在左侧栏，消息在主内容区。 |
| 频道列表 | `ChannelListSidebar` | 左侧栏里展示频道和私聊入口的列表。 | 不在主内容区。 |
| 频道标题 | `ChannelHeader` | 当前频道顶部信息栏。 | 不包含成员详情。 |
| 频道消息区 | `ChannelMessages`, `.channel-messages` | 当前频道消息滚动区。 | 不使用普通会话的 `sessionPanel`。 |
| 频道输入区 | `ChannelInput` | 非私聊频道的消息输入区。 | 私聊可能显示只读提示。 |
| 频道检查栏 | `ChannelInspectorPanel`, `channel-inspector-rail` | 频道页右侧成员、Agent 设置和活动信息栏。 | 不等同笺侧栏。 |
| 频道成员 | `ChannelMembers` | 当前频道或私聊的成员列表。 | Agent 成员和用户显示名要分开。 |
| Agent 手机动态 | `ChannelAgentActivityPanel`, `AgentPhoneActivity` | Agent 在频道/私聊内的阅读、回复、工具使用状态。 | 是协作可视状态，不是系统日志。 |

## 看板页与任务对象

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| 看板页 | `TaskPage` | `currentTab === 'boards'` 时的主页面，顶部 tab 显示为「看板」。 | 和聊天页输入区的任务浮窗不同。 |
| 看板侧栏 | `TaskSidebar` | 左侧栏中看板 tab 的项目看板列表与新建看板入口。 | 不等同任务右栏；不再包含项目组创建入口。 |
| 任务右栏 | `TaskRightRail` | 看板页激活时替换右侧工作区的详情/辅助栏。 | 位于 `jianSidebar` 容器内。 |
| 项目看板 | `TaskBoard` | 按项目/上下文组织任务的轻量看板，可配置主 agent 与协作 agent。 | 不等同一次任务运行，也不等同旧项目组。 |
| 默认看板 | `default-board` | 没有显式项目看板时的默认任务看板。 | 不能把它当作唯一业务项目。 |
| 任务台账 | `TaskLedger` | 本地可追踪任务记录的源，包括状态、来源、负责人、评论、产物。 | 是数据源，不是 UI 卡片。 |
| 台账任务 | `TaskLedgerTask` | 任务台账中的单个任务记录。 | 可以没有自动编排运行。 |
| 任务状态 | `TaskLedgerStatus` | 台账任务的看板状态：待整理、待办、就绪、运行中、阻塞、待验收、完成等。 | 不等同任务图节点状态。 |
| 任务运行 | `TaskRun` | 一次任务图执行，通常挂在台账任务下。 | 一条任务可以有多个运行。 |
| 任务图 | task graph | 由节点和边组成的执行计划或执行结果。 | 不等同看板。 |
| 任务节点 | `TaskGraphNode` | 任务图里由某个 Agent 执行的单个工作节点。 | 节点状态只描述执行生命周期。 |
| 任务边 | `TaskGraphEdge` | 任务节点之间的依赖关系。 | 不表示 UI 连线本身。 |
| 任务事件 | `TaskGraphEvent` | 任务或运行的状态变化记录。 | 不等同 Agent 手机动态。 |
| 任务产物 | `Artifact` | 任务节点或运行产生的文件、摘要或可展示输出。 | 可能进入预览面板，但不是预览项本身。 |
| Subagent 实时卡片 | `SubagentCard` | 聊天记录中展示子 Agent 任务进度的卡片。 | 不是看板页卡片。 |

## 浮层、面板与临时反馈

| 推荐中文名 | 代码/英文名 | 定义 | 易混点 |
| --- | --- | --- | --- |
| 活动面板 | `ActivityPanel` | 左侧栏活动入口打开的全局浮动面板。 | 是 `activePanel` 的一种。 |
| 自动化面板 | `AutomationPanel` | 定时任务/自动化入口打开的全局浮动面板。 | 不等同后台 task registry。 |
| 桥接面板 | `BridgePanel` | 外部平台桥接状态和配置相关面板。 | 不是频道页。 |
| 设置弹窗 | `SettingsModalShell` | 应用内设置 modal。 | 不要叫页面，除非讨论设置内容页。 |
| 技能查看浮层 | `SkillViewerOverlay` | 查看 skill 内容的只读浮层。 | 不等同预览面板。 |
| 媒体查看器 | `MediaViewer` | 查看图片/视频的全局媒体浮层。 | 不是预览面板 renderer。 |
| 选中文本输入浮窗 | `SelectionFloatingInput` | 选中文本后出现的浮动输入入口。 | 不等同底部输入区。 |
| Toast | `ToastContainer` | 临时轻提示。 | 不承载需要决策的确认。 |
| 区域错误边界 | `RegionalErrorBoundary` | 包住局部区域的错误隔离层。 | 不应作为用户可见页面名称。 |

## 状态与数据归属

| 推荐中文名 | 代码/英文名 | 定义 | 归属原则 |
| --- | --- | --- | --- |
| 流事件 | stream event | 服务端通过 WebSocket 发给前端的增量事件。 | 必须携带足够信息归属到正确会话或频道。 |
| 消息块 | `ContentBlock` | assistant 消息内的 text、thinking、tool、plugin card、subagent 等结构块。 | 不要把所有块都当普通 Markdown。 |
| 工具调用 | `ToolCall` | 模型/Agent 发起工具执行的记录。 | 和用户确认卡是不同对象。 |
| 附件引用 | `FileRef` | 当前会话或输入中引用的文件对象。 | 需要区分来源：上传、会话文件、预览产物等。 |
| 书桌文件 | `DeskFile` | 工作区文件浏览里的文件/目录条目。 | 不等同 `PreviewItem`。 |
| 选中文本引用 | `QuotedSelection` | 从预览或页面中捕获、准备发送到输入区的文本片段。 | 和输入正文分开管理。 |
| 权限模式 | `PermissionMode` | 本轮会话对本地/外部操作的批准方式。 | 不等同系统权限或 provider 鉴权。 |
| 思考强度 | `ThinkingLevel` | 模型推理强度选择。 | 不代表模型能力本身。 |
| 媒体能力 | media capability | 图片/视频输入或输出支持。 | 必须和普通聊天模型能力分开判断。 |

## 沟通时优先说法

| 如果想说 | 优先说 | 避免说 |
| --- | --- | --- |
| 截图右侧那条跳转消息的浮窗 | 内容导航浮窗 | 右边的滚动条 |
| 截图里 TodoWrite 任务列表 | 任务浮窗 | 看板页、项目看板 |
| 底部用户输入的整块区域 | 输入区 | 输入框 |
| 真正包住编辑器和按钮的卡片 | 输入卡片 | 输入浮窗 |
| 右侧文件/笺区域整体 | 右侧工作区或笺侧栏 | 右边面板 |
| 右侧代码/Markdown 预览编辑区域 | 预览面板 | 右侧工作区 |
| 频道页右侧成员和 Agent 状态栏 | 频道检查栏 | 笺侧栏 |
| 看板页右侧详情区域 | 任务右栏 | 右侧工作区 |
| 本地任务记录集合 | 任务台账 | task 列表 |
| 一次自动分解执行 | 任务运行或任务图 | 任务看板 |

## 术语变更流程

1. 发现新概念或命名歧义时，先在本文件新增或修正术语。
2. 如果术语影响功能边界，同步对应 `docs/specs/features/*.md` 的 `Terms`。
3. 如果术语影响具体模块，更新模块本地 `EARS.md` / `BDD.md` / `TDD.md`。
4. 如果术语影响用户可见文案，再更新 locale 和组件文本。
