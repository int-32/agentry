/**
 * ProviderModelDiscoveryService -- provider model discovery and cache projection.
 *
 * This service owns the fetch-models waterfall:
 * request credentials -> remote model catalog -> SDK registry -> default models.
 * Provider routes should not duplicate provider/model normalization rules.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { buildProviderAuthHeaders } from "../lib/llm/provider-client.js";
import { filterDiscoveredProviderModels } from "../shared/provider-model-validation.js";
import { lookupKnown } from "../shared/known-models.js";

function stringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(stringList);
  if (typeof value === "string") return [value];
  return [];
}

function lowerStrings(values) {
  return values.map(v => String(v).trim().toLowerCase()).filter(Boolean);
}

function finiteNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function hasImageOutputSignal(raw) {
  const capabilityStrings = lowerStrings([
    ...stringList(raw?.output),
    ...stringList(raw?.outputs),
    ...stringList(raw?.output_modalities),
    ...stringList(raw?.outputModalities),
    ...stringList(raw?.modalities?.output),
    ...stringList(raw?.capabilities?.output),
    ...stringList(raw?.capabilities?.outputs),
    ...stringList(raw?.capabilities?.output_modalities),
    ...stringList(raw?.capabilities?.outputModalities),
    ...stringList(raw?.capabilities?.modalities?.output),
  ]);
  if (capabilityStrings.includes("image")) return true;
  return raw?.supports_image_generation === true
    || raw?.supportsImageGeneration === true
    || raw?.image_generation === true
    || raw?.imageGeneration === true
    || raw?.capabilities?.image_generation === true
    || raw?.capabilities?.imageGeneration === true;
}

function looksLikeImageGenerationId(id = "") {
  const value = String(id).toLowerCase();
  return value.includes("gpt-image")
    || value.includes("dall-e")
    || value.includes("seedream")
    || value.includes("imagen")
    || value.includes("stable-diffusion")
    || value.includes("sdxl")
    || value.includes("flux")
    || value.includes("kolors")
    || value.includes("jimeng")
    || (/wan[\w.-]*image/.test(value));
}

function inferDiscoveredModelType(providerName, raw) {
  const id = typeof raw === "object" && raw !== null ? raw.id : raw;
  const explicitType = String(raw?.type || raw?.model_type || raw?.modelType || "").toLowerCase();
  if (["image", "image_generation", "image-generation", "text-to-image", "image-generation-model"].includes(explicitType)) {
    return "image";
  }
  if (lookupKnown(providerName, id)?.type === "image") return "image";
  if (hasImageOutputSignal(raw)) return "image";
  if (looksLikeImageGenerationId(id)) return "image";
  return undefined;
}

function hasImageInputSignal(raw) {
  const capabilityStrings = lowerStrings([
    ...stringList(raw?.input),
    ...stringList(raw?.inputs),
    ...stringList(raw?.input_modalities),
    ...stringList(raw?.inputModalities),
    ...stringList(raw?.modalities?.input),
    ...stringList(raw?.capabilities?.input),
    ...stringList(raw?.capabilities?.inputs),
    ...stringList(raw?.capabilities?.input_modalities),
    ...stringList(raw?.capabilities?.inputModalities),
    ...stringList(raw?.capabilities?.modalities?.input),
  ]);
  return capabilityStrings.includes("image")
    || capabilityStrings.includes("vision")
    || raw?.supports_image_input === true
    || raw?.supportsImageInput === true
    || raw?.supports_vision === true
    || raw?.supportsVision === true
    || raw?.vision === true
    || raw?.image === true
    || raw?.capabilities?.vision === true
    || raw?.capabilities?.image === true
    || raw?.capabilities?.image_input === true
    || raw?.capabilities?.imageInput === true;
}

function hasVideoInputSignal(raw) {
  const capabilityStrings = lowerStrings([
    ...stringList(raw?.input),
    ...stringList(raw?.inputs),
    ...stringList(raw?.input_modalities),
    ...stringList(raw?.inputModalities),
    ...stringList(raw?.modalities?.input),
    ...stringList(raw?.capabilities?.input),
    ...stringList(raw?.capabilities?.inputs),
    ...stringList(raw?.capabilities?.input_modalities),
    ...stringList(raw?.capabilities?.inputModalities),
    ...stringList(raw?.capabilities?.modalities?.input),
  ]);
  return capabilityStrings.includes("video")
    || raw?.supports_video_input === true
    || raw?.supportsVideoInput === true
    || raw?.video === true
    || raw?.capabilities?.video === true
    || raw?.capabilities?.video_input === true
    || raw?.capabilities?.videoInput === true;
}

function hasReasoningSignal(raw) {
  return raw?.reasoning === true
    || raw?.supports_reasoning === true
    || raw?.supportsReasoning === true
    || raw?.capabilities?.reasoning === true
    || raw?.capabilities?.reasoning_effort === true
    || raw?.capabilities?.reasoningEffort === true;
}

function withDiscoveredModelCapabilities(providerName, model, raw = model) {
  const type = inferDiscoveredModelType(providerName, raw);
  return {
    ...model,
    ...(type ? { type } : {}),
    ...(hasImageInputSignal(raw) ? { image: true } : {}),
    ...(hasVideoInputSignal(raw) ? { video: true } : {}),
    ...(hasReasoningSignal(raw) ? { reasoning: true } : {}),
  };
}

function normalizeRegistryModels(providerName, models) {
  return models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    context: finiteNumber(model.contextWindow, model.context),
    maxOutput: finiteNumber(model.maxOutputTokens, model.maxOutput, model.maxTokens),
  })).map((model, index) => withDiscoveredModelCapabilities(providerName, model, models[index]));
}

function normalizeRemoteModels(data, api, providerName) {
  if (api === "anthropic-messages") {
    return (data.data || []).map(m => withDiscoveredModelCapabilities(providerName, {
      id: m.id,
      name: m.display_name || m.id,
      context: finiteNumber(m.max_input_tokens, m.input_token_limit, m.context_length),
      maxOutput: finiteNumber(m.max_tokens, m.max_output_tokens, m.output_token_limit),
    }, m));
  }

  if (api === "google-generative-ai") {
    return (data.models || []).map(m => {
      const id = m.baseModelId || String(m.name || "").replace(/^models\//, "");
      return withDiscoveredModelCapabilities(providerName, {
        id,
        name: m.displayName || id,
        context: finiteNumber(m.inputTokenLimit),
        maxOutput: finiteNumber(m.outputTokenLimit),
      }, m);
    }).filter(m => m.id);
  }

  return (data.data || []).map(m => withDiscoveredModelCapabilities(providerName, {
    id: m.id,
    name: m.display_name || m.name || m.id,
    context: finiteNumber(m.context_length, m.context_window, m.max_context_length, m.max_input_tokens, m.input_token_limit),
    maxOutput: finiteNumber(m.max_completion_tokens, m.max_output_tokens, m.max_tokens, m.output_token_limit),
  }, m));
}

function filterProviderModels(name, models, baseUrl = "") {
  const { models: filtered, ignoredModels } = filterDiscoveredProviderModels(name, models, { baseUrl });
  const payload = { models: filtered };
  if (ignoredModels.length > 0) payload.ignoredModels = ignoredModels;
  return payload;
}

export class ProviderModelDiscoveryService {
  constructor({
    agentryHome,
    providerRegistry,
    providerSettings,
    getRegistryModelsForProvider,
    fetchImpl = globalThis.fetch,
  }) {
    this.agentryHome = agentryHome;
    this.providerRegistry = providerRegistry;
    this.providerSettings = providerSettings;
    this.getRegistryModelsForProvider = getRegistryModelsForProvider;
    this.fetchImpl = fetchImpl;
  }

  static fromEngine(engine, providerSettings) {
    return new ProviderModelDiscoveryService({
      agentryHome: engine.agentryHome,
      providerRegistry: engine.providerRegistry,
      providerSettings,
      getRegistryModelsForProvider: (name) => engine.getRegistryModelsForProvider(name),
    });
  }

  async fetchModels({ name, base_url, api: explicitApi, api_key }) {
    if (!name && !base_url) {
      return { status: 400, body: { error: "name or base_url is required" } };
    }

    const saved = name ? this.providerSettings.resolveProviderCredentials(name) : { api_key: "", base_url: "", api: "" };
    const effectiveKey = api_key || saved.api_key || "";
    const effectiveBaseUrl = base_url || saved.base_url || "";
    const effectiveApi = explicitApi || saved.api || "";

    if (effectiveBaseUrl) {
      const remote = await this._fetchRemoteModels({
        name,
        api: effectiveApi,
        apiKey: effectiveKey,
        baseUrl: effectiveBaseUrl,
      });
      if (remote) return { status: 200, body: remote };
    }

    return { status: 200, body: this.registryOrDefaultsFallback(name) };
  }

  getCachedDiscoveredModels(providerName) {
    const cache = this._readModelsCache();
    const entry = cache[providerName];
    if (!entry) return { models: [], fetchedAt: null };
    const creds = this.providerSettings.resolveProviderCredentials(providerName);
    const payload = filterProviderModels(providerName, entry.models || [], creds.base_url || "");
    return { ...payload, fetchedAt: entry.fetchedAt || null };
  }

  registryOrDefaultsFallback(name) {
    if (!name) {
      return { error: "name is required for model discovery fallback", models: [] };
    }

    const registryModels = this.getRegistryModelsForProvider?.(name) || [];
    if (registryModels.length > 0) {
      const normalized = normalizeRegistryModels(name, registryModels);
      const payload = filterProviderModels(name, normalized);
      if (payload.models.length === 0 && payload.ignoredModels?.length > 0) {
        return {
          source: "registry",
          error: `Registry only returned invalid model ids for provider "${name}": ${payload.ignoredModels.join(", ")}`,
          models: [],
          ignoredModels: payload.ignoredModels,
        };
      }
      this._saveToCache(name, payload.models);
      return { source: "registry", ...payload };
    }

    const authKey = this.providerRegistry?.getAuthJsonKey?.(name);
    const defaults = this.providerRegistry?.getDefaultModels?.(name)
      || this.providerRegistry?.getDefaultModels?.(authKey)
      || [];
    if (defaults.length > 0) {
      const builtinModels = defaults.map(id => ({ id, name: id, context: null, maxOutput: null }));
      const payload = filterProviderModels(name, builtinModels);
      this._saveToCache(name, payload.models);
      return { source: "builtin", ...payload };
    }

    return { error: `No models found for provider "${name}"`, models: [] };
  }

  async _fetchRemoteModels({ name, api, apiKey, baseUrl }) {
    try {
      const base = baseUrl.replace(/\/+$/, "");
      const url = api === "anthropic-messages" ? `${base}/v1/models?limit=1000` : `${base}/models`;

      let headers = { "Content-Type": "application/json" };
      if (apiKey) {
        if (!api) {
          return { error: "api is required when api_key is present", models: [] };
        }
        headers = buildProviderAuthHeaders(api, apiKey);
      }
      const res = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 401 || res.status === 403) {
        return { error: `HTTP ${res.status}: ${res.statusText}`, models: [] };
      }

      if (res.ok) {
        const data = await res.json();
        const remoteModels = normalizeRemoteModels(data, api, name);
        const { models, ignoredModels } = filterDiscoveredProviderModels(name, remoteModels, {
          baseUrl,
        });
        if (models.length === 0 && ignoredModels.length > 0) {
          return {
            error: `Remote catalog only returned invalid model ids for provider "${name}": ${ignoredModels.join(", ")}`,
            models: [],
            ignoredModels,
          };
        }
        this._saveToCache(name, models);
        return ignoredModels.length > 0 ? { models, ignoredModels } : { models };
      }
    } catch {
      // Network errors intentionally fall through to registry/default fallback.
    }
    return null;
  }

  _cachePath() {
    return path.join(this.agentryHome, "models-cache.json");
  }

  _readModelsCache() {
    try {
      return JSON.parse(fs.readFileSync(this._cachePath(), "utf-8"));
    } catch {
      return {};
    }
  }

  _writeModelsCache(cache) {
    const target = this._cachePath();
    const tmp = target + ".tmp." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + os.EOL);
    fs.renameSync(tmp, target);
  }

  _saveToCache(providerName, models) {
    if (!providerName || !models?.length) return;
    try {
      const cache = this._readModelsCache();
      cache[providerName] = { models, fetchedAt: new Date().toISOString() };
      this._writeModelsCache(cache);
    } catch {
      // Best-effort; cache miss is harmless.
    }
  }
}

export function createProviderModelDiscoveryService(engine, providerSettings) {
  return ProviderModelDiscoveryService.fromEngine(engine, providerSettings);
}
