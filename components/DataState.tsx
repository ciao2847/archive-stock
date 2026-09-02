import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function DataState({
  loading,
  isEmpty,
  children,
  loadingText = "正在讀取資料…",
  emptyText = "目前沒有資料",
  emptyContent,
  className = "",
}: {
  loading: boolean;
  isEmpty: boolean;
  children: ReactNode;
  loadingText?: string;
  emptyText?: string;
  emptyContent?: ReactNode;
  className?: string;
}) {
  if (loading) {
    return (
      <div
        className={`empty flex items-center justify-center gap-2 ${className}`}
        role="status"
        aria-live="polite"
      >
        <LoaderCircle className="animate-spin" size={18} />
        {loadingText}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={`empty ${className}`} role="status">
        {emptyContent ?? emptyText}
      </div>
    );
  }

  return children;
}
