import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import registerCardRoute from "../plugins/image-gen/routes/card.js";

function makeApp(tasks = []) {
  const app = new Hono();
  registerCardRoute(app, {
    pluginId: "image-gen",
    _mediaGen: {
      store: {
        getByBatch: () => tasks,
      },
    },
  });
  return app;
}

describe("image-gen card route", () => {
  it("returns 400 when batch is missing", async () => {
    const app = makeApp();
    const res = await app.request("/card");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Missing batch parameter");
  });

  it("renders iframe HTML for a valid batch route", async () => {
    const app = makeApp([
      {
        taskId: "task-1",
        status: "pending",
        params: { ratio: "16:9" },
      },
    ]);

    const res = await app.request("/card?batch=batch-1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('data-task-id="task-1"');
    expect(html).toContain("/api/plugins/image-gen/tasks/batch/batch-1");
  });
});
