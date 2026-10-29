import { QuantityStepper } from "@/components/ui/QuantityStepper";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ImageIcon, ShoppingBag } from "lucide-react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { getContrastColor } from "@/lib/claim-form-theme";
import type { PublicClaimForm } from "@/lib/claims";
import type { SelectedClaimProduct } from "./types";
import { currency } from "./format";

export function ClaimProductSelection({
  form,
  quantities,
  selectedProducts,
  availableProductCount,
  itemCount,
  subtotal,
  submitting,
  onQuantityChange,
}: {
  form: PublicClaimForm;
  quantities: Record<string, number>;
  selectedProducts: SelectedClaimProduct[];
  availableProductCount: number;
  itemCount: number;
  subtotal: number;
  submitting: boolean;
  onQuantityChange: (productId: string, value: number, maximum: number) => void;
}) {
  const surfaceText = getContrastColor(form.theme.surfaceColor);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
    label?: string;
  } | null>(null);
  return (
    <>
      <section
        aria-label="商品與訂購總額"
        className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] text-[var(--claim-surface-text)]"
      >
        <div className="p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold">
              <ShoppingBag size={17} className="text-[var(--claim-primary)]" />
              選擇商品
            </h2>
            <span className="text-[11px] text-[var(--claim-surface-muted)]">
              共 {form.products.length} 項 · {availableProductCount} 項可選
            </span>
          </div>
          {form.products.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingBag size={32} className="mx-auto opacity-60" />
              <h3 className="mb-0 mt-3 text-[17px]">商品即將上架</h3>
              <p className="mb-0 mt-2 text-[12px] text-[var(--claim-surface-muted)]">
                管理者更新後，重新整理即可查看商品。
              </p>
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
              {form.products.map((product) => {
                const quantity = product.isEnabled
                  ? (quantities[product.id] ?? 0)
                  : 0;
                return (
                  <article
                    key={product.id}
                    className="min-w-0"
                    aria-label={product.name}
                  >
                    {product.imageUrl ? (
                      <button
                        type="button"
                        className={`group block aspect-square w-full overflow-hidden rounded-[9px] border border-[var(--claim-border)] bg-[var(--claim-soft)] p-0 ${product.isEnabled ? "" : "opacity-55 grayscale"}`}
                        aria-label={`放大查看 ${product.name} 圖片`}
                        onClick={() =>
                          setLightboxImage({
                            src: product.imageUrl!,
                            alt: `${product.name} 商品圖片`,
                            label: `${product.name} (${currency.format(product.price)})`,
                          })
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={product.imageUrl}
                          alt={`${product.name} 商品圖片`}
                          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    ) : (
                      <div className="grid aspect-square w-full place-items-center rounded-[9px] border border-[var(--claim-border)] bg-[var(--claim-soft)]">
                        <ImageIcon size={28} className="opacity-45" />
                      </div>
                    )}
                    <h3
                      className="mb-0 mt-2 break-words text-[12px] font-bold leading-5"
                      style={{ color: surfaceText }}
                    >
                      {product.name}
                    </h3>
                    <span className="block text-[11px] text-[var(--claim-surface-muted)]">
                      {product.category}
                      {product.size ? ` · ${product.size}` : ""}
                    </span>
                    <strong
                      style={{ color: "#D6A84B" }}
                      className="mt-0.5 block text-[13px]"
                    >
                      {currency.format(product.price)}
                    </strong>
                    {product.isEnabled ? (
                      <QuantityStepper
                        className="mt-2"
                        style={
                          {
                            width: "100%",
                            "--quantity-border": "var(--claim-border)",
                            "--quantity-background": "transparent",
                            "--quantity-color": "var(--claim-surface-text)",
                            "--quantity-primary": "var(--claim-primary)",
                            "--quantity-soft": "var(--claim-soft)",
                          } as CSSProperties
                        }
                        value={quantity}
                        min={0}
                        max={product.maxQuantity}
                        itemName={product.name}
                        label={`${product.name}數量`}
                        disabled={!form.isOpen || submitting}
                        onChange={(next) =>
                          onQuantityChange(
                            product.id,
                            next,
                            product.maxQuantity,
                          )
                        }
                      />
                    ) : (
                      <span className="mt-2 block rounded-[8px] bg-[var(--claim-soft)] px-2 py-3 text-center text-[11px] text-[var(--claim-surface-muted)]">
                        已停止訂購
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {selectedProducts.length > 0 && (
            <div className="mt-4 border-t border-[var(--claim-border)] pt-3">
              <h3 className="m-0 text-[12px] font-semibold">已選商品</h3>
              <ul className="mb-0 mt-2 list-none space-y-2 p-0 text-[12px]">
                {selectedProducts.map(({ product, quantity }) => (
                  <li
                    key={product.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="min-w-0 break-words">
                      {product.name} × {quantity}
                    </span>
                    <span className="shrink-0">
                      {currency.format(product.price * quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div
          aria-label="訂購總額"
          className="flex min-h-16 items-center justify-between gap-3 bg-[var(--claim-primary)] px-4 py-3 text-white md:px-5"
        >
          <span className="text-[13px] font-semibold">共 {itemCount} 件</span>
          <strong
            className="text-[21px] font-bold text-white md:text-[24px]"
            style={{ color: "#ffffff" }}
          >
            {currency.format(subtotal)}
          </strong>
        </div>
      </section>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          label={lightboxImage.label}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  );
}
