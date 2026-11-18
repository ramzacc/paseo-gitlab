import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const connectionSettings = defineSettings({
  id: "connection",
  scope: "host",
  version: 1,
  schema: z.object({
    baseUrl: z.string().default("https://gitlab.com"),
  }),
});

// Kept in its own document so the client can write a new token without ever reading the saved one.
export const credentialSettings = defineSettings({
  id: "connection-token",
  scope: "host",
  version: 1,
  schema: z.object({
    token: z.string().default(""),
  }),
});
