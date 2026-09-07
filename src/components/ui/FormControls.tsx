import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/** 共用表單標籤。 */
export function FormLabel({
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={cn("my-4 block text-[12px] font-semibold", className)}
    />
  );
}

/** 共用文字輸入欄位。 */
export function FormInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "mt-2 block w-full rounded-lg border border-line bg-white p-3 text-[14px] outline-none max-lg:text-[16px]",
        className,
      )}
    />
  );
}

/** 共用主要表單按鈕。 */
export function FormPrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={cn("primary mt-3 w-full p-3", className)} />
  );
}
