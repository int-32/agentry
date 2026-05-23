// plugins/image-gen/adapters/openai-compatible.js
import fs from "fs";
import path from "path";
import { saveImage } from "../lib/download.js";

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const RATIO_TO_SIZE = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

const WAN_SIZE_TABLE = {
  "1K": {
    "1:1": "1024x1024", "4:3": "1184x880", "3:4": "880x1184",
    "16:9": "1376x768", "9:16": "768x1376", "3:2": "1248x832",
    "2:3": "832x1248", "21:9": "1568x672",
  },
  "2K": {
    "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304",
    "16:9": "2848x1600", "9:16": "1600x2848", "3:2": "2496x1664",
    "2:3": "1664x2496", "21:9": "3136x1344",
  },
  "4K": {
    "1:1": "4096x4096", "4:3": "3456x2592", "3:4": "2592x3456",
    "16:9": "4096x2304", "9:16": "2304x4096", "3:2": "3744x2496",
    "2:3": "2496x3744", "21:9": "4704x2016",
  },
};

function normalizeFormat(format) {
  const value = String(format || "png").trim().toLowerCase();
  return value === "jpg" ? "jpeg" : value;
}

function normalizeResolutionTier(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "1K" || normalized === "2K" || normalized === "4K") return normalized;
  return normalized || "2K";
}

function resolveProviderId(params, ctx) {
  return params.provider || ctx.providerId || ctx.config?.get?.("defaultImageModel")?.provider;
}

function resolveModelId(params, ctx, providerId) {
  if (params.model) return params.model;
  const defaultImageModel = ctx.config?.get?.("defaultImageModel");
  if (defaultImageModel?.provider === providerId) return defaultImageModel.id;
  return null;
}

function resolveSize(params, providerDefaults) {
  const explicitSize = params.size || params.resolution || providerDefaults?.size || providerDefaults?.resolution;
  if (explicitSize) return explicitSize;

  const ratio = params.aspect_ratio || params.aspectRatio || params.ratio || providerDefaults?.aspect_ratio || providerDefaults?.ratio;
  return ratio ? RATIO_TO_SIZE[ratio] : undefined;
}

function isDashScopeWanRequest(providerId, baseUrl, modelId) {
  const model = String(modelId || "").toLowerCase();
  if (!model.startsWith("wan2.7-image")) return false;

  let host = "";
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  return providerId === "dashscope"
    || host.includes("dashscope")
    || host.endsWith("maas.aliyuncs.com")
    || host.includes("token-plan");
}

function resolveDashScopeWanEndpoint(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.origin}/api/v1/services/aigc/multimodal-generation/generation`;
}

function resolveWanSize(params, providerDefaults, modelId) {
  const ratio = params.aspect_ratio || params.aspectRatio || params.ratio
    || providerDefaults?.aspect_ratio || providerDefaults?.ratio;
  let tier = normalizeResolutionTier(params.size || params.resolution || providerDefaults?.size || providerDefaults?.resolution || "2K");

  const hasInputImage = Boolean(params.image);
  const isPro = String(modelId || "").toLowerCase() === "wan2.7-image-pro";
  if ((!isPro || hasInputImage) && tier === "4K") tier = "2K";

  const size = ratio && WAN_SIZE_TABLE[tier]?.[ratio]
    ? WAN_SIZE_TABLE[tier][ratio]
    : tier;
  return String(size).replace(/^(\d+)x(\d+)$/i, "$1*$2");
}

async function toDataUrl(imagePath) {
  if (path.isAbsolute(imagePath) && fs.existsSync(imagePath)) {
    const buf = await fs.promises.readFile(imagePath);
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    const mime = FORMAT_TO_MIME[ext] || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  return imagePath;
}

async function saveResponseImage(image, mimeType, ctx, customName) {
  if (image.b64_json) {
    const buffer = Buffer.from(image.b64_json, "base64");
    return saveImage(buffer, mimeType, ctx.dataDir, customName);
  }

  if (image.url) {
    const response = await fetch(image.url);
    if (!response.ok) throw new Error(`image download failed ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || mimeType;
    return saveImage(Buffer.from(arrayBuffer), contentType, ctx.dataDir, customName);
  }

  throw new Error("API returned image without b64_json or url");
}

function extractDashScopeWanImages(data) {
  const choices = data?.output?.choices || [];
  const images = [];
  for (const choice of choices) {
    const content = choice?.message?.content || [];
    for (const item of content) {
      if (item?.image) images.push({ url: item.image });
      if (item?.b64_json) images.push({ b64_json: item.b64_json });
    }
  }
  return images;
}

async function submitDashScopeWan(params, ctx, providerId, creds, modelId, providerDefaults) {
  const content = [];
  if (params.image) {
    const images = Array.isArray(params.image) ? params.image : [params.image];
    for (const image of images) {
      content.push({ image: await toDataUrl(image) });
    }
  }
  content.push({ text: params.prompt });

  const parameters = {
    size: resolveWanSize(params, providerDefaults, modelId),
    n: 1,
    watermark: providerDefaults?.watermark ?? false,
  };

  if (!params.image) {
    parameters.thinking_mode = providerDefaults?.thinking_mode ?? true;
  }
  if (providerDefaults?.seed !== undefined) parameters.seed = providerDefaults.seed;
  if (providerDefaults?.color_palette) parameters.color_palette = providerDefaults.color_palette;

  const res = await fetch(resolveDashScopeWanEndpoint(creds.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: {
        messages: [
          { role: "user", content },
        ],
      },
      parameters,
    }),
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try {
      const err = await res.json();
      if (err.message) msg = `${msg}: ${err.code ? `${err.code}: ` : ""}${err.message}`;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  if (data.code || data.message) {
    throw new Error(`${data.code || "DashScopeError"}: ${data.message || "request failed"}`);
  }

  const responseImages = extractDashScopeWanImages(data);
  if (responseImages.length === 0) {
    throw new Error(`DashScope Wan returned no images${data.request_id ? ` (request_id: ${data.request_id})` : ""}`);
  }

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const files = [];
  for (let i = 0; i < responseImages.length; i++) {
    const customName = params.filename
      ? (responseImages.length > 1 ? `${params.filename}-${i + 1}` : params.filename)
      : null;
    const { filename } = await saveResponseImage(responseImages[i], "image/png", ctx, customName);
    files.push(filename);
  }

  return { taskId, files, provider: providerId };
}

export const openaiCompatibleImageAdapter = {
  id: "openai-compatible-image",
  name: "OpenAI Compatible Image",
  types: ["image"],
  capabilities: {
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    resolutions: ["2k", "4k"],
  },

  async checkAuth(ctx) {
    const providerId = resolveProviderId({}, ctx);
    if (!providerId) return { ok: false, message: "未指定 Provider" };
    try {
      const creds = await ctx.bus.request("provider:credentials", { providerId });
      if (creds.error || !creds.apiKey) {
        return { ok: false, message: creds.error || "未配置 API Key" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  },

  async submit(params, ctx) {
    const providerId = resolveProviderId(params, ctx);
    if (!providerId) {
      throw new Error("未指定 OpenAI Compatible 生图 Provider");
    }

    const creds = await ctx.bus.request("provider:credentials", { providerId });
    if (creds.error || !creds.apiKey) {
      throw new Error(`Provider "${providerId}" 未配置 API Key。请在设置中配置。`);
    }

    const modelId = resolveModelId(params, ctx, providerId);
    if (!modelId) {
      throw new Error(`Provider "${providerId}" 未指定图片模型`);
    }

    const allDefaults = ctx.config?.get?.("providerDefaults") || {};
    const providerDefaults = allDefaults[providerId] || {};
    if (isDashScopeWanRequest(providerId, creds.baseUrl, modelId)) {
      return submitDashScopeWan(params, ctx, providerId, creds, modelId, providerDefaults);
    }

    const outputFormat = normalizeFormat(params.format || providerDefaults?.format || "png");
    const mimeType = FORMAT_TO_MIME[outputFormat] || "image/png";

    const body = {
      model: modelId,
      prompt: params.prompt,
      n: 1,
      response_format: "b64_json",
    };

    const size = resolveSize(params, providerDefaults);
    if (size) body.size = size;
    if (outputFormat) body.output_format = outputFormat;
    const quality = params.quality || providerDefaults?.quality;
    if (quality) body.quality = quality;

    if (params.image) {
      const images = Array.isArray(params.image) ? params.image : [params.image];
      body.image = await Promise.all(images.map(toDataUrl));
    }

    const baseUrl = (creds.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(`Provider "${providerId}" 未配置 Base URL`);
    }

    const endpoint = body.image
      ? `${baseUrl}/images/edits`
      : `${baseUrl}/images/generations`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}: ${err.error.message}`;
        else if (err.message) msg = `${msg}: ${err.code ? `${err.code}: ` : ""}${err.message}`;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    const responseImages = data.data || [];
    if (responseImages.length === 0) {
      throw new Error("API returned no images");
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const files = [];
    for (let i = 0; i < responseImages.length; i++) {
      const customName = params.filename
        ? (responseImages.length > 1 ? `${params.filename}-${i + 1}` : params.filename)
        : null;
      const { filename } = await saveResponseImage(responseImages[i], mimeType, ctx, customName);
      files.push(filename);
    }

    return { taskId, files };
  },
};
