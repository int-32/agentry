/**
 * Local CLI Agent 路由（agentry 独家扩展）
 *
 * GET    /api/local-cli/scan          — 扫 PATH，返三家 CLI 之安装状态
 * GET    /api/local-cli/:id/models    — 返某 CLI 之模型清单（从 known-models.json）
 *
 * 与"云端 LLM 供应商"路由（providers.js）相对：本路由仅处理本机已装 agent CLI。
 */

import { Hono } from "hono";
import { scanAllAgentCliS, getModelsForCli, KNOWN_AGENT_CLIS } from "../../lib/local-cli/detector.js";

export function createLocalCliRoute() {
  const route = new Hono();

  route.get("/local-cli/scan", async (c) => {
    try {
      const cliS = await scanAllAgentCliS();
      return c.json({ ok: true, clis: cliS });
    } catch (err) {
      return c.json({ ok: false, error: String(err?.message || err) }, 500);
    }
  });

  route.get("/local-cli/:id/models", (c) => {
    const id = c.req.param("id");
    if (!KNOWN_AGENT_CLIS.find(x => x.id === id)) {
      return c.json({ error: `unknown cli id: ${id}` }, 404);
    }
    const models = getModelsForCli(id);
    return c.json({ ok: true, cliId: id, models });
  });

  return route;
}
