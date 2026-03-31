import { Hono } from "hono";
import { success, error } from "../lib/response.js";

const outletRoutes = new Hono();

// POST /outlets/resolve-maps-link — resolve Google Maps short URL to lat/lng
outletRoutes.post("/resolve-maps-link", async (c) => {
  const body = await c.req.json();
  const { url } = body;
  if (!url) {
    return error(c, "VALIDATION_ERROR", "Google Maps URL is required", 400);
  }

  // Placeholder: follow redirects + parse coordinates from Maps URL
  // TODO: Implement real URL resolution (follow redirect, extract @lat,lng)
  return success(c, {
    originalUrl: url,
    lat: -6.2088,
    lng: 106.8456,
    resolved: false,
    note: "Placeholder — real resolution not yet implemented",
  });
});

export { outletRoutes };
