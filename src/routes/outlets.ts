import { Hono } from "hono";
import { success, error } from "../lib/response.js";

const outletRoutes = new Hono();

type ResolveMapsResult = {
  resolved: boolean;
  address: string | null;
  lat: number | null;
  lng: number | null;
  warnings: string[];
};

const GOOGLE_MAPS_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

function parseCoordinate(text: string | undefined) {
  if (!text) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function decodeAddressSegment(value: string | null) {
  if (!value) return null;
  const decoded = decodeURIComponent(value).replace(/\+/g, " ").trim();
  return decoded.length > 0 ? decoded : null;
}

function extractCoordsFromUrl(url: URL) {
  const dataMatch = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) {
    return {
      lat: parseCoordinate(dataMatch[1]),
      lng: parseCoordinate(dataMatch[2]),
    };
  }

  const atMatch = url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    return {
      lat: parseCoordinate(atMatch[1]),
      lng: parseCoordinate(atMatch[2]),
    };
  }

  return { lat: null, lng: null };
}

function extractAddressFromUrl(url: URL) {
  const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);
  if (placeMatch) {
    return decodeAddressSegment(placeMatch[1]);
  }

  const queryAddress =
    url.searchParams.get("q") ??
    url.searchParams.get("query") ??
    url.searchParams.get("destination");

  return decodeAddressSegment(queryAddress);
}

async function resolveShortLink(url: URL) {
  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
  });

  if (response.headers.has("location")) {
    return response.headers.get("location");
  }

  return response.url || null;
}

async function resolveGoogleMapsUrl(rawUrl: string): Promise<ResolveMapsResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      resolved: false,
      address: null,
      lat: null,
      lng: null,
      warnings: ["Invalid URL format."],
    };
  }

  if (!GOOGLE_MAPS_HOSTS.has(url.hostname)) {
    return {
      resolved: false,
      address: null,
      lat: null,
      lng: null,
      warnings: ["Only Google Maps URLs are supported."],
    };
  }

  if (url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl") {
    try {
      const redirectedLocation = await resolveShortLink(url);
      if (redirectedLocation) {
        return resolveGoogleMapsUrl(redirectedLocation);
      }
      return {
        resolved: false,
        address: null,
        lat: null,
        lng: null,
        warnings: ["Could not resolve the Google Maps short link."],
      };
    } catch {
      return {
        resolved: false,
        address: null,
        lat: null,
        lng: null,
        warnings: ["Could not resolve the Google Maps short link."],
      };
    }
  }

  const { lat, lng } = extractCoordsFromUrl(url);
  const address = extractAddressFromUrl(url);
  const warnings: string[] = [];

  if (lat == null || lng == null) {
    return {
      resolved: false,
      address: null,
      lat: null,
      lng: null,
      warnings: ["Could not extract coordinates from this Google Maps URL."],
    };
  }

  if (!address) {
    warnings.push("Coordinates resolved, but address text could not be extracted. Please review manually.");
  }

  return {
    resolved: true,
    address,
    lat,
    lng,
    warnings,
  };
}

// POST /outlets/resolve-maps-link — resolve Google Maps short URL to lat/lng
outletRoutes.post("/resolve-maps-link", async (c) => {
  const body = await c.req.json();
  const { url } = body;
  if (!url) {
    return error(c, "VALIDATION_ERROR", "Google Maps URL is required", 400);
  }

  const resolved = await resolveGoogleMapsUrl(url);
  return success(c, resolved);
});

export { outletRoutes };
