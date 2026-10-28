import { supabase, authConfigured } from '../lib/supabase.js';
import { appUrl, displayName, providerName, setAvatar } from '../lib/auth.js';

/**
 * Loaded after idle so auth never blocks the first paint. The markup starts
 * signed out; this swaps it when Supabase reports a session.
 */
export function initHeaderAuth() {
  if (!authConfigured || !supabase) return;

  const signedOutLinks = [...document.querySelectorAll('[data-auth-signedout]')];
  const signedInLinks = [...document.querySelectorAll('[data-auth-signedin]')];
  const menu = document.querySelector('[data-user-menu]');
  const toggle = menu?.querySelector('[data-user-toggle]');
  const panel = menu?.querySelector('[data-user-panel]');

  if (!menu || !toggle || !panel) return;

  const avatar = menu.querySelector('[data-user-avatar]');
  const name = menu.querySelector('[data-user-name]');
  const email = menu.querySelector('[data-user-email]');
  const label = menu.querySelector('[data-user-label]');
  const signOut = menu.querySelector('[data-signout]');
  const items = () => [...panel.querySelectorAll('a[href], button:not([disabled])')];

  let open = false;

  const setOpen = (next, { focus = null } = {}) => {
    open = next;
    panel.hidden = !next;
    toggle.setAttribute('aria-expanded', String(next));
    if (!next) return;

    if (focus === 'first') window.requestAnimationFrame(() => items()[0]?.focus());
    if (focus === 'last') {
      window.requestAnimationFrame(() => items().at(-1)?.focus());
    }
  };

  toggle.addEventListener('click', () => setOpen(!open));

  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true, { focus: event.key === 'ArrowDown' ? 'first' : 'last' });
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      toggle.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const list = items();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? list.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next].focus();
  });

  panel.addEventListener('focusout', (event) => {
    if (open && !menu.contains(event.relatedTarget)) setOpen(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (open && !menu.contains(event.target)) setOpen(false);
  });

  signOut?.addEventListener('click', async () => {
    const original = signOut.textContent;
    signOut.disabled = true;
    signOut.textContent = 'Signing out…';
    setOpen(false);

    const { error } = await supabase.auth.signOut();

    if (error) {
      signOut.disabled = false;
      signOut.textContent = 'Sign out failed — retry';
      setOpen(true);
      console.warn('[SnapX] Sign out failed:', error.message);
      return;
    }

    signOut.textContent = original;
    signOut.disabled = false;
    if (/account\.html$/.test(window.location.pathname)) {
      window.location.assign(appUrl(''));
    }
  });

  const render = (session) => {
    const user = session?.user ?? null;
    const signedIn = Boolean(user);

    signedOutLinks.forEach((link) => {
      link.hidden = signedIn;
    });
    signedInLinks.forEach((link) => {
      link.hidden = !signedIn;
    });
    menu.hidden = !signedIn;

    if (!signedIn) {
      setOpen(false);
      return;
    }

    setAvatar(avatar, user);
    if (name) name.textContent = displayName(user) || 'Your account';
    if (email) email.textContent = user.email || '';
    if (label) {
      const who = displayName(user) || user.email || 'account';
      label.textContent = `Account menu for ${who}`;
    }
  };

  supabase.auth.getSession().then(({ data }) => render(data.session));
  supabase.auth.onAuthStateChange((_event, session) => render(session));
}
