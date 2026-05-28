import crypto from "crypto";
import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../shared/safe-fs.js";
import {
  SESSION_PROJECTS_FILENAME,
  normalizeProjectName,
  normalizeSessionProjectCatalog,
  normalizeSessionProjectId,
  isAutoProjectId,
  serializeSessionProjectCatalog,
} from "../shared/session-projects.js";

export class SessionProjectCatalogStore {
  constructor({ userDir }) {
    if (!userDir) throw new Error("SessionProjectCatalogStore requires userDir");
    this._userDir = userDir;
    this._path = path.join(userDir, SESSION_PROJECTS_FILENAME);
  }

  getCatalog() {
    return normalizeSessionProjectCatalog(this._readRaw());
  }

  createProject({ name, folderId = null }) {
    rejectFolderId(folderId);
    const catalog = this.getCatalog();
    const project = {
      id: this._nextId("project", new Set(catalog.projects.map(item => item.id))),
      name: requiredName(normalizeProjectName(name), "project name is required"),
      folderId: null,
      order: nextOrder(catalog.projects),
    };
    catalog.projects.push(project);
    this._writeCatalog(catalog);
    return project;
  }

  updateProject(id, patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, "folderId")) {
      rejectFolderId(patch.folderId);
    }
    const catalog = this.getCatalog();
    const projectId = normalizeSessionProjectId(id);
    const index = catalog.projects.findIndex(project => project.id === projectId);
    if (index < 0) {
      if (!isAutoProjectId(projectId)) throw new Error("project not found");
      const project = {
        id: projectId,
        name: requiredName(normalizeProjectName(patch.name), "project name is required"),
        folderId: null,
        order: nextOrder(catalog.projects),
      };
      catalog.projects.push(project);
      this._writeCatalog(catalog);
      return project;
    }
    const current = catalog.projects[index];
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      next.name = requiredName(normalizeProjectName(patch.name), "project name is required");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "folderId")) {
      next.folderId = null;
    }
    catalog.projects[index] = next;
    this._writeCatalog(catalog);
    return next;
  }

  reorderProjects({ folderId = null, projectIds = [] } = {}) {
    rejectFolderId(folderId);
    const catalog = this.getCatalog();
    const order = new Map(normalizeIdArray(projectIds).map((id, index) => [id, index]));
    catalog.projects = catalog.projects
      .map(project => (
        order.has(project.id)
          ? { ...project, order: order.get(project.id) }
          : project
      ))
      .sort(compareCatalogItems);
    this._writeCatalog(catalog);
    return catalog;
  }

  _readRaw() {
    try {
      return JSON.parse(fs.readFileSync(this._path, "utf-8"));
    } catch (err) {
      if (err?.code === "ENOENT") return {};
      return {};
    }
  }

  _writeCatalog(catalog) {
    fs.mkdirSync(this._userDir, { recursive: true });
    atomicWriteSync(this._path, JSON.stringify(serializeSessionProjectCatalog(catalog), null, 2) + "\n");
  }

  _nextId(prefix, existingIds) {
    for (let i = 0; i < 8; i += 1) {
      const id = `${prefix}-${crypto.randomUUID()}`;
      if (!existingIds.has(id)) return id;
    }
    throw new Error(`could not allocate ${prefix} id`);
  }
}

function requiredName(name, message) {
  if (!name) throw new Error(message);
  return name;
}

function rejectFolderId(folderId) {
  const normalized = normalizeSessionProjectId(folderId);
  if (normalized) throw new Error("folders are not supported");
}

function nextOrder(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.order) || 0), -1) + 1;
}

function normalizeIdArray(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const raw of ids) {
    const id = normalizeSessionProjectId(raw);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function compareCatalogItems(a, b) {
  return (a.order ?? 0) - (b.order ?? 0)
    || String(a.name || "").localeCompare(String(b.name || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}
