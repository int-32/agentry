import { describe, expect, it } from "vitest";

import { createConversationSessionStore, fingerprintConversation } from "./bridge-session-cache.mjs";

describe("createConversationSessionStore", () => {
  it("stores and reuses sdk session IDs by conversation fingerprint", () => {
    const store = createConversationSessionStore({ maxEntries: 2 });
    store.rememberSession("fp-1", "claude", "sid-1");
    store.rememberSession("fp-2", "codex", "sid-2");

    expect(store.lookupSession("fp-1", "claude")).toBe("sid-1");
    expect(store.lookupSession("fp-2", "codex")).toBe("sid-2");
  });

  it("evicts least recently used entry when maxEntries reached", () => {
    const store = createConversationSessionStore({ maxEntries: 2 });
    store.rememberSession("fp-1", "claude", "sid-1");
    store.rememberSession("fp-2", "claude", "sid-2");
    expect(store.lookupSession("fp-1", "claude")).toBe("sid-1");
    store.rememberSession("fp-3", "claude", "sid-3");

    expect(store.lookupSession("fp-2", "claude")).toBe("sid-2");
    expect(store.lookupSession("fp-1", "claude")).toBeNull();
    expect(store.lookupSession("fp-3", "claude")).toBe("sid-3");
  });
});

describe("fingerprintConversation", () => {
  it("builds deterministic fingerprint from model + system + first user message", () => {
    const model = "claude-opus-4-1";
    const systemPrompt = "sys";
    const messages = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "first user" },
      { role: "assistant", content: "reply" },
    ];
    expect(fingerprintConversation(model, systemPrompt, messages)).toEqual(
      fingerprintConversation(model, systemPrompt, messages),
    );
  });
});
