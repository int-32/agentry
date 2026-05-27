import { describe, expect, it, vi } from "vitest";

import { SessionCoordinator } from "../core/session-coordinator.js";

describe("SessionCoordinator.compactDesktopSession", () => {
  const deps = {
    agentsDir: "/tmp/agents",
    getAgent: () => ({ id: "agent-1", sessionDir: "/tmp/agents/agent-1/sessions" }),
    getActiveAgentId: () => "agent-1",
    getModels: () => ({}),
    getResourceLoader: () => ({}),
    getSkills: () => ({}),
    buildTools: () => ({ tools: [], customTools: [] }),
    emitEvent: () => {},
    getHomeCwd: () => "/tmp/home",
    agentIdFromSessionPath: () => "agent-1",
    switchAgentOnly: async () => {},
    getConfig: () => ({}),
    getPrefs: () => ({ getThinkingLevel: () => "auto" }),
    getAgents: () => new Map(),
    getActivityStore: () => null,
    getAgentById: () => null,
    listAgents: () => [],
  };

  it("compacts desktop session and returns token delta", async () => {
    const coord = new SessionCoordinator(deps);
    const session = {
      isCompacting: false,
      getContextUsage: vi.fn()
        .mockReturnValueOnce({ tokens: 9000, contextWindow: 120000 })
        .mockReturnValueOnce({ tokens: 1200, contextWindow: 120000 }),
      compact: vi.fn(async () => {}),
    };
    coord.sessions.set("/tmp/agents/agent-1/sessions/session-1.jsonl", {
      session,
    });

    const result = await coord.compactDesktopSession("/tmp/agents/agent-1/sessions/session-1.jsonl");

    expect(session.compact).toHaveBeenCalledOnce();
    expect(result).toEqual({
      tokensBefore: 9000,
      tokensAfter: 1200,
      contextWindow: 120000,
    });
  });

  it("throws when session does not exist", async () => {
    const coord = new SessionCoordinator(deps);

    await expect(
      coord.compactDesktopSession("/tmp/agents/agent-1/sessions/missing.jsonl"),
    ).rejects.toThrow("compactDesktopSession: session not found");
  });

  it("throws when session is compacting", async () => {
    const coord = new SessionCoordinator(deps);
    coord.sessions.set("/tmp/agents/agent-1/sessions/session-1.jsonl", {
      session: {
        isCompacting: true,
        compact: vi.fn(async () => {}),
      },
    });

    await expect(
      coord.compactDesktopSession("/tmp/agents/agent-1/sessions/session-1.jsonl"),
    ).rejects.toThrow("compactDesktopSession: already compacting");
  });
});
