export function initNav() {
  const header = document.querySelector('[data-header]');
  const openBtn = document.querySelector('[data-menu-open]');
  const sheet = document.querySelector('[data-menu]');
  const closeBtn = sheet?.querySelector('[data-menu-close]');
  let lastY = window.scrollY;
  let ticking = false;
  let menuOpen = false;
  let lastFocused = null;

  if (header) {
    const update = () => {
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 8);
      if (!menuOpen && y > 400 && y > lastY + 4) {
        header.classList.add('is-hidden');
      } else if (y < lastY - 4 || y <= 400) {
        header.classList.remove('is-hidden');
      }
      lastY = y;
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  if (!sheet || !openBtn) return;

  const focusable = () =>
    [...sheet.querySelectorAll('a[href], button:not([disabled])')].filter(
      (el) => el.offsetParent !== null,
    );

  const open = () => {
    menuOpen = true;
    lastFocused = document.activeElement;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    openBtn.setAttribute('aria-expanded', 'true');
    header?.classList.remove('is-hidden');
    window.requestAnimationFrame(() => closeBtn?.focus());
  };

  const close = () => {
    if (!menuOpen) return;
    menuOpen = false;
    sheet.hidden = true;
    document.body.classList.remove('is-locked');
    openBtn.setAttribute('aria-expanded', 'false');
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  };

  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  sheet.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.matchMedia('(min-width: 860px)').addEventListener('change', (event) => {
    if (event.matches) close();
  });
}
