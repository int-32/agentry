# TDD and Verification Strategy

TDD 在这个项目里不是要求每个提交都严格先写测试，而是要求每个行为变更有可追踪的验证入口。高风险逻辑应先补或先定位测试，再改实现。

## 常用命令

| 场景 | 命令 |
| --- | --- |
| 运行全部测试 | `npm test` |
| 运行单个核心/服务测试 | `npm test -- tests/<file>.test.js` |
| 运行单个前端测试 | `npm test -- desktop/src/react/__tests__/<file>.test.tsx` |
| 类型检查 | `npm run typecheck` |
| 启动开发 Electron | `npm start` |
| Vite HMR 前端开发 | `npm run dev:renderer` + `npm run start:vite` |

## 测试位置

| 代码面 | 默认测试位置 |
| --- | --- |
| `core/` | `tests/*engine*`, `tests/*session*`, `tests/*agent*` |
| `lib/` | `tests/<module>.test.js` |
| `server/routes/` | `tests/*route*.test.js` |
| `desktop/src/react/components/` | `desktop/src/react/__tests__/components/` |
| `desktop/src/react/settings/` | `desktop/src/react/__tests__/settings/` 或组件同层 `__tests__` |
| `desktop/src/react/stores/` | `desktop/src/react/__tests__/stores/` 或现有 store 测试 |
| `plugins/` | `tests/plugin-*.test.js` 或插件专属测试 |

## 规格到测试的映射

每个 feature 规格里的 TDD 表应包含：

| 字段 | 说明 |
| --- | --- |
| `Spec ID` | 关联的 EARS/BDD ID |
| `Test file` | 测试文件路径 |
| `Coverage` | 该测试覆盖成功路径、失败路径、边界路径还是回归路径 |
| `Command` | 最小验证命令 |
| `Status` | `planned`、`covered`、`manual-only`、`needs-review` |

## 何时必须补测试

- 修复会话、Agent、工作区、频道、桥接、权限或 provider 路由错误。
- 改动跨层协议，例如 WebSocket 消息、REST 响应、插件贡献、模型能力字段。
- 改动文件持久化、迁移、缓存、锁或并发控制。
- 改动前端状态归属、会话切换、设置保存、国际化文案。
- 修复一次用户可复现 bug，且以后可能回归。

## 何时可以只做手动验证

- 纯文档修改。
- 视觉微调且已有快照或结构测试收益不高。
- 外部平台登录、桥接上传、真实 OAuth 等无法稳定自动化的路径。

即使只做手动验证，也应在 feature 规格里写明操作入口、预期结果和残余风险。
