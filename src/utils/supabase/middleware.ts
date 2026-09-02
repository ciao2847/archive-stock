import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function redirectWithSessionCookies(
  request: NextRequest,
  supabaseResponse: NextResponse,
  pathname: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirectResponse = NextResponse.redirect(url);
  supabaseResponse.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));

  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = supabaseResponse.headers.get(header);
    if (value) redirectResponse.headers.set(header, value);
  }

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value),
          );
        },
      },
    },
  );

  // This validates and refreshes an existing login session when necessary.
  const { data } = await supabase.auth.getClaims();

  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/qr/");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (!data?.claims && isApiRoute) {
    const unauthorizedResponse = NextResponse.json(
      { success: false, error: "請先登入" },
      { status: 401 },
    );
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => unauthorizedResponse.cookies.set(cookie));
    unauthorizedResponse.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0",
    );
    return unauthorizedResponse;
  }

  if (!data?.claims && !isPublicRoute) {
    return redirectWithSessionCookies(request, supabaseResponse, "/login");
  }

  if (data?.claims && request.nextUrl.pathname === "/login") {
    return redirectWithSessionCookies(request, supabaseResponse, "/");
  }
  return supabaseResponse;
}
