import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ProviderModelDiscoveryService } from "../core/provider-model-discovery-service.js";

let tempRoot;

function makeService(overrides = {}) {
  return new ProviderModelDiscoveryService({
    agentryHome: tempRoot,
    providerRegistry: {
      getAuthJsonKey: (id) => id,
      getDefaultModels: () => [],
      ...(overrides.providerRegistry || {}),
    },
    providerSettings: {
      resolveProviderCredentials: () => ({ api_key: "", base_url: "", api: "" }),
      ...(overrides.providerSettings || {}),
    },
    getRegistryModelsForProvider: overrides.getRegistryModelsForProvider || (() => []),
    fetchImpl: overrides.fetchImpl || vi.fn(),
  });
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentry-provider-discovery-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ProviderModelDiscoveryService", () => {
  it("fetches remote models, preserves capabilities, and caches results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "qwen-vl-plus", input_modalities: ["text", "image"], capabilities: { reasoning: true } },
          { id: "wan2.7-image", output_modalities: ["image"] },
        ],
      }),
    });
    const service = makeService({ fetchImpl });

    const result = await service.fetchModels({
      name: "dashscope",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api: "openai-completions",
      api_key: "sk-test",
    });

    expect(result.status).toBe(200);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    expect(result.body.models).toEqual([
      expect.objectContaining({ id: "qwen-vl-plus", image: true, reasoning: true }),
      expect.objectContaining({ id: "wan2.7-image", type: "image" }),
    ]);
    const cache = JSON.parse(fs.readFileSync(path.join(tempRoot, "models-cache.json"), "utf-8"));
    expect(cache.dashscope.models).toEqual(result.body.models);
  });

  it("falls back from registry to auth-keyed defaults", async () => {
    const service = makeService({
      providerRegistry: {
        getAuthJsonKey: () => "openai-codex",
        getDefaultModels: (id) => id === "openai-codex" ? ["gpt-5.4"] : null,
      },
    });

    const result = await service.fetchModels({ name: "openai-codex-oauth" });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      source: "builtin",
      models: [{ id: "gpt-5.4", name: "gpt-5.4", context: null, maxOutput: null }],
    });
  });

  it("reads cached discovered models through the same filter path", () => {
    fs.writeFileSync(
      path.join(tempRoot, "models-cache.json"),
      JSON.stringify({
        deepseek: {
          fetchedAt: "2026-05-06T08:00:00.000Z",
          models: [{ id: "deepseek" }, { id: "deepseek-v4-flash" }],
        },
      }),
      "utf-8",
    );
    const service = makeService({
      providerSettings: {
        resolveProviderCredentials: () => ({
          api_key: "sk-test",
          base_url: "https://api.deepseek.com/v1",
          api: "openai-completions",
        }),
      },
    });

    expect(service.getCachedDiscoveredModels("deepseek")).toEqual({
      models: [{ id: "deepseek-v4-flash" }],
      ignoredModels: ["deepseek"],
      fetchedAt: "2026-05-06T08:00:00.000Z",
    });
  });
});
