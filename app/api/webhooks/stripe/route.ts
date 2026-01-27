import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Note: We need to use the service role key to bypass RLS when updating subscriptions
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
    const body = await req.text();
    const signature = (await headers()).get('Stripe-Signature') as string;

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET!
        );
    } catch (error: any) {
        return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const subscription = event.data.object as Stripe.Subscription;

    if (event.type === 'checkout.session.completed') {
        if (!session?.metadata?.organizationId) {
            return new NextResponse('Organization ID is missing in metadata', { status: 400 });
        }

        const subscriptionId = session.subscription as string;

        // Update organization with stripe customer id
        await supabaseAdmin
            .from('organizations')
            .update({
                stripe_customer_id: session.customer as string,
                subscription_status: 'active'
            })
            .eq('id', session.metadata.organizationId);

        // Create subscription record
        await supabaseAdmin
            .from('subscriptions')
            .insert({
                id: subscriptionId,
                organization_id: session.metadata.organizationId,
                status: 'active',
                price_id: session.metadata.priceId, // Assuming you pass this
                quantity: 1,
                cancel_at_period_end: false,
                // We would need to fetch the subscription details to get dates, 
                // but for now we can just set created_at
            });
    }

    if (event.type === 'customer.subscription.updated') {
        const sub = subscription as any;
        await supabaseAdmin
            .from('subscriptions')
            .update({
                status: sub.status,
                cancel_at_period_end: sub.cancel_at_period_end,
                current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
                current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            })
            .eq('id', sub.id);

        // Also update the organization status
        // We need to find the organization associated with this subscription
        const { data: subData } = await supabaseAdmin
            .from('subscriptions')
            .select('organization_id')
            .eq('id', sub.id)
            .single();

        if (subData) {
            await supabaseAdmin
                .from('organizations')
                .update({ subscription_status: sub.status })
                .eq('id', subData.organization_id);
        }
    }

    if (event.type === 'customer.subscription.deleted') {
        const sub = subscription as any;
        await supabaseAdmin
            .from('subscriptions')
            .update({
                status: sub.status,
                cancel_at_period_end: sub.cancel_at_period_end,
                current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
                current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            })
            .eq('id', sub.id);

        const { data: subData } = await supabaseAdmin
            .from('subscriptions')
            .select('organization_id')
            .eq('id', sub.id)
            .single();

        if (subData) {
            await supabaseAdmin
                .from('organizations')
                .update({ subscription_status: 'canceled' })
                .eq('id', subData.organization_id);
        }
    }

    return new NextResponse(null, { status: 200 });
}
