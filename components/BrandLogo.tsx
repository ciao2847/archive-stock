import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  inverse?: boolean;
  preload?: boolean;
  size?: "small" | "medium" | "large";
};

const IMAGE_SIZE_CLASSES = {
  small: "size-12",
  medium: "size-14",
  large: "size-[72px]",
} as const;

/** 共用品牌標誌，供登入頁、後台導覽與公開頁使用。 */
export function BrandLogo({
  className = "",
  inverse = false,
  preload = false,
  size = "medium",
}: BrandLogoProps) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <Image
        src="/brand/archive-logo.png"
        width={72}
        height={72}
        sizes={size === "large" ? "72px" : size === "medium" ? "56px" : "48px"}
        preload={preload}
        alt=""
        className={`${IMAGE_SIZE_CLASSES[size]} shrink-0 object-contain`}
      />
      <div className="min-w-0">
        <strong
          className={`block text-[20px] tracking-[0.12em] ${inverse ? "text-white" : "text-[var(--color-main)]"}`}
        >
          庫藏
        </strong>
        <small
          className={`mt-[2px] block font-mono text-[10px] tracking-[0.16em] ${inverse ? "text-white/60" : "text-[var(--color-muted)]"}`}
        >
          ARCHIVE STOCK
        </small>
      </div>
    </div>
  );
}
