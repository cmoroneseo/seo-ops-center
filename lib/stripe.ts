import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
    apiVersion: '2025-11-17.clover',
    typescript: true,
});

export const PRICE_IDS = {
    starter: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER || 'price_starter_placeholder',
    pro: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO || 'price_pro_placeholder',
    agency: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY || 'price_agency_placeholder',
};
