import "dotenv/config";
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_TEST_KEY!);