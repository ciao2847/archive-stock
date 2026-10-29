"use client";

import { LoadingState } from "@/components/ui/LoadingState";

import { useMemo, useState } from "react";
import type {
  PublicClaimForm,
  PublicClaimSubmissionResult,
} from "@/lib/claims";
import { ClaimFormTheme } from "./public-form/ClaimFormTheme";
import { ClaimFormHeader } from "./public-form/ClaimFormHeader";
import { ClaimProductSelection } from "./public-form/ClaimProductSelection";
import { ClaimContactForm } from "./public-form/ClaimContactForm";
import { ClaimOrderConfirmation } from "./public-form/ClaimOrderConfirmation";
import { useClaimReceipt } from "./public-form/useClaimReceipt";

export function PublicClaimFormView({
  form,
  token,
  turnstileSiteKey,
}: {
  form: PublicClaimForm;
  token: string;
  turnstileSiteKey: string | null;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const { ready, receipt, saved, remember, clear } = useClaimReceipt(token);

  const selectedProducts = useMemo(
    () =>
      form.products
        .filter(
          (product) => product.isEnabled && (quantities[product.id] ?? 0) > 0,
        )
        .map((product) => ({
          product,
          quantity: quantities[product.id] ?? 0,
        })),
    [form.products, quantities],
  );
  const availableProductCount = useMemo(
    () => form.products.filter((product) => product.isEnabled).length,
    [form.products],
  );
  const itemCount = selectedProducts.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const subtotal = selectedProducts.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );

  function setQuantity(productId: string, value: number, maximum: number) {
    if (submitting) return;
    const quantity = Math.max(0, Math.min(maximum, Math.trunc(value || 0)));
    setQuantities((current) => ({ ...current, [productId]: quantity }));
  }

  function completeOrder(response: PublicClaimSubmissionResult, phone: string) {
    // Save the submitted snapshot before the customer can leave for LINE or their bank.
    remember({
      version: 1,
      formToken: token,
      savedAt: Date.now(),
      form: {
        title: form.title,
        officialLineId: form.officialLineId,
        completionMessage: form.completionMessage,
      },
      result: response,
      phone,
      items: selectedProducts.map(({ product, quantity }) => ({
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
        },
        quantity,
      })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewOrder() {
    if (
      !window.confirm(
        "確定要再填一筆訂購嗎？這只會清除本機顯示的紀錄，不會取消已送出的訂單。",
      )
    )
      return;
    clear();
    setQuantities({});
  }

  if (!ready) {
    return (
      <ClaimFormTheme form={form}>
        <LoadingState text="正在讀取訂購資料…" />
      </ClaimFormTheme>
    );
  }

  const receiptItemCount =
    receipt?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const receiptSubtotal =
    receipt?.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0,
    ) ?? 0;

  return (
    <ClaimFormTheme form={form} completed={Boolean(receipt)}>
      {receipt ? (
        <ClaimOrderConfirmation
          form={receipt.form}
          result={receipt.result}
          phone={receipt.phone}
          selectedProducts={receipt.items}
          itemCount={receiptItemCount}
          subtotal={receiptSubtotal}
          saved={saved}
          onStartNewOrder={startNewOrder}
        />
      ) : (
        <>
          <ClaimFormHeader form={form} />
          <div className="mx-auto max-w-[1040px] px-4 pt-5 md:px-8 md:pt-8">
            {!form.isOpen && (
              <section className="mb-4 rounded-[14px] border border-[var(--claim-border)] bg-[var(--claim-surface)] p-4 text-[var(--claim-surface-text)]">
                <h2 className="m-0 text-[16px]">這次訂購已經截止</h2>
                <p className="mb-0 mt-2 text-[13px] text-[var(--claim-surface-muted)]">
                  商品仍可查看，目前不能送出訂購。後續消息請留意群組公告。
                </p>
              </section>
            )}
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)] md:gap-5">
              <ClaimProductSelection
                form={form}
                quantities={quantities}
                selectedProducts={selectedProducts}
                availableProductCount={availableProductCount}
                itemCount={itemCount}
                subtotal={subtotal}
                submitting={submitting}
                onQuantityChange={setQuantity}
              />
              {form.isOpen && availableProductCount > 0 && (
                <ClaimContactForm
                  form={form}
                  token={token}
                  turnstileSiteKey={turnstileSiteKey}
                  selectedProducts={selectedProducts}
                  itemCount={itemCount}
                  subtotal={subtotal}
                  submitting={submitting}
                  onSubmittingChange={setSubmitting}
                  onSuccess={completeOrder}
                />
              )}
            </div>
          </div>
        </>
      )}
    </ClaimFormTheme>
  );
}
