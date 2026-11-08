export type PricingTier = {
    name: string;
    price: string;
    period: string | null;
    description: string;
    features: string[];
    cta: string;
    href: string;
    highlighted: boolean;
};

/**
 * Locked public prices. Feature bullets are the live list after the Nov 7
 * honesty pass: Tasks replaces the kanban claim, unverified AI and portal
 * bullets are gone, and Pro/Agency/Enterprise inherit the previous tier so
 * the shorter lists stay readable. Contact sales uses /signup because the
 * live page has no separate sales path.
 */
export const pricingTiers: PricingTier[] = [
    {
        name: "Starter",
        price: "49",
        period: "/month",
        description: "Perfect for freelancers and solo-agency owners.",
        features: [
            "Up to 3 Clients",
            "1 User Account",
            "Basic SEO Dashboard",
            "Tasks",
            "Manual Reports",
            "Community Support",
        ],
        cta: "Start free trial",
        href: "/signup",
        highlighted: false,
    },
    {
        name: "Pro",
        price: "199",
        period: "/month",
        description: "Ideal for growing boutique agencies.",
        features: [
            "Everything in Starter",
            "Up to 15 Clients",
            "5 User Accounts",
            "Time Tracking",
            "Email Support",
        ],
        cta: "Start free trial",
        href: "/signup",
        highlighted: true,
    },
    {
        name: "Agency",
        price: "499",
        period: "/month",
        description: "For established agencies scaling fast.",
        features: [
            "Everything in Pro",
            "Up to 50 Clients",
            "Unlimited Users",
            "Priority Support",
        ],
        cta: "Start free trial",
        href: "/signup",
        highlighted: false,
    },
    {
        name: "Enterprise",
        price: "Custom",
        period: null,
        description: "Complex needs? We've got you covered.",
        features: [
            "Everything in Agency",
            "50+ Clients",
            "Dedicated Account Manager",
            "Onboarding Training",
            "Security Review",
        ],
        cta: "Contact sales",
        href: "/signup",
        highlighted: false,
    },
];

export const pricingTrialLine = "All plans include a 14-day free trial.";
