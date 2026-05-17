import { describe, expect, it, vi } from "vitest";
import { AgentryEngine } from "../core/engine.js";

describe("AgentryEngine session API", () => {
  it("exposes session model switch state without leaking coordinator internals", () => {
    const engine = Object.create(AgentryEngine.prototype);
    engine._sessionCoord = {
      isSessionSwitching: vi.fn(() => true),
    };

    expect(engine.isSessionSwitching("/tmp/session.jsonl")).toBe(true);
    expect(engine._sessionCoord.isSessionSwitching).toHaveBeenCalledWith("/tmp/session.jsonl");
  });
});
