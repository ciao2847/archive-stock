import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getClaimFormAssetPublicUrl } from "@/lib/claim-form-assets";
import {
  normalizeHexColor,
  DEFAULT_CLAIM_FORM_THEME,
} from "@/lib/claim-form-theme";
import type { FanmadeHeader } from "./types";
export async function fetchFanmadeHeader(
  token: string,
): Promise<FanmadeHeader | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await ((await createClient()) as SupabaseClient).rpc(
    "get_fanmade_header",
    { p_token: token },
  );
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...data,
    description: data.description ?? undefined,
    completionMessage:
      data.completionMessage || "訂購成功，請聯繫官方 LINE 完成付款。",
    bannerImageUrl: getClaimFormAssetPublicUrl(data.bannerImagePath),
    theme: {
      primaryColor: normalizeHexColor(
        data.theme.primaryColor,
        DEFAULT_CLAIM_FORM_THEME.primaryColor,
      ),
      backgroundColor: normalizeHexColor(
        data.theme.backgroundColor,
        DEFAULT_CLAIM_FORM_THEME.backgroundColor,
      ),
      surfaceColor: normalizeHexColor(
        data.theme.surfaceColor,
        DEFAULT_CLAIM_FORM_THEME.surfaceColor,
      ),
      headerTextColor: normalizeHexColor(
        data.theme.headerTextColor,
        DEFAULT_CLAIM_FORM_THEME.headerTextColor,
      ),
    },
  };
}
