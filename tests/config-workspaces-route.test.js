import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("config workspace routes", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-workspaces-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a selected workspace into the current agent workspace history", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const oldWorkspace = path.join(tmpDir, "old");
    const nextWorkspace = path.join(tmpDir, "next");
    fs.mkdirSync(oldWorkspace);
    fs.mkdirSync(nextWorkspace);
    const engine = {
      config: { cwd_history: [oldWorkspace] },
      updateConfig: vi.fn(async (patch) => {
        engine.config = { ...engine.config, ...patch };
      }),
    };
    const app = new Hono();
    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config/workspaces/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: nextWorkspace }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cwd_history).toEqual([nextWorkspace, oldWorkspace]);
    expect(engine.updateConfig).toHaveBeenCalledWith({
      cwd_history: [nextWorkspace, oldWorkspace],
    }, {});
  });

  it("persists a selected workspace into the explicit agent workspace history", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const focusWorkspace = path.join(tmpDir, "focus");
    const targetOldWorkspace = path.join(tmpDir, "target-old");
    const nextWorkspace = path.join(tmpDir, "next");
    fs.mkdirSync(focusWorkspace);
    fs.mkdirSync(targetOldWorkspace);
    fs.mkdirSync(nextWorkspace);
    const focusConfig = { cwd_history: [focusWorkspace] };
    const targetConfig = { cwd_history: [targetOldWorkspace] };
    const engine = {
      config: focusConfig,
      getAgent: vi.fn((id) => (id === "target" ? { id, config: targetConfig } : null)),
      updateConfig: vi.fn(async () => {}),
    };
    const app = new Hono();
    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config/workspaces/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: nextWorkspace, agentId: "target" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cwd_history).toEqual([nextWorkspace, targetOldWorkspace]);
    expect(engine.updateConfig).toHaveBeenCalledWith(
      { cwd_history: [nextWorkspace, targetOldWorkspace] },
      { agentId: "target" },
    );
  });

  it("exposes and creates the default onboarding workspace", async () => {
    const homeDir = path.join(tmpDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    const { createConfigRoute } = await import("../server/routes/config.js");
    const engine = { config: {} };
    const app = new Hono();
    app.route("/api", createConfigRoute(engine));

    const expected = path.join(homeDir, "Desktop", "OH-WorkSpace");

    const getRes = await app.request("/api/config/default-workspace");
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual({ path: expected });
    expect(fs.existsSync(expected)).toBe(false);

    const postRes = await app.request("/api/config/default-workspace", { method: "POST" });
    expect(postRes.status).toBe(200);
    await expect(postRes.json()).resolves.toEqual({ ok: true, path: expected });
    expect(fs.statSync(expected).isDirectory()).toBe(true);

    homedirSpy.mockRestore();
  });
});
