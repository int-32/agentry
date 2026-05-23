# 工作区快速定向记录（2026-05-19 18:00）

本轮心跳发现工作区出现完整 Agentry 项目文件，做了一次轻量定向，避免之后重复摸索。

## 项目概貌

- 项目名：`agentry`
- 当前版本：`0.198.4`
- 定位：有记忆、有人格、支持多 Agent 与插件生态的私人 AI 助理。
- 运行形态：Electron 桌面端 + Node/Hono 服务端 + React/Vite 前端。
- Node 要求：`>=20`
- Workspace：`packages/*`

## 常用脚本

- `npm run start:dev`：开发模式启动 Electron。
- `npm run start:vite`：Vite 相关启动路径。
- `npm run typecheck`：TypeScript 类型检查。
- `npm run test`：运行 Vitest，排除构建产物目录。
- `npm run lint`：运行 ESLint。
- `npm run build:client`：构建 main、preload、renderer、theme。
- `npm run build:server`：构建服务端。

## 插件开发要点

- 社区插件可通过 `tools/hello.js` 这类工具文件起步。
- 推荐用 `hana-plugin-creator` 脚手架生成插件雏形。
- Agent 辅助开发插件时，优先走 dev loop：源码留在工作区或 plugin-dev-sources，通过 dev install/reload 测试，不直接污染正式插件目录。
- full-access dev 插件需要显式授权 `allowFullAccess: true`。

## 后续若用户询问项目

可优先查阅：

1. `README.md`：产品定位、功能特性、快速开始。
2. `PLUGINS.md`：插件开发规范与 dev loop。
3. `package.json`：脚本、依赖、构建入口。
4. `PLUGIN_SDK.md` / `docs/`：更细的 SDK 与文档。
