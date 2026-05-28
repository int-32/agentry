import { Hono } from "hono";
import { emitAppEvent } from "../app-events.js";
import { safeJson } from "../hono-helpers.js";
import { createProjectRegistry } from "../../lib/projects/project-registry.js";

export function createProjectsRoute(engine) {
  const route = new Hono();
  const registry = createProjectRegistry({ userDir: engine.userDir });

  route.get("/projects", async (c) => {
    try {
      return c.json({ projects: await registry.listProjects() });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });

  route.post("/projects", async (c) => {
    try {
      const project = await registry.createProject(await safeJson(c));
      emitAppEvent(engine, "projects-changed", { projectId: project.id });
      return c.json({ ok: true, project });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });

  route.put("/projects/:id", async (c) => {
    try {
      const project = await registry.updateProject(c.req.param("id"), await safeJson(c));
      emitAppEvent(engine, "projects-changed", { projectId: project.id });
      return c.json({ ok: true, project });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });

  route.delete("/projects/:id", async (c) => {
    try {
      await registry.deleteProject(c.req.param("id"));
      emitAppEvent(engine, "projects-changed", { projectId: c.req.param("id") });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });

  return route;
}
