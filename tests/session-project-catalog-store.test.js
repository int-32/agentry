import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { SessionProjectCatalogStore } from "../core/session-project-catalog-store.js";

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-session-projects-"));
  const userDir = path.join(root, "user");
  return {
    root,
    userDir,
    store: new SessionProjectCatalogStore({ userDir }),
  };
}

describe("SessionProjectCatalogStore", () => {
  it("creates a project catalog file only when the user creates organization data", () => {
    const { userDir, store } = makeStore();

    expect(store.getCatalog()).toEqual({ folders: [], projects: [] });
    expect(fs.existsSync(path.join(userDir, "session-projects.json"))).toBe(false);

    const project = store.createProject({ name: "简历和作品集" });

    expect(project.folderId).toBe(null);
    expect(JSON.parse(fs.readFileSync(path.join(userDir, "session-projects.json"), "utf-8"))).toEqual({
      version: 1,
      folders: [],
      projects: [project],
    });
  });

  it("renames projects without changing session ownership", () => {
    const { store } = makeStore();

    const project = store.createProject({ name: "OH-Plugins" });

    expect(store.updateProject(project.id, { name: "OH Plugins" })).toMatchObject({
      id: project.id,
      name: "OH Plugins",
    });
  });

  it("persists project ordering in a single project level", () => {
    const { store } = makeStore();

    const projectA = store.createProject({ name: "A1" });
    const projectB = store.createProject({ name: "A2" });
    const projectC = store.createProject({ name: "Root" });
    const reordered = store.reorderProjects({ folderId: null, projectIds: [projectB.id, projectA.id] });

    expect(reordered.projects.map(project => project.id)).toEqual([
      projectB.id,
      projectA.id,
      projectC.id,
    ]);
  });

  it("rejects blank names and unsupported folder moves instead of silently falling back", () => {
    const { store } = makeStore();

    const project = store.createProject({ name: "Good" });
    expect(() => store.createProject({ name: " " })).toThrow(/name/);
    expect(() => store.createProject({ name: "Bad", folderId: "missing-folder" })).toThrow(/folders/);
    expect(() => store.updateProject(project.id, { folderId: "folder-work" })).toThrow(/folders/);
    expect(() => store.reorderProjects({ folderId: "folder-work", projectIds: [project.id] })).toThrow(/folders/);
  });

  it("flattens older catalog files that still contain folders", () => {
    const { userDir, store } = makeStore();
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, "session-projects.json"), JSON.stringify({
      version: 1,
      folders: [{ id: "folder-work", name: "作品集", order: 0 }],
      projects: [{ id: "project-resume", name: "简历和作品集", folderId: "folder-work", order: 0 }],
    }));

    expect(store.getCatalog()).toEqual({
      folders: [],
      projects: [{ id: "project-resume", name: "简历和作品集", folderId: null, order: 0 }],
    });
  });

  it("materializes cwd-derived project metadata when an auto project is renamed or reordered", () => {
    const { store } = makeStore();
    const project = store.updateProject("cwd:%2Ftmp%2Fproject-hana", { name: "project-hana" });

    expect(project).toMatchObject({
      id: "cwd:%2Ftmp%2Fproject-hana",
      name: "project-hana",
      folderId: null,
      order: 0,
    });
    expect(store.getCatalog().projects).toEqual([project]);
    expect(store.reorderProjects({ folderId: null, projectIds: [project.id] }).projects[0].id).toBe(project.id);
  });
});
