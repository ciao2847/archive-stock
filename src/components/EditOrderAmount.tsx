"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Save, X } from "lucide-react";
import { SALES_CHANNELS } from "@/constants";
import { createClient } from "@/utils/supabase/client";
import { DEFAULT_VALUES, toNumber } from "@/constants";
import { DataState } from "./DataState";
import { updateOrder } from "@/lib/api/orders";

type Item = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
};

type CustomerRelation = {
  name: string | null;
  nickname: string | null;
  contact: string | null;
};

type ProductRelation = {
  sku: string | null;
  name: string | null;
};

type OrderItemRelation = {
  id: string;
  quantity: number;
  unit_price: number | string;
  products: ProductRelation | ProductRelation[] | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** 編輯訂單金額表單。 */
export function EditOrderAmount({
  orderId,
  orderNo,
  onClose,
  onUpdated,
}: {
  orderId: string;
  orderNo: string;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
  const [channel, setChannel] = useState("direct");
  const [customerName, setCustomerName] = useState("");
  const [nickname, setNickname] = useState("");
  const [contact, setContact] = useState("");
  const [payment, setPayment] = useState("pending");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState<string>(DEFAULT_VALUES.amountInput);
  const [shipping, setShipping] = useState<string>(DEFAULT_VALUES.amountInput);
  const [fee, setFee] = useState<string>(DEFAULT_VALUES.amountInput);
  const [sellerShipping, setSellerShipping] = useState<string>(
    DEFAULT_VALUES.amountInput,
  );
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const [
        { data: order, error: orderError },
        { data: itemRows, error: itemError },
      ] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "sales_channel,discount,shipping_income,platform_fee,seller_shipping_cost,status,payment_status,notes,customers(name,nickname,contact)",
          )
          .eq("id", orderId)
          .single(),
        supabase
          .from("order_items")
          .select("id,quantity,unit_price,products(sku,name)")
          .eq("order_id", orderId),
      ]);
      if (orderError || itemError) {
        setError((orderError || itemError)?.message || "讀取失敗");
        setLoading(false);
        return;
      }
      if (["packed", "shipped", "cancelled"].includes(order.status)) {
        setError("已包裝、已出貨或已取消的訂單不能修改金額");
        setLoading(false);
        return;
      }
      const customer = firstRelation(
        order.customers as CustomerRelation | CustomerRelation[] | null,
      );
      const typedItems = itemRows as unknown as OrderItemRelation[];
      setChannel(order.sales_channel);
      setCustomerName(customer?.name || "");
      setNickname(customer?.nickname || "");
      setContact(customer?.contact || "");
      setPayment(order.payment_status);
      setNotes(order.notes || "");
      setDiscount(String(order.discount));
      setShipping(String(order.shipping_income));
      setFee(String(order.platform_fee));
      setSellerShipping(String(order.seller_shipping_cost));
      setItems(
        typedItems.map((item) => ({
          id: item.id,
          sku: firstRelation(item.products)?.sku || "—",
          name: firstRelation(item.products)?.name || "未命名商品",
          quantity: item.quantity,
          unitPrice: String(item.unit_price),
        })) ?? [],
      );
      setLoading(false);
    })();
  }, [orderId]);
  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + toNumber(item.unitPrice) * item.quantity,
        0,
      ),
    [items],
  );
  const total = subtotal + toNumber(shipping) - toNumber(discount);
  const net = total - toNumber(fee) - toNumber(sellerShipping);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await updateOrder(orderId, {
        customerName,
        customerNickname: nickname,
        customerContact: contact,
        paymentStatus: payment,
        notes,
        salesChannel: channel,
        discount: toNumber(discount),
        shippingIncome: toNumber(shipping),
        platformFee: toNumber(fee),
        sellerShippingCost: toNumber(sellerShipping),
        items: items.map((item) => ({
          id: item.id,
          unitPrice: toNumber(item.unitPrice),
        })),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新訂單失敗");
      setSaving(false);
      return;
    }
    await onUpdated();
    onClose();
  }
  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/55" onClick={onClose} />
      <aside className="drawer z-[110]!">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">編輯訂單</span>
            <h2>{orderNo}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <DataState
          loading={loading}
          isEmpty={!error && items.length === 0}
          loadingText="正在讀取訂單金額…"
          emptyText="這筆訂單沒有商品明細"
        >
          <form
            className="p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="form-grid">
              <label className="field">
                <span>客人姓名</span>
                <input
                  required
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>客戶暱稱</span>
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="例：小王、IG 帳號"
                />
              </label>
              <label className="field">
                <span>聯絡方式</span>
                <input
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
              </label>
              <label className="field">
                <span>付款狀態</span>
                <select
                  value={payment}
                  onChange={(event) => setPayment(event.target.value)}
                >
                  <option value="paid">已付款</option>
                  <option value="pending">待付款</option>
                </select>
              </label>
              <label className="field wide">
                <span>銷售平台</span>
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                >
                  {SALES_CHANNELS.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field wide">
                <span>訂單備註</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>
            <section className="mt-5 space-y-3">
              <h3 className="text-[14px]">商品成交單價</h3>
              {items?.map((item) => (
                <label className="flex items-center gap-3" key={item.id}>
                  <span className="min-w-0 flex-1">
                    <code>{item.sku}</code>
                    <b className="block truncate">{item.name}</b>
                  </span>
                  <span className="text-[12px] text-default">NT$</span>
                  <input
                    className="w-28 rounded-md border border-line bg-white p-2 text-right text-[16px]"
                    type="number"
                    min="0"
                    value={item.unitPrice}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((row) =>
                          row.id === item.id
                            ? { ...row, unitPrice: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </section>
            <div className="form-grid">
              <Money label="訂單折扣" value={discount} set={setDiscount} />
              <Money label="客人支付運費" value={shipping} set={setShipping} />
              <Money label="平台手續費" value={fee} set={setFee} />
              <Money
                label="賣家負擔運費"
                value={sellerShipping}
                set={setSellerShipping}
              />
            </div>
            <div className="mt-5 space-y-1 rounded-lg bg-white p-4 text-[14px]">
              <p className="m-0 flex justify-between">
                <span>客人訂單金額</span>
                <b>NT$ {total.toLocaleString()}</b>
              </p>
              <p className="m-0 flex justify-between text-secondary-strong">
                <span>預計實收</span>
                <b>NT$ {net.toLocaleString()}</b>
              </p>
            </div>
            {error && <p className="upload-error">更新失敗：{error}</p>}
            <div className="form-actions">
              <button type="button" className="outline" onClick={onClose}>
                取消
              </button>
              <button className="primary" disabled={saving}>
                {saving ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Save size={17} />
                )}
                儲存訂單
              </button>
            </div>
          </form>
        </DataState>
      </aside>
    </>
  );
}

function Money({
  label,
  value,
  set,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </label>
  );
}
