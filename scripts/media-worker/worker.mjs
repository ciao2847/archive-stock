import { createClient } from "@supabase/supabase-js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcodeVideo } from "./transcode.mjs";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret)
  throw new Error(
    "Worker 需要 SUPABASE_URL 及 SUPABASE_SECRET_KEY（僅限伺服器）",
  );
const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function runOne() {
  const { data: job, error } = await db.rpc("claim_fanmade_video_job");
  if (error) throw new Error(error.message);
  if (!job) return false;
  let dir;
  try {
    const { data, error: downloadError } = await db.storage
      .from("fanmade-video-originals")
      .download(job.sourcePath);
    if (downloadError || !data || data.size > 100 * 1024 * 1024)
      throw new Error("原始影片無法下載或超過 100MB");
    dir = await mkdtemp(join(tmpdir(), "archive-fanmade-"));
    const input = join(dir, "source"),
      video = join(dir, "video.mp4"),
      poster = join(dir, "poster.webp");
    await writeFile(input, Buffer.from(await data.arrayBuffer()));
    const result = await transcodeVideo(input, video, poster);
    const prefix = `${job.ownerId}/${job.productId}/${job.id}/${job.leaseToken}`;
    for (const [path, type] of [
      [video, "video/mp4"],
      [poster, "image/webp"],
    ]) {
      const name = path === video ? "video.mp4" : "poster.webp";
      const { error: uploadError } = await db.storage
        .from("fanmade-video-playback")
        .upload(`${prefix}/${name}`, await readFile(path), {
          contentType: type,
          cacheControl: "31536000",
          upsert: true,
        });
      if (uploadError) throw new Error("播放檔上傳失敗");
    }
    const { data: finished, error: finishError } = await db.rpc(
      "finish_fanmade_video_job",
      {
        p_id: job.id,
        p_lease: job.leaseToken,
        p_duration: result.duration,
        p_bytes: result.bytes,
      },
    );
    if (finishError) throw new Error("無法確認轉檔結果");
    console.log(
      finished ? "影片轉檔完成" : "任務已被取代或租約過期，略過結果",
      job.id,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "影片處理失敗";
    await db.rpc("finish_fanmade_video_job", {
      p_id: job.id,
      p_lease: job.leaseToken,
      p_error: message,
    });
    console.error("影片任務失敗", job.id, message);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  return true;
}
do {
  try {
    const worked = await runOne();
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 5000));
  } catch (cause) {
    console.error(
      "Worker 連線失敗",
      cause instanceof Error ? cause.message : "未知錯誤",
    );
    if (process.argv.includes("--once")) {
      process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
} while (!stopping);
