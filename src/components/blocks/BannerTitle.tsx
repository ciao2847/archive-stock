import { cn } from "@/lib/cn";

export interface BannerTitleProps {
  title: string;
  sub?: string;
  img?: string;
  className?: string;
}

export function BannerTitle({ title, sub, className }: BannerTitleProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-paper p-6 mb-6",
        className,
      )}
    >
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export default BannerTitle;
