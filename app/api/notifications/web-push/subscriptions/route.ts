import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/authz";
import { getPushProvider } from "@/lib/integration-settings";
import {
  deleteWebPushSubscription,
  saveWebPushSubscription,
} from "@/lib/web-push";

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { auth?: unknown; p256dh?: unknown };
}

// Endpoints from the browser's PushSubscription are push-service URLs; cap the
// length so a bogus client can't store arbitrarily large rows.
const MAX_FIELD_LENGTH = 2048;

function isValidField(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FIELD_LENGTH
  );
}

// POST /api/notifications/web-push/subscriptions — registers the signed-in
// agent's browser for Web Push (body: PushSubscription.toJSON()). Only accepted
// while Web Push is the selected provider.
export async function POST(request: NextRequest) {
  const me = getSessionUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if ((await getPushProvider()) !== "webpush") {
    return NextResponse.json(
      { error: "Web Push is not enabled." },
      { status: 409 }
    );
  }

  let body: SubscriptionBody;
  try {
    body = (await request.json()) as SubscriptionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { endpoint } = body;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (
    !(isValidField(endpoint) && isValidField(p256dh) && isValidField(auth)) ||
    !endpoint.startsWith("https://")
  ) {
    return NextResponse.json(
      { error: "Invalid push subscription." },
      { status: 400 }
    );
  }

  await saveWebPushSubscription({
    userId: me.id,
    endpoint,
    p256dh,
    auth,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE /api/notifications/web-push/subscriptions — body { endpoint }. Removes
// one of the signed-in agent's own subscriptions (never another user's).
export async function DELETE(request: NextRequest) {
  const me = getSessionUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { endpoint?: unknown };
  try {
    body = (await request.json()) as { endpoint?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isValidField(body.endpoint)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  await deleteWebPushSubscription(me.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
