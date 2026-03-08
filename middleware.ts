import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await sb.auth.getUser();
  const isLoggedIn = Boolean(data.user?.email);

  const path = req.nextUrl.pathname;
  const isLogin = path.startsWith("/login") || path.startsWith("/auth");
  const isPublic =
    isLogin ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path.startsWith("/api/health");

  if (!isPublic && !isLoggedIn) {
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    u.searchParams.set("next", path);
    return NextResponse.redirect(u);
  }

  if (isLogin && isLoggedIn) {
    const u = req.nextUrl.clone();
    u.pathname = "/";
    u.search = "";
    return NextResponse.redirect(u);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
