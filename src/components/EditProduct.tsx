"use client";
import { FormEvent, useState } from "react";
import { LoaderCircle, Save, X } from "lucide-react";
import { Product } from "@/lib/types";
import { toNumber } from "@/constants";
import { updateProduct } from "@/lib/api/products";
import {
  COUNTRIES,
  LOCATION_CODE_PATTERN,
  POSTER_CATEGORY,
  POSTER_FORMATS,
  POSTER_SIZES,
  PRODUCT_CATEGORIES,
} from "@/constants";
/** 編輯商品表單。 */
export function EditProduct({
  product,
  isAdmin,
  onClose,
  onUpdated,
}: {
  product: Product;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: product.name,
    category: product.category,
    country: product.country === "—" ? "" : product.country,
    source: product.source === "—" ? "" : product.source,
    location: product.location === "未指定" ? "" : product.location,
    stock: String(product.stock),
    price: String(product.price),
    cost: String(product.cost),
    format: product.format || "",
    size: product.size || "",
    feature: product.feature || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const change = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product.dbId) return;
    setSaving(true);
    setError("");
    try {
      if (form.location) {
        const code = form.location.toUpperCase();
        if (!LOCATION_CODE_PATTERN.test(code))
          throw new Error("庫位格式需為 A-03-02");
      }
      const nextStock = Number(form.stock);
      if (!Number.isInteger(nextStock) || nextStock < 0)
        throw new Error("庫存數量必須是 0 以上的整數");
      await updateProduct(product.dbId, {
        name: form.name.trim(),
        category: form.category,
        country: form.country,
        source: form.source,
        location: form.location.toUpperCase(),
        stock: nextStock,
        price: toNumber(form.price),
        cost:
          isAdmin && toNumber(form.cost) !== product.cost
            ? toNumber(form.cost)
            : null,
        format: form.category === POSTER_CATEGORY ? form.format : "",
        size: form.category === POSTER_CATEGORY ? form.size : "",
        feature: form.feature,
      });
      await onUpdated();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失敗");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/55" onClick={onClose} />
      <aside className="drawer z-[110]!">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">編輯商品</span>
            <h2>{product.id}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <form className="p-6" onSubmit={submit}>
          <div className="form-grid">
            <Field label="商品名稱">
              <input
                required
                value={form.name}
                onChange={(e) => change("name", e.target.value)}
              />
            </Field>
            <Field label="商品類型">
              <select
                value={form.category}
                onChange={(e) => change("category", e.target.value)}
              >
                {PRODUCT_CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="國家">
              <select
                value={form.country}
                onChange={(e) => change("country", e.target.value)}
              >
                <option value="">未指定</option>
                {form.country &&
                  !COUNTRIES.some((country) => country === form.country) && (
                    <option value={form.country}>{form.country}</option>
                  )}
                {COUNTRIES.map((country) => (
                  <option value={country} key={country}>
                    {country}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="發行來源">
              <input
                value={form.source}
                onChange={(e) => change("source", e.target.value)}
              />
            </Field>
            <Field label="庫位">
              <input
                value={form.location}
                onChange={(e) => change("location", e.target.value)}
                placeholder="A-03-02"
              />
            </Field>
            <Field label="庫存數量">
              <input
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(e) => change("stock", e.target.value)}
              />
            </Field>
            <Field label="商品售價（每件）">
              <input
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => change("price", e.target.value)}
              />
            </Field>
            {isAdmin && (
              <Field label="本批成本總額">
                <input
                  type="number"
                  min="0"
                  value={form.cost}
                  onChange={(e) => change("cost", e.target.value)}
                />
              </Field>
            )}
            {form.category === POSTER_CATEGORY && (
              <>
                <Field label="版本 / 影廳">
                  <select
                    value={form.format}
                    onChange={(e) => change("format", e.target.value)}
                  >
                    <option value="">未指定</option>
                    {form.format &&
                      !POSTER_FORMATS.some(
                        (format) => format === form.format,
                      ) && <option value={form.format}>{form.format}</option>}
                    {POSTER_FORMATS.map((format) => (
                      <option value={format} key={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="尺寸">
                  <select
                    value={form.size}
                    onChange={(e) => change("size", e.target.value)}
                  >
                    <option value="">未指定</option>
                    {form.size &&
                      !POSTER_SIZES.some((size) => size === form.size) && (
                        <option value={form.size}>{form.size}</option>
                      )}
                    {POSTER_SIZES.map((size) => (
                      <option value={size} key={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="辨識特徵" wide>
                  <textarea
                    value={form.feature}
                    onChange={(e) => change("feature", e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          {error && <p className="upload-error">更新失敗：{error}</p>}
          <div className="form-actions">
            <button type="button" className="outline" onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={saving}>
              {saving ? <LoaderCircle className="spin" /> : <Save size={17} />}{" "}
              {saving ? "儲存中…" : "儲存修改"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}
