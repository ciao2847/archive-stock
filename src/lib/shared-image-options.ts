import type { PublicClaimProduct } from "./claims";

/** Preserve listing order and each SKU's independent price/quantity/availability. */
export function groupClaimProducts(products: PublicClaimProduct[]) {
  const groups: PublicClaimProduct[][] = [];
  const byImage = new Map<string, PublicClaimProduct[]>();
  for (const product of products) {
    const existing = product.imageUrl
      ? byImage.get(product.imageUrl)
      : undefined;
    if (existing) existing.push(product);
    else {
      const group = [product];
      groups.push(group);
      if (product.imageUrl) byImage.set(product.imageUrl, group);
    }
  }
  return groups;
}

export function parseOptionNames(text: string) {
  return text
    .split(/[\n、,，]+/u)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The uploader always stores an uncropped main and a smaller thumbnail. */
export function fullProductImage(url: string) {
  return url.replace(/\/thumb\.webp(?=\?|$)/u, "/main.webp");
}
