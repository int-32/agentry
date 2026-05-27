import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, afterEach } from "vitest";

import { antigravityWorkspaceUris, extractWorkspaceRootsFromPrompt } from "./bridge-workspace.mjs";

describe("bridge workspace helpers", () => {
  const cleanupRoots = [];

  afterEach(() => {
    for (const root of cleanupRoots.splice(0, cleanupRoots.length)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot(prefix) {
    const created = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    cleanupRoots.push(created);
    return created;
  }

  it("extracts absolute workspace roots from prompt text", () => {
    const tempRoot = makeTempRoot("agentry-bridge-workspace");
    const prompt = [
      `当前工作目录: ${tempRoot}`,
      `- ${tempRoot}/sub`,
    ].join("\n");
    expect(extractWorkspaceRootsFromPrompt(prompt)).toEqual([tempRoot]);
  });

  it("builds antigravity workspace uris from workspace config and prompt", () => {
    const tempFolder = makeTempRoot("agentry-bridge-workspace-folder");
    const tempRoot = makeTempRoot("agentry-bridge-workspace-config");
    const result = antigravityWorkspaceUris(
      { workspaceRoot: tempRoot, workspaceFolders: [tempFolder] },
      `=== USER ===\n${tempFolder}`,
    );
    expect(result).toEqual([
      pathToFileURL(tempRoot).href,
      pathToFileURL(tempFolder).href,
    ]);
  });
});
