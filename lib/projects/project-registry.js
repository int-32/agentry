import crypto from "crypto";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModules(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeString).filter(Boolean)));
}

function normalizeProjectInput(input = {}, existing = null) {
  const name = normalizeString(input.name ?? existing?.name);
  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }

  const workspaceRoot = normalizeString(input.workspaceRoot ?? existing?.workspaceRoot);
  if (!workspaceRoot) {
    const err = new Error("workspaceRoot is required");
    err.status = 400;
    throw err;
  }

  const docsRoot = normalizeString(input.docsRoot ?? existing?.docsRoot);
  const testCommand = normalizeString(input.testCommand ?? existing?.testCommand);
  const description = normalizeString(input.description ?? existing?.description);
  const modules = normalizeModules(input.modules ?? existing?.modules);

  return {
    name,
    workspaceRoot,
    docsRoot,
    testCommand,
    description,
    modules,
  };
}

function assertExistingDirectory(value, fieldName) {
  if (!value) return;
  if (!path.isAbsolute(value)) {
    const err = new Error(`${fieldName} must be an absolute path`);
    err.status = 400;
    throw err;
  }
  try {
    if (fs.statSync(value).isDirectory()) return;
  } catch {
    // Fall through to the explicit error below.
  }
  const err = new Error(`${fieldName} must be an existing directory`);
  err.status = 400;
  throw err;
}

function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const aTime = a.updatedAt || a.createdAt || "";
    const bTime = b.updatedAt || b.createdAt || "";
    return bTime.localeCompare(aTime) || a.name.localeCompare(b.name);
  });
}

export function createProjectRegistry({ userDir }) {
  if (!userDir) throw new Error("userDir is required");
  const filePath = path.join(userDir, "projects.json");

  async function readRaw() {
    try {
      const raw = await fsp.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.projects) ? parsed.projects : [];
    } catch (err) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async function writeRaw(projects) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    const payload = `${JSON.stringify({ projects }, null, 2)}\n`;
    await fsp.writeFile(tmpPath, payload, "utf-8");
    await fsp.rename(tmpPath, filePath);
  }

  async function listProjects() {
    return sortProjects(await readRaw());
  }

  async function createProject(input = {}) {
    const projects = await readRaw();
    const normalized = normalizeProjectInput(input);
    assertExistingDirectory(normalized.workspaceRoot, "workspaceRoot");
    assertExistingDirectory(normalized.docsRoot, "docsRoot");

    const id = `prj_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = nowIso();
    const project = {
      id,
      ...normalized,
      createdAt,
      updatedAt: createdAt,
    };
    await writeRaw(sortProjects([project, ...projects]));
    return project;
  }

  async function updateProject(id, patch = {}) {
    const projectId = normalizeString(id);
    if (!projectId) {
      const err = new Error("id is required");
      err.status = 400;
      throw err;
    }

    const projects = await readRaw();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index < 0) {
      const err = new Error("Project not found");
      err.status = 404;
      throw err;
    }

    const existing = projects[index];
    const normalized = normalizeProjectInput(patch, existing);
    assertExistingDirectory(normalized.workspaceRoot, "workspaceRoot");
    assertExistingDirectory(normalized.docsRoot, "docsRoot");

    const updated = {
      ...existing,
      ...normalized,
      updatedAt: nowIso(),
    };
    const next = [...projects];
    next[index] = updated;
    await writeRaw(sortProjects(next));
    return updated;
  }

  async function deleteProject(id) {
    const projectId = normalizeString(id);
    if (!projectId) {
      const err = new Error("id is required");
      err.status = 400;
      throw err;
    }

    const projects = await readRaw();
    const next = projects.filter((project) => project.id !== projectId);
    if (next.length === projects.length) {
      const err = new Error("Project not found");
      err.status = 404;
      throw err;
    }
    await writeRaw(sortProjects(next));
    return { ok: true };
  }

  return {
    filePath,
    listProjects,
    createProject,
    updateProject,
    deleteProject,
  };
}
