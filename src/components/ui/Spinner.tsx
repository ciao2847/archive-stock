import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 18, className }: SpinnerProps) {
  return (
    <LoaderCircle
      aria-hidden="true"
      size={size}
      className={cn("animate-spin motion-reduce:animate-none", className)}
    />
  );
}

export default Spinner;
