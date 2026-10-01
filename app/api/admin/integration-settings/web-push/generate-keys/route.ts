import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/authz";
import { generateVapidKeys } from "@/lib/web-push";

// POST — admin only. Returns a fresh VAPID key pair to fill into the form.
// Nothing is persisted here: the admin still has to press Save, so an
// accidental click can't silently invalidate every agent's subscription.
export async function POST(request: NextRequest) {
  try {
    requireAdminFromRequest(request);
  } catch (e) {
    return e as Response;
  }

  return NextResponse.json(generateVapidKeys());
}
