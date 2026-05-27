import { describe, expect, it, vi } from "vitest";
import { ProviderSettingsService } from "../core/provider-settings-service.js";

describe("ProviderSettingsService", () => {
  it("projects config providers with defaults and workspace fields", () => {
    const service = new ProviderSettingsService({
      providerRegistry: {
        getAllProvidersRaw: () => ({
          "cli-claude-code": {
            api_key: "",
            models: ["claude-sonnet"],
            workspace_root: "/workspace/project",
            workspace_folders: ["/workspace/reference", "", null],
          },
        }),
        get: () => ({
          baseUrl: "http://localhost:4399/v1",
          api: "openai-completions",
        }),
      },
    });

    expect(service.getConfigProviders()).toEqual({
      "cli-claude-code": {
        base_url: "http://localhost:4399/v1",
        api: "openai-completions",
        api_key: "",
        models: ["claude-sonnet"],
        workspace_root: "/workspace/project",
        workspace_folders: ["/workspace/reference"],
        model_count: 1,
      },
    });
  });

  it("builds provider summary from registry auth and workspace metadata", () => {
    const allowsMissingApiKey = vi.fn(() => true);
    const service = new ProviderSettingsService({
      providerRegistry: {
        getAllProvidersRaw: () => ({
          ollama: {
            base_url: "http://192.168.1.20:11434/v1",
            api: "openai-completions",
            models: ["llama3"],
            workspace_root: "/workspace/project",
          },
        }),
        get: () => ({
          authType: "none",
          displayName: "Ollama",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
        }),
        isOAuth: () => false,
        getAuthType: () => "none",
        allowsMissingApiKey,
        getOAuthProviderIds: () => [],
        getAll: () => new Map(),
      },
      preferences: {
        getOAuthCustomModels: () => ({}),
      },
    });

    const summary = service.getProviderSummary();

    expect(summary.ollama).toMatchObject({
      auth_type: "none",
      display_name: "Ollama",
      has_credentials: true,
      config_status: "ok",
      workspace_root: "/workspace/project",
      workspace_folders: [],
    });
    expect(allowsMissingApiKey).toHaveBeenCalledWith(
      "ollama",
      "http://192.168.1.20:11434/v1",
    );
  });

  it("uses provider entry defaults in summary when config omits base_url and api", () => {
    const service = new ProviderSettingsService({
      providerRegistry: {
        getAllProvidersRaw: () => ({
          deepseek: {
            display_name: "Research DeepSeek",
            api_key: "sk-test",
            models: ["deepseek-chat"],
          },
        }),
        get: () => ({
          authType: "api-key",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
        }),
        isOAuth: () => false,
        getAuthType: () => "api-key",
        allowsMissingApiKey: () => false,
        getOAuthProviderIds: () => [],
        getAll: () => new Map(),
      },
      preferences: {
        getOAuthCustomModels: () => ({}),
      },
    });

    expect(service.getProviderSummary().deepseek).toMatchObject({
      display_name: "Research DeepSeek",
      base_url: "https://api.deepseek.com",
      api: "openai-completions",
      has_credentials: true,
      config_status: "ok",
      missing_fields: [],
    });
  });

  it("adds oauth-only providers from auth storage", () => {
    const service = new ProviderSettingsService({
      providerRegistry: {
        getAllProvidersRaw: () => ({}),
        getAuthJsonKey: () => "openai-codex",
        getOAuthProviderIds: () => ["openai-codex-oauth"],
        getAll: () => new Map(),
      },
      authStorage: {
        getOAuthProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
        get: () => ({ type: "oauth" }),
      },
      preferences: {
        getOAuthCustomModels: () => ({
          "openai-codex": [{ id: "gpt-5" }],
        }),
      },
    });

    expect(service.getProviderSummary()["openai-codex-oauth"]).toMatchObject({
      type: "oauth",
      display_name: "OpenAI Codex",
      has_credentials: true,
      config_status: "ok",
      custom_models: [{ id: "gpt-5" }],
    });
  });

  it("applies provider patches through the registry", () => {
    const saveProvider = vi.fn();
    const removeProvider = vi.fn();
    const service = new ProviderSettingsService({
      providerRegistry: { saveProvider, removeProvider },
    });

    expect(service.applyProvidersPatch({
      openai: { api_key: "sk-test" },
      old: null,
    })).toBe(true);

    expect(saveProvider).toHaveBeenCalledWith("openai", { api_key: "sk-test" });
    expect(removeProvider).toHaveBeenCalledWith("old");
  });
});
