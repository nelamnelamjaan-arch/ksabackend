import { getStripeClient } from "./stripeCheckout.js";

/**
 * Grand Admin: Stripe balance + recent payouts (Payoneer / bank payouts use Stripe payout settings).
 */
export async function fetchStripePayoutSnapshot() {
  const stripe = getStripeClient();
  if (!stripe) {
    const err = new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
    err.status = 503;
    throw err;
  }

  const [balance, payouts] = await Promise.all([
    stripe.balance.retrieve(),
    stripe.payouts.list({ limit: 8 }),
  ]);

  const sumAvailable = (balance.available || []).reduce((a, b) => a + (b.amount || 0), 0);
  const readyForPayout = sumAvailable > 0;

  return {
    available: balance.available || [],
    pending: balance.pending || [],
    instantAvailable: balance.instant_available || [],
    livemode: balance.livemode,
    readyForPayout,
    recentPayouts: (payouts.data || []).map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      arrivalDate: p.arrival_date,
      description: p.description || "",
    })),
    payoneerNote:
      "Connect your Payoneer virtual bank account under Stripe Dashboard → Settings → Payouts and bank accounts. Charges settle in Stripe; payouts follow your payout schedule.",
  };
}
