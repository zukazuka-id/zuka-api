import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { platformConfig } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { success, error } from "../lib/response.js";
import { configQuerySchema } from "../validators/index.js";

const configRoutes = new Hono();

configRoutes.get(
  "/",
  zValidator("query", configQuerySchema),
  async (c) => {
    const { key } = c.req.valid("query");
    const [row] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, key))
      .limit(1);
    if (!row || !row.isPublic) {
      return error(c, "NOT_FOUND", "Config key not found", 404);
    }
    return success(c, { key: row.key, value: row.value });
  },
);

export { configRoutes };
