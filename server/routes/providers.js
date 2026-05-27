/**
 * 供应商管理 REST 路由
 */
import { Hono } from "hono";
import { emitAppEvent } from "../app-events.js";
import { safeJson } from "../hono-helpers.js";
import { probeProvider } from "../../lib/llm/provider-client.js";
import { clearConfigCache } from "../../lib/memory/config-loader.js";
import { createProviderSettingsService } from "../../core/provider-settings-service.js";
import { createProviderModelDiscoveryService } from "../../core/provider-model-discovery-service.js";

export function createProvidersRoute(engine) {
  const route = new Hono();
  const providerSettings = createProviderSettingsService(engine);
  const modelDiscovery = createProviderModelDiscoveryService(engine, providerSettings);

  // ── Provider Summary ──

  /**
   * 统一概览：合并 added-models.yaml + OAuth status + SDK 模型
   * 前端新 ProvidersTab 的核心数据源
   */
  route.get("/providers/summary", async (c) => {
    return c.json({ providers: providerSettings.getProviderSummary() });
  });

  // ── Fetch / Test ──

  async function refreshProviderModels() {
    clearConfigCache();
    await engine.onProviderChanged();
    emitAppEvent(engine, "models-changed", { agentId: engine.currentAgentId || null });
  }

  /**
   * 从供应商拉取模型列表
   * 统一瀑布流：凭证解析 → 远程 list models → registry fallback → defaults fallback
   *
   * 远程端点按协议分岔：
   *   - anthropic-messages → GET {base}/v1/models?limit=1000（Anthropic Messages API）
   *   - 其他（openai-completions 等）→ GET {base}/models
   *
   * body: { name, base_url?, api?, api_key? }
   */
  route.post("/providers/fetch-models", async (c) => {
    const result = await modelDiscovery.fetchModels(await safeJson(c));
    return c.json(result.body, result.status);
  });

  /**
   * 读取供应商已发现但尚未添加的模型（缓存）
   * GET /api/providers/:name/discovered-models
   */
  route.get("/providers/:name/discovered-models", (c) => {
    return c.json(modelDiscovery.getCachedDiscoveredModels(c.req.param("name")));
  });

  /**
   * 测试供应商连接
   * body: { name?, base_url?, api?, api_key? }
   * 凭证解析优先级与 fetch-models 一致：请求体 > resolveProviderCredentials > 插件默认值
   */
  route.post("/providers/test", async (c) => {
    const body = await safeJson(c);
    const { name } = body;
    // 清洗 API key：去除非 ASCII 字符（防止粘贴时输入法带入中文）
    const bodyKey = (body.api_key || "").replace(/[^\x20-\x7E]/g, "").trim();

    // ── 凭证解析：请求体 > resolveProviderCredentials（统一路径） ──
    const saved = name ? providerSettings.resolveProviderCredentials(name) : { api_key: "", base_url: "", api: "" };

    const api_key = bodyKey || saved.api_key || "";
    const base_url = body.base_url || saved.base_url || "";
    const api = body.api || saved.api || "";

    if (!base_url) {
      return c.json({ error: "base_url is required" }, 400);
    }
    if (api_key && !api) {
      return c.json({ error: "api is required when api_key is present" }, 400);
    }

    try {
      const result = await probeProvider({ baseUrl: base_url, api, apiKey: api_key });
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: err.message });
    }
  });

  /**
   * 更新模型元数据（context/image/video/reasoning/maxOutput/name）
   * 写回 added-models.yaml → 触发 model-sync → SDK 模型对象更新
   */
  route.put("/providers/:name/models/:modelId", async (c) => {
    const providerName = c.req.param("name");
    const modelId = c.req.param("modelId");
    const body = await safeJson(c);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid body" }, 400);
    }
    try {
      engine.providerRegistry.updateModelEntry(providerName, modelId, body);
      await refreshProviderModels();
      return c.json({ ok: true });
    } catch (err) {
      const status = err.message?.includes("not found") ? 404 : 500;
      return c.json({ error: err.message }, status);
    }
  });

  /**
   * 删除模型配置
   * 从 added-models.yaml 移除指定模型 → 触发 model-sync
   */
  route.delete("/providers/:name/models/:modelId", async (c) => {
    const providerName = c.req.param("name");
    const modelId = c.req.param("modelId");
    try {
      engine.providerRegistry.removeModel(providerName, modelId);
      await refreshProviderModels();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}
