import { Hono } from "hono";
import { getActiveBanners } from "../lib/banner-service.js";
import { success } from "../lib/response.js";

const bannerRoutes = new Hono();

// GET /banners — active banners for homepage carousel
bannerRoutes.get("/", async (c) => {
  const banners = await getActiveBanners();
  return success(c, banners);
});

export { bannerRoutes };
