export const APP_EVENTS = Object.freeze([
  "agent-created",
  "agent-config-changed",
  "agent-deleted",
  "agent-switched",
  "agent-updated",
  "agent-workspace-changed",
  "computer-use-permissions-requested",
  "computer-use-settings-changed",
  "editor-typography-changed",
  "font-changed",
  "locale-changed",
  "leaves-overlay-changed",
  "memory-master-changed",
  "models-changed",
  "network-proxy-changed",
  "paper-texture-changed",
  "projects-changed",
  "skills-changed",
  "theme-changed",
]);

/** @param {string} type */
export function isKnownAppEventType(type) {
  return APP_EVENTS.includes(type);
}
