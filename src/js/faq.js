export function initFaq() {
  const list = document.querySelector('[data-help]');
  if (!list) return;

  const query = window.matchMedia('(min-width: 900px)');
  const rows = [...list.querySelectorAll('details')];

  const apply = () => {
    list.classList.toggle('is-table', query.matches);
    rows.forEach((row) => {
      row.open = query.matches;
    });
  };

  // On desktop the rows are a two-column table, not a disclosure.
  list.addEventListener('click', (event) => {
    if (query.matches && event.target.closest('summary')) event.preventDefault();
  });

  query.addEventListener('change', apply);
  apply();
}
