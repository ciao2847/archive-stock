"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** 圖片燈箱預覽。 */
export function ImageLightbox({ src, alt, label, onClose }: { src: string; alt: string; label?: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = ""; };
  }, [onClose]);

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-8" role="dialog" aria-modal="true" aria-label="商品圖片預覽" onClick={onClose}>
    <button className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-black/50 text-white hover:bg-white/15" onClick={onClose} aria-label="關閉圖片"><X /></button>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="max-h-full max-w-full object-contain" src={src} alt={alt} decoding="async" onClick={event=>event.stopPropagation()} />
    {label&&<div className="absolute bottom-4 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-black/65 px-4 py-2 text-center text-[14px] text-white">{label}</div>}
  </div>;
}
