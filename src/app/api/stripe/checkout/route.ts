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

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
      return NextResponse.json(
        { error: "Stripe non configuré" },
        { status: 500 }
      );
    }

    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/pricing/cancel`,
      client_reference_id: user.uid,
      customer_email: user.email,
      metadata: { uid: user.uid, email: user.email },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}