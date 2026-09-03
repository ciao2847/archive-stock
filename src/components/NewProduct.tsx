"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, Trash2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  COUNTRIES,
  IMAGE_UPLOAD,
  LOCATION_CODE_PATTERN,
  POSTER_CATEGORY,
  POSTER_CRAFTS,
  POSTER_FORMATS,
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

const schema = z.object({
  name: z.string().min(1, "請輸入商品名稱"),
  work: z.string().min(1, "請輸入作品名稱"),
  category: z.string(),
  country: z.string(),
  source: z.string(),
  location: z.string().regex(LOCATION_CODE_PATTERN, "格式如 A-03-02"),
  stock: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0),
  format: z.string().optional(),
  size: z.string().optional(),
  crafts: z.array(z.string()).optional(),
  feature: z.string().optional(),
});
type Form = z.input<typeof schema>;

/** 新增商品表單。 */
export function NewProduct({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
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
      category: POSTER_CATEGORY,
      stock: DEFAULT_VALUES.productStock,
      price: DEFAULT_VALUES.amount,
      cost: DEFAULT_VALUES.amount,
      crafts: [],
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
    if (
      !IMAGE_UPLOAD.acceptedTypes.includes(
        file.type as (typeof IMAGE_UPLOAD.acceptedTypes)[number],
      )
    ) {
      setImageError("請選擇 JPG、PNG 或 WebP 圖片");
      event.target.value = "";
      return;
    }
    if (file.size > IMAGE_UPLOAD.maxBytes) {
      setImageError(`圖片不可超過 ${IMAGE_UPLOAD.maxMegabytes}MB`);
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

      await createProductApi({
        name: values.name,
        work: values.work,
        category: values.category,
        country: values.country,
        source: values.source,
        location: values.location,
        stock: toNumber(values.stock, DEFAULT_VALUES.productStock),
        price: toNumber(values.price),
        cost: toNumber(values.cost),
        imagePaths,
        format: values.category === POSTER_CATEGORY ? values.format || "" : "",
        size: values.category === POSTER_CATEGORY ? values.size || "" : "",
        crafts: values.category === POSTER_CATEGORY ? values.crafts || [] : [],
        feature:
          values.category === POSTER_CATEGORY ? values.feature || "" : "",
      });
      await onCreated?.();
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
            <span className="eyebrow">商品入庫</span>
            <h2>新增商品</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <form onSubmit={handleSubmit(createProduct)}>
          {previewUrl ? (
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
          )}
          {imageError && <p className="upload-error">{imageError}</p>}
          <div className="form-grid">
            <Field label="商品名稱" error={errors.name?.message}>
              <input {...register("name")} placeholder="例：烘焙款 IMAX 海報" />
            </Field>
            <Field label="作品名稱" error={errors.work?.message}>
              <input {...register("work")} placeholder="搜尋或建立作品" />
            </Field>
            <Field label="商品類型">
              <select
                {...register("category")}
                onChange={(e) => setPoster(e.target.value === POSTER_CATEGORY)}
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
            {poster && (
              <>
                <Field label="版本 / 影廳">
                  <select {...register("format")}>
                    {POSTER_FORMATS.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="尺寸">
                  <select {...register("size")}>
                    {POSTER_SIZES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="工藝（可複選）" wide>
                  <div className="chips">
                    {POSTER_CRAFTS.map((x) => (
                      <label key={x}>
                        <input
                          type="checkbox"
                          value={x}
                          {...register("crafts")}
                        />
                        {x}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="辨識特徵" wide>
                  <textarea
                    {...register("feature")}
                    placeholder="例：左下角有 IMAX Logo、標題燙金…"
                  />
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
              {saving ? "儲存中…" : "儲存並產生 QR Code"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function Field({
  label,
  error,
  wide,
  children,
}: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
      {error && <em>{error}</em>}
    </label>
  );
}
