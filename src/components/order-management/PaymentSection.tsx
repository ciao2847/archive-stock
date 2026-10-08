import type { ReactNode } from "react";
export function PaymentSection({
  summary,
  actions,
  children,
}: {
  summary: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="付款操作"
      className="mt-4 rounded-[9px] border border-line p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="m-0 text-[13px] font-bold text-dark">付款操作</h4>
          <div className="mt-1 text-[12px] text-muted">{summary}</div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}
