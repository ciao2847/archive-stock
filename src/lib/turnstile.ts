import "server-only";

import { z } from "zod";

import { CLAIM_TURNSTILE_ACTION } from "@/lib/turnstile-config";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TURNSTILE_VERIFY_TIMEOUT_MS = 8_000;

const turnstileResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  metadata: z
    .object({ result_with_testing_key: z.boolean().optional() })
    .passthrough()
    .optional(),
});

export type TurnstileVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "misconfigured" | "unavailable" | "rejected";
      errorCodes?: string[];
    };

function isDevelopment() {
  return process.env.NODE_ENV !== "production";
}

export function getTurnstileSiteKey() {
  const configuredKey = process.env.TURNSTILE_SITE_KEY?.trim();
  if (configuredKey) return configuredKey;
  return isDevelopment() ? TURNSTILE_TEST_SITE_KEY : null;
}

function getTurnstileSecretKey() {
  const configuredKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (configuredKey) return configuredKey;
  return isDevelopment() ? TURNSTILE_TEST_SECRET_KEY : null;
}

export function getRequestIp(headers: Headers) {
  const cloudflareIp = headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp.slice(0, 64);

  const forwardedIp = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedIp ? forwardedIp.slice(0, 64) : undefined;
}

export async function verifyClaimTurnstile(input: {
  token: string;
  expectedHostname: string;
  remoteIp?: string;
  requestId: string;
}): Promise<TurnstileVerificationResult> {
  const secret = getTurnstileSecretKey();
  if (!secret) return { ok: false, reason: "misconfigured" };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TURNSTILE_VERIFY_TIMEOUT_MS,
  );

  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: input.token,
        ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
        idempotency_key: input.requestId,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const parsed = turnstileResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) return { ok: false, reason: "unavailable" };

    const result = parsed.data;
    const errorCodes = result["error-codes"] ?? [];
    if (
      errorCodes.includes("missing-input-secret") ||
      errorCodes.includes("invalid-input-secret")
    ) {
      return { ok: false, reason: "misconfigured", errorCodes };
    }
    if (errorCodes.includes("internal-error")) {
      return { ok: false, reason: "unavailable", errorCodes };
    }
    if (!response.ok) {
      return { ok: false, reason: "unavailable", errorCodes };
    }

    const usesTestingKey = result.metadata?.result_with_testing_key === true;
    if (usesTestingKey && !isDevelopment()) {
      return { ok: false, reason: "misconfigured" };
    }

    const canRelaxTestMetadata = usesTestingKey && isDevelopment();
    const hasExpectedContext =
      canRelaxTestMetadata ||
      (result.action === CLAIM_TURNSTILE_ACTION &&
        result.hostname === input.expectedHostname);

    if (!result.success || !hasExpectedContext) {
      return {
        ok: false,
        reason: "rejected",
        errorCodes,
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
