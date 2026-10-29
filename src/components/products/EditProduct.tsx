"use client";

import { CloseButton } from "@/components/ui/CloseButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Spinner } from "@/components/ui/Spinner";
import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { FormEvent, useEffect, useState } from "react";
import { Expand, ImagePlus, Save, Search, Trash2 } from "lucide-react";
import { PreorderNameFields } from "./PreorderNameFields";
import { ProductImageUpload } from "./ProductImageUpload";
import { validateProductImage } from "./product-image-validation";
import {
  buildPreorderProductName,
  cleanPreorderNamePart,
} from "@/lib/preorder-product-name";
import { Product } from "@/lib/types";
import { toNumber } from "@/constants";
import { updateProduct, uploadProductImages } from "@/lib/api/products";
import {
  countryLabel,
  COUNTRIES,
  LOCATION_CODE_PATTERN,
  POSTER_CATEGORY,
  POSTER_FORMATS,
  POSTER_CRAFTS,
  IMAGE_UPLOAD,
  POSTER_SIZES,
  PRODUCT_CATEGORIES,
} from "@/constants";
import { createProductImageVariants } from "@/lib/product-images";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import styles from "../../../styles/components/products/EditProduct.module.scss";
/** 編輯商品表單。 */
export function EditProduct({
  product,
  onClose,
  onUpdated,
  preorderOnly = false,
}: {
  product: Product;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
  preorderOnly?: boolean;
}) {
  const namedPreorder = product.preorderItemName !== undefined;
  const [form, setForm] = useState({
    work: product.work,
    itemName: product.preorderItemName ?? "",
    name: product.name,
    category: product.category,
    country: product.country === "—" ? "" : product.country,
    source: product.source === "—" ? "" : product.source,
    location:
      product.primaryLocationCode ??
      (product.location === "未指定" ? "" : product.location),
    stock: String(product.stock),
    price: String(product.price),
    format: product.format || "",
    size: product.size || "",
    description: product.description || "",
    feature: product.feature || "",
  });
  const displayName = namedPreorder
    ? buildPreorderProductName(form.country, form.work, form.itemName)
    : form.name;
  const [crafts, setCrafts] = useState(product.crafts ?? []);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!image) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const displayedImage = preview || (!removeImage ? product.image : undefined);
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
      if (namedPreorder && !cleanPreorderNamePart(form.work))
        throw new Error("請填寫作品名稱");
      if (
        namedPreorder &&
        buildPreorderProductName(form.country, form.work, form.itemName)
          .length > 300
      )
        throw new Error("組合後的商品名稱最多 300 字元");
      if (form.description.length > 2000)
        throw new Error("功能描述最多 2,000 字元");
      if (form.location) {
        const code = form.location.toUpperCase();
        if (!LOCATION_CODE_PATTERN.test(code))
          throw new Error("庫位格式需為 A-03-02");
      }
      const nextStock = Number(form.stock);
      if (!Number.isInteger(nextStock) || nextStock < 0)
        throw new Error("庫存數量必須是 0 以上的整數");
      let imagePaths: string[] | undefined = removeImage ? [] : undefined;
      if (image) {
        const variants = await createProductImageVariants(image);
        imagePaths = (
          await uploadProductImages(variants.main, variants.thumbnail)
        ).paths;
      }
      await updateProduct(product.dbId, {
        crafts: form.category === POSTER_CATEGORY ? crafts : [],
        imagePaths,
        name: displayName.trim(),
        ...(namedPreorder
          ? { work: form.work.trim(), preorderItemName: form.itemName.trim() }
          : {}),
        category: form.category,
        country: form.country,
        source: form.source,
        location: form.location.toUpperCase(),
        stock: nextStock,
        price: toNumber(form.price),
        format: form.category === POSTER_CATEGORY ? form.format : "",
        size: form.category === POSTER_CATEGORY ? form.size : "",
        feature: form.feature,
        description: form.description,
      });
      await onUpdated();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失敗");
    } finally {
      setSaving(false);
    }
  }
  const { requestBack, markChanged } = useDirtyBack({
    onBack: onClose,
    hideButton: true,
    busy: saving,
    dirty:
      Boolean(image) ||
      removeImage ||
      JSON.stringify(crafts) !== JSON.stringify(product.crafts ?? []),
  });
  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/55"
        onClick={requestBack}
      />
      <aside
        className={`drawer ${styles.drawer}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-product-title"
      >
        <header className={styles.header}>
          <div>
            <span className="eyebrow">編輯商品</span>
            <h2 id="edit-product-title">{product.id}</h2>
          </div>
          <CloseButton
            aria-label="關閉編輯商品"
            onClick={requestBack}
            disabled={saving}
            size={20}
          />
        </header>
        <form
          onChangeCapture={markChanged}
          className={styles.form}
          onSubmit={submit}
        >
          <fieldset className={styles.fields} disabled={saving}>
            {preorderOnly || namedPreorder ? (
              <div className={styles.preorderImage}>
                <ProductImageUpload
                  src={displayedImage}
                  file={image}
                  preorder
                  disabled={saving}
                  error={imageError}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const validationError = validateProductImage(file);
                    if (validationError) {
                      setImageError(validationError);
                      return;
                    }
                    setImageError("");
                    setImage(file);
                    setRemoveImage(false);
                  }}
                  onRemove={() => {
                    setImage(null);
                    setRemoveImage(true);
                    setImageError("");
                  }}
                  onPreview={() => setLightboxOpen(true)}
                />
              </div>
            ) : (
              <div className={styles.imageArea}>
                {displayedImage ? (
                  <>
                    <button
                      type="button"
                      className={styles.imagePreview}
                      onClick={() => setLightboxOpen(true)}
                      aria-label="查看完整商品圖片"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayedImage}
                        alt={`${displayName} 商品圖片`}
                      />
                    </button>
                    <button
                      type="button"
                      className={styles.expand}
                      onClick={() => setLightboxOpen(true)}
                      aria-label="放大商品圖片"
                    >
                      <Expand size={18} />
                    </button>
                  </>
                ) : (
                  <div className={styles.emptyImage}>
                    <ImagePlus size={32} />
                    <span>新增商品圖片</span>
                  </div>
                )}
                <div className={styles.imageActions}>
                  <span>
                    {displayedImage ? (
                      <>
                        <Search size={14} />
                        點擊查看完整圖片
                      </>
                    ) : (
                      "JPG、PNG、WebP，最多 10MB"
                    )}
                  </span>
                  <label className={styles.replaceImage}>
                    <ImagePlus size={15} />
                    {displayedImage ? "更換圖片" : "上傳圖片"}
                    <input
                      type="file"
                      aria-label="上傳商品圖片"
                      accept={IMAGE_UPLOAD.acceptedTypes.join(",")}
                      disabled={saving}
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (
                          !IMAGE_UPLOAD.acceptedTypes.includes(
                            file.type as (typeof IMAGE_UPLOAD.acceptedTypes)[number],
                          ) ||
                          file.size > IMAGE_UPLOAD.maxBytes
                        ) {
                          setError(
                            `請選擇 ${IMAGE_UPLOAD.maxMegabytes}MB 以下的 JPG、PNG 或 WebP 圖片`,
                          );
                          event.target.value = "";
                          return;
                        }
                        setError("");
                        setImage(file);
                        setRemoveImage(false);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.removeImage}
                    aria-label="移除圖片"
                    disabled={!displayedImage}
                    onClick={() => {
                      setImage(null);
                      setRemoveImage(true);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )}
            <div className={styles.body}>
              <section className={styles.section}>
                {namedPreorder ? (
                  <PreorderNameFields
                    work={form.work}
                    itemName={form.itemName}
                    country={form.country}
                    onWorkChange={(value) => change("work", value)}
                    onItemNameChange={(value) => change("itemName", value)}
                    onCountryChange={(value) => change("country", value)}
                  />
                ) : (
                  <Field label="商品名稱">
                    <input
                      required
                      value={form.name}
                      onChange={(e) => change("name", e.target.value)}
                    />
                  </Field>
                )}
              </section>
              <section
                className={styles.section}
                aria-labelledby="edit-classification"
              >
                <h3 id="edit-classification">分類與來源</h3>
                <div className={styles.grid}>
                  <Field label="商品類型">
                    <select
                      value={form.category}
                      onChange={(e) => change("category", e.target.value)}
                    >
                      {PRODUCT_CATEGORIES.map((item) => (
                        <option key={item} value={item}>
                          {countryLabel(item)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {form.category === POSTER_CATEGORY && (
                    <Field label="版本 / 影廳">
                      <select
                        value={form.format}
                        onChange={(e) => change("format", e.target.value)}
                      >
                        <option value="">未指定</option>
                        {[
                          ...new Set([
                            ...POSTER_FORMATS,
                            ...(form.format ? [form.format] : []),
                          ]),
                        ].map((item) => (
                          <option key={item} value={item}>
                            {countryLabel(item)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {!namedPreorder && (
                    <Field label="國家">
                      <select
                        value={form.country}
                        onChange={(e) => change("country", e.target.value)}
                      >
                        <option value="">未指定</option>
                        {[
                          ...new Set([
                            ...COUNTRIES,
                            ...(form.country ? [form.country] : []),
                          ]),
                        ].map((item) => (
                          <option key={item} value={item}>
                            {countryLabel(item)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {form.category === POSTER_CATEGORY && (
                    <Field label="尺寸">
                      <select
                        value={form.size}
                        onChange={(e) => change("size", e.target.value)}
                      >
                        <option value="">未指定</option>
                        {[
                          ...new Set([
                            ...POSTER_SIZES,
                            ...(form.size ? [form.size] : []),
                          ]),
                        ].map((item) => (
                          <option key={item} value={item}>
                            {countryLabel(item)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="發行來源" wide>
                    <input
                      value={form.source}
                      onChange={(e) => change("source", e.target.value)}
                      placeholder="例如：官方發行、戲院限定"
                    />
                  </Field>
                </div>
              </section>
              <section className={styles.section} aria-labelledby="edit-stock">
                <h3 id="edit-stock">庫位與定價</h3>
                <div className={styles.grid}>
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
                      required
                      value={form.stock}
                      onChange={(e) => change("stock", e.target.value)}
                    />
                  </Field>
                  <Field label="會員價（每件，定價另加 150）" wide>
                    <input
                      type="number"
                      min="0"
                      value={form.price}
                      onChange={(e) => change("price", e.target.value)}
                    />
                  </Field>
                </div>
              </section>
              {form.category === POSTER_CATEGORY && (
                <>
                  <section className={styles.section}>
                    <fieldset className={styles.crafts}>
                      <legend>工藝（可複選）</legend>
                      <div className={styles.chips}>
                        {[...new Set([...POSTER_CRAFTS, ...crafts])].map(
                          (craft) => (
                            <label key={craft}>
                              <input
                                type="checkbox"
                                checked={crafts.includes(craft)}
                                onChange={(e) =>
                                  setCrafts((current) =>
                                    e.target.checked
                                      ? [...current, craft]
                                      : current.filter(
                                          (value) => value !== craft,
                                        ),
                                  )
                                }
                              />
                              <span>{craft}</span>
                            </label>
                          ),
                        )}
                      </div>
                    </fieldset>
                  </section>
                  <section className={styles.section}>
                    <Field label="辨識特徵">
                      <textarea
                        value={form.feature}
                        onChange={(e) => change("feature", e.target.value)}
                        placeholder="方便快速辨識的外觀特徵"
                        rows={2}
                      />
                    </Field>
                  </section>
                </>
              )}
              <section className={styles.section}>
                <div className={styles.descriptionLabel}>
                  <label htmlFor="edit-product-description">功能描述</label>
                  <span>
                    {form.description.length.toLocaleString()} / 2,000 字元
                  </span>
                </div>
                <textarea
                  id="edit-product-description"
                  className={styles.description}
                  value={form.description}
                  onChange={(e) => change("description", e.target.value)}
                  rows={3}
                  placeholder="商品內容、特色或故事背景"
                  aria-invalid={form.description.length > 2000}
                />

                {form.description.length > 2000 && (
                  <p className="upload-error">功能描述最多 2,000 字元</p>
                )}
              </section>
              {error && (
                <ErrorMessage className="upload-error">
                  更新失敗：{error}
                </ErrorMessage>
              )}
            </div>
          </fieldset>
          <footer className={styles.footer}>
            <button
              type="button"
              className="outline"
              onClick={requestBack}
              disabled={saving}
            >
              取消
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Spinner size={17} /> : <Save size={17} />}
              {saving ? "儲存中…" : "儲存修改"}
            </button>
          </footer>
        </form>
      </aside>
      {lightboxOpen && displayedImage && (
        <ImageLightbox
          src={displayedImage}
          alt={form.name}
          label={product.id}
          onClose={() => setLightboxOpen(false)}
        />
      )}
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
