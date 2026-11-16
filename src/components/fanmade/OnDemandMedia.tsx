"use client";
/* eslint-disable @next/next/no-img-element -- Storage thumbnails are pre-compressed; full media is requested only after a click. */
import { useEffect, useRef, useState } from "react";
import { CloseButton } from "@/components/ui/CloseButton";
import { getFanmadeMedia } from "@/lib/fanmade/api";
import { useBackAction } from "@/components/navigation/BackNavigation";
/** Mounted only after an explicit click. No video element or source exists in a product card. */
export function OnDemandMedia({
  token,
  productId,
  name,
  kind,
  onClose,
}: {
  token: string;
  productId: string;
  name: string;
  kind: "image" | "video";
  onClose: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useBackAction({ priority: 210, hideButton: true, onBack: onClose });
  useEffect(() => {
    const controller = new AbortController();
    void getFanmadeMedia(token, productId, kind, controller.signal)
      .then((data) => setUrl(data.url))
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "媒體讀取失敗");
      });
    return () => controller.abort();
  }, [token, productId, kind]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const player = video.current;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
      if (player) {
        player.pause();
        player.removeAttribute("src");
        player.load();
      }
    };
  }, [url, onClose]);
  return (
    <div
      className="fixed inset-0 z-[220] grid place-items-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${name}${kind === "video" ? "實拍影片" : "大圖"}`}
      onClick={onClose}
    >
      <CloseButton
        className="absolute right-4 top-4 rounded-full bg-white p-2"
        aria-label="關閉媒體"
        onClick={onClose}
      />
      <div
        className="max-h-[85dvh] max-w-full text-white"
        onClick={(event) => event.stopPropagation()}
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : !url ? (
          <p role="status">正在讀取{kind === "video" ? "影片" : "圖片"}…</p>
        ) : kind === "video" ? (
          <video
            ref={video}
            src={url}
            controls
            playsInline
            preload="none"
            className="max-h-[80dvh] max-w-full"
            aria-label={`${name}商品實拍影片`}
          />
        ) : (
          <img
            src={url}
            alt={`${name}商品大圖`}
            className="max-h-[80dvh] max-w-full object-contain"
          />
        )}
        <p className="mt-2 text-center text-sm">{name}</p>
      </div>
    </div>
  );
}
