const ENABLE_AGENT_CONFIG_CACHE = typeof process === 'undefined' || process.env?.NODE_ENV !== 'test';

const agentConfigCache = new Map<string, unknown>();

export function readAgentConfigCache<T = unknown>(agentId: string): T | undefined {
  if (!ENABLE_AGENT_CONFIG_CACHE) return undefined;
  return agentConfigCache.get(agentId) as T | undefined;
}

export function writeAgentConfigCache(agentId: string, config: unknown): void {
  if (!ENABLE_AGENT_CONFIG_CACHE) return;
  agentConfigCache.set(agentId, config);
}

export function invalidateAgentConfigCache(agentId?: string | null): void {
  if (!agentId) {
    agentConfigCache.clear();
    return;
  }
  agentConfigCache.delete(agentId);
}
