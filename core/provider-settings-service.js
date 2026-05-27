/**
 * ProviderSettingsService -- provider configuration projection and updates.
 *
 * ProviderRegistry owns persistence and plugin merging. This service owns the
 * route-facing settings shape so config, agent config, and provider summary do
 * not each rebuild provider state differently.
 */

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeModels(models) {
  return Array.isArray(models) ? models : [];
}

function normalizeWorkspaceFolders(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && item.trim())
    : [];
}

function emptyCredentials() {
  return { api_key: "", base_url: "", api: "" };
}

function providerWorkspaceFields(provider) {
  return {
    workspace_root: typeof provider?.workspace_root === "string" ? provider.workspace_root : "",
    workspace_folders: normalizeWorkspaceFolders(provider?.workspace_folders),
  };
}

export class ProviderSettingsService {
  constructor({ providerRegistry, authStorage = null, preferences = null }) {
    this.providerRegistry = providerRegistry;
    this.authStorage = authStorage;
    this.preferences = preferences;
  }

  static fromEngine(engine) {
    return new ProviderSettingsService({
      providerRegistry: engine.providerRegistry,
      authStorage: engine.authStorage,
      preferences: engine.preferences,
    });
  }

  getConfigProviders() {
    const rawProviders = this._rawProviders();
    const providerEntries = {};
    for (const [name, provider] of Object.entries(rawProviders)) {
      const entry = this.providerRegistry?.get?.(name);
      const models = normalizeModels(provider?.models);
      providerEntries[name] = {
        base_url: provider?.base_url || entry?.baseUrl || "",
        api: provider?.api || entry?.api || "",
        api_key: provider?.api_key || "",
        models,
        ...providerWorkspaceFields(provider),
        model_count: models.length,
      };
    }
    return providerEntries;
  }

  getProviderSummary() {
    const rawProviders = this._rawProviders();
    const registry = this.providerRegistry;
    const oauthLoginMap = this._getOAuthLoginMap();
    const oauthCustom = this.preferences?.getOAuthCustomModels?.() || {};
    const result = {};

    const getOAuthLoginInfo = (name) => {
      if (oauthLoginMap.has(name)) return oauthLoginMap.get(name);
      const authKey = registry?.getAuthJsonKey?.(name);
      if (authKey && authKey !== name && oauthLoginMap.has(authKey)) {
        return oauthLoginMap.get(authKey);
      }
      return null;
    };

    for (const [name, provider] of Object.entries(rawProviders)) {
      const entry = registry?.get?.(name);
      const isOAuth = registry?.isOAuth?.(name) === true;
      const authType = registry?.getAuthType?.(name) || (isOAuth ? "oauth" : "api-key");
      const oauthInfo = getOAuthLoginInfo(name);
      const rawModels = normalizeModels(provider?.models);
      const customModels = normalizeModels(oauthCustom[name]);
      const baseUrl = provider?.base_url || entry?.baseUrl || "";
      const api = provider?.api || entry?.api || "";
      const allowsMissingApiKey = !!baseUrl && registry?.allowsMissingApiKey?.(name, baseUrl) === true;
      const hasCredentials = !!(
        provider?.api_key
        || (isOAuth && oauthInfo?.loggedIn)
        || (!isOAuth && allowsMissingApiKey)
      );
      const missingFields = [];
      if (!isOAuth) {
        if (!baseUrl) missingFields.push("base_url");
        if (!hasCredentials) missingFields.push("api_key");
      }
      if (rawModels.length === 0 && customModels.length === 0) missingFields.push("models");

      result[name] = {
        type: isOAuth ? "oauth" : "api-key",
        auth_type: authType,
        display_name: provider?.display_name || entry?.displayName || oauthInfo?.name || name,
        base_url: baseUrl,
        api,
        api_key: provider?.api_key || "",
        models: rawModels,
        ...providerWorkspaceFields(provider),
        custom_models: customModels,
        has_credentials: hasCredentials,
        logged_in: isOAuth ? !!oauthInfo?.loggedIn : undefined,
        supports_oauth: isOAuth,
        is_coding_plan: name.endsWith("-coding"),
        can_delete: !isOAuth || Object.prototype.hasOwnProperty.call(rawProviders, name),
        config_status: provider?._config_error ? "invalid" : (missingFields.length > 0 ? "needs_setup" : "ok"),
        config_error: provider?._config_error || null,
        missing_fields: missingFields,
      };
    }

    for (const oauthId of registry?.getOAuthProviderIds?.() || []) {
      if (result[oauthId]) continue;
      const authKey = registry?.getAuthJsonKey?.(oauthId) || oauthId;
      const loginInfo = oauthLoginMap.get(authKey);
      if (!loginInfo) continue;
      const customModels = normalizeModels(oauthCustom[authKey] || oauthCustom[oauthId]);
      result[oauthId] = {
        type: "oauth",
        auth_type: "oauth",
        display_name: loginInfo.name || oauthId,
        base_url: "",
        api: "",
        api_key: "",
        models: [],
        custom_models: customModels,
        has_credentials: !!loginInfo.loggedIn,
        logged_in: !!loginInfo.loggedIn,
        supports_oauth: true,
        is_coding_plan: false,
        can_delete: false,
        config_status: customModels.length > 0 && loginInfo.loggedIn ? "ok" : "needs_setup",
        config_error: null,
        missing_fields: customModels.length > 0 ? [] : ["models"],
      };
    }

    for (const [id, entry] of registry?.getAll?.() || []) {
      if (result[id]) continue;
      if (entry.authType === "oauth") continue;
      result[id] = {
        type: "api-key",
        auth_type: entry.authType,
        display_name: entry.displayName || id,
        base_url: entry.baseUrl || "",
        api: entry.api || "",
        api_key: "",
        models: [],
        custom_models: [],
        has_credentials: false,
        logged_in: undefined,
        supports_oauth: false,
        is_coding_plan: id.endsWith("-coding"),
        can_delete: false,
        config_status: "needs_setup",
        config_error: null,
        missing_fields: [
          ...(entry.authType === "none" ? [] : ["api_key"]),
          "models",
        ],
      };
    }

    return result;
  }

  applyProvidersPatch(providers) {
    if (!providers || typeof providers !== "object") return false;
    for (const [name, data] of Object.entries(providers)) {
      if (data === null) {
        this.providerRegistry?.removeProvider?.(name);
      } else {
        this.providerRegistry?.saveProvider?.(name, data);
      }
    }
    return true;
  }

  saveProvider(providerId, data) {
    this.providerRegistry?.saveProvider?.(providerId, data);
  }

  removeProvider(providerId) {
    this.providerRegistry?.removeProvider?.(providerId);
  }

  resolveProviderCredentials(providerId) {
    if (!providerId) return emptyCredentials();
    const cred = this.providerRegistry?.getCredentials?.(providerId);
    if (!cred) return emptyCredentials();
    return {
      api_key: cred.apiKey || "",
      base_url: cred.baseUrl || "",
      api: cred.api || "",
    };
  }

  _rawProviders() {
    const raw = this.providerRegistry?.getAllProvidersRaw?.() || {};
    return isObject(raw) ? raw : {};
  }

  _getOAuthLoginMap() {
    const oauthProviders = this.authStorage?.getOAuthProviders?.() || [];
    const map = new Map();
    for (const provider of oauthProviders) {
      const cred = this.authStorage?.get?.(provider.id);
      map.set(provider.id, { name: provider.name, loggedIn: cred?.type === "oauth" });
    }
    return map;
  }
}

export function createProviderSettingsService(engine) {
  return ProviderSettingsService.fromEngine(engine);
}
