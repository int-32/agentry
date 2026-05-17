import { describe, expect, it, vi } from "vitest";
import { createChatRoute } from "../server/routes/chat.js";

describe("chat route model switch guard", () => {
  it("rejects prompts through the engine public switching API", async () => {
    let createHandlers;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn(),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Agentry",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => true),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onMessage({
      data: JSON.stringify({
        type: "prompt",
        text: "hello",
        sessionPath: "/tmp/session.jsonl",
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.isSessionSwitching).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(hub.send).not.toHaveBeenCalled();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
      type: "error",
      message: "正在切换模型，请稍候",
      sessionPath: "/tmp/session.jsonl",
    });
  });
});
