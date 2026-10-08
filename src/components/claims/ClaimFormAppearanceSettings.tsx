"use client";

import {
  ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ImagePlus,
  Move,
  Palette,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { validateClaimFormBanner } from "@/lib/claim-form-assets";
import {
  CLAIM_FORM_THEME_PRESETS,
  blendHexColors,
  getContrastColor,
  normalizeClaimFormBannerPosition,
  normalizeHexColor,
  type ClaimFormBannerPosition,
  type ClaimFormTheme,
} from "@/lib/claim-form-theme";

function themesMatch(
  left?: Partial<ClaimFormTheme> | null,
  right?: Partial<ClaimFormTheme> | null,
) {
  if (!left || !right) return false;
  return (
    (left.primaryColor || "").toUpperCase() ===
      (right.primaryColor || "").toUpperCase() &&
    (left.backgroundColor || "").toUpperCase() ===
      (right.backgroundColor || "").toUpperCase() &&
    (left.surfaceColor || "").toUpperCase() ===
      (right.surfaceColor || "").toUpperCase() &&
    (left.headerTextColor || "").toUpperCase() ===
      (right.headerTextColor || "").toUpperCase()
  );
}

function ColorControl({
  label,
  value,
  fallback = "#5A87B1",
  onChange,
  disabled,
}: {
  label: string;
  value?: string;
  fallback?: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const safeValue = normalizeHexColor(value || "", fallback);
  return (
    <label className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-line bg-white px-3 py-2.5">
      <span className="whitespace-nowrap text-[12px] font-semibold text-dark">
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap font-mono text-[11px] text-muted">
          {safeValue}
        </span>
        <input
          className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
          type="color"
          value={safeValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          disabled={disabled}
          aria-label={label}
        />
      </span>
    </label>
  );
}

export function ClaimFormAppearanceSettings({
  inventoryName,
  title,
  description,
  bannerImageUrl,
  bannerImageFile,
  bannerImageRemoved,
  bannerPosition,
  onSelectBannerImage,
  onRemoveBannerImage,
  onBannerPositionChange,
  theme,
  onThemeChange,
  disabled,
}: {
  inventoryName: string;
  title: string;
  description: string;
  bannerImageUrl?: string;
  bannerImageFile: File | null;
  bannerImageRemoved: boolean;
  bannerPosition: ClaimFormBannerPosition;
  onSelectBannerImage: (file: File) => void;
  onRemoveBannerImage: () => void;
  onBannerPositionChange: (position: ClaimFormBannerPosition) => void;
  theme: ClaimFormTheme;
  onThemeChange: (theme: ClaimFormTheme) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  } | null>(null);
  const [imageError, setImageError] = useState("");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");

  useEffect(() => {
    if (!bannerImageFile) {
      setLocalPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(bannerImageFile);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerImageFile]);

  const previewImageUrl =
    localPreviewUrl || (!bannerImageRemoved ? bannerImageUrl : undefined);
  const safeTheme: ClaimFormTheme = {
    primaryColor: normalizeHexColor(theme?.primaryColor || "", "#5A87B1"),
    backgroundColor: normalizeHexColor(theme?.backgroundColor || "", "#F3F7FB"),
    surfaceColor: normalizeHexColor(theme?.surfaceColor || "", "#FFFFFF"),
    headerTextColor: normalizeHexColor(theme?.headerTextColor || "", "#172433"),
  };
  const primaryText = getContrastColor(safeTheme.primaryColor);
  const surfaceText = getContrastColor(safeTheme.surfaceColor);
  const previewBorder = blendHexColors(
    safeTheme.surfaceColor,
    safeTheme.primaryColor,
    0.28,
  );

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateClaimFormBanner(file);
    if (validationError) {
      setImageError(validationError);
      return;
    }
    setImageError("");
    onSelectBannerImage(file);
  }

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !previewImageUrl) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      positionX: bannerPosition.x,
      positionY: bannerPosition.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };
  }

  function dragImage(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onBannerPositionChange({
      x: normalizeClaimFormBannerPosition(
        drag.positionX - ((event.clientX - drag.pointerX) / drag.width) * 100,
      ),
      y: normalizeClaimFormBannerPosition(
        drag.positionY - ((event.clientY - drag.pointerY) / drag.height) * 100,
      ),
    });
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveImageWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !previewImageUrl) return;
    const step = event.shiftKey ? 10 : 2;
    const movement = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    onBannerPositionChange({
      x: normalizeClaimFormBannerPosition(bannerPosition.x + movement.x),
      y: normalizeClaimFormBannerPosition(bannerPosition.y + movement.y),
    });
  }

  return (
    <section className="rounded-[8px] border border-line bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary">
          <Palette size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="mb-0 text-[17px] font-bold text-dark">表單外觀</h3>
          <p className="mb-0 mt-0.5 text-[12px] text-muted">
            設定頂部橫幅背景圖與整頁色系，此庫藏所有 IP
            訂購頁共用同一組外觀風格。
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 border-t border-line/70 pt-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <b className="block text-[13px] text-dark">頂部橫幅背景圖</b>
                <span className="text-[11px] text-muted">
                  建議使用橫式圖片；系統會壓縮成 WebP，最多 10MB。
                </span>
              </div>
              {previewImageUrl && (
                <button
                  type="button"
                  className="outline shrink-0 text-[12px] text-danger hover:border-danger hover:bg-danger-soft"
                  onClick={() => {
                    setImageError("");
                    onRemoveBannerImage();
                  }}
                  disabled={disabled}
                >
                  <Trash2 size={14} />
                  移除
                </button>
              )}
            </div>

            {previewImageUrl ? (
              <>
                <div
                  className="group relative grid min-h-40 w-full touch-none select-none place-items-center overflow-hidden rounded-[8px] border border-line bg-light outline-none ring-primary/30 focus-visible:ring-2"
                  onPointerDown={startDragging}
                  onPointerMove={dragImage}
                  onPointerUp={stopDragging}
                  onPointerCancel={stopDragging}
                  onKeyDown={moveImageWithKeyboard}
                  role="application"
                  tabIndex={disabled ? -1 : 0}
                  aria-label="拖曳或使用方向鍵調整橫幅圖片位置"
                  style={{ cursor: disabled ? "not-allowed" : "grab" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    style={{
                      objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
                    }}
                    src={previewImageUrl}
                    alt="頂部橫幅裁切預覽"
                    draggable={false}
                  />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-2.5 pt-8 text-center text-[11px] font-semibold text-white">
                    <Move
                      className="mr-1.5 inline"
                      size={14}
                      aria-hidden="true"
                    />
                    按住圖片拖曳位置
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="outline text-[12px]"
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled}
                  >
                    <ImagePlus size={14} />
                    更換圖片
                  </button>
                  <button
                    type="button"
                    className="outline text-[12px]"
                    onClick={() => onBannerPositionChange({ x: 50, y: 50 })}
                    disabled={
                      disabled ||
                      (bannerPosition.x === 50 && bannerPosition.y === 50)
                    }
                  >
                    <RotateCcw size={14} />
                    回到置中
                  </button>
                  <span className="ml-auto self-center text-[10px] text-muted">
                    X {bannerPosition.x}% · Y {bannerPosition.y}%
                  </span>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="grid min-h-32 w-full place-items-center rounded-[8px] border border-dashed border-line bg-light text-muted transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                <span className="flex flex-col items-center gap-2 px-4 py-5 text-[12px] font-semibold">
                  <ImagePlus size={24} />
                  上傳頂部橫幅背景圖
                </span>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={selectImage}
              hidden
            />
            {imageError && (
              <p className="mb-0 mt-2 text-[12px] text-danger" role="alert">
                {imageError}
              </p>
            )}
          </div>

          <div>
            <b className="block text-[13px] text-dark">快速套用色系</b>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CLAIM_FORM_THEME_PRESETS.map((preset) => {
                const selected = themesMatch(safeTheme, preset.theme);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`flex items-center gap-3 rounded-[8px] border px-3 py-3 text-left transition ${selected ? "border-primary bg-primary-soft/50" : "border-line bg-white hover:border-primary/60"}`}
                    onClick={() => onThemeChange({ ...preset.theme })}
                    disabled={disabled}
                  >
                    <span className="flex shrink-0 overflow-hidden rounded-full border border-black/10">
                      <span
                        className="size-5"
                        style={{
                          backgroundColor: preset.theme.backgroundColor,
                        }}
                      />
                      <span
                        className="size-5"
                        style={{ backgroundColor: preset.theme.surfaceColor }}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[12px] text-dark">
                        {preset.name}
                      </b>
                      <small className="block truncate text-[10px] text-muted">
                        {preset.description}
                      </small>
                    </span>
                    {selected && (
                      <Check className="shrink-0 text-primary" size={15} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <b className="block text-[13px] text-dark">自訂色彩</b>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ColorControl
                label="主色"
                value={safeTheme.primaryColor}
                fallback="#5A87B1"
                onChange={(primaryColor) =>
                  onThemeChange({ ...safeTheme, primaryColor })
                }
                disabled={disabled}
              />
              <ColorControl
                label="頁面背景"
                value={safeTheme.backgroundColor}
                fallback="#F3F7FB"
                onChange={(backgroundColor) =>
                  onThemeChange({ ...safeTheme, backgroundColor })
                }
                disabled={disabled}
              />
              <ColorControl
                label="卡片底色"
                value={safeTheme.surfaceColor}
                fallback="#FFFFFF"
                onChange={(surfaceColor) =>
                  onThemeChange({ ...safeTheme, surfaceColor })
                }
                disabled={disabled}
              />
              <ColorControl
                label="表頭文字"
                value={safeTheme.headerTextColor}
                fallback="#172433"
                onChange={(headerTextColor) =>
                  onThemeChange({ ...safeTheme, headerTextColor })
                }
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div>
          <b className="block text-[13px] text-dark">即時預覽</b>
          <div
            className="mt-2 overflow-hidden rounded-[8px] border p-3 shadow-sm"
            style={{
              backgroundColor: safeTheme.backgroundColor,
              borderColor: previewBorder,
            }}
          >
            <div
              className="relative min-h-32 overflow-hidden rounded-[8px] bg-cover p-4"
              style={{
                backgroundColor: safeTheme.primaryColor,
                backgroundImage: previewImageUrl
                  ? `linear-gradient(rgba(5, 16, 32, 0.28), rgba(5, 16, 32, 0.28)), url(${JSON.stringify(previewImageUrl)})`
                  : undefined,
                backgroundPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
                color: safeTheme.headerTextColor,
              }}
            >
              <div className="relative">
                <span
                  className="inline-flex rounded-[8px] px-2 py-1 text-[9px] font-bold"
                  style={{
                    backgroundColor: safeTheme.surfaceColor,
                    color: surfaceText,
                  }}
                >
                  {inventoryName}
                </span>
                <h4
                  className="mb-0 mt-3 text-[17px] leading-tight"
                  style={{ color: safeTheme.headerTextColor }}
                >
                  {title.trim() || "訂購標題預覽"}
                </h4>
                {description.trim() && (
                  <p
                    className="mb-0 mt-1 line-clamp-2 text-[10px] leading-4 opacity-80"
                    style={{ color: safeTheme.headerTextColor }}
                  >
                    {description}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {["商品預覽 A", "商品預覽 B"].map((name) => (
                <div
                  key={name}
                  className="rounded-[8px] border p-3"
                  style={{
                    backgroundColor: safeTheme.surfaceColor,
                    borderColor: previewBorder,
                    color: surfaceText,
                  }}
                >
                  <span
                    className="text-[9px] font-bold"
                    style={{ color: safeTheme.primaryColor }}
                  >
                    海報 · A3
                  </span>
                  <b className="mt-1 block text-[11px]">{name}</b>
                  <button
                    type="button"
                    className="mt-3 w-full rounded-[8px] border-0 px-2 py-1.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: safeTheme.primaryColor,
                      color: primaryText,
                    }}
                    tabIndex={-1}
                  >
                    選擇商品
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
