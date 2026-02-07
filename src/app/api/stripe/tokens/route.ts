import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getVerifiedUser } from "@/lib/serverAuth";

const getStripe = () => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY missing");
  }
  return new Stripe(secret, {});
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.bfzoom.fr";
const TOKENS_PRICE_ID = process.env.STRIPE_TOKENS_PRICE_ID;
const TOKENS_PER_PACK = Number(process.env.TOKENS_PER_PACK ?? 12);

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  if (!TOKENS_PRICE_ID) {
    return NextResponse.json({ error: "Tokens price not configured" }, { status: 500 });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: TOKENS_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/pricing/success?purchase=tokens`,
    cancel_url: `${APP_URL}/pricing/cancel`,
    client_reference_id: user.uid,
    customer_email: user.email,
    metadata: {
      uid: user.uid,
      purpose: "tokens",
      tokens: TOKENS_PER_PACK.toString(),
    },
  });

  return NextResponse.json({ url: session.url });
}