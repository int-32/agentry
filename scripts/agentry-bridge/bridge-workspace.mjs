import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cleanWorkspacePath } from "../../lib/bridge/local-cli-runtime-config.js";

function maybeWorkspaceRoot(raw) {
  const value = cleanWorkspacePath(raw);
  if (!value || value === "未设置" || value === "not set") return "";
  if (!path.isAbsolute(value)) return "";
  try {
    const stat = fs.statSync(value);
    if (stat.isDirectory()) return value;
    if (stat.isFile()) return path.dirname(value);
  } catch {}
  return "";
}

export function extractWorkspaceRootsFromPrompt(prompt) {
  const roots = [];
  const add = (value) => {
    const root = maybeWorkspaceRoot(value);
    if (root && !roots.includes(root)) roots.push(root);
  };

  for (const match of String(prompt || "").matchAll(/(?:当前工作目录|Current working directory)\s*[:：]\s*([^\r\n]+)/gi)) {
    add(match[1]);
  }
  for (const match of String(prompt || "").matchAll(/^\s*-\s*(\/[^\r\n]+)/gm)) {
    add(match[1]);
  }
  for (const match of String(prompt || "").matchAll(/\/Users\/[^\s`"'<>，。；：、)）\]}]+/g)) {
    add(match[0]);
  }

  return roots.slice(0, 8);
}

export function antigravityWorkspaceUris(workspaceConfig = {}, prompt = "") {
  const roots = [];
  const add = (value) => {
    const root = maybeWorkspaceRoot(value);
    if (root && !roots.includes(root)) roots.push(root);
  };

  add(workspaceConfig.workspaceRoot);
  for (const folder of workspaceConfig.workspaceFolders || []) add(folder);
  for (const folder of extractWorkspaceRootsFromPrompt(prompt)) add(folder);

  return roots.map(root => pathToFileURL(root).href);
}
