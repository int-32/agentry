import { describe, expect, it, vi } from "vitest";
import {
  cliProviderForBackend,
  createCliProviderConfigLoader,
  normalizeCliProviderWorkspaceConfig,
  resolveBridgeRuntimeConfig,
  routeBackend,
} from "../lib/bridge/local-cli-runtime-config.js";

describe("local CLI bridge runtime config", () => {
  it("routes bridge models to local CLI provider ids", () => {
    expect(routeBackend("gpt-codex")).toBe("codex");
    expect(routeBackend("gemini-3-flash")).toBe("gemini");
    expect(routeBackend("agy")).toBe("antigravity");
    expect(routeBackend("claude-sonnet-4-6")).toBe("claude");

    expect(cliProviderForBackend("claude")).toBe("cli-claude-code");
    expect(cliProviderForBackend("codex")).toBe("cli-codex");
    expect(cliProviderForBackend("gemini")).toBe("cli-gemini");
    expect(cliProviderForBackend("antigravity")).toBe("cli-antigravity");
  });

  it("normalizes snake_case and camelCase workspace config", () => {
    expect(normalizeCliProviderWorkspaceConfig({
      workspace_root: " /workspace/project ",
      workspace_folders: ["/workspace/reference", "", "/workspace/reference", null],
    })).toEqual({
      workspaceRoot: "/workspace/project",
      workspaceFolders: ["/workspace/reference"],
    });

    expect(normalizeCliProviderWorkspaceConfig({
      workspaceRoot: "/workspace/camel",
      workspaceFolders: ["/workspace/one"],
    })).toEqual({
      workspaceRoot: "/workspace/camel",
      workspaceFolders: ["/workspace/one"],
    });
  });

  it("loads added-models workspace config with mtime cache", () => {
    const statSync = vi.fn(() => ({ mtimeMs: 10 }));
    const readFileSync = vi.fn(() => "unused");
    const yaml = {
      load: vi.fn(() => ({
        providers: {
          "cli-codex": {
            workspace_root: "/workspace/project",
            workspace_folders: ["/workspace/reference"],
          },
        },
      })),
    };
    const loader = createCliProviderConfigLoader({
      agentryHome: "/tmp/agentry-home",
      fsImpl: { statSync, readFileSync },
      yaml,
    });

    expect(loader.loadProviderConfig("cli-codex")).toEqual({
      workspaceRoot: "/workspace/project",
      workspaceFolders: ["/workspace/reference"],
    });
    expect(loader.loadProviderConfig("cli-codex")).toEqual({
      workspaceRoot: "/workspace/project",
      workspaceFolders: ["/workspace/reference"],
    });
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("resolves model backend and workspace config together", () => {
    const loader = {
      loadProviderConfig: vi.fn(() => ({
        workspaceRoot: "/workspace/project",
        workspaceFolders: [],
      })),
    };

    expect(resolveBridgeRuntimeConfig("codex", loader)).toEqual({
      backend: "codex",
      cliProviderId: "cli-codex",
      workspaceConfig: {
        workspaceRoot: "/workspace/project",
        workspaceFolders: [],
      },
    });
    expect(loader.loadProviderConfig).toHaveBeenCalledWith("cli-codex");
  });
});
