import { Hono } from "hono";

export function createSessionProjectsRoute(engine) {
  const route = new Hono();

  route.get("/session-projects", (c) => {
    try {
      return c.json({ catalog: engine.getSessionProjectCatalog() });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/session-projects/projects", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      if (hasUnsupportedFolderId(body?.folderId)) {
        return c.json({ error: "folders are not supported" }, 400);
      }
      const project = engine.createSessionProject({
        name: body?.name,
        folderId: null,
      });
      return c.json({ ok: true, project });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  route.patch("/session-projects/projects/:id", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      if (hasUnsupportedFolderId(body?.folderId)) {
        return c.json({ error: "folders are not supported" }, 400);
      }
      const project = engine.updateSessionProject(c.req.param("id"), body);
      return c.json({ ok: true, project });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  route.post("/session-projects/projects/reorder", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      if (hasUnsupportedFolderId(body?.folderId)) {
        return c.json({ error: "folders are not supported" }, 400);
      }
      const catalog = engine.reorderSessionProjects({
        folderId: null,
        projectIds: body?.projectIds,
      });
      return c.json({ ok: true, catalog });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  route.post("/session-projects/session-assignment", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const assignment = await engine.setSessionProjectAssignment({
        sessionPath: body?.sessionPath,
        projectId: body?.projectId ?? null,
      });
      return c.json({ ok: true, assignment });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  return route;
}

function hasUnsupportedFolderId(folderId) {
  return folderId !== null && folderId !== undefined;
}
