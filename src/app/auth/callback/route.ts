import { NextResponse, type NextRequest } from "next/server";

/** Старі посилання з листів (підтвердження, відновлення) ведуть на сторінку входу. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
}
