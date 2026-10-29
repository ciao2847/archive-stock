import type { ReactNode } from "react";
import type { PublicClaimForm } from "@/lib/claims";
import { createClaimFormStyles } from "../../../../styles/components/claims/PublicClaimFormView.styles";

export function ClaimFormTheme({
  form,
  completed = false,
  children,
}: {
  form: PublicClaimForm;
  completed?: boolean;
  children: ReactNode;
}) {
  const { themeStyle } = createClaimFormStyles(form);
  return (
    <main
      className={
        completed
          ? "min-h-screen bg-[var(--claim-background)] px-4 py-5 text-[var(--claim-page-text)] md:py-10"
          : "min-h-screen bg-[var(--claim-background)] pb-12 text-[var(--claim-page-text)]"
      }
      style={themeStyle}
    >
      {children}
    </main>
  );
}
