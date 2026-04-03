declare module "@scalar/hono-api-reference" {
  import { Hono } from "hono";
  export interface ScalarProps {
    url?: string;
    theme?: string;
    layout?: string;
    [key: string]: unknown;
  }
  export function Scalar(options?: ScalarProps): ReturnType<Hono["get"]>;
}
