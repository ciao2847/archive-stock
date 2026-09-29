export type ClaimFormTheme = {
  primaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  headerTextColor: string;
};

export type ClaimFormBannerPosition = {
  x: number;
  y: number;
};

export const DEFAULT_CLAIM_FORM_THEME: ClaimFormTheme = {
  primaryColor: "#5A87B1",
  backgroundColor: "#F3F7FB",
  surfaceColor: "#FFFFFF",
  headerTextColor: "#172433",
};

export const POSTER_OWNER_CLAIM_FORM_THEME: ClaimFormTheme = {
  primaryColor: "#425F8F",
  backgroundColor: "#E8EDF6",
  surfaceColor: "#FFF9EE",
  headerTextColor: "#FFF9EE",
};

export const DEFAULT_CLAIM_FORM_BANNER_POSITION: ClaimFormBannerPosition = {
  x: 50,
  y: 50,
};

export const CLAIM_FORM_THEME_PRESETS = [
  {
    id: "classic-blue",
    name: "清爽淺藍",
    description: "目前的清爽藍白色系",
    theme: DEFAULT_CLAIM_FORM_THEME,
  },
  {
    id: "poster-owner-navy",
    name: "小天地柔霧藍",
    description: "明亮霧藍、海軍藍與暖米白",
    theme: POSTER_OWNER_CLAIM_FORM_THEME,
  },
] as const;

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function getDefaultClaimFormTheme(inventoryName: string) {
  const theme =
    inventoryName.trim() === "海報小天地"
      ? POSTER_OWNER_CLAIM_FORM_THEME
      : DEFAULT_CLAIM_FORM_THEME;
  return { ...theme };
}

export function normalizeHexColor(value: string, fallback: string) {
  return HEX_COLOR_PATTERN.test(value) ? value.toUpperCase() : fallback;
}

export function normalizeClaimFormBannerPosition(value: number, fallback = 50) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex, "#000000").slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function channelToHex(channel: number) {
  return Math.round(channel).toString(16).padStart(2, "0");
}

export function blendHexColors(from: string, to: string, amount: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const ratio = Math.max(0, Math.min(1, amount));
  return `#${channelToHex(start.red + (end.red - start.red) * ratio)}${channelToHex(start.green + (end.green - start.green) * ratio)}${channelToHex(start.blue + (end.blue - start.blue) * ratio)}`.toUpperCase();
}

export function getContrastColor(background: string) {
  const { red, green, blue } = hexToRgb(background);
  const luminance =
    (0.2126 * red) / 255 + (0.7152 * green) / 255 + (0.0722 * blue) / 255;
  return luminance > 0.58 ? "#172433" : "#FFFFFF";
}
