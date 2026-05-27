import { describe, expect, it, vi } from "vitest";
import { AgentryEngine } from "../core/engine.js";

describe("AgentryEngine.syncWorkspaceSkillPaths", () => {
  function makeFakeEngine({ currentPaths = [] } = {}) {
    const engine = Object.create(AgentryEngine.prototype);
    const workspaceService = {
      syncWorkspaceSkillPaths: vi.fn().mockResolvedValue(false),
    };
    engine._skills = { _externalPaths: currentPaths };
    engine._prefs = { getExternalSkillPaths: vi.fn(() => []) };
    engine._pluginManager = { getSkillPaths: vi.fn(() => []) };
    engine._discoveredExternalPaths = [];
    engine._workspaceService = () => workspaceService;
    return engine;
  }

  it("delegates to workspace service and passes workspace skill inputs", async () => {
    const engine = makeFakeEngine({ currentPaths: [] });
    const cwd = "/workspace";
    const result = await engine.syncWorkspaceSkillPaths(cwd, {
      reload: false,
      emitEvent: true,
      force: true,
    });
    const svc = engine._workspaceService();

    expect(result).toBe(false);
    expect(svc.syncWorkspaceSkillPaths).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        pluginPaths: [],
        configuredPaths: [],
        discoveredPaths: [],
        currentPaths: [],
        reload: false,
        emitEvent: true,
        force: true,
      }),
    );
  });

  it("returns false directly when skills not initialized", async () => {
    const engine = makeFakeEngine({ currentPaths: [] });
    engine._skills = null;
    const result = await engine.syncWorkspaceSkillPaths("/workspace");
    expect(result).toBe(false);
  });

  it("passes through service result", async () => {
    const engine = makeFakeEngine({ currentPaths: [] });
    const svc = engine._workspaceService();
    svc.syncWorkspaceSkillPaths.mockResolvedValue(true);
    const result = await engine.syncWorkspaceSkillPaths("/workspace");

    expect(result).toBe(true);
  });

  it("refreshes discovered external paths and triggers sync on new discovered directories", async () => {
    const engine = makeFakeEngine({ currentPaths: [] });
    Object.defineProperty(engine, "currentSessionPath", { value: "/sessions/current.jsonl", configurable: true });
    Object.defineProperty(engine, "cwd", { value: "/tmp/cwd", configurable: true });
    engine._discoveredExternalPaths = [{ dirPath: "/u/missing", label: "Missing", exists: false }];
    engine._prefs.getExternalSkillPaths = vi.fn(() => ["/u/configured"]);
    const svc = engine._workspaceService();
    const refreshedPaths = [{ dirPath: "/u/missing", label: "Missing", exists: true }];
    svc.refreshDiscoveredExternalPaths = vi.fn().mockReturnValue({
      paths: refreshedPaths,
      newDirAppeared: true,
    });
    engine.syncWorkspaceSkillPaths = vi.fn().mockResolvedValue(true);

    const result = engine.getExternalSkillPaths();

    expect(svc.refreshDiscoveredExternalPaths).toHaveBeenCalled();
    expect(engine._discoveredExternalPaths).toEqual(refreshedPaths);
    expect(engine.syncWorkspaceSkillPaths).toHaveBeenCalledWith("/tmp/cwd", {
      reload: true,
      emitEvent: true,
    });
    expect(result).toEqual({
      configured: ["/u/configured"],
      discovered: refreshedPaths,
    });
  });
});
