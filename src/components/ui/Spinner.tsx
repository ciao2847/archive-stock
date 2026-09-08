import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 18, className }: SpinnerProps) {
  return (
    <LoaderCircle
      size={size}
      className={cn("animate-spin text-muted", className)}
    />
  );
}

export default Spinner;
