import '../styles/main.css';
import '../extension-bridge.js';
import { initNav } from './nav.js';
import { initReveal } from './reveal.js';
import { initCopy } from './copy.js';
import { initEffects } from './effects.js';
import { initFaq } from './faq.js';
import { initHero } from './dissolve.js';

function afterIdle(fn) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 1200 });
  } else {
    window.setTimeout(fn, 300);
  }
}

function initPopup() {
  const stage = document.querySelector('[data-popup-stage]');
  if (!stage) return;

  const tabs = [...document.querySelectorAll('[data-popup-tab]')];
  let selected = 'camera';

  const render = (front) => {
    stage.classList.toggle('is-swapped', front === 'hidden');
  };

  const select = (state) => {
    selected = state;
    tabs.forEach((tab) => {
      tab.setAttribute('aria-pressed', String(tab.dataset.popupTab === state));
    });
    render(state);
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => select(tab.dataset.popupTab));
  });

  stage.addEventListener('pointerenter', () => render('hidden'));
  stage.addEventListener('pointerleave', () => render(selected));
  stage.addEventListener('focusin', () => render('hidden'));
  stage.addEventListener('focusout', () => render(selected));
}

initNav();
initReveal();
initCopy();
initFaq();
initPopup();

afterIdle(() => {
  initHero();
  initEffects();
  import('./header-auth.js').then(({ initHeaderAuth }) => initHeaderAuth());
});
