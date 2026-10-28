import { PLANS, PRICES_INCLUDE_TAX, LAUNCH_OFFER } from './plans.config.js';
import { SITE } from './site.config.js';

/**
 * Build-time renderer for the pricing cards. Imported by the Vite plugin, never
 * shipped to the browser, so the cards are static HTML: no JS needed to read
 * prices, no layout shift, and search engines see the prices in the source.
 */

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const priceLabel = (plan, symbol) =>
  plan.priceINR === 0
    ? 'Free'
    : `${symbol}${plan.priceINR.toLocaleString('en-IN')}<span class="plan__period">/${esc(plan.period ?? 'month')}</span>`;

const ctaFor = (plan, { installUrl, base }) => {
  if (plan.cta.action === 'install') {
    // No store listing yet: say what the link actually does instead of implying one.
    const label = SITE.CHROME_STORE_URL ? plan.cta.label : 'See install steps';
    return `<a class="btn btn--secondary btn--wide" href="${esc(installUrl)}">${esc(label)}</a>`;
  }

  if (!SITE.PAYMENTS_ENABLED) {
    return `<button class="btn btn--ghost btn--wide" type="button" disabled aria-describedby="plan-${esc(plan.id)}-note">${esc(plan.cta.label)}</button>
        <p class="plan__note small" id="plan-${esc(plan.id)}-note">Payments open soon. The Free plan works today.</p>`;
  }

  const next = encodeURIComponent(`/pricing.html#${plan.id}`);
  return `<a class="btn ${plan.highlight ? 'btn--primary' : 'btn--secondary'} btn--wide" href="${esc(`${base}login.html?next=${next}`)}">${esc(plan.cta.label)}</a>
        <p class="plan__note small">You'll be asked to sign in first.</p>`;
};

export function renderPricing({ base = '/', onHome = false, priceSymbol = '₹' } = {}) {
  const effectsHref = onHome ? '#effects' : `${base}index.html#effects`;
  const installUrl = SITE.CHROME_STORE_URL || (onHome ? '#install' : `${base}index.html#install`);

  const cards = PLANS.map((plan) => {
    const ribbon = plan.highlight
      ? LAUNCH_OFFER.enabled && LAUNCH_OFFER.label
        ? `<p class="plan__ribbon">${esc(LAUNCH_OFFER.label)}</p>`
        : '<p class="plan__ribbon">Most popular</p>'
      : '';

    const features = plan.features
      .map((feature) => {
        const label = /All effects as they launch/i.test(feature)
          ? `<a class="link" href="${esc(effectsHref)}">${esc(feature)}</a>`
          : esc(feature);
        return `<li>${label}</li>`;
      })
      .join('\n            ');

    return `<article class="plan${plan.highlight ? ' plan--highlight' : ''}" id="${esc(plan.id)}" aria-labelledby="plan-${esc(plan.id)}-name">
          ${ribbon}
          <div class="plan__head">
            <h3 class="plan__name" id="plan-${esc(plan.id)}-name">${esc(plan.name)}</h3>
            <p class="plan__tagline">${esc(plan.tagline)}</p>
          </div>
          <p class="plan__price"><span class="plan__amount">${priceLabel(plan, priceSymbol)}</span></p>
          ${
            plan.highlight && LAUNCH_OFFER.enabled && LAUNCH_OFFER.description
              ? `<p class="plan__offer small">${esc(LAUNCH_OFFER.description)}</p>`
              : ''
          }
          <ul class="plan__features">
            ${features}
          </ul>
          <div class="plan__cta">
            ${ctaFor(plan, { installUrl, base })}
          </div>
        </article>`;
  }).join('\n        ');

  const tax = PRICES_INCLUDE_TAX ? ' Inclusive of all taxes.' : '';

  return `<div class="pricing-grid">
        ${cards}
      </div>
      <p class="pricing-fine small">Prices in INR.${tax} Cancel anytime. Auto-renews monthly until cancelled.</p>`;
}

/** Offer list for the homepage SoftwareApplication JSON-LD. */
export function renderOffers() {
  return JSON.stringify(
    PLANS.map((plan) => ({
      '@type': 'Offer',
      name: plan.name,
      price: String(plan.priceINR),
      priceCurrency: 'INR',
    })),
  );
}
