import { describe, it, expect } from "vitest";
import { app } from "../../app.js";

describe("CORS", () => {
  it.each([
    "http://localhost:7689",
    "http://100.122.155.96:7689",
  ])("allows member-forge origin %s for auth preflight", async (origin) => {
    const res = await app.request("/api/v1/auth/register", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
