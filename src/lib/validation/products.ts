import { z } from "zod";

import { LOCATION_CODE_PATTERN } from "@/constants";

const productBaseSchema = z.object({
  name: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100),
  country: z.string().max(100),
  source: z.string().max(300),
  location: z.string().regex(LOCATION_CODE_PATTERN),
  stock: z.number().int().min(0).max(1000),
  price: z.number().nonnegative(),
  format: z.string().max(100),
  size: z.string().max(100),
  feature: z.string().max(2000),
});

export const createProductSchema = productBaseSchema.extend({
  work: z.string().trim().min(1).max(300),
  stock: z.number().int().min(1).max(1000),
  cost: z.number().nonnegative(),
  imagePaths: z.array(z.string().min(1).max(1000)).max(2),
  crafts: z.array(z.string().max(100)).max(30),
});

export const updateProductSchema = productBaseSchema.extend({
  location: z.union([z.string().regex(LOCATION_CODE_PATTERN), z.literal("")]),
  cost: z.number().nonnegative().nullable(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
