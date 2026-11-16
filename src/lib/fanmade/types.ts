import type { PublicClaimForm, PublicClaimProduct } from "@/lib/claims";
export type FanmadeForm = {
  id: number;
  title: string;
  token: string;
  isOpen: boolean;
};
export type FanmadeProduct = {
  id: string;
  catalogGroupId?: string;
  sku: string;
  title: string;
  craft: string;
  ip: string;
  ipId: string;
  stock: number;
  reserved: number;
  active: boolean;
  listed: boolean;
  imagePaths: string[];
  updatedAt: string;
  videoStatus?: "pending" | "processing" | "ready" | "failed";
  videoError?: string;
};
export type FanmadeManagement = {
  price: number | null;
  forms: FanmadeForm[];
  products: FanmadeProduct[];
  total: number;
  variantTotal?: number;
  legacy: Array<{ id: string; name: string; stock: number; crafts: string[] }>;
};
export type FanmadeGroup = {
  id: string;
  name: string;
  count: number;
  variantCount?: number;
};
export type FanmadeHeader = Omit<PublicClaimForm, "products"> & {
  price: number;
  groups: FanmadeGroup[];
  bannerImagePath?: string;
};
export type FanmadePublicProduct = PublicClaimProduct & {
  catalogGroupId?: string;
  title: string;
  craft: string;
  available: number;
  thumbnailPath: string;
  posterPath?: string;
  videoAvailable: boolean;
};
export type FanmadePage = {
  products: FanmadePublicProduct[];
  total: number;
  page: number;
  hasMore: boolean;
};
