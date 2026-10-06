'use client';

export default function PortalError({ reset }: { reset: () => void }) {
    return <section className="portal-panel mx-auto max-w-lg"><h2>We couldn’t load this update.</h2><p className="portal-panel-description">Please try again. If this continues, contact your account team.</p><button className="portal-button mt-5" onClick={reset} type="button">Try again</button></section>;
}
