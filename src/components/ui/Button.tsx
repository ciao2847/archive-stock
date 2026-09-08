import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          variant,
          size === "sm" && "py-1 px-2.5 text-xs",
          size === "lg" && "py-3 px-5 text-base",
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
export default Button;
