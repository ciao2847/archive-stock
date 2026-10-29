import type { CSSProperties } from "react";

import { blendHexColors, getContrastColor } from "@/lib/claim-form-theme";
import type { PublicClaimForm } from "@/lib/claims";

type ClaimThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

const flatAppearance: ClaimThemeStyle = {
  "--app-shadow-sm": "none",
  "--app-shadow-md": "none",
  "--app-shadow-lg": "none",
  "--color-accent": "transparent",
};

export function createClaimFormStyles(form: PublicClaimForm) {
  const { theme } = form;
  const surfaceText = getContrastColor(theme.surfaceColor);
  const softColor = blendHexColors(
    theme.surfaceColor,
    theme.primaryColor,
    0.13,
  );

  // 主色與互動狀態
  const primaryStyles: ClaimThemeStyle = {
    "--claim-primary": theme.primaryColor,
    "--claim-primary-hover": blendHexColors(
      theme.primaryColor,
      "#000000",
      0.16,
    ),
    "--claim-primary-text": getContrastColor(theme.primaryColor),
  };

  // 頁面背景與文字
  const pageStyles: ClaimThemeStyle = {
    "--claim-background": theme.backgroundColor,
    "--claim-page-text": getContrastColor(theme.backgroundColor),
  };

  // 商品卡片、金額與邊框
  const surfaceStyles: ClaimThemeStyle = {
    "--claim-surface": theme.surfaceColor,
    "--claim-surface-text": surfaceText,
    "--claim-surface-muted": blendHexColors(
      theme.surfaceColor,
      surfaceText,
      0.64,
    ),
    "--claim-amount": surfaceText === "#FFFFFF" ? "#F0C775" : "#B7791F",
    "--claim-border": blendHexColors(
      theme.surfaceColor,
      theme.primaryColor,
      0.28,
    ),
  };

  // 提示區塊的淡色背景
  const softStyles: ClaimThemeStyle = {
    "--claim-soft": softColor,
    "--claim-soft-text": getContrastColor(softColor),
  };

  const themeStyle: ClaimThemeStyle = {
    ...primaryStyles,
    ...pageStyles,
    ...surfaceStyles,
    ...softStyles,
    ...flatAppearance,
  };

  const heroStyle: CSSProperties = {
    backgroundColor: theme.primaryColor,
    backgroundImage: form.bannerImageUrl
      ? `linear-gradient(rgba(5, 16, 32, 0.28), rgba(5, 16, 32, 0.28)), url(${JSON.stringify(form.bannerImageUrl)})`
      : undefined,
    backgroundPosition: `${form.bannerPosition.x}% ${form.bannerPosition.y}%`,
    backgroundSize: "cover",
    color: theme.headerTextColor,
  };

  return { themeStyle, heroStyle, surfaceText };
}
