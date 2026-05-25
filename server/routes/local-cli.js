/**
 * Local CLI Agent 路由（agentry 独家扩展）
 *
 * GET    /api/local-cli/scan          — 扫 PATH，返内置 CLI 之安装状态
 * GET    /api/local-cli/:id/models    — 返某 CLI 之模型清单（从 known-models.json）
 *
 * 与"云端 LLM 供应商"路由（providers.js）相对：本路由仅处理本机已装 agent CLI。
 */

import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanAllAgentCliS, getModelsForCli, KNOWN_AGENT_CLIS } from "../../lib/local-cli/detector.js";

export const LOCAL_CLI_SCAN_CACHE_FILE = "local-cli-scan-cache.json";
export const LOCAL_CLI_SCAN_CACHE_SCHEMA_VERSION = 3;
export const DEFAULT_LOCAL_CLI_SCAN_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

function boolQuery(value) {
  return value === "1" || value === "true" || value === "yes";
}

function localCliScanCachePath(agentryHome) {
  if (!agentryHome || typeof agentryHome !== "string") return null;
  return path.join(agentryHome, "user", LOCAL_CLI_SCAN_CACHE_FILE);
}

function readLocalCliScanCache(agentryHome) {
  const cachePath = localCliScanCachePath(agentryHome);
  if (!cachePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (raw?.schemaVersion !== LOCAL_CLI_SCAN_CACHE_SCHEMA_VERSION) return null;
    if (!Array.isArray(raw?.clis)) return null;
    return {
      scannedAt: typeof raw.scannedAt === "string" ? raw.scannedAt : null,
      clis: raw.clis,
    };
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(`[local-cli] failed to read scan cache: ${err.message}`);
    }
    return null;
  }
}

function writeLocalCliScanCache(agentryHome, clis, scannedAt) {
  const cachePath = localCliScanCachePath(agentryHome);
  if (!cachePath) return;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      schemaVersion: LOCAL_CLI_SCAN_CACHE_SCHEMA_VERSION,
      scannedAt,
      clis,
    }, null, 2) + os.EOL, "utf-8");
    fs.renameSync(tmp, cachePath);
  } catch (err) {
    console.warn(`[local-cli] failed to write scan cache: ${err.message}`);
  }
}

function isCacheStale(entry, maxAgeMs = DEFAULT_LOCAL_CLI_SCAN_CACHE_MAX_AGE_MS, now = Date.now()) {
  if (!entry?.scannedAt) return true;
  const scannedAtMs = Date.parse(entry.scannedAt);
  if (!Number.isFinite(scannedAtMs)) return true;
  return now - scannedAtMs > maxAgeMs;
}

export function createLocalCliRoute({ agentryHome } = {}) {
  const route = new Hono();

  route.get("/local-cli/scan", async (c) => {
    try {
      const forceRefresh = boolQuery(c.req.query("refresh")) || boolQuery(c.req.query("force"));
      const cacheOnly = boolQuery(c.req.query("cached")) || c.req.query("mode") === "cached";
      const maxAgeParam = Number(c.req.query("maxAgeMs"));
      const maxAgeMs = Number.isFinite(maxAgeParam) && maxAgeParam >= 0
        ? maxAgeParam
        : DEFAULT_LOCAL_CLI_SCAN_CACHE_MAX_AGE_MS;
      const cache = readLocalCliScanCache(agentryHome);

      if (!forceRefresh && cache) {
        const stale = isCacheStale(cache, maxAgeMs);
        if (cacheOnly || !stale) {
          return c.json({
            ok: true,
            clis: cache.clis,
            cached: true,
            stale,
            scannedAt: cache.scannedAt,
          });
        }
      }

      if (cacheOnly) {
        return c.json({
          ok: true,
          clis: [],
          cached: false,
          stale: true,
          scannedAt: null,
        });
      }

      const cliS = await scanAllAgentCliS();
      const scannedAt = new Date().toISOString();
      writeLocalCliScanCache(agentryHome, cliS, scannedAt);
      return c.json({
        ok: true,
        clis: cliS,
        cached: false,
        stale: false,
        scannedAt,
      });
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
