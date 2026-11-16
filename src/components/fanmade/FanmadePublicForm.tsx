"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, ShoppingBag } from "lucide-react";
import type {
  FanmadeHeader,
  FanmadePage,
  FanmadePublicProduct,
} from "@/lib/fanmade/types";
import type {
  PublicClaimForm,
  PublicClaimSubmissionResult,
} from "@/lib/claims";
import { getFanmadePage } from "@/lib/fanmade/api";
import { ClaimFormTheme } from "@/components/claims/public-form/ClaimFormTheme";
import { ClaimFormHeader } from "@/components/claims/public-form/ClaimFormHeader";
import { ClaimContactForm } from "@/components/claims/public-form/ClaimContactForm";
import { ClaimOrderConfirmation } from "@/components/claims/public-form/ClaimOrderConfirmation";
import { useClaimReceipt } from "@/components/claims/public-form/useClaimReceipt";
import { currency } from "@/components/claims/public-form/format";
import { OnDemandMedia } from "./OnDemandMedia";
import { FanmadeProductCard } from "./FanmadeProductCard";
import { LoadingState } from "@/components/ui/LoadingState";
import styles from "../../../styles/components/fanmade/FanmadePublicForm.module.scss";

function catalogGroups(products: FanmadePublicProduct[]) {
  const groups = new Map<
    string,
    { id: string; products: FanmadePublicProduct[] }
  >();
  for (const product of products) {
    const id = product.catalogGroupId || product.id;
    const group = groups.get(id);
    if (group) group.products.push(product);
    else groups.set(id, { id, products: [product] });
  }
  return [...groups.values()];
}

type GroupState = { page: FanmadePage; items: FanmadePublicProduct[] };
export function FanmadePublicForm({
  header,
  token,
  turnstileSiteKey,
}: {
  header: FanmadeHeader;
  token: string;
  turnstileSiteKey: string | null;
}) {
  const [open, setOpen] = useState(new Set<string>()),
    [groups, setGroups] = useState<Record<string, GroupState>>({}),
    [busy, setBusy] = useState(new Set<string>()),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({}),
    [query, setQuery] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const [media, setMedia] = useState<{
    productId: string;
    name: string;
  } | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const requests = useRef(new Set<string>());
  const { ready, receipt, saved, remember, clear } = useClaimReceipt(token);
  useEffect(() => {
    const current = controllers.current;
    return () => current.forEach((c) => c.abort());
  }, []);
  const allProducts = useMemo(
    () => Object.values(groups).flatMap((g) => g.items),
    [groups],
  );
  const selected = useMemo(
    () =>
      allProducts
        .filter((p) => p.isEnabled && (quantities[p.id] ?? 0) > 0)
        .map((product) => ({ product, quantity: quantities[product.id] })),
    [allProducts, quantities],
  );
  const count = selected.reduce((n, p) => n + p.quantity, 0),
    subtotal = selected.reduce((n, p) => n + p.quantity * p.product.price, 0);
  const form: PublicClaimForm = { ...header, products: allProducts };
  const productCount = header.groups.reduce(
    (total, group) => total + group.count,
    0,
  );
  const visibleGroups = header.groups.filter((group) =>
    group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  function setQuantity(productId: string, value: number, maximum: number) {
    if (submitting) return;
    const quantity = Math.max(0, Math.min(maximum, Math.trunc(value || 0)));
    setQuantities((current) => ({ ...current, [productId]: quantity }));
  }
  const closeMedia = useCallback(() => setMedia(null), []);
  async function load(id: string, page: number) {
    if (requests.current.has(id)) return;
    requests.current.add(id);
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setBusy((old) => new Set([...old, id]));
    setErrors((old) => ({ ...old, [id]: "" }));
    try {
      const result = await getFanmadePage(
        token,
        id,
        page,
        "",
        controller.signal,
      );
      if (result.products.some((p) => p.price !== header.price))
        throw new Error("飯製統一價格已更新，請重新整理後確認。");
      if (!controller.signal.aborted)
        setGroups((old) => ({
          ...old,
          [id]: {
            page: result,
            items:
              page === 1
                ? result.products
                : [
                    ...(old[id]?.items ?? []),
                    ...result.products.filter(
                      (p) =>
                        !(old[id]?.items ?? []).some(
                          (previous) => previous.id === p.id,
                        ),
                    ),
                  ],
          },
        }));
    } catch (cause) {
      if (!controller.signal.aborted)
        setErrors((old) => ({
          ...old,
          [id]: cause instanceof Error ? cause.message : "商品讀取失敗",
        }));
    } finally {
      requests.current.delete(id);
      controllers.current.delete(id);
      setBusy((old) => {
        const next = new Set(old);
        next.delete(id);
        return next;
      });
    }
  }
  function toggle(id: string) {
    setOpen((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!groups[id] && !busy.has(id)) void load(id, 1);
  }
  function success(result: PublicClaimSubmissionResult, phone: string) {
    remember({
      version: 1,
      formToken: token,
      savedAt: Date.now(),
      form: {
        title: form.title,
        officialLineId: form.officialLineId,
        completionMessage: form.completionMessage,
      },
      items: selected.map(({ product, quantity }) => ({
        product: { ...product, name: `${product.work}／${product.name}` },
        quantity,
      })),
      result,
      phone,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (!ready)
    return (
      <ClaimFormTheme form={form}>
        <LoadingState text="正在讀取訂購紀錄…" />
      </ClaimFormTheme>
    );
  if (receipt)
    return (
      <ClaimFormTheme form={form} completed>
        <ClaimOrderConfirmation
          form={receipt.form}
          result={receipt.result}
          phone={receipt.phone}
          selectedProducts={receipt.items}
          itemCount={receipt.items.reduce((n, p) => n + p.quantity, 0)}
          subtotal={receipt.items.reduce(
            (n, p) => n + p.quantity * p.product.price,
            0,
          )}
          saved={saved}
          onStartNewOrder={() => {
            if (window.confirm("清除本機收據並填寫新訂單？原訂單不會取消。")) {
              clear();
              setQuantities({});
            }
          }}
        />
      </ClaimFormTheme>
    );
  return (
    <ClaimFormTheme form={form}>
      <ClaimFormHeader form={form} />
      <div className={styles.body}>
        {!header.isOpen && (
          <section className={styles.closed} role="status">
            <h2>這次訂購已經截止</h2>
            <p>
              商品與實拍影片仍可查看，目前不能送出訂購。後續消息請留意群組公告。
            </p>
          </section>
        )}
        <div className={styles.layout}>
          <section className={styles.selection} aria-label="商品與訂購總額">
            <div className={styles.selectionBody}>
              <div className={styles.heading}>
                <h2>
                  <ShoppingBag size={17} aria-hidden="true" />
                  選擇商品
                </h2>
                <span>
                  共 {productCount} 款 · {header.groups.length} 個 IP
                </span>
              </div>
              <div className={styles.uniformPrice}>
                <div>
                  <b>飯製海報統一單價</b>
                  <p>先選 IP，再切換工藝觀看實拍、選擇數量。</p>
                </div>
                <strong>{currency.format(header.price)}</strong>
              </div>
              {header.groups.length > 0 ? (
                <>
                  <label className={styles.search}>
                    <Search size={18} aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜尋 IP…"
                      aria-label="搜尋 IP"
                    />
                  </label>
                  <section
                    aria-label="按 IP 選擇飯製商品"
                    className={styles.groups}
                  >
                    {visibleGroups.map((group) => {
                      const state = groups[group.id];
                      const selectedCount = (state?.items ?? []).reduce(
                        (total, product) =>
                          total + (quantities[product.id] ?? 0),
                        0,
                      );
                      const expanded = open.has(group.id);
                      return (
                        <section key={group.id} className={styles.group}>
                          <h3 className={styles.ipHeading}>
                            <button
                              type="button"
                              className={styles.groupToggle}
                              id={"ip-toggle-" + group.id}
                              aria-expanded={expanded}
                              aria-controls={"ip-" + group.id}
                              onClick={() => toggle(group.id)}
                            >
                              <span>
                                <b>{group.name}</b>
                                <small>
                                  {group.count} 款商品 · 已選 {selectedCount} 張
                                </small>
                              </span>
                              <ChevronDown
                                size={18}
                                aria-hidden="true"
                                style={{
                                  transform: expanded
                                    ? "rotate(180deg)"
                                    : undefined,
                                }}
                              />
                            </button>
                          </h3>
                          <div
                            id={"ip-" + group.id}
                            hidden={!expanded}
                            role="region"
                            aria-labelledby={"ip-toggle-" + group.id}
                            aria-busy={busy.has(group.id)}
                          >
                            {expanded && (
                              <div className={styles.groupBody}>
                                {errors[group.id] && (
                                  <div className={styles.error} role="alert">
                                    <p>{errors[group.id]}</p>
                                    <button
                                      type="button"
                                      className={styles.moreButton}
                                      onClick={() =>
                                        void load(
                                          group.id,
                                          (state?.page.page ?? 0) + 1,
                                        )
                                      }
                                    >
                                      重試讀取
                                    </button>
                                  </div>
                                )}
                                <div className={styles.products}>
                                  {catalogGroups(state?.items ?? []).map(
                                    (design) => (
                                      <FanmadeProductCard
                                        key={design.id}
                                        products={design.products}
                                        quantities={quantities}
                                        isOpen={header.isOpen}
                                        submitting={submitting}
                                        onQuantityChange={setQuantity}
                                        onWatch={(product) =>
                                          setMedia({
                                            productId: product.id,
                                            name: product.name,
                                          })
                                        }
                                      />
                                    ),
                                  )}
                                </div>
                                {busy.has(group.id) && (
                                  <p role="status" className={styles.loading}>
                                    正在載入商品…
                                  </p>
                                )}
                                {state?.page.hasMore &&
                                  !busy.has(group.id) &&
                                  !errors[group.id] && (
                                    <button
                                      type="button"
                                      className={styles.moreButton}
                                      onClick={() =>
                                        void load(group.id, state.page.page + 1)
                                      }
                                    >
                                      載入更多（每批 12 款）
                                    </button>
                                  )}
                                {state &&
                                  state.items.length === 0 &&
                                  !busy.has(group.id) &&
                                  !errors[group.id] && (
                                    <p className={styles.empty}>
                                      目前沒有可顯示商品。
                                    </p>
                                  )}
                              </div>
                            )}
                          </div>
                        </section>
                      );
                    })}
                    {visibleGroups.length === 0 && (
                      <p className={styles.empty}>
                        找不到符合的 IP，請試試其他關鍵字。
                      </p>
                    )}
                  </section>
                </>
              ) : (
                <div className={styles.empty}>
                  <ShoppingBag size={32} aria-hidden="true" />
                  <h3>商品即將上架</h3>
                  <p>管理者更新後，重新整理即可查看商品。</p>
                </div>
              )}
              {selected.length > 0 && (
                <section className={styles.selected} aria-label="已選飯製商品">
                  <h3>已選商品</h3>
                  <ul>
                    {selected.map(({ product, quantity }) => (
                      <li key={product.id}>
                        <span>
                          {product.work}／{product.name} × {quantity}
                        </span>
                        <span>{currency.format(product.price * quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className={styles.total} aria-label="飯製訂購總額">
              <span>共 {count} 張</span>
              <strong>{currency.format(subtotal)}</strong>
            </div>
          </section>
          {header.isOpen && productCount > 0 && (
            <ClaimContactForm
              form={form}
              token={token}
              formKind="fanmade"
              turnstileSiteKey={turnstileSiteKey}
              selectedProducts={selected}
              itemCount={count}
              subtotal={subtotal}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onSuccess={success}
            />
          )}
        </div>
      </div>
      {media && (
        <OnDemandMedia
          {...media}
          kind="video"
          token={token}
          onClose={closeMedia}
        />
      )}
    </ClaimFormTheme>
  );
}
