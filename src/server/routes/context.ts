import type { Hono } from "hono";
import type { Entity, Store } from "../db";
export type Routes = {
  app: Hono;
  s: Store;
  entity: (id: string, kind?: string) => Entity;
  view: (e: Entity) => Record<string, any>;
  checked: (text: string) => Promise<void>;
};
