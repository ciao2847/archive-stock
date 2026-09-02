export type Status = "在庫" | "已預留" | "待出貨" | "售罄" | "已出貨";
export type Product = {
  id: string;
  dbId?: string;
  name: string;
  work: string;
  category: string;
  country: string;
  source: string;
  format?: string;
  size?: string;
  crafts?: string[];
  location: string;
  stock: number;
  status: Status;
  price: number;
  cost: number;
  feature?: string;
  accent: string;
  image?: string;
  thumbnail?: string;
  qrLabels?: {
    token: string;
    batchCode?: string;
    status: "active" | "used" | "revoked";
  }[];
};
export type Order = {
  dbId: string;
  id: string;
  customer: string;
  createdAt: string;
  status: string;
  payment: string;
  itemIds: string[];
  packedIds: string[];
  total?: number;
};

export type FinanceOverview = {
  revenue: number;
  cost: number;
  profit: number;
};

export type AccountData = {
  userName: string;
  isAdmin: boolean;
  finance: FinanceOverview | null;
};
