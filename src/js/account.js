import { supabase } from '../lib/supabase.js';
import { appUrl, authErrorMessage, displayName, formatDate, providerName, setAvatar } from '../lib/auth.js';

const loading = document.querySelector('[data-account-loading]');
const body = document.querySelector('[data-account-body]');
const statusEl = document.querySelector('[data-account-status]');

const avatar = document.querySelector('[data-account-avatar]');
const nameEl = document.querySelector('[data-account-name]');
const emailEl = document.querySelector('[data-account-email]');
const providerEl = document.querySelector('[data-account-provider]');
const idEl = document.querySelector('[data-account-id]');

const planBadge = document.querySelector('[data-plan-badge]');
const planSummary = document.querySelector('[data-plan-summary]');
const planStatus = document.querySelector('[data-plan-status]');
const planDateRow = document.querySelector('[data-plan-date-row]');
const planDateLabel = document.querySelector('[data-plan-date-label]');
const planDate = document.querySelector('[data-plan-date]');

const signOutButton = document.querySelector('[data-account-signout]');
const deleteOpen = document.querySelector('[data-delete-open]');
const dialog = document.querySelector('[data-delete-dialog]');
const deleteInput = document.querySelector('[data-delete-input]');
const deleteConfirm = document.querySelector('[data-delete-confirm]');
const deleteStatus = document.querySelector('[data-delete-status]');
const contactEmail = document.body.dataset.contactEmail || '';

const PLAN_NAMES = { free: 'Free', pro: 'Pro', max: 'Max' };

const STATUS_NAMES = {
  active: 'Active',
  authenticated: 'Pending',
  created: 'Pending',
  pending: 'Payment pending',
  halted: 'Payment failed',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  completed: 'Completed',
  expired: 'Expired',
  paused: 'Paused',
  past_due: 'Payment failed',
  trialing: 'Trial',
};

let user = null;

function setStatus(message, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', kind === 'error');
  statusEl.classList.toggle('is-ok', kind === 'ok');
}

function renderUser(account) {
  user = account;
  setAvatar(avatar, account);

  const name = displayName(account);
  if (nameEl) nameEl.textContent = name || 'Your account';
  if (emailEl) emailEl.textContent = account.email || 'No email on this account';
  if (providerEl) providerEl.textContent = providerName(account);
  if (idEl) idEl.textContent = account.id;
}

function renderPlan(row) {
  const plan = String(row?.plan || 'free').toLowerCase();
  const planName = PLAN_NAMES[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
  const status = String(row?.status || 'active').toLowerCase();
  const statusName = STATUS_NAMES[status] || status.charAt(0).toUpperCase() + status.slice(1);
  const paid = plan !== 'free';
  const endDate = formatDate(row?.current_period_end);

  if (planBadge) {
    planBadge.textContent = planName;
    planBadge.classList.toggle('plan-badge--paid', paid);
  }
  if (planStatus) planStatus.textContent = statusName;

  if (!paid) {
    if (planSummary) planSummary.textContent = 'Free, forever.';
    if (planDateRow) planDateRow.hidden = true;
    return;
  }

  if (planDateRow) planDateRow.hidden = false;

  if (row?.cancel_at_period_end) {
    if (planSummary) planSummary.textContent = `Your plan ends on ${endDate}.`;
    if (planDateLabel) planDateLabel.textContent = 'Ends on';
    if (planDate) planDate.textContent = endDate;
    return;
  }

  if (status === 'halted' || status === 'past_due') {
    if (planSummary) planSummary.textContent = 'The last payment needs attention.';
  } else if (status === 'paused') {
    if (planSummary) planSummary.textContent = 'Your plan is paused.';
  } else {
    if (planSummary) planSummary.textContent = `Your ${planName} plan renews automatically.`;
  }

  if (planDateLabel) planDateLabel.textContent = 'Renews on';
  if (planDate) planDate.textContent = endDate;
}

async function loadPlan(account) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan,status,current_period_end,cancel_at_period_end')
    .eq('user_id', account.id)
    .maybeSingle();

  if (error) {
    console.warn('[SnapX] Could not load the plan:', error.message);
    if (planBadge) planBadge.textContent = 'Unavailable';
    if (planSummary) planSummary.textContent = 'Your plan is unavailable right now. Refresh in a moment.';
    if (planStatus) planStatus.textContent = '—';
    if (planDateRow) planDateRow.hidden = true;
    setStatus('We could not load your plan. Refresh the page to try again.', 'error');
    return;
  }

  renderPlan(data);
}

function openDialog() {
  if (!dialog) return;
  deleteInput.value = '';
  deleteConfirm.disabled = true;
  deleteStatus.textContent = '';
  deleteStatus.classList.remove('is-error', 'is-ok');

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  window.requestAnimationFrame(() => deleteInput.focus());
}

deleteOpen?.addEventListener('click', openDialog);

deleteInput?.addEventListener('input', () => {
  deleteConfirm.disabled = deleteInput.value.trim() !== 'DELETE';
});

deleteConfirm?.addEventListener('click', () => {
  if (!user) return;

  if (!contactEmail) {
    deleteStatus.textContent = 'No contact address is configured. Please try again later.';
    deleteStatus.classList.add('is-error');
    return;
  }

  const subject = encodeURIComponent('Account deletion request');
  const bodyText = [
    'Please delete my SnapX account and plan data.',
    '',
    `User ID: ${user.id}`,
    `Email: ${user.email || '(none)'}`,
    '',
    'I understand this cannot be undone.',
  ].join('\n');

  window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${encodeURIComponent(bodyText)}`;

  deleteStatus.textContent = `Your email app should open. If it does not, write to ${contactEmail} with your user ID.`;
  deleteStatus.classList.add('is-ok');
});

dialog?.addEventListener('close', () => {
  deleteInput.value = '';
  deleteConfirm.disabled = true;
});

dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

signOutButton?.addEventListener('click', async () => {
  signOutButton.disabled = true;
  const { error } = await supabase.auth.signOut();

  if (error) {
    signOutButton.disabled = false;
    setStatus(authErrorMessage(error), 'error');
    return;
  }

  window.location.assign(appUrl(''));
});

async function init() {
  if (!supabase) {
    if (loading) loading.hidden = true;
    setStatus('Sign-in is not configured on this site yet.', 'error');
    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    const login = `${appUrl('login.html')}?next=${encodeURIComponent(appUrl('account.html'))}`;
    window.location.replace(login);
    return;
  }

  renderUser(data.session.user);

  if (loading) loading.hidden = true;
  if (body) body.hidden = false;

  await loadPlan(data.session.user);
}

init();
