"use client";

import styles from "../../../styles/components/ui/Pagination.module.scss";

export function Pagination({
  page,
  pageSize,
  total,
  disabled = false,
  showTopBorder = true,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  disabled?: boolean;
  showTopBorder?: boolean;
  onPageChange: (page: number) => void | Promise<void>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      className={`${styles.pager}${showTopBorder ? "" : ` ${styles.withoutTopBorder}`}`}
      aria-label="清單分頁"
    >
      <span>
        共 {total} 筆 · 第 {page} / {totalPages} 頁
      </span>
      <div className={styles.actions}>
        <button
          type="button"
          className="outline"
          disabled={disabled || page <= 1}
          onClick={() => void onPageChange(page - 1)}
        >
          上一頁
        </button>
        <button
          type="button"
          className="outline"
          disabled={disabled || page >= totalPages}
          onClick={() => void onPageChange(page + 1)}
        >
          下一頁
        </button>
      </div>
    </nav>
  );
}
