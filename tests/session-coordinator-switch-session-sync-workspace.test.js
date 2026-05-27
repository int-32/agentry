import { describe, expect, it, vi } from "vitest";

import { SessionCoordinator } from "../core/session-coordinator.js";

describe("SessionCoordinator.switchSession", () => {
  it("syncs workspace skill paths after switching to existing session", async () => {
    const syncWorkspaceSkillPaths = vi.fn(async () => {});
    const setMemoryEnabled = vi.fn();
    const coord = new SessionCoordinator({
      agentsDir: "/tmp/agents",
      getAgent: () => ({ sessionDir: "/tmp/agents/agent-1/sessions", setMemoryEnabled }),
      getActiveAgentId: () => "agent-1",
      getModels: () => ({ resolveThinkingLevel: () => "auto", authStorage: {}, modelRegistry: {} }),
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
      getAgentById: () => ({ setMemoryEnabled }),
      listAgents: () => [],
      syncWorkspaceSkillPaths,
    });

    const oldSession = {
      sessionManager: { getSessionFile: () => "/tmp/agents/agent-1/sessions/old.jsonl", getCwd: () => "/tmp/old" },
    };
    const newSession = {
      sessionManager: { getSessionFile: () => "/tmp/agents/agent-1/sessions/new.jsonl", getCwd: () => "/tmp/new" },
    };
    coord.sessions.set("/tmp/agents/agent-1/sessions/old.jsonl", { session: oldSession, agentId: "agent-1" });
    coord.sessions.set("/tmp/agents/agent-1/sessions/new.jsonl", { session: newSession, agentId: "agent-1" });
    coord._session = oldSession;

    await coord.switchSession("/tmp/agents/agent-1/sessions/new.jsonl");

    expect(syncWorkspaceSkillPaths).toHaveBeenCalledOnce();
    expect(syncWorkspaceSkillPaths).toHaveBeenCalledWith("/tmp/new", { reload: true, emitEvent: false });
  });
});
