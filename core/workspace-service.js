/**
 * WorkspaceService -- agent workspace ownership and approval rules.
 *
 * Agent config owns explicit home folders. Session cwd and workspace history are
 * projections around that source, so route/engine code should ask this service
 * instead of rebuilding workspace root lists locally.
 */

import fs from "fs";
import path from "path";

function asAgentList(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return value;
  return [];
}

function existsDir(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function realPathForWorkspaceCheck(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return fs.realpathSync(value);
  } catch {
    try {
      return fs.realpathSync(path.dirname(value));
    } catch {
      return null;
    }
  }
}

function isInsideResolvedPath(resolved, root) {
  const base = realPathForWorkspaceCheck(root);
  if (!base) return false;
  return resolved === base || resolved.startsWith(base + path.sep);
}

function pushExisting(values, value) {
  if (typeof value === "string" && value.trim()) values.push(value);
}

export class WorkspaceService {
  constructor(deps = {}) {
    this._d = deps;
  }

  getExplicitHomeFolder(agentId) {
    const targetId = agentId || this._getPrimaryAgentId();
    if (!targetId) return null;
    const agent = this._d.getAgentById?.(targetId);
    const folder = agent?.config?.desk?.home_folder;
    return existsDir(folder) ? folder : null;
  }

  getHomeFolder(agentId) {
    return this.getExplicitHomeFolder(agentId);
  }

  setHomeFolder(agentId, folder) {
    const agent = this._d.getAgentById?.(agentId);
    if (!agent) return false;
    if (folder) {
      agent.updateConfig({ desk: { home_folder: folder } });
    } else {
      agent.updateConfig({ desk: { home_folder: null } });
    }
    return true;
  }

  getDefaultDeskCwd() {
    return this.getHomeFolder(this._getActiveAgentId()) || null;
  }

  isApprovedWorkspaceDir(dir) {
    const resolved = realPathForWorkspaceCheck(dir);
    if (!resolved) return false;
    return this._currentWorkspaceRoots().some(root => isInsideResolvedPath(resolved, root));
  }

  isApprovedDeskDir(dir) {
    const resolved = realPathForWorkspaceCheck(dir);
    if (!resolved) return false;
    return this._approvedDeskRoots().some(root => isInsideResolvedPath(resolved, root));
  }

  _currentWorkspaceRoots() {
    const roots = [];
    pushExisting(roots, this.getHomeFolder(this._getActiveAgentId()));
    pushExisting(roots, this._d.getDeskCwd?.());
    for (const folder of this._getSessionWorkspaceFolders()) {
      pushExisting(roots, folder);
    }
    return roots;
  }

  _approvedDeskRoots() {
    const roots = [...this._currentWorkspaceRoots()];
    const config = this._d.getConfig?.() || {};
    if (Array.isArray(config.cwd_history)) {
      for (const folder of config.cwd_history) pushExisting(roots, folder);
    }
    for (const agent of asAgentList(this._d.getAgents?.())) {
      pushExisting(roots, agent?.config?.desk?.home_folder);
      pushExisting(roots, agent?.config?.last_cwd);
      if (Array.isArray(agent?.config?.cwd_history)) {
        for (const folder of agent.config.cwd_history) pushExisting(roots, folder);
      }
    }
    return roots;
  }

  _getSessionWorkspaceFolders() {
    const sessionPath = this._d.getCurrentSessionPath?.() || null;
    const folders = this._d.getSessionWorkspaceFolders?.(sessionPath);
    return Array.isArray(folders) ? folders : [];
  }

  _getPrimaryAgentId() {
    return this._d.getPrimaryAgentId?.() || this._getActiveAgentId();
  }

  _getActiveAgentId() {
    return this._d.getActiveAgentId?.() || null;
  }
}

export function createWorkspaceService(deps) {
  return new WorkspaceService(deps);
}
