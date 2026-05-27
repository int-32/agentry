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
});
