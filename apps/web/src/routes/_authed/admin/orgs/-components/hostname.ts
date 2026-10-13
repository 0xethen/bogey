import { z } from "zod";
import type { T } from "#/lib/translate.tsx";

export const hostnameSchema = (t: T) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, t("hostname.rule"));
