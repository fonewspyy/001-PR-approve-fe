import { NextResponse } from "next/server";
import { completeLogin, storeSession } from "@/lib/auth/msauth";

function safeReturnTo(value: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  try {
    const { tokens, returnTo } = await completeLogin(request);
    await storeSession(request, tokens);

    const target = new URL(safeReturnTo(returnTo), request.url);
    return NextResponse.redirect(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    const target = new URL("/", request.url);
    target.searchParams.set("authError", message);
    return NextResponse.redirect(target);
  }
}
