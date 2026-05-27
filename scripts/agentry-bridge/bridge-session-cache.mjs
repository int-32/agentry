import { createHash } from "node:crypto";

const CONV_CACHE_MAX = 200; // 简易 LRU 上限

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === "text" && typeof c.text === "string")
      .map(c => c.text)
      .join("\n");
  }
  return "";
}

export function fingerprintConversation(model, systemPrompt, messages) {
  // 首条 user 消息 + system 前 1000 字 + model：可对一条 conv 跨轮稳定标识
  const firstUser = Array.isArray(messages) ? messages.find(m => m && m.role === "user") : null;
  const firstUserText = firstUser ? flattenContent(firstUser.content) : "";
  const sysPart = (systemPrompt || "").slice(0, 1000);
  const usrPart = firstUserText.slice(0, 1000);
  return createHash("sha256").update(`${model}\0${sysPart}\0${usrPart}`).digest("hex").slice(0, 16);
}

export function createConversationSessionStore({ maxEntries = CONV_CACHE_MAX } = {}) {
  const conversationSessions = new Map(); // fp -> { backend, sessionId, lastAccessed }

  function rememberSession(fp, backend, sessionId) {
    if (!fp || !sessionId) return;
    if (conversationSessions.size >= maxEntries) {
      // 淘汰最久未访问
      let oldest = null, oldestT = Infinity;
      for (const [k, v] of conversationSessions) {
        if (v.lastAccessed < oldestT) { oldest = k; oldestT = v.lastAccessed; }
      }
      if (oldest) conversationSessions.delete(oldest);
    }
    conversationSessions.set(fp, { backend, sessionId, lastAccessed: Date.now() });
  }

  function lookupSession(fp, backend) {
    const entry = conversationSessions.get(fp);
    if (!entry || entry.backend !== backend) return null;
    entry.lastAccessed = Date.now();
    return entry.sessionId;
  }

  return {
    rememberSession,
    lookupSession,
  };
}
