import { stripe } from "../lib/stripe";
import { tenantRepository } from "../repositories/tenant.repository";
import { webhookEventRepository } from "../repositories/webhookEvent.repository";
import { Tenant } from "../generated/prisma/client";
import { Stripe } from "stripe";
import { prisma } from "../lib/prisma";

interface CreateCheckoutSessionInput {
  tenant: Tenant;
  idempotencyKey: string
}

interface CreateCheckoutSessionResult {
  url: string;
}

export class StripeService {
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    const { tenant, idempotencyKey } = input;

    let stripeCustomerId = tenant.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          name: tenant.name,
          metadata: { tenantId: tenant.id },
        },
        { idempotencyKey: `customer-create:${tenant.id}` },
      );

      stripeCustomerId = customer.id;

      await tenantRepository.updateTenant(tenant.id, { stripeCustomerId });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID as string, quantity: 1 }],
        success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/billing/cancel`,
        client_reference_id: tenant.id,
      },
      { idempotencyKey },
    );

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return { url: session.url };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): Stripe.Event {
    return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET as string);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
  await prisma.$transaction(async (tx) => {
      const alreadyProcessed = await webhookEventRepository.findByStripeEventId(event.id, tx);
      if (alreadyProcessed) {
        return;
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const tenantId = session.client_reference_id;
          if (tenantId) {
            await tenantRepository.updateTenant(
              tenantId,
              {
                plan: "PRO",
                stripeSubscriptionId: session.subscription as string,
                subscriptionStatus: "active",
              },
              tx,
            );
          }
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          const tenant = await tenantRepository.findByStripeCustomerId(subscription.customer as string, tx);
          if (tenant) {
            await tenantRepository.updateTenant(tenant.id, { subscriptionStatus: subscription.status }, tx);
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const tenant = await tenantRepository.findByStripeCustomerId(subscription.customer as string, tx);
          if (tenant) {
            await tenantRepository.updateTenant(tenant.id, { plan: "FREE", subscriptionStatus: "canceled" }, tx);
          }
          break;
        }

        default:
          break;
      }

      await webhookEventRepository.createWebhookEvent(event.id, event.type, tx);
    });
  }
}

export const stripeService = new StripeService();

