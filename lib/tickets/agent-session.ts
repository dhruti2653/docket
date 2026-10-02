import type { NextRequest } from "next/server";
import { ADMIN_ROLE, AGENT_ROLE } from "@/config/platform";
import { auth } from "@/lib/auth";

/** Agent/admin session for `/api/tickets/*` routes. Those paths aren't behind
 * proxy.ts (customers hit them too, token-gated), so the x-user-* headers that
 * requireAgentFromRequest() reads are never set — check the session directly. */
export async function getTicketAgent(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = session?.user.role;
  if (!(session?.user && (role === AGENT_ROLE || role === ADMIN_ROLE))) {
    return null;
  }
  return {
    id: session.user.id,
    name: session.user.name || session.user.email,
    email: session.user.email,
    role: role as string,
  };
}
