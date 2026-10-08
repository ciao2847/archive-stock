import "server-only";
import { QR_TOKEN_PATTERN } from "@/constants";
import {
  asUntypedSupabase,
  createBundleClaimSignedUrlMap,
  mapBundleClaimOrder,
} from "@/lib/api/bundle-claims-server";
import {
  BUNDLE_PUBLIC_INVENTORY_SELECT,
  mapBundlePublicSettings,
} from "@/lib/api/bundle-public-settings";
import {
  toPublicBundleMenuOption,
  type PublicBundleMenu,
} from "@/lib/bundle-claims";
import { createServiceClient } from "@/utils/supabase/service";
const MENU_ORDER_SELECT = `id,title,description,total_amount,customer_hint,status,expires_at,
 bundle_claim_order_images(id,storage_path,sort_order,media_type,byte_size,product_name,product_amount)`;
export async function fetchPublicBundleMenu(
  token: string,
): Promise<PublicBundleMenu | null> {
  if (!QR_TOKEN_PATTERN.test(token)) return null;
  const supabase = asUntypedSupabase(createServiceClient());
  // Legacy links were migrated to campaigns; never fall back around a paused campaign.
  const { data: campaign, error: campaignError } = await supabase
    .from("bundle_claim_campaigns")
    .select("id,owner_id,title,description")
    .eq("public_token", token)
    .eq("enabled", true)
    .maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) return null;
  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory_databases")
    .select(`id,${BUNDLE_PUBLIC_INVENTORY_SELECT}`)
    .eq("id", campaign.owner_id)
    .maybeSingle();
  if (inventoryError) throw new Error(inventoryError.message);
  if (!inventory) return null;
  const { data: rows, error } = await supabase
    .from("bundle_claim_orders")
    .select(MENU_ORDER_SELECT)
    .eq("owner_id", campaign.owner_id)
    .eq("campaign_id", campaign.id)
    .in("status", ["open", "confirmed"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  const published = (rows ?? []).filter((row) =>
    toPublicBundleMenuOption(mapBundleClaimOrder(row)),
  );
  const signedUrls = await createBundleClaimSignedUrlMap(supabase, published);
  return {
    ...mapBundlePublicSettings(inventory),
    campaignTitle: campaign.title,
    campaignDescription: campaign.description || undefined,
    options: published.flatMap((row) => {
      const option = toPublicBundleMenuOption(
        mapBundleClaimOrder(row, signedUrls),
      );
      return option ? [option] : [];
    }),
  };
}
