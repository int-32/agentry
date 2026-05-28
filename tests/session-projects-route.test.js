import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

function makeApp(engine) {
  const app = new Hono();
  app.route("/api", createSessionProjectsRoute(engine));
  return app;
}

import { createSessionProjectsRoute } from "../server/routes/session-projects.js";

describe("session projects route", () => {
  it("reads the user-level project catalog", async () => {
    const catalog = {
      folders: [],
      projects: [{ id: "project-resume", name: "简历和作品集", folderId: null, order: 0 }],
    };
    const engine = {
      getSessionProjectCatalog: vi.fn(() => catalog),
    };
    const app = makeApp(engine);

    const res = await app.request("/api/session-projects");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ catalog });
    expect(engine.getSessionProjectCatalog).toHaveBeenCalledTimes(1);
  });

  it("creates projects through the engine facade", async () => {
    const engine = {
      createSessionProject: vi.fn(({ name, folderId }) => ({ id: "project-new", name, folderId, order: 3 })),
    };
    const app = makeApp(engine);

    const projectRes = await app.request("/api/session-projects/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "插件官网" }),
    });
    const projectBody = await projectRes.json();

    expect(projectRes.status).toBe(200);
    expect(projectBody.project).toEqual({ id: "project-new", name: "插件官网", folderId: null, order: 3 });
    expect(engine.createSessionProject).toHaveBeenCalledWith({ name: "插件官网", folderId: null });
  });

  it("renames projects and persists same-level order", async () => {
    const engine = {
      updateSessionProject: vi.fn(() => ({ id: "project-hana", name: "Project Hana", folderId: null, order: 0 })),
      reorderSessionProjects: vi.fn(() => ({
        folders: [],
        projects: [
          { id: "project-hana", name: "Project Hana", folderId: null, order: 0 },
          { id: "project-plugins", name: "OH-Plugins", folderId: null, order: 1 },
        ],
      })),
    };
    const app = makeApp(engine);

    const renameRes = await app.request("/api/session-projects/projects/project-hana", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Project Hana" }),
    });
    const renameBody = await renameRes.json();

    const orderRes = await app.request("/api/session-projects/projects/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: null, projectIds: ["project-hana", "project-plugins"] }),
    });
    const orderBody = await orderRes.json();

    expect(renameRes.status).toBe(200);
    expect(renameBody.project.name).toBe("Project Hana");
    expect(engine.updateSessionProject).toHaveBeenCalledWith("project-hana", { name: "Project Hana" });
    expect(orderRes.status).toBe(200);
    expect(orderBody.catalog.projects.map((project) => project.id)).toEqual(["project-hana", "project-plugins"]);
    expect(engine.reorderSessionProjects).toHaveBeenCalledWith({
      folderId: null,
      projectIds: ["project-hana", "project-plugins"],
    });
  });

  it("returns a clear error for unsupported folder routes", async () => {
    const engine = {
      createSessionProject: vi.fn(),
    };
    const app = makeApp(engine);

    const res = await app.request("/api/session-projects/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad", folderId: "folder-work" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "folders are not supported" });
    expect(engine.createSessionProject).not.toHaveBeenCalled();

    const folderRes = await app.request("/api/session-projects/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unused" }),
    });
    expect(folderRes.status).toBe(404);
  });

  it("assigns a session to a project through session meta", async () => {
    const engine = {
      setSessionProjectAssignment: vi.fn(async ({ sessionPath, projectId }) => ({ sessionPath, projectId })),
    };
    const app = makeApp(engine);

    const res = await app.request("/api/session-projects/session-assignment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionPath: "/tmp/agents/hana/sessions/a.jsonl",
        projectId: "project-hana",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      assignment: {
        sessionPath: "/tmp/agents/hana/sessions/a.jsonl",
        projectId: "project-hana",
      },
    });
    expect(engine.setSessionProjectAssignment).toHaveBeenCalledWith({
      sessionPath: "/tmp/agents/hana/sessions/a.jsonl",
      projectId: "project-hana",
    });
  });
});
