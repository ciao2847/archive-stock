import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const configPath =
    process.env.MEDIA_WORKER_ENV_FILE || resolve(".env.media-worker");
  if (existsSync(configPath)) process.loadEnvFile(configPath);
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
  const secret = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  if (!url || !secret)
    throw new Error(
      "尚未啟動影片處理：請在 .env.media-worker 填入 SUPABASE_URL 與 SUPABASE_SECRET_KEY，再執行 npm run media:worker。請勿將金鑰貼到聊天或前端。",
    );
  const parsedUrl = new URL(url);
  if (!["https:", "http:"].includes(parsedUrl.protocol))
    throw new Error("SUPABASE_URL 格式不正確。");
  let serviceKey = secret.startsWith("sb_secret_");
  if (!serviceKey) {
    try {
      serviceKey =
        JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString())
          .role === "service_role";
    } catch {
      /* Not a legacy service-role JWT. */
    }
  }
  if (!serviceKey)
    throw new Error(
      "影片處理需要 Supabase Secret key，不能使用 Publishable／anon 公開金鑰。請檢查 .env.media-worker 的 SUPABASE_SECRET_KEY。",
    );
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  for (const [variable, fallback, cached] of [
    [
      "FFMPEG_BIN",
      "ffmpeg",
      ".local/media-tools/node_modules/ffmpeg-static/ffmpeg",
    ],
    [
      "FFPROBE_BIN",
      "ffprobe",
      ".local/media-tools/node_modules/@ffprobe-installer/darwin-arm64/ffprobe",
    ],
  ]) {
    const binary =
      process.env[variable] ||
      (existsSync(cached) ? resolve(cached) : fallback);
    const check = spawnSync(binary, ["-version"], {
      stdio: "ignore",
      timeout: 10000,
    });
    if (check.error || check.status !== 0)
      throw new Error(
        `無法執行 ${fallback}，請安裝轉檔工具或設定 ${variable}。尚未取出任何影片任務。`,
      );
    process.env[variable] = binary;
  }
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (request, init) =>
        fetch(request, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
  const { error } = await db
    .from("fanmade_details")
    .select("product_id")
    .limit(1);
  if (error)
    throw new Error(
      `Supabase 連線未通過（${error.code || "連線錯誤"}）。請確認 Secret key 屬於此專案，且飯製 migration 已套用。`,
    );
  if (process.argv.includes("--check")) {
    console.log(
      "影片服務設定、Supabase 連線及 FFmpeg／ffprobe 檢查通過；尚未取出任務。執行 npm run media:worker 開始處理。",
    );
    return;
  }
  console.log(
    "影片處理服務已啟動，將處理已上傳的商品實拍。請保持本程序執行；完成後，已上架商品會顯示觀看按鈕。",
  );
  await import("./worker.mjs");
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "影片服務啟動失敗，請檢查設定。",
  );
  process.exitCode = 1;
}
