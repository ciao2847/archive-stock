"use client";

import { useState } from "react";
import { ImageIcon, ZoomIn } from "lucide-react";

import { ImageLightbox } from "./ImageLightbox";

type Recommendation = {
  sku: string;
  name: string;
  imageUrl?: string;
};

const ICON_STROKE = 1.7;

export function PublicRecommendationGrid({
  recommendations,
}: {
  recommendations: Recommendation[];
}) {
  const [preview, setPreview] = useState<Recommendation | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {recommendations.map((product) => (
          <article
            className="relative block min-w-0 overflow-hidden rounded-[16px] border-[0.5px] border-[#d6d9de] bg-transparent text-main"
            key={product.sku}
          >
            {product.imageUrl ? (
              <button
                type="button"
                className="group relative block aspect-square w-full cursor-zoom-in overflow-hidden border-0 border-b-[0.5px] border-[#d6d9de] bg-transparent p-0"
                aria-label={`放大查看${product.name}商品圖片`}
                onClick={() => setPreview(product)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  src={product.imageUrl}
                  alt={`${product.name} 商品圖片`}
                  loading="lazy"
                  decoding="async"
                />
                <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm">
                  <ZoomIn
                    size={17}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                </span>
              </button>
            ) : (
              <div className="aspect-square overflow-hidden border-b-[0.5px] border-[#d6d9de]">
                <span className="grid h-full w-full place-items-center text-muted">
                  <ImageIcon
                    size={31}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                </span>
              </div>
            )}
            <h3 className="m-0 line-clamp-2 min-h-[58px] px-4 py-3 text-[12px] leading-5 md:min-h-[66px] md:px-4 md:text-[16px] md:leading-6">
              {product.name}
            </h3>
          </article>
        ))}
      </div>

      {preview?.imageUrl && (
        <ImageLightbox
          src={preview.imageUrl}
          alt={`${preview.name} 商品圖片`}
          label={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
