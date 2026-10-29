import { Clock } from "lucide-react";
import { formatTaipeiDateTime, type PublicClaimForm } from "@/lib/claims";
import { createClaimFormStyles } from "../../../../styles/components/claims/PublicClaimFormView.styles";

export function ClaimFormHeader({ form }: { form: PublicClaimForm }) {
  const { heroStyle, surfaceText } = createClaimFormStyles(form);
  return (
    <section
      className="relative w-full overflow-hidden bg-cover shadow-[0_10px_30px_rgba(5,16,32,0.12)]"
      style={heroStyle}
    >
      {!form.bannerImageUrl && (
        <>
          <div
            className="absolute -right-10 -top-16 size-40 rounded-full opacity-25 md:size-48"
            style={{ backgroundColor: form.theme.surfaceColor }}
          />
          <div
            className="absolute -bottom-24 right-20 size-40 rounded-full opacity-15 md:size-44"
            style={{ backgroundColor: form.theme.surfaceColor }}
          />
        </>
      )}
      <div className="relative z-10 mx-auto flex min-h-[170px] max-w-[1040px] flex-col justify-between gap-6 px-4 py-5 md:min-h-[200px] md:px-8 md:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold md:text-[12px]"
            style={{
              backgroundColor: form.theme.surfaceColor,
              color: surfaceText,
            }}
          >
            {form.storeName}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold md:text-[12px] ${form.isOpen ? "bg-[#dff3e7] text-[#17653b]" : "bg-[#d8e2ea] text-[#5e7182]"}`}
          >
            {form.isOpen ? "訂購開放中" : "訂購已截止"}
          </span>
          <span className="rounded-full bg-[#fff4d8] px-3 py-1 text-[11px] font-semibold text-[#7a5a13] md:text-[12px]">
            預購／現貨訂購
          </span>
        </div>
        <div className="max-w-[720px]">
          <h1
            className="m-0 max-w-[680px] text-[24px] font-bold leading-tight md:text-[32px]"
            style={{ color: form.theme.headerTextColor }}
          >
            {form.title}
          </h1>
          {form.description && (
            <p
              className="mb-0 mt-2 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 opacity-80 md:mt-3 md:max-w-[620px] md:text-[14px] md:leading-6"
              style={{ color: form.theme.headerTextColor }}
            >
              {form.description}
            </p>
          )}
          {form.closesAt && (
            <p
              className="mb-0 mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold md:mt-3 md:text-[12px]"
              style={{ color: "#D6A84B" }}
              suppressHydrationWarning
            >
              <Clock
                size={14}
                className="shrink-0 opacity-90"
                aria-hidden="true"
              />
              <span>截止時間：{formatTaipeiDateTime(form.closesAt)}</span>
            </p>
          )}
        </div>
        <ol
          aria-label="訂購流程"
          className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
        >
          {["選擇商品", "核對與填資料", "完成訂購"].map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="opacity-50">
                  →
                </span>
              )}
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] font-semibold">
                <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[10px]">
                  {index + 1}
                </span>
                {label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
