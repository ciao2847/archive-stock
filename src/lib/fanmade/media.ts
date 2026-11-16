/** Only approved storage paths become public URLs; original videos never use this helper. */
export function fanmadeMediaUrl(
  bucket: "product-images" | "fanmade-video-playback",
  path?: string | null,
) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !path) return undefined;
  return `${base}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
