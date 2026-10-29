import type { ReactNode } from "react";
import { LoadingState } from "./LoadingState";

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
    return <LoadingState text={loadingText} className={className} />;
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
