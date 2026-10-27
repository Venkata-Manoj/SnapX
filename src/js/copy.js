export function initCopy() {
  const status = document.querySelector('[data-copy-status]');
  const buttons = document.querySelectorAll('[data-copy]');

  buttons.forEach((button) => {
    const label = button.querySelector('[data-copy-label]');
    const original = label ? label.textContent : '';
    let timer = 0;

    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      let copied = false;

      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        try {
          copied = document.execCommand('copy');
        } catch {
          copied = false;
        }
        field.remove();
      }

      if (!copied) return;

      button.classList.add('is-copied');
      if (label) label.textContent = 'Copied';
      if (status) status.textContent = `${value} copied to clipboard`;

      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        button.classList.remove('is-copied');
        if (label) label.textContent = original;
      }, 1600);
    });
  });
}
