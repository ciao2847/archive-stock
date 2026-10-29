"use client";

import { CloseButton } from "@/components/ui/CloseButton";

import { useDirtyBack } from "@/components/navigation/BackNavigation";
import { ChangeEvent, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  newProductSchema as schema,
  preorderProductSchema,
  type NewProductForm as Form,
} from "./new-product-schema";
import { PreorderNameFields } from "./PreorderNameFields";
import { ProductImageUpload } from "./ProductImageUpload";
import { buildPreorderProductName } from "@/lib/preorder-product-name";
import { PosterSpecFields } from "./PosterSpecFields";
import { validateProductImage } from "./product-image-validation";
import { ProductFormField as Field } from "./ProductFormField";
import {
  countryLabel,
  COUNTRIES,
  POSTER_CATEGORY,
  POSTER_SIZES,
  PRODUCT_CATEGORIES,
} from "@/constants";
import { DEFAULT_VALUES, toNumber } from "@/constants";
import { getStorage } from "@/lib/api/locations";
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
  initialWorkName = "",
  requireItemName = false,
}: {
  ownerId: string;
  onClose: () => void;
  onCreated?: (productId?: string) => void | Promise<void>;
  initialStock?: number;
  initialLocation?: string;
  title?: string;
  preorderOnly?: boolean;
  initialWorkName?: string;
  requireItemName?: boolean;
}) {
  const [locationOptions, setLocationOptions] = useState<
    Array<{ code: string; name: string }>
  >([]);
  useEffect(() => {
    if (preorderOnly) return;
    const controller = new AbortController();
    void getStorage(ownerId, controller.signal)
      .then((data) =>
        setLocationOptions(
          data.slots.map((slot) => ({
            code: slot.code,
            name: `${data.cabinets.find((c) => c.id === slot.cabinet_id)?.name ?? "櫃子"}／${slot.display_name ?? slot.code}`,
          })),
        ),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [ownerId, preorderOnly]);
  const [poster, setPoster] = useState(true);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(preorderOnly ? preorderProductSchema : schema),
    defaultValues: {
      name: preorderOnly ? initialWorkName : "",
      itemName: "",
      category: POSTER_CATEGORY,
      country: "",
      source: "",
      stock: preorderOnly ? 0 : (initialStock ?? DEFAULT_VALUES.productStock),
      location: preorderOnly ? "" : (initialLocation ?? ""),
      price: "",
      format: preorderOnly ? "" : undefined,
      size: preorderOnly ? POSTER_SIZES[0] : undefined,
      crafts: [],
      description: preorderOnly ? "" : undefined,
      feature: preorderOnly ? "" : undefined,
    },
  });

  const [preorderWork, preorderItem, preorderCountry] = useWatch({
    control,
    name: ["name", "itemName", "country"],
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
    if (
      preorderOnly &&
      buildPreorderProductName(values.country, values.name, values.itemName)
        .length > 300
    ) {
      setSubmitError("組合後的商品名稱最多 300 字元");
      return;
    }
    if (preorderOnly && requireItemName && !values.itemName?.trim()) {
      setSubmitError("多品表單請填寫品項名稱，例如 A款、全員款或肖像款");
      return;
    }
    if (!preorderOnly && !image) {
      setImageError("請上傳商品圖片");
      return;
    }
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
          name: preorderOnly
            ? buildPreorderProductName(
                values.country,
                values.name,
                values.itemName,
              )
            : values.name,
          ...(preorderOnly
            ? {
                work: values.name.trim(),
                preorderItemName: values.itemName?.trim() ?? "",
              }
            : {}),
          preorderOnly,
          category: values.category,
          country: values.country,
          source: values.source,
          location: preorderOnly ? "" : values.location,
          stock: preorderOnly
            ? 0
            : toNumber(values.stock, DEFAULT_VALUES.productStock),
          price: toNumber(values.price),
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

  const { requestBack, markChanged } = useDirtyBack({
    onBack: onClose,
    hideButton: true,
    busy: saving,
    dirty: false,
  });
  return (
    <>
      <div className="overlay" onClick={requestBack} />
      <aside className="drawer new-drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">
              {preorderOnly ? "預購訂購" : "商品入庫"}
            </span>
            <h2>{title || "新增商品"}</h2>
          </div>
          <CloseButton aria-label="關閉新增商品" onClick={requestBack} />
        </div>
        <form
          onChangeCapture={markChanged}
          onSubmit={handleSubmit(createProduct)}
        >
          <ProductImageUpload
            src={previewUrl}
            file={image}
            required={!preorderOnly}
            preorder={preorderOnly}
            disabled={saving}
            error={imageError}
            onChange={selectImage}
            onRemove={removeImage}
          />
          {/* {preorderOnly && (
            <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-[#cbdde9] bg-[#eef5fa] px-4 py-3.5 text-[#29485f]">
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white text-[#5a87b1]">
                <ClipboardList size={18} aria-hidden="true" />
              </span>
              <div>
                <b className="block text-[13px]">先收訂購，再依總數叫貨</b>

              </div>
            </div>
          )} */}
          <div className="form-grid">
            {preorderOnly ? (
              <>
                <PreorderNameFields
                  work={preorderWork ?? ""}
                  itemName={preorderItem ?? ""}
                  country={preorderCountry ?? ""}
                  onWorkChange={(value) =>
                    setValue("name", value, { shouldDirty: true })
                  }
                  onItemNameChange={(value) =>
                    setValue("itemName", value, { shouldDirty: true })
                  }
                  onCountryChange={(value) =>
                    setValue("country", value, { shouldDirty: true })
                  }
                  workError={errors.name?.message}
                  itemError={errors.itemName?.message}
                  countryError={errors.country?.message}
                  requireItemName={requireItemName}
                />
                <Field label="尺寸" error={errors.size?.message}>
                  <select {...register("size")} required>
                    {POSTER_SIZES.map((item) => (
                      <option key={item} value={item}>
                        {countryLabel(item)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="會員價（定價另加 150）"
                  error={errors.price?.message}
                >
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
                <Field label="名稱（必填）" error={errors.name?.message}>
                  <input
                    {...register("name")}
                    placeholder="例：烘焙款 IMAX 海報"
                    required
                  />
                </Field>
                <Field label="國家版本（必填）" error={errors.country?.message}>
                  <select {...register("country")} required>
                    <option value="">請選擇國家版本</option>
                    {COUNTRIES.map((item) => (
                      <option key={item} value={item}>
                        {countryLabel(item)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="會員價（必填，定價另加 150）"
                  error={errors.price?.message}
                >
                  <input
                    type="number"
                    min="0"
                    step="1"
                    {...register("price")}
                    placeholder="每件販售金額"
                    required
                  />
                </Field>
                <Field
                  label="存放格位（選填）"
                  error={errors.location?.message}
                >
                  <select {...register("location")}>
                    <option value="">待整理（稍後安排）</option>
                    {initialLocation &&
                      !locationOptions.some(
                        (s) => s.code === initialLocation,
                      ) && (
                        <option value={initialLocation}>
                          {initialLocation}
                        </option>
                      )}
                    {locationOptions.map((slot) => (
                      <option key={slot.code} value={slot.code}>
                        {slot.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <details className="col-span-full mt-2 rounded-xl border border-line p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    更多資訊（選填）
                  </summary>
                  <div className="form-grid">
                    <Field label="商品類型">
                      <select
                        {...register("category")}
                        onChange={(e) =>
                          setPoster(e.target.value === POSTER_CATEGORY)
                        }
                      >
                        {PRODUCT_CATEGORIES.map((item) => (
                          <option key={item} value={item}>
                            {countryLabel(item)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="發行來源">
                      <input
                        {...register("source")}
                        placeholder="CGV、官方快閃…"
                      />
                    </Field>
                    <Field label="庫存數量">
                      <input type="number" {...register("stock")} />
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
                  </div>
                </details>
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
              onClick={requestBack}
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
