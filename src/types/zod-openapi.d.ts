declare module "@hono/zod-openapi" {
  import { z as zod } from "zod";
  export const z: typeof zod;
  export class OpenAPIHono {
    openapi(...args: unknown[]): ReturnType<OpenAPIHono["get"]>;
    get(...args: unknown[]): ReturnType<OpenAPIHono["get"]>;
    post(...args: unknown[]): ReturnType<OpenAPIHono["get"]>;
    put(...args: unknown[]): ReturnType<OpenAPIHono["get"]>;
    delete(...args: unknown[]): ReturnType<OpenAPIHono["get"]>;
  }
  export function createRoute(opts: unknown): unknown;
}
