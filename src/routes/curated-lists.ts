import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getActiveCuratedLists } from "../lib/curated-list-service.js";
import { sectionLimitSchema } from "../validators/index.js";
import { success } from "../lib/response.js";

const curatedListRoutes = new Hono();

// GET /curated-lists — active curated lists with restaurants for homepage sections
curatedListRoutes.get(
  "/",
  zValidator("query", sectionLimitSchema.optional()),
  async (c) => {
    const query = c.req.valid("query") ?? {};
    const latStr = c.req.query("lat");
    const lngStr = c.req.query("lng");
    const lat = latStr ? parseFloat(latStr) : undefined;
    const lng = lngStr ? parseFloat(lngStr) : undefined;

    const lists = await getActiveCuratedLists(
      lat != null && !isNaN(lat) ? lat : undefined,
      lng != null && !isNaN(lng) ? lng : undefined
    );

    return success(c, lists);
  }
);

export { curatedListRoutes };
