import { Spinner } from "@/components/ui/Spinner";
import styles from "../../../styles/components/ui/LoadingState.module.scss";

export function LoadingState({
  text = "正在讀取資料…",
  className = "",
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div
      className={`${styles.loading} ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.content}>
        <span aria-hidden="true">
          <Spinner size={19} />
        </span>
        <span>{text}</span>
      </span>
    </div>
  );
}
