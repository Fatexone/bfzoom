import Stripe from "stripe";
import { headers } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const getStripe = () => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY missing");
  }
  return new Stripe(secret, {});
};

export async function POST(req: Request) {
  const signature = (await headers()).get("stripe-signature");
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return new Response("Webhook error", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.client_reference_id || session.metadata?.uid;
    if (!uid) {
      return new Response("Missing uid", { status: 400 });
    }

    const metadata = session.metadata ?? {};
    if (metadata.purpose === "tokens") {
      const tokensToAdd =
        Number(metadata.tokens) ||
        Number(process.env.TOKENS_PER_PACK ?? 0);
      if (tokensToAdd > 0) {
        const tokensRef = getAdminDb().doc(`users/${uid}/tokens/wallet`);
        await tokensRef.set(
          {
            balance: FieldValue.increment(tokensToAdd),
            tier: "free",
            lastRefillAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      return new Response("tokens added", { status: 200 });
    }

    await getAdminDb().collection("users").doc(uid).set(
      {
        plan: "premium",
        isPremium: true,
        stripeCustomerId: session.customer,
      },
      { merge: true }
    );
  }

  return new Response("ok", { status: 200 });
}