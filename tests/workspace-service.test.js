import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceService, WELL_KNOWN_SKILL_PATHS } from "../core/workspace-service.js";

describe("WorkspaceService", () => {
  let tempRoot = null;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  function makeDir(name) {
    if (!tempRoot) tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-workspace-service-"));
    const dir = path.join(tempRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function makeAgent(id, config = {}) {
    return {
      id,
      config,
      updateConfig: vi.fn(),
    };
  }

  it("returns only the requested agent explicit home folder", () => {
    const focusHome = makeDir("focus");
    const targetHome = makeDir("target");
    const missingHome = path.join(tempRoot, "missing");
    const agents = new Map([
      ["focus", makeAgent("focus", { desk: { home_folder: focusHome } })],
      ["target", makeAgent("target", { desk: { home_folder: targetHome } })],
      ["missing", makeAgent("missing", { desk: { home_folder: missingHome } })],
    ]);
    const service = new WorkspaceService({
      getAgentById: (id) => agents.get(id) || null,
      getActiveAgentId: () => "focus",
      getPrimaryAgentId: () => "focus",
      getAgents: () => agents,
    });

    expect(service.getHomeFolder("target")).toBe(targetHome);
    expect(service.getHomeFolder("missing")).toBeNull();
  });

  it("writes and clears the target agent home folder", () => {
    const target = makeAgent("target", { desk: {} });
    const service = new WorkspaceService({
      getAgentById: (id) => (id === "target" ? target : null),
    });

    expect(service.setHomeFolder("target", "/workspace")).toBe(true);
    expect(target.updateConfig).toHaveBeenCalledWith({ desk: { home_folder: "/workspace" } });

    service.setHomeFolder("target", null);
    expect(target.updateConfig).toHaveBeenCalledWith({ desk: { home_folder: null } });
    expect(service.setHomeFolder("missing", "/workspace")).toBe(false);
  });

  it("approves the current workspace and session workspace folders only for workspace-scope checks", () => {
    const currentHome = makeDir("current");
    const sessionExtra = makeDir("reference");
    const privateDir = makeDir("private");
    const agents = new Map([
      ["focus", makeAgent("focus", { desk: { home_folder: currentHome } })],
    ]);
    const service = new WorkspaceService({
      getAgentById: (id) => agents.get(id) || null,
      getActiveAgentId: () => "focus",
      getAgents: () => agents,
      getCurrentSessionPath: () => "session.jsonl",
      getSessionWorkspaceFolders: () => [sessionExtra],
      getDeskCwd: () => currentHome,
    });

    expect(service.isApprovedWorkspaceDir(path.join(currentHome, "src"))).toBe(true);
    expect(service.isApprovedWorkspaceDir(path.join(sessionExtra, "docs"))).toBe(true);
    expect(service.isApprovedWorkspaceDir(privateDir)).toBe(false);
  });

  it("approves desk history and non-current agent roots for file browser use", () => {
    const currentHome = makeDir("current");
    const history = makeDir("history");
    const otherHome = makeDir("other-home");
    const otherHistory = makeDir("other-history");
    const privateDir = makeDir("private");
    const agents = new Map([
      ["focus", makeAgent("focus", { desk: { home_folder: currentHome } })],
      ["other", makeAgent("other", {
        desk: { home_folder: otherHome },
        cwd_history: [otherHistory],
      })],
    ]);
    const service = new WorkspaceService({
      getAgentById: (id) => agents.get(id) || null,
      getActiveAgentId: () => "focus",
      getAgents: () => agents,
      getConfig: () => ({ cwd_history: [history] }),
      getDeskCwd: () => currentHome,
    });

    expect(service.isApprovedDeskDir(path.join(history, "note.md"))).toBe(true);
    expect(service.isApprovedDeskDir(path.join(otherHome, "src"))).toBe(true);
    expect(service.isApprovedDeskDir(path.join(otherHistory, "drafts"))).toBe(true);
    expect(service.isApprovedDeskDir(privateDir)).toBe(false);
  });

  it("merges configured, discovered, workspace, and plugin skill paths with de-dupe", () => {
    const service = new WorkspaceService({});
    service.getWorkspaceExternalSkillPaths = vi.fn(() => [
      { dirPath: "/workspace/.agents/skills", label: ".agents" },
      { dirPath: "/workspace/.claude/skills", label: ".claude" },
    ]);

    const discovered = [
      { dirPath: "/discovered/pi", label: "Pi", exists: true },
      { dirPath: "/discovered/claude", label: "Claude", exists: false },
    ];
    const resolved = service.mergeExternalSkillPaths(
      ["/u/project/extra", "/u/project/pi"],
      [{ dirPath: "/plugin/skills", label: "Plugin" }, { dirPath: "/workspace/.agents/skills", label: "Workspace duplicate" }],
      discovered,
    );

    expect(resolved).toMatchObject([
      { dirPath: "/discovered/pi", label: "Pi" },
      { dirPath: path.resolve("/u/project/extra"), label: "project" },
      { dirPath: path.resolve("/u/project/pi"), label: "project" },
      { dirPath: "/plugin/skills", label: "Plugin" },
      { dirPath: "/workspace/.agents/skills", label: "Workspace duplicate" },
    ]);
    expect(resolved.some((entry) => entry.dirPath === "/discovered/claude")).toBe(false);
    expect(resolved.filter((entry) => entry.dirPath === "/workspace/.agents/skills").length).toBe(1);
  });

  it("sameExternalSkillPaths keeps path + label + scope identity", () => {
    const service = new WorkspaceService({});
    const a = [{ dirPath: "/x", label: "A", scope: "workspace" }];
    const b = [{ dirPath: "/x", label: "A", scope: "workspace" }];
    const c = [{ dirPath: "/x", label: "A", scope: "agent" }];
    expect(service.sameExternalSkillPaths(a, b)).toBe(true);
    expect(service.sameExternalSkillPaths(a, c)).toBe(false);
  });

  it("resolves well-known external skill paths for a home directory", () => {
    const home = makeDir("home");
    fs.mkdirSync(path.join(home, ".pi/agent/skills"), { recursive: true });
    const service = new WorkspaceService({});

    const result = service.getWellKnownSkillPaths(home);

    const expected = WELL_KNOWN_SKILL_PATHS.map((entry) => ({
      dirPath: path.resolve(home, entry.suffix),
      label: entry.label,
      exists: fs.existsSync(path.resolve(home, entry.suffix)),
    }));

    expect(result).toEqual(expected);
  });

  it("syncWorkspaceSkillPaths mirrors engine short-circuit + force behavior", async () => {
    const service = new WorkspaceService({});
    service.getWorkspaceExternalSkillPaths = vi.fn(() => []);
    const configured = path.join(tempRoot || os.tmpdir(), "configured");
    const sameEntry = {
      dirPath: path.resolve(configured),
      label: path.basename(path.dirname(configured)),
    };
    const setExternalPaths = vi.fn();
    const reloadSkills = vi.fn().mockResolvedValue(undefined);
    const emitSkillsChanged = vi.fn();

    const result = await service.syncWorkspaceSkillPaths({
      cwd: "/workspace",
      configuredPaths: [configured],
      currentPaths: [sameEntry],
      reload: true,
      emitEvent: true,
      setExternalPaths,
      reloadSkills,
      emitSkillsChanged,
    });

    expect(result).toBe(false);
    expect(setExternalPaths).not.toHaveBeenCalled();
    expect(reloadSkills).not.toHaveBeenCalled();
    expect(emitSkillsChanged).not.toHaveBeenCalled();

    const forcedResult = await service.syncWorkspaceSkillPaths({
      cwd: "/workspace",
      configuredPaths: [configured],
      currentPaths: [sameEntry],
      force: true,
      reload: true,
      emitEvent: true,
      setExternalPaths,
      reloadSkills,
      emitSkillsChanged,
    });
    expect(forcedResult).toBe(true);
    expect(setExternalPaths).toHaveBeenCalledWith([sameEntry]);
    expect(reloadSkills).toHaveBeenCalledTimes(1);
    expect(emitSkillsChanged).toHaveBeenCalledTimes(1);
  });
});
