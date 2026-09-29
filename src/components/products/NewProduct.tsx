"use client";

import { ChangeEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  ImagePlus,
  Trash2,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  newProductSchema as schema,
  type NewProductForm as Form,
} from "./new-product-schema";
import { PosterSpecFields } from "./PosterSpecFields";
import { validateProductImage } from "./product-image-validation";
import { ProductFormField as Field } from "./ProductFormField";
import {
  COUNTRIES,
  POSTER_CATEGORY,
  POSTER_SIZES,
  PRODUCT_CATEGORIES,
} from "@/constants";
import { DEFAULT_VALUES, toNumber } from "@/constants";
import { createProductImageVariants } from "@/lib/product-images";
import {
  createProduct as createProductApi,
  removeProductImages,
  uploadProductImages,
} from "@/lib/api/products";

/** 新增商品表單。 */
export function NewProduct({
  ownerId,
  onClose,
  onCreated,
  initialStock,
  initialLocation,
  title,
  preorderOnly = false,
}: {
  ownerId: string;
  onClose: () => void;
  onCreated?: (productId?: string) => void | Promise<void>;
  initialStock?: number;
  initialLocation?: string;
  title?: string;
  preorderOnly?: boolean;
}) {
  const [poster, setPoster] = useState(true);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      work: preorderOnly ? "預購商品" : undefined,
      category: POSTER_CATEGORY,
      country: preorderOnly ? "" : undefined,
      source: preorderOnly ? "" : undefined,
      stock: preorderOnly ? 0 : (initialStock ?? DEFAULT_VALUES.productStock),
      location: preorderOnly ? "" : (initialLocation ?? ""),
      price: DEFAULT_VALUES.amount,
      cost: DEFAULT_VALUES.amount,
      format: preorderOnly ? "" : undefined,
      size: preorderOnly ? POSTER_SIZES[0] : undefined,
      crafts: [],
      description: preorderOnly ? "" : undefined,
      feature: preorderOnly ? "" : undefined,
    },
  });

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateProductImage(file);
    if (validationError) {
      setImageError(validationError);
      event.target.value = "";
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setImageError("");
  }

  function removeImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImage(null);
    setPreviewUrl(null);
    setImageError("");
  }

  async function createProduct(values: Form) {
    setSaving(true);
    setSubmitError("");
    const imagePaths: string[] = [];
    try {
      if (image) {
        const variants = await createProductImageVariants(image);
        const uploaded = await uploadProductImages(
          variants.main,
          variants.thumbnail,
        );
        imagePaths.push(...uploaded.paths);
      }

      const res = await createProductApi(
        {
          name: values.name,
          work: values.work,
          category: values.category,
          country: values.country,
          source: values.source,
          location: preorderOnly ? "" : values.location,
          stock: preorderOnly
            ? 0
            : toNumber(values.stock, DEFAULT_VALUES.productStock),
          price: toNumber(values.price),
          cost: preorderOnly ? 0 : toNumber(values.cost),
          imagePaths,
          format:
            values.category === POSTER_CATEGORY ? values.format || "" : "",
          size: values.category === POSTER_CATEGORY ? values.size || "" : "",
          crafts:
            values.category === POSTER_CATEGORY ? values.crafts || [] : [],
          description: values.description || "",
          feature:
            values.category === POSTER_CATEGORY ? values.feature || "" : "",
        },
        ownerId,
      );
      await onCreated?.(res.productId);
      onClose();
    } catch (error) {
      if (imagePaths.length > 0) {
        await removeProductImages(imagePaths).catch(() => undefined);
      }
      setSubmitError(error instanceof Error ? error.message : "商品儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer new-drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">
              {preorderOnly ? "預購喊單" : "商品入庫"}
            </span>
            <h2>{title || "新增商品"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <form onSubmit={handleSubmit(createProduct)}>
          {!preorderOnly &&
            (previewUrl ? (
              <div className="upload-preview">
                {/* blob URL is only used for a local preview. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="商品主圖預覽" />
                <div className="upload-preview-info">
                  <span className="upload-success">
                    <CheckCircle2 size={16} />
                    圖片已選擇
                  </span>
                  <b title={image?.name}>{image?.name}</b>
                  <small>
                    {image && `${(image.size / 1024 / 1024).toFixed(2)} MB`}
                  </small>
                  <div>
                    <label className="outline image-change">
                      更換圖片
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={selectImage}
                        hidden
                      />
                    </label>
                    <button
                      type="button"
                      className="image-remove"
                      onClick={removeImage}
                    >
                      <Trash2 size={15} />
                      移除
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <label className="upload">
                <ImagePlus />
                <b>上傳商品主圖</b>
                <span>JPG、PNG、WebP，最多 10MB</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={selectImage}
                  hidden
                />
              </label>
            ))}
          {!preorderOnly && imageError && (
            <p className="upload-error">{imageError}</p>
          )}
          {preorderOnly && (
            <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-[#cbdde9] bg-[#eef5fa] px-4 py-3.5 text-[#29485f]">
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white text-[#5a87b1]">
                <ClipboardList size={18} aria-hidden="true" />
              </span>
              <div>
                <b className="block text-[13px]">先收喊單，再依總數叫貨</b>
                <p className="mb-0 mt-1 text-[12px] leading-5 text-[#526b80]">
                  只要填寫商品名稱、尺寸與販售金額。系統會自動以庫存 0
                  建立，不佔用現貨；截止後再依喊單總數採購。
                </p>
              </div>
            </div>
          )}
          <div className="form-grid">
            {preorderOnly ? (
              <>
                <Field label="商品名稱" error={errors.name?.message}>
                  <input
                    {...register("name")}
                    placeholder="例：烘焙款 IMAX 海報"
                    required
                  />
                </Field>
                <Field label="尺寸" error={errors.size?.message}>
                  <select {...register("size")} required>
                    {POSTER_SIZES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="販售金額" error={errors.price?.message}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    {...register("price")}
                    placeholder="每件販售金額"
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="商品名稱" error={errors.name?.message}>
                  <input
                    {...register("name")}
                    placeholder="例：烘焙款 IMAX 海報"
                  />
                </Field>
                <Field label="作品名稱" error={errors.work?.message}>
                  <input {...register("work")} placeholder="搜尋或建立作品" />
                </Field>
                <Field label="商品類型">
                  <select
                    {...register("category")}
                    onChange={(e) =>
                      setPoster(e.target.value === POSTER_CATEGORY)
                    }
                  >
                    {PRODUCT_CATEGORIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="國家">
                  <select {...register("country")}>
                    {COUNTRIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="發行來源">
                  <input {...register("source")} placeholder="CGV、官方快閃…" />
                </Field>
                <Field label="庫位" error={errors.location?.message}>
                  <input {...register("location")} placeholder="A-03-02" />
                  <small>尚未進貨、庫存填 0 時可先留空。</small>
                </Field>
                <Field label="庫存數量">
                  <input type="number" {...register("stock")} />
                </Field>
                <Field label="商品售價（每件）" error={errors.price?.message}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    {...register("price")}
                    placeholder="每件售價"
                  />
                </Field>
                <Field label="本批成本總額" error={errors.cost?.message}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    {...register("cost")}
                    placeholder="整批成本，不必拆單件"
                  />
                </Field>
                {poster && <PosterSpecFields register={register} />}
                <Field
                  label="功能描述"
                  wide
                  error={errors.description?.message}
                >
                  <textarea
                    {...register("description")}
                    rows={5}
                    placeholder="商品內容、特色或故事背景"
                    aria-invalid={Boolean(errors.description)}
                  />
                  <small>選填，最多 2,000 字元，支援換行。</small>
                </Field>
              </>
            )}
          </div>
          {submitError && (
            <p className="upload-error">儲存失敗：{submitError}</p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="outline"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "儲存中…" : preorderOnly ? "建立預購商品" : "儲存商品"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
