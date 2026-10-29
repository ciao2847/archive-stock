import { useEffect, useState } from "react";
import {
  clearClaimReceipt,
  readClaimReceipt,
  saveClaimReceipt,
  type ClaimReceipt,
} from "@/lib/claim-receipt";

export function useClaimReceipt(token: string) {
  const [state, setState] = useState<{
    token: string;
    receipt: ClaimReceipt | null;
    saved: boolean;
  } | null>(null);

  useEffect(() => {
    setState({ token, receipt: readClaimReceipt(token), saved: true });
  }, [token]);

  function remember(receipt: ClaimReceipt) {
    const saved = saveClaimReceipt(receipt);
    setState({ token, receipt, saved });
  }

  function clear() {
    clearClaimReceipt(token);
    setState({ token, receipt: null, saved: true });
  }

  return {
    ready: state?.token === token,
    receipt: state?.token === token ? state.receipt : null,
    saved: state?.saved ?? true,
    remember,
    clear,
  };
}
