import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { AgentryEngine } from "../core/engine.js";

describe("AgentryEngine desk directory approval", () => {
  it("allows desk roots configured on non-current agents", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentry-engine-desk-"));
    try {
      const currentHome = path.join(tempRoot, "current");
      const coderHome = path.join(tempRoot, "coder-home");
      const privateDir = path.join(tempRoot, "private");
      for (const dir of [currentHome, coderHome, privateDir]) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const engine = Object.create(AgentryEngine.prototype);
      Object.defineProperty(engine, "homeCwd", { value: currentHome });
      Object.defineProperty(engine, "deskCwd", { value: currentHome });
      Object.defineProperty(engine, "currentSessionPath", { value: null });
      Object.defineProperty(engine, "config", { value: { cwd_history: [] } });
      engine.getSessionWorkspaceFolders = () => [];
      engine.listAgents = () => [{ id: "hanako" }, { id: "coder" }];
      engine.getAgent = (id) => {
        if (id === "coder") {
          return { config: { desk: { home_folder: coderHome }, cwd_history: [coderHome] } };
        }
        return { config: { desk: { home_folder: currentHome }, cwd_history: [] } };
      };

      expect(engine.isApprovedDeskDir(coderHome)).toBe(true);
      expect(engine.isApprovedDeskDir(path.join(coderHome, "src"))).toBe(true);
      expect(engine.isApprovedDeskDir(privateDir)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
