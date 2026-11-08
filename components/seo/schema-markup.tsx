export function SchemaMarkup() {
    const schema = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "SEO Ops Center",
        "operatingSystem": "Web",
        "applicationCategory": "BusinessApplication",
        "description": "See how a client is performing, what the campaign is doing next, and what was actually delivered — without a second spreadsheet or a status-chase email.",
        "offers": [
            { "@type": "Offer", "name": "Starter", "price": "49", "priceCurrency": "USD" },
            { "@type": "Offer", "name": "Pro", "price": "199", "priceCurrency": "USD" },
            { "@type": "Offer", "name": "Agency", "price": "499", "priceCurrency": "USD" },
        ],
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}
