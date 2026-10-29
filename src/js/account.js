import { supabase } from '../lib/supabase.js';
import { appUrl, authErrorMessage, displayName, formatDate, providerName, setAvatar } from '../lib/auth.js';
import { formatMoney, planName, readFunctionError } from '../lib/billing.js';

const loading = document.querySelector('[data-account-loading]');
const body = document.querySelector('[data-account-body]');
const deletedPanel = document.querySelector('[data-account-deleted]');
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
const planPendingRow = document.querySelector('[data-plan-pending-row]');
const planPending = document.querySelector('[data-plan-pending]');
const planPaymentRow = document.querySelector('[data-plan-payment-row]');
const planPayment = document.querySelector('[data-plan-payment]');
const planUpgrade = document.querySelector('[data-plan-upgrade]');
const manageButton = document.querySelector('[data-manage]');

const manageDialog = document.querySelector('[data-manage-dialog]');
const manageCurrent = document.querySelector('[data-manage-current]');
const switchBlock = document.querySelector('[data-switch-block]');
const switchTitle = document.querySelector('[data-switch-title]');
const switchCopy = document.querySelector('[data-switch-copy]');
const switchButton = document.querySelector('[data-switch-plan]');
const cancelCopy = document.querySelector('[data-cancel-copy]');
const cancelOpen = document.querySelector('[data-cancel-open]');
const cancelConfirm = document.querySelector('[data-cancel-confirm]');
const cancelWarning = document.querySelector('[data-cancel-warning]');
const cancelAbort = document.querySelector('[data-cancel-abort]');
const cancelGo = document.querySelector('[data-cancel-go]');
const manageStatus = document.querySelector('[data-manage-status]');
const manageClose = document.querySelector('[data-manage-close]');

const signOutButton = document.querySelector('[data-account-signout]');
const deleteOpen = document.querySelector('[data-delete-open]');
const dialog = document.querySelector('[data-delete-dialog]');
const deleteInput = document.querySelector('[data-delete-input]');
const deleteConfirm = document.querySelector('[data-delete-confirm]');
const deleteStatus = document.querySelector('[data-delete-status]');

const STATUS_NAMES = {
  active: 'Active',
  authenticated: 'Active',
  created: 'Checkout started',
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
let planRow = null;
let manageBusy = false;
let deleteBusy = false;

const loginUrl = () => `${appUrl('login.html')}?next=${encodeURIComponent(appUrl('account.html'))}`;

function setStatus(message, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', kind === 'error');
  statusEl.classList.toggle('is-ok', kind === 'ok');
}

function setManageStatus(message, kind = '') {
  if (!manageStatus) return;
  manageStatus.textContent = message;
  manageStatus.classList.toggle('is-error', kind === 'error');
  manageStatus.classList.toggle('is-ok', kind === 'ok');
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
  planRow = row ?? null;

  const plan = String(row?.plan || 'free').toLowerCase();
  const name = planName(plan);
  const status = String(row?.status || 'active').toLowerCase();
  const paid = plan !== 'free';
  const endDate = formatDate(row?.current_period_end);
  const hasEnd = endDate !== '—';
  const pending =
    row?.pending_plan && String(row.pending_plan).toLowerCase() !== plan
      ? String(row.pending_plan).toLowerCase()
      : '';

  if (planBadge) {
    planBadge.textContent = name;
    planBadge.classList.toggle('plan-badge--paid', paid);
  }
  if (planStatus) {
    planStatus.textContent =
      STATUS_NAMES[status] || status.charAt(0).toUpperCase() + status.slice(1);
  }

  if (planUpgrade) planUpgrade.hidden = paid;
  if (manageButton) manageButton.hidden = !paid;

  if (planPendingRow) planPendingRow.hidden = !pending;
  if (pending && planPending) {
    planPending.textContent = hasEnd
      ? `${planName(pending)} on ${formatDate(row?.pending_plan_at)}`
      : `${planName(pending)} at the end of this period`;
  }

  const paidAt = formatDate(row?.last_payment_at);
  const amount = formatMoney(row?.last_payment_amount, row?.last_payment_currency);
  const hasPayment = paidAt !== '—';

  if (planPaymentRow) planPaymentRow.hidden = !hasPayment;
  if (hasPayment && planPayment) {
    planPayment.textContent = amount ? `${amount} on ${paidAt}` : paidAt;
  }

  if (!paid) {
    if (planSummary) planSummary.textContent = 'Free, forever.';
    if (planDateRow) planDateRow.hidden = true;
    return;
  }

  if (planDateRow) planDateRow.hidden = !hasEnd;

  if (row?.cancel_at_period_end) {
    if (planSummary) {
      planSummary.textContent = hasEnd
        ? `Your ${name} plan ends on ${endDate}.`
        : `Your ${name} plan is cancelled.`;
    }
    if (planDateLabel) planDateLabel.textContent = 'Ends on';
    if (planDate) planDate.textContent = endDate;
    return;
  }

  if (planSummary) {
    if (pending) {
      planSummary.textContent = hasEnd
        ? `Your plan switches to ${planName(pending)} on ${formatDate(row?.pending_plan_at)}.`
        : `Your plan switches to ${planName(pending)} at the end of this period.`;
    } else if (status === 'halted' || status === 'past_due') {
      planSummary.textContent =
        'The last payment failed, so paid features are off until it succeeds.';
    } else if (status === 'paused') {
      planSummary.textContent = 'Your plan is paused.';
    } else if (status === 'created' || status === 'pending') {
      planSummary.textContent = "Checkout hasn't finished yet.";
    } else {
      planSummary.textContent = `Your ${name} plan renews automatically.`;
    }
  }

  if (planDateLabel) planDateLabel.textContent = pending ? 'Current period ends' : 'Renews on';
  if (planDate) planDate.textContent = endDate;
}

async function loadPlan(account) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'plan,status,current_period_end,cancel_at_period_end,provider_subscription_id,started_at,pending_plan,pending_plan_at,last_payment_at,last_payment_amount,last_payment_currency',
    )
    .eq('user_id', account.id)
    .maybeSingle();

  if (error) {
    console.warn('[SnapX] Could not load the plan:', error.message);
    if (planBadge) planBadge.textContent = 'Unavailable';
    if (planSummary) planSummary.textContent = 'Your plan is unavailable right now. Refresh in a moment.';
    if (planStatus) planStatus.textContent = '—';
    if (planDateRow) planDateRow.hidden = true;
    if (planPendingRow) planPendingRow.hidden = true;
    if (planPaymentRow) planPaymentRow.hidden = true;
    setStatus('We could not load your plan. Refresh the page to try again.', 'error');
    return;
  }

  renderPlan(data);
}

function renderManage() {
  if (!planRow) return;

  const plan = String(planRow.plan || 'free').toLowerCase();
  const name = planName(plan);
  const status = String(planRow.status || '').toLowerCase();
  const endDate = formatDate(planRow.current_period_end);
  const hasEnd = endDate !== '—';
  const canChange = ['active', 'authenticated'].includes(status) && plan !== 'free';

  if (manageCurrent) {
    manageCurrent.textContent = hasEnd
      ? `You are on ${name}. The current period ends on ${endDate}.`
      : `You are on ${name}.`;
  }

  if (switchBlock) switchBlock.hidden = !canChange;

  if (canChange) {
    const target = plan === 'max' ? 'pro' : 'max';
    if (switchButton) {
      switchButton.dataset.target = target;
      switchButton.textContent = `Switch to ${planName(target)}`;
    }
    if (switchTitle) switchTitle.textContent = `Switch to ${planName(target)}`;
    if (switchCopy) {
      switchCopy.textContent =
        target === 'max'
          ? 'Takes effect now. Razorpay charges the prorated difference for the rest of this period.'
          : `Takes effect on ${hasEnd ? endDate : 'the last day of this period'}, when your Max period ends. You keep Max until then.`;
    }
  }

  if (cancelOpen) cancelOpen.hidden = Boolean(planRow.cancel_at_period_end);
  if (cancelConfirm) cancelConfirm.hidden = true;

  if (cancelCopy) {
    if (planRow.cancel_at_period_end) {
      cancelCopy.textContent = hasEnd
        ? `Your plan is already cancelled. You keep ${name} until ${endDate}.`
        : 'Your plan is already cancelled.';
    } else {
      cancelCopy.textContent = hasEnd
        ? `You keep ${name} until ${endDate}, then move to Free. You are not charged again.`
        : `You keep ${name} until the end of this period, then move to Free. You are not charged again.`;
    }
  }

  if (cancelWarning) {
    cancelWarning.textContent = hasEnd
      ? `Cancel ${name}? It stays active until ${endDate}, then your account moves to Free.`
      : `Cancel ${name}? It stays active until the end of this period, then your account moves to Free.`;
  }
}

function openManage() {
  if (!manageDialog || !planRow) return;

  setManageStatus('');
  renderManage();

  if (typeof manageDialog.showModal === 'function') manageDialog.showModal();
  else manageDialog.setAttribute('open', '');

  window.requestAnimationFrame(() => manageClose?.focus());
}

async function switchPlan(target) {
  if (manageBusy || !target || !planRow || !supabase) return;

  manageBusy = true;
  if (switchButton) switchButton.disabled = true;
  setManageStatus(`Switching to ${planName(target)}…`);

  const { data, error } = await supabase.functions.invoke('change-subscription', {
    body: { plan: target },
  });

  manageBusy = false;
  if (switchButton) switchButton.disabled = false;

  if (error) {
    const info = await readFunctionError(error);

    if (info.status === 401) {
      window.location.assign(loginUrl());
      return;
    }

    setManageStatus(
      info.message || "We couldn't change the plan. Try again in a moment.",
      'error',
    );
    return;
  }

  const effective = String(data?.effective || '');

  if (effective === 'now') {
    planRow = { ...planRow, plan: target, pending_plan: null, pending_plan_at: null };
    setManageStatus(
      `${planName(target)} is active now. Your plan details will update in a moment.`,
      'ok',
    );
  } else {
    const endsAt = data?.current_period_end ?? planRow.current_period_end;
    planRow = { ...planRow, pending_plan: target, pending_plan_at: endsAt };
    const endDate = formatDate(endsAt);
    setManageStatus(
      endDate === '—'
        ? `Your plan switches to ${planName(target)} at the end of this period.`
        : `Your plan switches to ${planName(target)} on ${endDate}.`,
      'ok',
    );
  }

  renderPlan(planRow);
  renderManage();

  // The webhook confirms the change; reconcile shortly afterwards.
  window.setTimeout(() => {
    if (user) loadPlan(user);
  }, 4000);
}

async function cancelPlan() {
  if (manageBusy || !planRow || !supabase) return;

  manageBusy = true;
  if (cancelGo) cancelGo.disabled = true;
  setManageStatus('Cancelling your plan…');

  const { data, error } = await supabase.functions.invoke('cancel-subscription', {});

  manageBusy = false;
  if (cancelGo) cancelGo.disabled = false;

  if (error) {
    const info = await readFunctionError(error);

    if (info.status === 401) {
      window.location.assign(loginUrl());
      return;
    }

    setManageStatus(
      info.message || "We couldn't cancel the plan. Try again, or email billing.",
      'error',
    );
    return;
  }

  planRow = {
    ...planRow,
    cancel_at_period_end: true,
    current_period_end: data?.current_period_end ?? planRow.current_period_end,
  };

  renderPlan(planRow);
  renderManage();

  const endDate = formatDate(planRow.current_period_end);
  setManageStatus(
    endDate === '—'
      ? `Cancelled. You keep ${planName(planRow.plan)} until the end of this period.`
      : `Cancelled. You keep ${planName(planRow.plan)} until ${endDate}.`,
    'ok',
  );
}

function openDeleteDialog() {
  if (!dialog) return;

  deleteInput.value = '';
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Delete my account';
  deleteStatus.textContent = '';
  deleteStatus.classList.remove('is-error', 'is-ok');

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  window.requestAnimationFrame(() => deleteInput.focus());
}

async function deleteAccount() {
  if (!user || deleteBusy || !supabase) return;

  deleteBusy = true;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Deleting…';
  deleteStatus.textContent = '';
  deleteStatus.classList.remove('is-error', 'is-ok');

  const { error } = await supabase.functions.invoke('delete-account', {});

  if (error) {
    const info = await readFunctionError(error);

    if (info.status === 401) {
      window.location.assign(loginUrl());
      return;
    }

    deleteBusy = false;
    deleteConfirm.textContent = 'Delete my account';
    deleteConfirm.disabled = deleteInput.value.trim() !== 'DELETE';
    deleteStatus.textContent =
      info.message || "We couldn't delete the account. Try again in a moment.";
    deleteStatus.classList.add('is-error');
    return;
  }

  // The auth user no longer exists; clear the local session too.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The session is already invalid.
  }

  if (dialog?.open) dialog.close();
  if (body) body.hidden = true;
  setStatus('');

  if (deletedPanel) {
    deletedPanel.hidden = false;
    deletedPanel.focus();
  }
}

manageButton?.addEventListener('click', openManage);
manageClose?.addEventListener('click', () => manageDialog?.close());

switchButton?.addEventListener('click', () => {
  switchPlan(switchButton.dataset.target);
});

cancelOpen?.addEventListener('click', () => {
  if (cancelOpen) cancelOpen.hidden = true;
  if (cancelConfirm) cancelConfirm.hidden = false;
  window.requestAnimationFrame(() => cancelAbort?.focus());
});

cancelAbort?.addEventListener('click', () => {
  if (cancelConfirm) cancelConfirm.hidden = true;
  if (cancelOpen) cancelOpen.hidden = Boolean(planRow?.cancel_at_period_end);
  window.requestAnimationFrame(() => cancelOpen?.focus());
});

cancelGo?.addEventListener('click', cancelPlan);

manageDialog?.addEventListener('close', () => {
  manageBusy = false;
  if (switchButton) switchButton.disabled = false;
  if (cancelGo) cancelGo.disabled = false;
  if (cancelConfirm) cancelConfirm.hidden = true;
  setManageStatus('');
});

manageDialog?.addEventListener('click', (event) => {
  if (event.target === manageDialog) manageDialog.close();
});

deleteOpen?.addEventListener('click', openDeleteDialog);

deleteInput?.addEventListener('input', () => {
  if (deleteBusy) return;
  deleteConfirm.disabled = deleteInput.value.trim() !== 'DELETE';
});

deleteConfirm?.addEventListener('click', deleteAccount);

dialog?.addEventListener('close', () => {
  deleteInput.value = '';
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Delete my account';
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
    window.location.replace(loginUrl());
    return;
  }

  renderUser(data.session.user);

  if (loading) loading.hidden = true;
  if (body) body.hidden = false;

  await loadPlan(data.session.user);
}

init();
