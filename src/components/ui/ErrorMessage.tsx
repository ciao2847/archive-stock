import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ErrorMessageProps = Omit<HTMLAttributes<HTMLElement>, "role"> & {
  as?: "p" | "div" | "ul";
  variant?: "inline" | "panel";
};

export function ErrorMessage({
  as: Tag = "p",
  variant = "inline",
  className,
  children,
  ...props
}: ErrorMessageProps) {
  return (
    <Tag
      {...props}
      role="alert"
      className={cn(
        variant === "panel" ? "data-error" : "text-danger",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
