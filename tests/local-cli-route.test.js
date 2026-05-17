import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanAllAgentCliS: vi.fn(),
  getModelsForCli: vi.fn(() => []),
}));

vi.mock("../lib/local-cli/detector.js", () => ({
  scanAllAgentCliS: mocks.scanAllAgentCliS,
  getModelsForCli: mocks.getModelsForCli,
  KNOWN_AGENT_CLIS: [
    {
      id: "codex",
      binary: "codex",
      displayName: "Codex CLI",
    },
  ],
}));

import {
  createLocalCliRoute,
  LOCAL_CLI_SCAN_CACHE_FILE,
} from "../server/routes/local-cli.js";

describe("local cli route", () => {
  let tempRoot;
  let agentryHome;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-local-cli-route-"));
    agentryHome = path.join(tempRoot, "hanako-home");
    fs.mkdirSync(path.join(agentryHome, "user"), { recursive: true });
    mocks.scanAllAgentCliS.mockReset();
    mocks.getModelsForCli.mockReset();
    mocks.getModelsForCli.mockReturnValue([]);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function buildApp() {
    const app = new Hono();
    app.route("/api", createLocalCliRoute({ agentryHome }));
    return app;
  }

  function cachePath() {
    return path.join(agentryHome, "user", LOCAL_CLI_SCAN_CACHE_FILE);
  }

  function writeCache(entry) {
    fs.writeFileSync(cachePath(), JSON.stringify({
      schemaVersion: 1,
      ...entry,
    }, null, 2) + "\n", "utf-8");
  }

  it("returns cached scan results without probing PATH in cache-only mode", async () => {
    const scannedAt = new Date().toISOString();
    writeCache({
      scannedAt,
      clis: [
        {
          id: "codex",
          binary: "codex",
          displayName: "Codex CLI",
          installed: true,
          binaryPath: "/usr/local/bin/codex",
          version: "1.2.3",
          modelsCount: 2,
        },
      ],
    });

    const res = await buildApp().request("/api/local-cli/scan?cached=1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      cached: true,
      stale: false,
      scannedAt,
    });
    expect(data.clis).toHaveLength(1);
    expect(mocks.scanAllAgentCliS).not.toHaveBeenCalled();
  });

  it("uses a fresh cache for the default scan endpoint", async () => {
    writeCache({
      scannedAt: new Date().toISOString(),
      clis: [
        {
          id: "codex",
          binary: "codex",
          displayName: "Codex CLI",
          installed: false,
          binaryPath: null,
          version: null,
          modelsCount: 0,
        },
      ],
    });

    const res = await buildApp().request("/api/local-cli/scan");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cached).toBe(true);
    expect(mocks.scanAllAgentCliS).not.toHaveBeenCalled();
  });

  it("force refreshes and persists scan results", async () => {
    const scanned = [
      {
        id: "codex",
        binary: "codex",
        displayName: "Codex CLI",
        installed: true,
        binaryPath: "/opt/homebrew/bin/codex",
        version: "2.0.0",
        modelsCount: 3,
      },
    ];
    mocks.scanAllAgentCliS.mockResolvedValue(scanned);

    const res = await buildApp().request("/api/local-cli/scan?refresh=1");
    const data = await res.json();
    const persisted = JSON.parse(fs.readFileSync(cachePath(), "utf-8"));

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      cached: false,
      stale: false,
      clis: scanned,
    });
    expect(persisted.clis).toEqual(scanned);
    expect(typeof persisted.scannedAt).toBe("string");
    expect(mocks.scanAllAgentCliS).toHaveBeenCalledTimes(1);
  });
});
