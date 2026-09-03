import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "product-images";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_TTL_MS = 55 * 60 * 1000;
const CACHE_PREFIX = "archive-stock:signed-image:";

type CachedUrl = { url: string; expiresAt: number };

const memoryCache = new Map<string, CachedUrl>();

function readCachedUrl(path: string): string | undefined {
  const now = Date.now();
  const memory = memoryCache.get(path);
  if (memory && memory.expiresAt > now) return memory.url;
  memoryCache.delete(path);

  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${path}`);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedUrl;
    if (cached.expiresAt <= now) {
      window.localStorage.removeItem(`${CACHE_PREFIX}${path}`);
      return undefined;
    }
    memoryCache.set(path, cached);
    return cached.url;
  } catch {
    return undefined;
  }
}

function cacheUrl(path: string, url: string) {
  const cached = { url, expiresAt: Date.now() + CACHE_TTL_MS };
  memoryCache.set(path, cached);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${CACHE_PREFIX}${path}`,
      JSON.stringify(cached),
    );
  } catch {
    // Storage can be unavailable in private mode; the in-memory cache still works.
  }
}

export async function getSignedImageUrls(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
) {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  const urls = new Map<string, string>();
  const missing: string[] = [];

  for (const path of uniquePaths) {
    const cached = readCachedUrl(path);
    if (cached) urls.set(path, cached);
    else missing.push(path);
  }

  if (missing.length) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
    if (error) throw error;
    data.forEach((result, index) => {
      if (!result.signedUrl) return;
      const path = missing[index];
      urls.set(path, result.signedUrl);
      cacheUrl(path, result.signedUrl);
    });
  }

  return urls;
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("圖片壓縮失敗"))),
      "image/webp",
      quality,
    );
  });
}

async function resizeToWebp(file: File, maxSize: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("無法處理圖片");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvasToWebp(canvas, quality);
}

export async function createProductImageVariants(file: File) {
  const [main, thumbnail] = await Promise.all([
    resizeToWebp(file, 2000, 0.86),
    resizeToWebp(file, 480, 0.78),
  ]);
  return { main, thumbnail };
}

export const PRODUCT_IMAGE_BUCKET = BUCKET;
