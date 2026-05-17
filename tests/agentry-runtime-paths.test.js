import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  configureProcessPiSdkEnv,
  ensureHanaPiSdkDirs,
  resolveHanakoHome,
  resolveHanaPiAgentDir,
  resolveHanaPiProjectDir,
  withHanaPiSdkEnv,
} from "../shared/agentry-runtime-paths.js";

describe("Agentry runtime path contracts", () => {
  it("derives the Pi SDK agent directory from HANA_HOME", () => {
    const agentryHome = path.join(os.tmpdir(), "agentry-runtime-paths", ".hanako-dev");

    expect(resolveHanaPiAgentDir(agentryHome)).toBe(path.join(agentryHome, ".pi", "agent"));
    expect(resolveHanaPiProjectDir(agentryHome)).toBe(path.join(agentryHome, ".pi", "project"));
  });

  it("normalizes HANA_HOME before deriving Pi SDK paths", () => {
    const homeDir = path.join(os.tmpdir(), "hana-runtime-home");

    expect(resolveHanakoHome("~/.hanako-dev", homeDir)).toBe(path.join(homeDir, ".hanako-dev"));
  });

  it("adds PI_CODING_AGENT_DIR without dropping existing environment", () => {
    const agentryHome = path.join(os.tmpdir(), "hana-runtime-env", ".hanako");
    const baseEnv = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: "/old-pi" };

    expect(withHanaPiSdkEnv(baseEnv, agentryHome)).toEqual({
      PATH: "/usr/bin",
      PI_CODING_AGENT_DIR: path.join(agentryHome, ".pi", "agent"),
    });
    expect(baseEnv.PI_CODING_AGENT_DIR).toBe("/old-pi");
  });

  it("can install the Pi SDK agent directory into a process env object", () => {
    const agentryHome = path.join(os.tmpdir(), "hana-runtime-process", ".hanako");
    const env = {};

    expect(configureProcessPiSdkEnv(agentryHome, env)).toBe(path.join(agentryHome, ".pi", "agent"));
    expect(env.PI_CODING_AGENT_DIR).toBe(path.join(agentryHome, ".pi", "agent"));
  });

  it("creates Agentry-owned Pi SDK directories explicitly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-runtime-dirs-"));
    const agentryHome = path.join(root, ".hanako");

    ensureHanaPiSdkDirs(agentryHome);

    expect(fs.statSync(path.join(agentryHome, ".pi", "agent")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(agentryHome, ".pi", "project")).isDirectory()).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
