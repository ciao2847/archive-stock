"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";

type CloseButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  size?: number;
};

export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(
  (
    {
      size = 20,
      className = "icon-btn",
      "aria-label": label = "關閉",
      title = label,
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type="button"
      className={className}
      aria-label={label}
      title={title}
    >
      <X size={size} aria-hidden="true" />
    </button>
  ),
);

CloseButton.displayName = "CloseButton";
