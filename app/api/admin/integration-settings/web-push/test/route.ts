import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PRODUCT_NAME } from "@/config/platform";
import { requireAdminFromRequest } from "@/lib/authz";
import { getWebPushSettings, vapidSubject } from "@/lib/integration-settings";
import { sendWebPushToUsers, testWebPushKeys } from "@/lib/web-push";

interface TestBody {
  privateKey?: unknown;
  publicKey?: unknown;
}

// POST — admin only. Validates the VAPID fields currently in the form (a blank
// private key falls back to the saved one), then — if the keys match
// what this admin's browsers subscribed with — sends them a real test push.
// Ad hoc only — never persists a result; see the smtp/test route for why.
export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = requireAdminFromRequest(request);
  } catch (e) {
    return e as Response;
  }

  let body: TestBody;
  try {
    body = (await request.json()) as TestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const saved = await getWebPushSettings();
  const publicKey =
    typeof body.publicKey === "string" ? body.publicKey.trim() : "";
  const privateKey =
    (typeof body.privateKey === "string" ? body.privateKey.trim() : "") ||
    (saved?.publicKey === publicKey ? saved.privateKey : "");

  if (!(publicKey && privateKey)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Fill in (or generate) the public and private keys first.",
      },
      { status: 400 }
    );
  }

  const settings = { publicKey, privateKey, subject: vapidSubject() };
  const result = testWebPushKeys(settings);
  if (!result.ok) {
    return NextResponse.json(result);
  }

  // Subscriptions are bound to the key they were created with, so only the
  // saved, active pair can reach this admin's devices.
  if (saved?.publicKey !== publicKey) {
    return NextResponse.json({
      ok: true,
      message:
        "VAPID keys are valid. Save, then reload the page and allow notifications to receive a test push.",
    });
  }

  const sent = await sendWebPushToUsers(
    [admin.id],
    {
      title: `${PRODUCT_NAME} test notification`,
      body: "Web Push is working. You'll get alerts like this for new tickets and customer replies.",
      tag: "docket-test",
    },
    settings
  );

  return NextResponse.json({
    ok: true,
    message:
      sent.attempted === 0
        ? "VAPID keys are valid. No browser is subscribed for your account yet — reload the page and allow notifications."
        : `VAPID keys are valid. Test notification sent to ${sent.delivered} of ${sent.attempted} of your browser(s).`,
  });
}
