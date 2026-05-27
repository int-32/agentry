import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceService } from "../core/workspace-service.js";

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
});
