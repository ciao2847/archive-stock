export type ProductMergePreview = {
  source: { id: string; sku: string; name: string; stock: number };
  target: { id: string; sku: string; name: string; stock: number };
  forms: Array<{
    id: number;
    title: string;
    targetAlreadyListed: boolean;
    listing: {
      name: string;
      price: number;
      maxQuantity: number;
      isEnabled: boolean;
    };
  }>;
  submissionCount: number;
  fulfillmentCount: number;
  conflicts: Array<{ kind: "claim" | "order" | "bundle"; code: string }>;
  token: string;
  merged: boolean;
};
