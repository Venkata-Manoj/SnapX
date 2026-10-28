import { supabase, authConfigured } from '../lib/supabase.js';
import { appUrl, authErrorMessage, safeNext } from '../lib/auth.js';

const statusEl = document.querySelector('[data-auth-status]');
const emailForm = document.querySelector('[data-email-form]');
const codeForm = document.querySelector('[data-code-form]');
const emailInput = document.querySelector('#login-email');
const sendButton = document.querySelector('[data-send-code]');
const verifyButton = document.querySelector('[data-verify-code]');
const codeEmail = document.querySelector('[data-code-email]');
const boxes = [...document.querySelectorAll('[data-code-box]')];
const resendButton = document.querySelector('[data-resend]');
const changeButton = document.querySelector('[data-change-email]');

const params = new URLSearchParams(window.location.search);
const next = safeNext(params.get('next'), appUrl('account.html'));

let pendingEmail = '';
let cooldown = null;
let secondsLeft = 0;

function setStatus(message, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', kind === 'error');
  statusEl.classList.toggle('is-ok', kind === 'ok');
}

function clearStatus() {
  setStatus('');
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.html = button.innerHTML;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.html) {
      button.innerHTML = button.dataset.html;
      delete button.dataset.html;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

function startCooldown() {
  if (!resendButton) return;
  window.clearInterval(cooldown);
  secondsLeft = 60;
  resendButton.disabled = true;
  resendButton.textContent = `Resend code in ${secondsLeft}s`;

  cooldown = window.setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      window.clearInterval(cooldown);
      resendButton.disabled = false;
      resendButton.textContent = 'Resend code';
      return;
    }
    resendButton.textContent = `Resend code in ${secondsLeft}s`;
  }, 1000);
}

function stopCooldown() {
  window.clearInterval(cooldown);
  if (resendButton) {
    resendButton.disabled = false;
    resendButton.textContent = 'Resend code';
  }
}

function showStep(step) {
  emailForm.hidden = step !== 'email';
  codeForm.hidden = step !== 'code';
  if (step === 'code') {
    boxes[0]?.focus();
  } else {
    emailInput?.focus();
  }
}

function markCodeInvalid(invalid) {
  boxes.forEach((box) => {
    if (invalid) box.setAttribute('aria-invalid', 'true');
    else box.removeAttribute('aria-invalid');
  });
}

async function sendCode(email, { resend = false } = {}) {
  if (!supabase) {
    setStatus('Sign-in is not configured on this site yet.', 'error');
    return false;
  }

  const button = resend ? resendButton : sendButton;
  setBusy(button, true, resend ? 'Sending…' : 'Sending code…');

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}${appUrl('auth/callback.html')}?next=${encodeURIComponent(next)}`,
    },
  });

  setBusy(button, false);

  if (error) {
    setStatus(authErrorMessage(error), 'error');
    if (resend) startCooldown();
    return false;
  }

  pendingEmail = email;
  if (codeEmail) codeEmail.textContent = email;
  showStep('code');
  startCooldown();
  setStatus(
    resend
      ? 'A new code is on its way. Check your inbox and spam folder.'
      : 'Code sent. Check your inbox and spam folder.',
    'ok',
  );
  return true;
}

emailForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();

  if (!isEmail(email)) {
    emailInput.setAttribute('aria-invalid', 'true');
    setStatus('Enter a valid email address, like name@example.com.', 'error');
    emailInput.focus();
    return;
  }

  emailInput.removeAttribute('aria-invalid');
  clearStatus();
  sendCode(email);
});

emailInput?.addEventListener('input', () => {
  emailInput.removeAttribute('aria-invalid');
});

codeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = boxes.map((box) => box.value).join('');

  if (token.length !== 6) {
    markCodeInvalid(true);
    setStatus('Enter all six digits from the email.', 'error');
    boxes.find((box) => !box.value)?.focus();
    return;
  }

  if (!supabase) {
    setStatus('Sign-in is not configured on this site yet.', 'error');
    return;
  }

  markCodeInvalid(false);
  setBusy(verifyButton, true, 'Verifying…');

  const { error } = await supabase.auth.verifyOtp({
    email: pendingEmail,
    token,
    type: 'email',
  });

  if (error) {
    setBusy(verifyButton, false);
    markCodeInvalid(true);
    setStatus(authErrorMessage(error), 'error');
    boxes[0]?.focus();
    return;
  }

  window.location.replace(next);
});

resendButton?.addEventListener('click', () => {
  if (!pendingEmail || secondsLeft > 0) return;
  clearStatus();
  sendCode(pendingEmail, { resend: true });
});

changeButton?.addEventListener('click', () => {
  stopCooldown();
  markCodeInvalid(false);
  boxes.forEach((box) => {
    box.value = '';
  });
  clearStatus();
  showStep('email');
});

boxes.forEach((box, index) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 1);
    box.removeAttribute('aria-invalid');

    if (box.value && index < boxes.length - 1) {
      boxes[index + 1].focus();
    }
  });

  box.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !box.value && index > 0) {
      event.preventDefault();
      boxes[index - 1].value = '';
      boxes[index - 1].focus();
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes[index - 1].focus();
    }
    if (event.key === 'ArrowRight' && index < boxes.length - 1) {
      event.preventDefault();
      boxes[index + 1].focus();
    }
  });

  box.addEventListener('paste', (event) => {
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    digits.split('').forEach((digit, offset) => {
      if (boxes[offset]) boxes[offset].value = digit;
    });
    boxes[Math.min(digits.length, boxes.length - 1)].focus();
  });
});

document.querySelectorAll('[data-provider]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!supabase) {
      setStatus('Sign-in is not configured on this site yet.', 'error');
      return;
    }

    const provider = button.dataset.provider;
    setBusy(button, true, 'Opening…');
    clearStatus();

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${appUrl('auth/callback.html')}?next=${encodeURIComponent(next)}`,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });

    if (error) {
      setBusy(button, false);
      setStatus(authErrorMessage(error), 'error');
    }
  });
});

if (!authConfigured) {
  setStatus('Sign-in is not configured on this site yet. The Free plan works without an account.', 'error');
} else if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) window.location.replace(next);
  });
}
