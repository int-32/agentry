import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildAgentCliSearchPath,
  getModelsForCli,
  resolveBinaryOnAgentCliPath,
} from "../lib/local-cli/detector.js";

describe("local cli detector", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentry-local-cli-detector-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("searches common user bin directories when the service PATH is incomplete", () => {
    const localBin = path.join(tempRoot, ".local", "bin");
    const binaryPath = path.join(localBin, "claude");
    fs.mkdirSync(localBin, { recursive: true });
    fs.writeFileSync(binaryPath, "#!/bin/sh\nprintf '2.1.143 (Claude Code)\\n'\n", "utf-8");
    fs.chmodSync(binaryPath, 0o755);

    expect(buildAgentCliSearchPath({ envPath: "/usr/bin", homeDir: tempRoot })).toContain(localBin);
    expect(resolveBinaryOnAgentCliPath("claude", { envPath: "/usr/bin", homeDir: tempRoot })).toBe(binaryPath);
  });

  it("detects Antigravity CLI from the common user bin path", () => {
    const localBin = path.join(tempRoot, ".local", "bin");
    const binaryPath = path.join(localBin, "agy");
    fs.mkdirSync(localBin, { recursive: true });
    fs.writeFileSync(binaryPath, "#!/bin/sh\nprintf '1.0.1\\n'\n", "utf-8");
    fs.chmodSync(binaryPath, 0o755);

    expect(resolveBinaryOnAgentCliPath("agy", { envPath: "/usr/bin", homeDir: tempRoot })).toBe(binaryPath);
    expect(getModelsForCli("antigravity").map(model => model.id)).toContain("antigravity");
  });
});
