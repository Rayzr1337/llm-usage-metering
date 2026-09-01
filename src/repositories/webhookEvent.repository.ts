import { prisma } from "../lib/prisma";
import type { WebhookEvent, Prisma } from "../generated/prisma/client";

type Client = typeof prisma | Prisma.TransactionClient;

export class WebhookEventRepository {
    async createWebhookEvent(stripeEventId: string, type: string, client: Client = prisma): Promise<WebhookEvent> {
        return client.webhookEvent.create({ data: { stripeEventId, type } });
    }

    async findByStripeEventId(stripeEventId: string, client: Client = prisma): Promise<WebhookEvent | null> {
        return client.webhookEvent.findUnique({ where: { stripeEventId } });
    }
}

export const webhookEventRepository = new WebhookEventRepository();