import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
export function runMediaCommand(
  binary,
  args,
  { timeout = 180000, maxOutput = 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("影片處理逾時"));
    }, timeout);
    child.stderr.on("data", (data) => {
      output = (output + data.toString()).slice(-maxOutput);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("影片無法轉檔，請確認原檔可播放"));
      else resolve(output);
    });
  });
}
export async function transcodeVideo(
  input,
  video,
  poster,
  {
    ffmpeg = process.env.FFMPEG_BIN || "ffmpeg",
    ffprobe = process.env.FFPROBE_BIN || "ffprobe",
  } = {},
) {
  const info = await new Promise((resolve, reject) => {
    const p = spawn(
      ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration:stream=codec_type,width,height",
        "-of",
        "json",
        input,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let text = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("影片檢查逾時"));
    }, 30000);
    p.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.length > 65536) {
        p.kill();
        reject(new Error("無效影片資訊"));
      }
    });
    p.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error();
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("影片格式無法讀取"));
      }
    });
  });
  const duration = Number(info.format?.duration),
    stream = info.streams?.find((s) => s.codec_type === "video");
  if (
    !stream ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 120 ||
    stream.width * stream.height > 40000000
  )
    throw new Error("影片須為 120 秒內的有效影片");
  await runMediaCommand(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    "-t",
    "120",
    video,
  ]);
  await runMediaCommand(
    ffmpeg,
    [
      "-y",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease",
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      poster,
    ],
    { timeout: 30000 },
  );
  const bytes = (await stat(video)).size;
  if (bytes > 50 * 1024 * 1024)
    throw new Error("播放檔案過大，請使用較短的影片");
  return { duration, bytes };
}
