// FFMPEG_BIN=/path/to/ffmpeg FFPROBE_BIN=/path/to/ffprobe node tests/media-transcode.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runMediaCommand,
  transcodeVideo,
} from "../scripts/media-worker/transcode.mjs";
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg",
  ffprobe = process.env.FFPROBE_BIN || "ffprobe";
const dir = await mkdtemp(join(tmpdir(), "archive-media-test-"));
try {
  const input = join(dir, "source.mov"),
    video = join(dir, "video.mp4"),
    poster = join(dir, "poster.webp");
  await runMediaCommand(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=10",
    "-t",
    "1",
    "-c:v",
    "mpeg4",
    input,
  ]);
  const result = await transcodeVideo(input, video, poster, {
    ffmpeg,
    ffprobe,
  });
  assert.ok(result.duration > 0 && result.duration < 2);
  assert.ok(result.bytes > 100);
  assert.ok((await stat(poster)).size > 100);
  const bytes = await readFile(video);
  assert.ok(
    bytes.indexOf(Buffer.from("moov")) < bytes.indexOf(Buffer.from("mdat")),
    "MP4 fast-start metadata must precede video data",
  );
  await writeFile(join(dir, "bad.mov"), "not a video");
  await assert.rejects(
    transcodeVideo(join(dir, "bad.mov"), video, poster, { ffmpeg, ffprobe }),
    /格式無法讀取/,
  );
  console.log(
    "實際影片轉檔通過：MOV → H.264 MP4、WebP 封面、fast-start 與損壞影片拒絕。",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
