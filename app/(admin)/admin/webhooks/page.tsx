import { requireAdmin } from "@/lib/authz";
import { listWebhookEndpoints } from "@/lib/webhooks/service";
import { WebhooksManager } from "./_components/webhooks-manager";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  await requireAdmin();
  const webhooks = await listWebhookEndpoints();

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <WebhooksManager
        initialWebhooks={webhooks.map((w) => ({
          id: w.id,
          name: w.name,
          url: w.url,
          events: w.events,
          isActive: w.isActive,
          createdByName: w.createdByName,
          lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
          lastDeliveryStatus: w.lastDeliveryStatus,
          createdAt: w.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
