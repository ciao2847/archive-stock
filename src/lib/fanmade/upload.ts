import { createClient } from "@/utils/supabase/client";
import { validateFanmadeVideo } from "./validation";
/** Resumable direct-to-Storage upload; video bytes bypass the Next.js function. */
export async function uploadFanmadeVideo(
  ownerId: string,
  file: File,
  onProgress: (percent: number) => void,
) {
  const invalid = validateFanmadeVideo(file);
  if (invalid) throw new Error(invalid);
  const { Upload } = await import("tus-js-client");
  const supabase = createClient();
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("請重新登入後上傳影片");
  const extension =
    file.type === "video/quicktime"
      ? "mov"
      : file.type === "video/webm"
        ? "webm"
        : "mp4";
  const path = `${ownerId}/${crypto.randomUUID()}/source.${extension}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const endpoint =
    base.replace(/\.supabase\.co\/?$/, ".storage.supabase.co") +
    "/storage/v1/upload/resumable";
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      },
      metadata: {
        bucketName: "fanmade-video-originals",
        objectName: path,
        contentType: file.type,
        cacheControl: "3600",
      },
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
  return path;
}
