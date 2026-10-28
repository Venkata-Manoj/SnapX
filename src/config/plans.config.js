/**
 * Plans and the launch offer. The pricing UI is rendered from this file at
 * build time, so prices, features and CTAs never drift between pages.
 */

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceINR: 0,
    period: null,
    tagline: 'Snap and vanish, on us.',
    features: [
      'Dust effect',
      'Google Meet',
      'Zoom',
      'Snap, shortcut and button triggers',
      'On-device, private',
    ],
    cta: { label: 'Add to Chrome', action: 'install' },
  },
  {
    id: 'pro',
    name: 'Pro',
    priceINR: 69,
    period: 'month',
    highlight: true,
    tagline: 'Every effect, every call app.',
    features: [
      'Everything in Free',
      'All effects as they launch',
      'Teams',
      'X video calls', /* CONFIRM */
    ],
    cta: { label: 'Get Pro', action: 'checkout' },
  },
  {
    id: 'max',
    name: 'Max',
    priceINR: 149,
    period: 'month',
    tagline: "First in line for what's next.",
    features: ['Everything in Pro', 'Early access to new effects and features', 'Priority support'],
    cta: { label: 'Get Max', action: 'checkout' },
  },
];

/** Prices are quoted inclusive of GST. CONFIRM with your CA. */
export const PRICES_INCLUDE_TAX = true;

/** Set enabled: true and fill the label to show a ribbon on Pro. */
export const LAUNCH_OFFER = {
  enabled: false,
  label: '',
  description: '',
};
