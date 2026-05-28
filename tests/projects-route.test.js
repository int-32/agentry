import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import fs from "fs";
import os from "os";
import path from "path";
import { createProjectsRoute } from "../server/routes/projects.js";

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-projects-route-test-"));
}

describe("projects route", () => {
  let tmpDir;
  let app;
  let emitEvent;
  let workspaceRoot;
  let docsRoot;

  beforeEach(() => {
    tmpDir = mktemp();
    workspaceRoot = path.join(tmpDir, "repo");
    docsRoot = path.join(tmpDir, "docs");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(docsRoot, { recursive: true });
    emitEvent = vi.fn();

    app = new Hono();
    app.route("/api", createProjectsRoute({
      userDir: path.join(tmpDir, "user"),
      emitEvent,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates, lists, updates, and deletes project registry entries", async () => {
    const createRes = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Agentry",
        workspaceRoot,
        docsRoot,
        testCommand: "npm test",
        description: "desktop agent app",
        modules: ["desktop", "server", "desktop"],
      }),
    });

    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.project).toMatchObject({
      name: "Agentry",
      workspaceRoot,
      docsRoot,
      testCommand: "npm test",
      description: "desktop agent app",
      modules: ["desktop", "server"],
    });
    expect(created.project.id).toMatch(/^prj_/);
    expect(emitEvent).toHaveBeenCalledWith({
      type: "app_event",
      event: {
        type: "projects-changed",
        payload: { projectId: created.project.id },
        source: "server",
      },
    }, null);

    const listRes = await app.request("/api/projects");
    expect(await listRes.json()).toMatchObject({
      projects: [expect.objectContaining({ id: created.project.id, name: "Agentry" })],
    });

    const updateRes = await app.request(`/api/projects/${created.project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agentry Desktop", testCommand: "npm run typecheck" }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({
      project: expect.objectContaining({
        id: created.project.id,
        name: "Agentry Desktop",
        workspaceRoot,
        docsRoot,
        testCommand: "npm run typecheck",
      }),
    });

    const deleteRes = await app.request(`/api/projects/${created.project.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });
    expect(await (await app.request("/api/projects")).json()).toEqual({ projects: [] });
  });

  it("rejects missing or invalid workspace roots", async () => {
    const missingName = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot }),
    });
    expect(missingName.status).toBe(400);

    const missingWorkspace = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Broken", workspaceRoot: path.join(tmpDir, "missing") }),
    });
    expect(missingWorkspace.status).toBe(400);
    expect((await missingWorkspace.json()).error).toMatch(/workspaceRoot/);
  });
});
