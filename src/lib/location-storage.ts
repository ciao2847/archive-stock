import { z } from "zod";
export type StorageCabinet = {
  id: string;
  name: string;
  code: string;
  rows: number;
  columns: number;
};
export type StorageSlot = {
  id: string;
  code: string;
  cabinet_id: string | null;
  display_name: string | null;
  shelf: number | null;
  bin: number | null;
};
export type StoredProduct = {
  id: string;
  name: string;
  country: string | null;
  price: number;
  stock: number;
  image?: string;
  allocations: Array<{ location_id: string; quantity: number }>;
};
export type StorageData = {
  cabinets: StorageCabinet[];
  slots: StorageSlot[];
  products: StoredProduct[];
};
export const storageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_cabinet"),
    name: z.string().trim().min(1).max(100),
    rows: z.number().int().min(1).max(99),
    columns: z.number().int().min(1).max(99),
  }),
  z.object({
    action: z.literal("resize_cabinet"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    rows: z.number().int().min(1).max(99),
    columns: z.number().int().min(1).max(99),
  }),
  z.object({
    action: z.literal("rename_slot"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
  }),
  z.object({ action: z.literal("delete_slot"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_slot"), id: z.string().uuid() }),
  z.object({
    action: z.literal("putaway"),
    locationId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(1000),
          fromLocationId: z.string().uuid().optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    action: z.literal("quick_add"),
    name: z.string().trim().min(1).max(300),
    country: z.string().trim().min(1).max(100),
    price: z.number().finite().nonnegative(),
    quantity: z.number().int().min(1).max(1000),
    locationId: z.string().uuid().nullable(),
  }),
]);
export type StorageAction = z.infer<typeof storageActionSchema>;
export function unassignedQuantity(product: StoredProduct) {
  return Math.max(
    0,
    product.stock -
      product.allocations.reduce((sum, row) => sum + row.quantity, 0),
  );
}
export function slotTotals(products: StoredProduct[], id: string) {
  const items = products.flatMap((product) => {
    const row = product.allocations.find((row) => row.location_id === id);
    return row && row.quantity > 0 ? [{ product, quantity: row.quantity }] : [];
  });
  return {
    items,
    count: items.length,
    quantity: items.reduce((sum, row) => sum + row.quantity, 0),
  };
}
