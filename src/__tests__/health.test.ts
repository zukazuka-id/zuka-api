import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";

describe("GET /health", () => {
  it("returns 200 with service info", async () => {
    const res = await app.request("/health");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("zuka-api");
    expect(body.version).toBe("0.1.0");
    expect(body.db).toBe("connected");
    expect(body.timestamp).toBeDefined();
  });
});
