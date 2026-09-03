"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, ClipboardPlus, LoaderCircle, Search, X } from "lucide-react";
import { Product } from "@/lib/types";
import { SALES_CHANNELS, isProductAvailable } from "@/constants";
import { DEFAULT_VALUES, toNumber } from "@/constants";
import { createOrder } from "@/lib/api/orders";
import { DataState } from "./DataState";

/** 新增訂單表單。 */
export function NewOrder({
  products,
  productsLoading = false,
  onClose,
  onCreated,
}: {
  products: Product[];
  productsLoading?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customer, setCustomer] = useState("");
  const [nickname, setNickname] = useState("");
  const [contact, setContact] = useState("");
  const [payment, setPayment] = useState("paid");
  const [salesChannel, setSalesChannel] = useState("direct");
  const [discount, setDiscount] = useState<string>(DEFAULT_VALUES.amountInput);
  const [shippingIncome, setShippingIncome] = useState<string>(
    DEFAULT_VALUES.amountInput,
  );
  const [platformFee, setPlatformFee] = useState<string>(
    DEFAULT_VALUES.amountInput,
  );
  const [sellerShippingCost, setSellerShippingCost] = useState<string>(
    DEFAULT_VALUES.amountInput,
  );
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const available = useMemo(
    () =>
      products.filter(
        (product) =>
          isProductAvailable(product.status, product.stock) &&
          Object.values(product)
            .flat()
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [products, query],
  );
  const selectedProducts = useMemo(
    () => products.filter((product) => selected.includes(product.dbId || "")),
    [products, selected],
  );
  const subtotal = selectedProducts.reduce(
    (sum, product) =>
      sum + toNumber(prices[product.dbId || ""] ?? product.price),
    0,
  );
  const orderTotal = subtotal + toNumber(shippingIncome) - toNumber(discount);
  const netRevenue =
    orderTotal - toNumber(platformFee) - toNumber(sellerShippingCost);

  function toggle(id: string) {
    const product = products.find((item) => item.dbId === id);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    if (product && prices[id] === undefined)
      setPrices((current) => ({ ...current, [id]: String(product.price) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected.length) {
      setError("請至少選擇一件商品");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createOrder({
        customerName: customer.trim(),
        customerNickname: nickname.trim(),
        customerContact: contact.trim(),
        paymentStatus: payment,
        notes: notes.trim(),
        salesChannel,
        discount: toNumber(discount),
        shippingIncome: toNumber(shippingIncome),
        platformFee: toNumber(platformFee),
        sellerShippingCost: toNumber(sellerShippingCost),
        items: selectedProducts.map((product) => ({
          productId: product.dbId!,
          quantity: 1,
          unitPrice: toNumber(prices[product.dbId!] ?? product.price),
        })),
      });
      onCreated();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "訂單建立失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer order-drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">訂單管理</span>
            <h2>新增訂單</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="客人姓名">
              <input
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                required
                placeholder="例：王小姐"
              />
            </Field>
            <Field label="客戶暱稱">
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="例：小王、IG 帳號"
              />
            </Field>
            <Field label="聯絡方式">
              <input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="電話、LINE 或 Email"
              />
            </Field>
            <Field label="銷售平台">
              <select
                value={salesChannel}
                onChange={(event) => setSalesChannel(event.target.value)}
              >
                {SALES_CHANNELS.map((channel) => (
                  <option value={channel.value} key={channel.value}>
                    {channel.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="付款狀態">
              <select
                value={payment}
                onChange={(event) => setPayment(event.target.value)}
              >
                <option value="paid">已付款</option>
                <option value="pending">待付款</option>
              </select>
            </Field>
            <Field label="備註">
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="出貨或客戶備註"
              />
            </Field>
          </div>
          <div className="mt-7 flex items-end justify-between">
            <div>
              <h3 className="mb-1 mt-0">選擇訂購商品</h3>
              <p className="m-0 text-[11px] text-muted">只顯示目前在庫的商品</p>
            </div>
            <span className="font-mono text-[13px] font-medium text-rust">
              {selected.length} 件
            </span>
          </div>
          <div className="order-product-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋商品 ID、作品或庫位"
            />
          </div>
          <div className="order-product-list">
            <DataState
              loading={productsLoading}
              isEmpty={available.length === 0}
              loadingText="正在讀取可訂購商品…"
              emptyText="目前沒有可加入訂單的在庫商品"
              className="compact-empty"
            >
              {available?.map((product) => {
                const checked = selected.includes(product.dbId || "");
                return (
                  <button
                    type="button"
                    className={checked ? "selected" : ""}
                    key={product.dbId}
                    onClick={() => toggle(product.dbId!)}
                  >
                    <span className="order-product-check">
                      {checked && <Check />}
                    </span>
                    <span
                      className="thumb"
                      style={{ background: product.accent }}
                    >
                      {product.work[0]}
                    </span>
                    <div>
                      <code>{product.id}</code>
                      <b>{product.work}</b>
                      <small>
                        {product.name} · {product.location}
                      </small>
                    </div>
                    <strong>NT$ {product.price.toLocaleString()}</strong>
                  </button>
                );
              })}
            </DataState>
          </div>
          {selectedProducts.length > 0 && (
            <section className="mt-4 rounded-lg border border-line bg-white p-4">
              <h3 className="mt-0 mb-3 text-[14px]">實際成交金額</h3>
              <div className="space-y-3">
                {selectedProducts?.map((product) => (
                  <label className="flex items-center gap-3" key={product.dbId}>
                    <span className="min-w-0 flex-1">
                      <code>{product.id}</code>
                      <b className="block truncate">{product.work}</b>
                    </span>
                    <span className="text-[12px] text-default">NT$</span>
                    <input
                      className="w-24 rounded-md border border-line bg-white p-2 text-right text-[16px]"
                      type="number"
                      min="0"
                      value={prices[product.dbId!] ?? product.price}
                      onChange={(event) =>
                        setPrices((current) => ({
                          ...current,
                          [product.dbId!]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <MoneyField
                  label="訂單折扣"
                  value={discount}
                  onChange={setDiscount}
                />
                <MoneyField
                  label="客人支付運費"
                  value={shippingIncome}
                  onChange={setShippingIncome}
                />
                <MoneyField
                  label="平台手續費"
                  value={platformFee}
                  onChange={setPlatformFee}
                />
                <MoneyField
                  label="賣家負擔運費"
                  value={sellerShippingCost}
                  onChange={setSellerShippingCost}
                />
              </div>
              <div className="mt-4 space-y-1 border-t border-line pt-3 text-[14px]">
                <p className="m-0 flex justify-between">
                  <span>客人訂單金額</span>
                  <b>NT$ {orderTotal.toLocaleString()}</b>
                </p>
                <p className="m-0 flex justify-between text-secondary-strong">
                  <span>預計實收</span>
                  <b>NT$ {netRevenue.toLocaleString()}</b>
                </p>
              </div>
            </section>
          )}
          {error && <div className="login-error order-error">{error}</div>}
          <div className="form-actions">
            <button
              type="button"
              className="outline"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button className="primary" disabled={saving || !selected.length}>
              {saving ? <LoaderCircle className="spin" /> : <ClipboardPlus />}
              {saving ? "建立中…" : "建立訂單"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
