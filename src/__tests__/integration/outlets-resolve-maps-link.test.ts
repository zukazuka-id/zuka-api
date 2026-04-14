import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";

describe("Outlet Maps URL Resolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /outlets/resolve-maps-link parses a full Google Maps place URL", async () => {
    const res = await app.request("/api/v1/outlets/resolve-maps-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://www.google.com/maps/place/Solaria+-+Summarecon+Mall+Serpong/@-6.2412395,106.623306,790m/data=!3m3!1e3!4b1!5s0x2e69bb3031a3c78f:0x943e72b1158b634b!4m6!3m5!1s0x2e69fc0a0e6af2dd:0x583dfeade5de62f4!8m2!3d-6.2412395!4d106.6281769!16s%2Fg%2F1pzykn3_v",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.resolved).toBe(true);
    expect(body.data.lat).toBeCloseTo(-6.2412395, 6);
    expect(body.data.lng).toBeCloseTo(106.6281769, 6);
    expect(body.data.address).toContain("Solaria");
    expect(body.data.warnings).toEqual([]);
  });

  it("POST /outlets/resolve-maps-link parses coordinate-only maps URLs", async () => {
    const res = await app.request("/api/v1/outlets/resolve-maps-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://www.google.com/maps/@-6.2000000,106.8166667,17z",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.resolved).toBe(true);
    expect(body.data.lat).toBeCloseTo(-6.2, 6);
    expect(body.data.lng).toBeCloseTo(106.8166667, 6);
    expect(body.data.address).toBeNull();
    expect(body.data.warnings.length).toBeGreaterThan(0);
  });

  it("POST /outlets/resolve-maps-link follows Google short-link redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.google.com/maps/place/Foo+Bar/@-6.123456,106.654321,17z/data=!3m1!4b1",
          },
        })
      )
    );

    const res = await app.request("/api/v1/outlets/resolve-maps-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://maps.app.goo.gl/example-short-link",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.resolved).toBe(true);
    expect(body.data.lat).toBeCloseTo(-6.123456, 6);
    expect(body.data.lng).toBeCloseTo(106.654321, 6);
    expect(body.data.address).toContain("Foo Bar");
  });

  it("POST /outlets/resolve-maps-link returns warning payload for malformed URLs", async () => {
    const res = await app.request("/api/v1/outlets/resolve-maps-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://www.google.com/maps/this-does-not-contain-location-data",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.resolved).toBe(false);
    expect(body.data.address).toBeNull();
    expect(body.data.lat).toBeNull();
    expect(body.data.lng).toBeNull();
    expect(body.data.warnings.length).toBeGreaterThan(0);
  });
});
