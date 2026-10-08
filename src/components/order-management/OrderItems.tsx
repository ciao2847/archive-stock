"use client";
import { ImageIcon } from "lucide-react";

export type OrderDisplayItem = {
  key: string;
  name: string;
  quantity: number;
  amount?: string;
  imageUrl?: string;
  description?: string;
};
export function OrderItems({
  items,
  total,
  onPreview,
}: {
  items: OrderDisplayItem[];
  total: string;
  onPreview?: (item: OrderDisplayItem) => void;
}) {
  return (
    <section
      className="mt-5 min-w-0 overflow-hidden rounded-[12px] border border-line"
      aria-label="商品明細"
    >
      <h4 className="m-0 border-b border-line px-4 py-3 text-[14px] font-bold text-dark">
        商品明細
      </h4>
      <div className="divide-y divide-line">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex min-w-0 items-center gap-3 px-4 py-4"
          >
            {item.imageUrl ? (
              <button
                type="button"
                className="size-14 shrink-0 overflow-hidden rounded-[8px] border border-line bg-light p-0"
                onClick={() => onPreview?.(item)}
                disabled={!onPreview}
                aria-label={`查看 ${item.name} 圖片`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-[8px] bg-light text-muted">
                <ImageIcon size={19} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <strong className="block break-words text-[13px] text-dark">
                {item.name}
              </strong>
              <span className="mt-1 block text-[11px] text-muted">
                數量 {item.quantity}
                {item.description && ` · ${item.description}`}
              </span>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-[#B7791F]">
              {item.amount || "包含於總額"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 bg-primary px-4 py-4 text-white">
        <span className="shrink-0 whitespace-nowrap text-[12px]">
          共 {items.reduce((sum, item) => sum + item.quantity, 0)} 件
        </span>
        <strong
          className="whitespace-nowrap text-[20px]"
          style={{ color: "#D6A84B" }}
        >
          {total}
        </strong>
      </div>
    </section>
  );
}
