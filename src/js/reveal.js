export function initReveal() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('[data-reveal-stagger]').forEach((parent) => {
    [...parent.children].forEach((child, index) => {
      child.style.setProperty('--stagger', String(index));
    });
  });

  document.querySelectorAll('[data-wipe]').forEach((heading) => {
    const wipe = document.createElement('span');
    wipe.className = 'wipe';
    wipe.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 10; index += 1) {
      const square = document.createElement('i');
      square.style.setProperty('--n', String(index));
      wipe.append(square);
    }
    heading.after(wipe);
  });

  const targets = [
    ...document.querySelectorAll('[data-reveal], [data-reveal-stagger], .wipe'),
  ];

  if (reduce) {
    targets.forEach((target) => target.classList.add('is-in'));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    targets.forEach((target) => observer.observe(target));
  }

  const stepGroups = document.querySelectorAll('.steps');
  if (stepGroups.length && !reduce) {
    const pauseObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-paused', !entry.isIntersecting);
        });
      },
      { threshold: 0.01 },
    );
    stepGroups.forEach((group) => pauseObserver.observe(group));
  }
}
