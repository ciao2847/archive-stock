"use client";
import { FormEvent, useState } from "react";
import { LoaderCircle, Save, X } from "lucide-react";
import { Product } from "@/lib/types";
import { createClient } from "@/utils/supabase/client";
import { toNumber } from "@/constants";
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
    const supabase = createClient();
    try {
      let locationId: string | null = null;
      if (form.location) {
        const code = form.location.toUpperCase();
        if (!LOCATION_CODE_PATTERN.test(code))
          throw new Error("庫位格式需為 A-03-02");
        const existing = await supabase
          .from("locations")
          .select("id")
          .eq("code", code)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) locationId = existing.data.id;
        else {
          const [cabinet, shelf, bin] = code.split("-");
          const created = await supabase
            .from("locations")
            .insert({ code, cabinet, shelf: Number(shelf), bin: Number(bin) })
            .select("id")
            .single();
          if (created.error) throw created.error;
          locationId = created.data.id;
        }
      }
      const nextStock = Number(form.stock);
      if (!Number.isInteger(nextStock) || nextStock < 0)
        throw new Error("庫存數量必須是 0 以上的整數");
      if (nextStock !== product.stock) {
        const stockResult = await supabase.rpc("adjust_product_stock", {
          p_product_id: product.dbId,
          p_new_stock: nextStock,
        });
        if (stockResult.error) {
          if (stockResult.error.code === "PGRST202")
            throw new Error(
              "庫存調整功能尚未安裝，請先執行 adjust-product-stock-migration.sql",
            );
          if (stockResult.error.message.includes("not enough active qr labels"))
            throw new Error("部分庫存已被訂單核對，不能減少到這個數量");
          throw stockResult.error;
        }
      }
      const result = await supabase
        .from("products")
        .update({
          name: form.name.trim(),
          category: form.category,
          country: form.country || null,
          source: form.source || null,
          location_id: locationId,
          price: toNumber(form.price),
          poster_format:
            form.category === POSTER_CATEGORY ? form.format || null : null,
          poster_size:
            form.category === POSTER_CATEGORY ? form.size || null : null,
          identifying_features: form.feature || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.dbId);
      if (result.error) throw result.error;
      if (isAdmin && toNumber(form.cost) !== product.cost) {
        const costResult = await supabase.rpc("set_admin_product_cost", {
          p_product_id: product.dbId,
          p_cost: toNumber(form.cost),
        });
        if (costResult.error) throw costResult.error;
      }
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
