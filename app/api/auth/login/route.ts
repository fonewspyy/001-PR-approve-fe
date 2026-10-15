import { NextResponse } from "next/server";
import { beginLogin } from "@/lib/auth/msauth";

// Only allow same-app relative return paths to avoid an open redirect.
function safeReturnTo(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  try {
    const authorizeUrl = await beginLogin(request, returnTo);
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to start sign-in." },
      { status: 500 }
    );
  }
}
