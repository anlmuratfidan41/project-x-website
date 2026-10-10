type RequestItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  projectType: string;
  propertyAddress: string;
  preferredMeeting: string;
  idealStart: string;
  message: string;
  status: 'new' | 'contacted' | 'scheduled' | 'in_progress' | 'declined';
  createdAt: string;
  quoteCount?: number;
  lastQuote?: {
    id: string;
    quoteNumber: string;
    total: number;
    deliveryStatus: 'sent' | 'failed' | 'not_configured';
    createdAt: string;
    createdBy: string;
    approvalStatus: 'pending' | 'approved' | 'rejected';
  } | null;
  paidTotal?: number;
  emailVerifiedAt?: string | null;
  meetingStatus?: 'scheduled' | 'postponed' | 'done' | 'cancelled';
  meetingNote?: string;
};

const statusLabels: Record<RequestItem['status'], string> = {
  new: 'New', contacted: 'Contacted', scheduled: 'Scheduled', in_progress: 'In progress', declined: 'Declined',
};

type StaffUser = { email: string; role: string };
type Material = {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  supplier: string;
  sku: string;
  stockQty: number;
  priceSource: string;
  updatedAt: string;
  imageUrl: string;
  supplierUrl?: string;
  supplierStore?: string;
  priceCheckedAt?: string | null;
};
type InventoryMovement = {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  quantityChange: number;
  note: string;
  actorEmail: string;
  createdAt: string;
};
// Dev talks to the API on :4000; a production build calls the same origin it is served from unless VITE_API_URL is set.
const apiBase = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

// Production only: send visitors' JavaScript errors to the admin Health page (each message once, at most 5 per page view).
if (!import.meta.env.DEV) {
  const reported = new Set<string>();
  const report = (message: string, stack = '') => {
    if (!message || reported.has(message) || reported.size >= 5) return;
    reported.add(message);
    void fetch(`${apiBase}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.slice(0, 500), stack: stack.slice(0, 4000), page: location.pathname.slice(0, 300) }),
      keepalive: true,
    }).catch(() => undefined);
  };
  window.addEventListener('error', (event) => report(event.message, event.error instanceof Error ? event.error.stack : `${event.filename}:${event.lineno}`));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : '');
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(data?.error ?? 'Something went wrong. Please try again.');
  return data as T;
}

function feedback(form: HTMLFormElement, message: string, isError = false): void {
  let element = form.querySelector<HTMLElement>('[data-runtime-feedback]');
  if (!element) {
    element = document.createElement('p');
    element.dataset.runtimeFeedback = 'true';
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.style.cssText = 'grid-column:1/-1;margin:0;padding:12px 14px;font-size:13px;line-height:20px;border-left:3px solid #3fb0d8;background:#10242c;color:#bdeafb';
    form.append(element);
  }
  element.textContent = message;
  element.style.borderLeftColor = isError ? '#ff9d90' : '#3fb0d8';
  element.style.color = isError ? '#ffb2a8' : '#bdeafb';
  element.setAttribute('role', isError ? 'alert' : 'status');
}

function setupContactForm(): void {
  const form = document.querySelector<HTMLFormElement>('#f-name')?.closest('form');
  if (!form) return;
  const name = form.querySelector<HTMLInputElement>('#f-name');
  const email = form.querySelector<HTMLInputElement>('#f-email');
  const phone = form.querySelector<HTMLInputElement>('#f-phone');
  const projectType = form.querySelector<HTMLSelectElement>('#f-type');
  const propertyAddress = form.querySelector<HTMLInputElement>('#f-addr');
  const preferredMeeting = form.querySelector<HTMLInputElement>('#f-date');
  const idealStart = form.querySelector<HTMLInputElement>('#f-start');
  const message = form.querySelector<HTMLTextAreaElement>('#f-msg');
  const submit = form.querySelector<HTMLButtonElement>('button');
  if (!name || !email || !phone || !projectType || !propertyAddress || !preferredMeeting || !idealStart || !message || !submit) return;

  name.required = true;
  name.minLength = 2;
  email.required = true;
  projectType.required = true;
  propertyAddress.required = true;
  propertyAddress.minLength = 5;
  message.required = true;
  message.minLength = 10;
  submit.type = 'submit';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    try {
      const result = await api<{ message: string }>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          name: name.value,
          email: email.value,
          phone: phone.value,
          projectType: projectType.value,
          propertyAddress: propertyAddress.value,
          preferredMeeting: preferredMeeting.value,
          idealStart: idealStart.value,
          message: message.value,
          smsConsent: document.querySelector<HTMLInputElement>('#px-sms-consent')?.checked ?? false,
        }),
      });
      feedback(form, result.message);
      form.reset();
    } catch (error) {
      feedback(form, error instanceof Error ? error.message : 'Could not send your request.', true);
    } finally {
      submit.disabled = false;
    }
  });
}

// Contact page opened from the confirmation email (/contact?verify=<token>): confirm the address and show the result
// in place of the form.
function setupEmailConfirmation(): void {
  const token = new URLSearchParams(location.search).get('verify');
  if (!token || location.pathname !== '/contact') return;
  const form = document.querySelector<HTMLFormElement>('#f-name')?.closest('form');
  if (!form) return;
  history.replaceState(null, '', location.pathname);

  const box = node('div', '', 'px-step-state px-step-state-pending px-confirm-card');
  box.setAttribute('role', 'status');
  const icon = node('span', '✉', 'px-step-state-icon');
  icon.setAttribute('aria-hidden', 'true');
  const title = node('h3', 'Confirming your email…');
  title.tabIndex = -1;
  const text = node('p', 'One moment.');
  const actions = node('div', '', 'px-step-state-actions');
  box.append(icon, title, text, actions);
  form.hidden = true;
  form.style.display = 'none';
  form.before(box);
  box.scrollIntoView({ block: 'center' });

  const showForm = () => {
    box.remove();
    form.hidden = false;
    form.style.display = '';
  };

  api<{ message: string; name: string; alreadyVerified: boolean }>('/api/requests/verify', { method: 'POST', body: JSON.stringify({ token }) })
    .then((result) => {
      box.className = 'px-step-state px-step-state-success px-confirm-card';
      icon.textContent = '✓';
      title.textContent = result.alreadyVerified ? 'Your email is already confirmed' : `Thanks, ${result.name} — your email is confirmed`;
      text.textContent = 'We will call you to book your site meeting, then email you a personal link to your itemized quote.';
      const work = node('a', 'SEE OUR WORK →', 'px-step-state-primary');
      work.href = '/';
      actions.append(work);
    })
    .catch((error) => {
      box.className = 'px-step-state px-step-state-error px-confirm-card';
      box.setAttribute('role', 'alert');
      icon.textContent = '!';
      title.textContent = 'We could not confirm this link';
      text.textContent = error instanceof Error ? error.message : 'The link is invalid or has expired.';
      const retry = node('button', 'SEND A NEW REQUEST', 'px-step-state-primary');
      retry.type = 'button';
      retry.addEventListener('click', showForm);
      actions.append(retry);
    })
    .finally(() => title.focus());
}


function setupCareersForm(): void {
  const form = document.querySelector<HTMLFormElement>('#c-name')?.closest('form');
  if (!form) return;
  const name = form.querySelector<HTMLInputElement>('#c-name')!;
  const email = form.querySelector<HTMLInputElement>('#c-email')!;
  const phone = form.querySelector<HTMLInputElement>('#c-phone')!;
  const position = form.querySelector<HTMLSelectElement>('#c-role')!;
  const resume = form.querySelector<HTMLInputElement>('#c-cv')!;
  const message = form.querySelector<HTMLTextAreaElement>('#c-msg')!;
  const submit = form.querySelector<HTMLButtonElement>('button')!;
  name.required = true; name.minLength = 2; name.maxLength = 120; name.autocomplete = 'name';
  email.required = true; email.autocomplete = 'email';
  phone.maxLength = 40; phone.autocomplete = 'tel';
  message.maxLength = 4000;
  resume.accept = 'application/pdf,.pdf';
  submit.type = 'submit';

  // Each APPLY link preselects its own position before jumping to the form.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('li a[href="#apply"]')) {
    const role = link.closest('li')?.querySelector('span span')?.textContent?.trim();
    if (!role) continue;
    link.setAttribute('aria-label', `Apply for ${role}`);
    link.addEventListener('click', () => {
      if ([...position.options].some((option) => option.value === role)) position.value = role;
      window.setTimeout(() => name.focus({ preventScroll: true }), 400);
    });
  }

  const readResume = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The resume could not be read.'));
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const file = resume.files?.[0];
    if (file && (file.size > 5 * 1024 * 1024 || !/\.pdf$/i.test(file.name))) {
      feedback(form, 'Please attach your resume as a PDF of 5 MB or less.', true);
      return;
    }
    submit.disabled = true;
    feedback(form, 'Sending your application…');
    try {
      const result = await api<{ message: string }>('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          name: name.value, email: email.value, phone: phone.value, position: position.value, message: message.value,
          ...(file ? { resume: { name: file.name, data: await readResume(file) } } : {}),
        }),
      });
      feedback(form, result.message);
      form.reset();
    } catch (error) {
      feedback(form, error instanceof Error ? error.message : 'Your application could not be sent.', true);
    } finally {
      submit.disabled = false;
    }
  });
}

function setupLoginPage(): void {
  const form = document.querySelector<HTMLFormElement>('#l-email')?.closest('form');
  if (!form) return;
  const email = form.querySelector<HTMLInputElement>('#l-email');
  const password = form.querySelector<HTMLInputElement>('#l-pass');
  const submit = [...form.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent?.trim() === 'SIGN IN');
  if (!email || !password || !submit) return;

  email.required = true;
  password.required = true;
  submit.href = '#sign-in';
  submit.setAttribute('role', 'button');
  submit.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!email.reportValidity() || !password.reportValidity()) return;
    submit.style.pointerEvents = 'none';
    try {
      await api<{ user: StaffUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      location.assign('/admin/dashboard');
    } catch (error) {
      feedback(form, error instanceof Error ? error.message : 'Could not sign in.', true);
    } finally {
      submit.style.pointerEvents = '';
    }
  });

  api<{ user: StaffUser | null }>('/api/auth/me').then(({ user }) => {
    if (user) location.replace('/admin/dashboard');
  }).catch(() => undefined);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderRequestDetail(container: HTMLElement, request: RequestItem, onChanged: () => Promise<void>): void {
  container.replaceChildren();
  const panel = node('div', '', 'px-request-detail');
  const heading = node('div', '', 'px-request-heading');
  const title = node('h2', request.name);
  title.style.cssText = 'margin:0;font-size:22px;font-weight:800';
  const received = node('p', `Received ${new Date(`${request.createdAt.replace(' ', 'T')}Z`).toLocaleString()}`);
  received.style.cssText = 'margin:4px 0 0;font-size:12px;color:#71858b';
  const headingText = node('div', '');
  headingText.append(title, received);
  const status = node('span', statusLabels[request.status].toUpperCase(), `px-request-status px-status-${request.status}`);
  heading.append(headingText, status);

  const fields = node('div', '', 'px-request-fields');
  const values: Array<[string, string]> = [
    ['EMAIL', request.email], ['PHONE', request.phone || 'Not provided'], ['PROJECT TYPE', request.projectType],
    ['PROJECT ADDRESS', request.propertyAddress], ['PREFERRED SITE MEETING', request.preferredMeeting ? formatMeeting(request.preferredMeeting) : 'Not provided'],
    ['IDEAL START', request.idealStart || 'Not provided'], ['CUSTOMER MESSAGE', request.message],
  ];
  for (const [label, value] of values) {
    const field = node('div', '', 'px-request-field');
    field.append(node('span', label));
    if (label === 'EMAIL') {
      const link = node('a', value);
      link.href = `mailto:${request.email}`;
      field.append(link);
    } else if (label === 'PHONE' && request.phone) {
      const link = node('a', value);
      link.href = `tel:${request.phone}`;
      field.append(link);
    } else {
      field.append(node('span', value));
    }
    fields.append(field);
  }

  const openQuote = () => void openQuoteDialog(request, () => void onChanged());
  const notices: HTMLElement[] = [];
  if (!request.emailVerifiedAt) {
    const notice = node('div', '', 'px-quote-pending-notice');
    notice.setAttribute('role', 'status');
    const text = node('p', '');
    text.append(node('strong', 'Email not confirmed yet'), document.createTextNode(` · ${request.email} has not opened the confirmation link. It may be a typo or spam.`));
    notice.append(text);
    notices.push(notice);
  }
  if (awaitingQuote(request)) {
    const notice = node('div', '', 'px-quote-pending-notice');
    notice.setAttribute('role', 'status');
    const text = node('p', '');
    text.append(node('strong', 'Awaiting price quote'), document.createTextNode(' · No quote has been sent to this customer yet.'));
    const noticeAction = node('button', 'Create quote →', 'px-link-action');
    noticeAction.type = 'button';
    noticeAction.addEventListener('click', openQuote);
    notice.append(text, noticeAction);
    notices.push(notice);
  } else if (request.lastQuote) {
    const quote = request.lastQuote;
    const sent = quote.deliveryStatus === 'sent';
    const notice = node('div', '', `px-quote-sent-notice${sent ? '' : ' unsent'}`);
    notice.setAttribute('role', 'status');
    const text = node('p', '');
    const when = new Date(`${quote.createdAt.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    text.append(
      node('strong', sent ? `Quote sent to ${request.email}` : 'Quote saved — the email was not delivered'),
      node('span', `${quote.quoteNumber} · ${when} · by ${quote.createdBy}${request.quoteCount! > 1 ? ` · ${request.quoteCount} quotes in total` : ''}`),
    );
    notice.append(text, node('strong', usd.format(quote.total), 'px-quote-sent-total'));
    notices.push(notice, renderQuoteMoney(container, request, onChanged));
  }

  const actions = node('div', '', 'px-request-actions');
  const quoteButton = node('button', request.quoteCount ? 'New quote' : 'Create quote', 'px-primary-action');
  quoteButton.type = 'button';
  quoteButton.addEventListener('click', openQuote);
  const materialButton = node('button', 'Request materials', 'px-link-action');
  materialButton.type = 'button';
  materialButton.addEventListener('click', () => openMaterialFollowup(request));
  const statusLabel = node('label', '', 'px-request-status-control');
  const statusSelect = document.createElement('select');
  for (const value of Object.keys(statusLabels) as Array<RequestItem['status']>) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = statusLabels[value];
    statusSelect.append(option);
  }
  statusSelect.value = request.status;
  statusSelect.addEventListener('change', async () => {
    statusSelect.disabled = true;
    try {
      await api(`/api/admin/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) });
      await onChanged();
    } catch (error) {
      statusSelect.value = request.status;
      statusSelect.disabled = false;
      const message = error instanceof Error ? error.message : 'Could not update request.';
      let alert = container.querySelector<HTMLElement>('[data-runtime-error]');
      if (!alert) {
        alert = node('p', '', 'px-request-error');
        alert.dataset.runtimeError = 'true';
        container.prepend(alert);
      }
      alert.textContent = message;
    }
  });
  statusLabel.append(node('span', 'Status'), statusSelect);
  actions.append(quoteButton, materialButton, statusLabel);
  panel.append(heading, ...notices, fields, actions);
  container.append(panel);
}

const approvalLabels = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' } as const;

// Approval state of the latest quote plus payments received for the project.
function renderQuoteMoney(container: HTMLElement, request: RequestItem, onChanged: () => Promise<void>): HTMLElement {
  const quote = request.lastQuote!;
  const paid = request.paidTotal ?? 0;
  const box = node('div', '', 'px-quote-money');
  const showError = (error: unknown) => {
    let alert = container.querySelector<HTMLElement>('[data-runtime-error]');
    if (!alert) {
      alert = node('p', '', 'px-request-error');
      alert.dataset.runtimeError = 'true';
      container.prepend(alert);
    }
    alert.textContent = error instanceof Error ? error.message : 'Could not update the quote.';
  };

  const approvalRow = node('div', '', 'px-quote-money-row');
  approvalRow.append(node('span', 'Customer approval'), node('strong', approvalLabels[quote.approvalStatus], `px-approval px-approval-${quote.approvalStatus}`));
  const approvalActions = node('span', '', 'px-quote-money-actions');
  const choices = quote.approvalStatus === 'pending'
    ? [['Mark approved', 'approved'], ['Mark rejected', 'rejected']] as const
    : [['Reset to awaiting approval', 'pending']] as const;
  for (const [label, approvalStatus] of choices) {
    const button = node('button', label, 'px-link-action');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/admin/quotes/${quote.id}/approval`, { method: 'PATCH', body: JSON.stringify({ approvalStatus }) });
        await onChanged();
      } catch (error) {
        button.disabled = false;
        showError(error);
      }
    });
    approvalActions.append(button);
  }
  approvalRow.append(approvalActions);
  box.append(approvalRow);

  if (quote.approvalStatus === 'approved' || paid > 0) {
    const remaining = Math.max(0, Math.round((quote.total - paid) * 100) / 100);
    const paymentRow = node('div', '', 'px-quote-money-row');
    paymentRow.append(
      node('span', 'Received'),
      node('strong', `${usd.format(paid)} of ${usd.format(quote.total)}`),
      node('span', remaining > 0 ? `${usd.format(remaining)} left to collect` : 'Paid in full', remaining > 0 ? 'px-quote-money-remaining' : 'px-quote-money-paid'),
    );
    box.append(paymentRow);

    const form = document.createElement('form');
    form.className = 'px-payment-form';
    const kind = selectField('kind', [['payment', 'Payment received'], ['refund', 'Refund to customer']], 'payment');
    kind.setAttribute('aria-label', 'Entry type');
    const amount = document.createElement('input');
    amount.type = 'number'; amount.min = '0.01'; amount.step = '0.01'; amount.required = true;
    amount.placeholder = remaining > 0 ? remaining.toFixed(2) : 'Amount';
    amount.setAttribute('aria-label', 'Amount USD');
    const note = document.createElement('input');
    note.maxLength = 300; note.placeholder = 'Note, e.g. 30% deposit, check #1042';
    note.setAttribute('aria-label', 'Payment note');
    const save = node('button', 'Record', 'px-link-action');
    save.type = 'submit';
    form.append(kind, amount, note, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await api(`/api/admin/requests/${request.id}/payments`, {
          method: 'POST', body: JSON.stringify({ kind: kind.value, amount: Number(amount.value), note: note.value }),
        });
        await onChanged();
      } catch (error) {
        save.disabled = false;
        showError(error);
      }
    });
    box.append(form);
  }
  const history = node('div', '', 'px-payment-history');
  box.append(history);
  void loadPaymentHistory(history, request.id, onChanged, showError);
  return box;
}

type PaymentEntry = {
  id: string;
  kind: 'payment' | 'refund';
  amount: number;
  note: string;
  recordedBy: string;
  receivedAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  customerName?: string;
};

// One ledger line; voided entries stay visible (struck through) with who voided them and why.
function paymentEntryRow(entry: PaymentEntry, onVoid: (reason: string) => Promise<void>, label?: string): HTMLElement {
  const row = node('div', '', `px-ledger-row${entry.voidedAt ? ' voided' : ''}`);
  const sign = entry.kind === 'refund' ? '−' : '+';
  const amount = node('strong', `${sign}${usd.format(entry.amount)}`, `px-ledger-amount ${entry.kind}`);
  const details = node('div', '', 'px-ledger-details');
  details.append(node('strong', label ?? (entry.kind === 'refund' ? 'Refund' : 'Payment')));
  if (entry.note) details.append(node('span', entry.note));
  details.append(node('small', `${new Date(`${entry.receivedAt.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${entry.recordedBy}`));
  if (entry.voidedAt) {
    details.append(node('small', `Voided by ${entry.voidedBy} on ${new Date(`${entry.voidedAt.replace(' ', 'T')}Z`).toLocaleDateString()}: ${entry.voidReason}`, 'px-ledger-void-note'));
  }
  row.append(amount, details);
  if (!entry.voidedAt) row.append(voidControl(onVoid));
  return row;
}

function voidControl(onVoid: (reason: string) => Promise<void>): HTMLElement {
  const wrap = node('div', '', 'px-void-control');
  const start = node('button', 'Void', 'px-row-action danger');
  start.type = 'button';
  start.addEventListener('click', () => {
    const form = document.createElement('form');
    form.className = 'px-void-form';
    const reason = document.createElement('input');
    reason.required = true; reason.minLength = 3; reason.maxLength = 300; reason.placeholder = 'Reason, e.g. entered twice';
    reason.setAttribute('aria-label', 'Reason for voiding');
    const confirm = node('button', 'Confirm void', 'px-row-action danger solid');
    confirm.type = 'submit';
    const cancel = node('button', 'Cancel', 'px-row-action');
    cancel.type = 'button';
    cancel.addEventListener('click', () => wrap.replaceChildren(start));
    form.append(reason, confirm, cancel);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      confirm.disabled = true;
      try { await onVoid(reason.value); } finally { confirm.disabled = false; }
    });
    wrap.replaceChildren(form);
    reason.focus();
  });
  wrap.append(start);
  return wrap;
}

async function loadPaymentHistory(container: HTMLElement, requestId: string, onChanged: () => Promise<void>, showError: (error: unknown) => void): Promise<void> {
  try {
    const { payments } = await api<{ payments: PaymentEntry[]; netPaid: number }>(`/api/admin/requests/${requestId}/payments`);
    container.replaceChildren();
    if (!payments.length) return;
    container.append(node('p', 'Payment history', 'px-payment-history-title'));
    for (const entry of payments) {
      container.append(paymentEntryRow(entry, async (reason) => {
        try {
          await api(`/api/admin/payments/${entry.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
          await onChanged();
        } catch (error) {
          showError(error);
        }
      }));
    }
  } catch (error) {
    showError(error);
  }
}

function awaitingQuote(request: RequestItem): boolean {
  return !request.quoteCount && request.status !== 'declined';
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Short status of the most recent quote, e.g. "Quote sent · $2,540.00 · Oct 1".
function lastQuoteSummary(request: RequestItem): { label: string; sent: boolean } | null {
  const quote = request.lastQuote;
  if (!quote) return null;
  const sent = quote.deliveryStatus === 'sent';
  const date = new Date(`${quote.createdAt.replace(' ', 'T')}Z`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const state = quote.approvalStatus === 'approved' ? 'Quote approved'
    : quote.approvalStatus === 'rejected' ? 'Quote rejected'
      : sent ? 'Quote sent' : 'Quote saved, email not sent';
  return { label: `${state} · ${usd.format(quote.total)} · ${date}`, sent: sent || quote.approvalStatus === 'approved' };
}

function formatMeeting(value: string): string {
  const parsed = parseMeetingDate(value);
  if (!parsed) return value;
  return parsed.hasTime
    ? parsed.date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : parsed.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

type MaterialFollowup = {
  id: string;
  items: Array<{ name: string; quantity: number; unit: string }>;
  message: string;
  deliveryStatus: 'sent' | 'failed' | 'not_configured';
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
};

function openMaterialFollowup(request: RequestItem): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'px-followup-dialog';
  const heading = node('div', '', 'px-followup-heading');
  const titleBlock = node('div', '', '');
  titleBlock.append(node('p', 'CUSTOMER FOLLOW-UP'), node('h2', 'Request project materials'));
  const close = node('button', 'Close');
  close.type = 'button'; close.className = 'px-dialog-close';
  close.setAttribute('aria-label', 'Close material request window');
  close.addEventListener('click', () => dialog.close());
  heading.append(titleBlock, close);

  const recipient = node('p', '', 'px-followup-recipient');
  recipient.append(node('strong', request.name), document.createTextNode(` · ${request.email}`));
  const form = document.createElement('form');
  form.className = 'px-followup-form';
  const itemHeading = node('div', '', 'px-followup-section-heading');
  itemHeading.append(node('strong', 'Materials needed'));
  const addItem = node('button', '+ Add material');
  addItem.type = 'button'; addItem.className = 'px-add-item';
  itemHeading.append(addItem);
  const rows = node('div', '', 'px-followup-items');

  function addRow(): void {
    if (rows.children.length >= 20) return;
    const row = node('div', '', 'px-followup-item-row');
    const name = document.createElement('input');
    name.name = 'materialName'; name.required = true; name.minLength = 2; name.maxLength = 180; name.placeholder = 'Material or information';
    name.setAttribute('aria-label', 'Material name');
    const quantity = document.createElement('input');
    quantity.name = 'materialQuantity'; quantity.required = true; quantity.type = 'number'; quantity.min = '0.01'; quantity.step = '0.01'; quantity.placeholder = 'Qty';
    quantity.setAttribute('aria-label', 'Material quantity');
    const unit = document.createElement('input');
    unit.name = 'materialUnit'; unit.required = true; unit.maxLength = 40; unit.placeholder = 'Unit';
    unit.setAttribute('aria-label', 'Material unit');
    const remove = node('button', '×');
    remove.type = 'button'; remove.className = 'px-remove-item'; remove.setAttribute('aria-label', 'Remove material');
    remove.addEventListener('click', () => { if (rows.children.length > 1) row.remove(); });
    row.append(name, quantity, unit, remove);
    rows.append(row);
  }
  addItem.addEventListener('click', addRow);
  addRow();

  const messageLabel = node('label', '', 'px-followup-message-label');
  messageLabel.append(node('span', 'Message to customer (optional)'));
  const message = document.createElement('textarea');
  message.name = 'message'; message.rows = 3; message.maxLength = 2000;
  message.placeholder = 'Add a short explanation or instructions';
  messageLabel.append(message);
  const feedbackLine = node('p', '', 'px-followup-feedback');
  feedbackLine.setAttribute('aria-live', 'polite');
  const submit = node('button', 'Save and email customer');
  submit.type = 'submit'; submit.className = 'px-save-button';
  form.append(itemHeading, rows, messageLabel, feedbackLine, submit);

  const historyPanel = node('section', '', 'px-followup-history');
  historyPanel.append(node('h3', 'Previous material requests'));
  const history = node('div', '', 'px-followup-history-list');
  historyPanel.append(history);
  dialog.append(heading, recipient, form, historyPanel);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.showModal();

  async function loadHistory(): Promise<void> {
    try {
      const result = await api<{ followups: MaterialFollowup[] }>(`/api/admin/requests/${request.id}/material-followups`);
      history.replaceChildren();
      if (!result.followups.length) {
        history.append(node('p', 'No material requests sent yet.', 'px-empty'));
        return;
      }
      for (const followup of result.followups) {
        const entry = node('article', '', 'px-followup-history-entry');
        const statusLabel = followup.deliveryStatus === 'sent' ? 'Email sent' : followup.deliveryStatus === 'failed' ? 'Email failed' : 'Email not configured';
        entry.append(node('div', '', 'px-followup-history-top'));
        const top = entry.firstElementChild!;
        top.append(node('strong', new Date(`${followup.createdAt.replace(' ', 'T')}Z`).toLocaleString()), node('span', statusLabel, `px-delivery-status ${followup.deliveryStatus}`));
        const list = document.createElement('ul');
        for (const item of followup.items) list.append(node('li', `${item.name} — ${item.quantity} ${item.unit}`));
        entry.append(list);
        if (followup.message) entry.append(node('p', followup.message));
        entry.append(node('small', `Created by ${followup.createdBy}`));
        history.append(entry);
      }
    } catch (error) {
      history.replaceChildren(node('p', error instanceof Error ? error.message : 'Could not load previous requests.', 'px-request-error'));
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    feedbackLine.textContent = 'Saving request…';
    try {
      const itemRows = [...rows.querySelectorAll<HTMLElement>('.px-followup-item-row')];
      const items = itemRows.map((row) => ({
        name: row.querySelector<HTMLInputElement>('[name="materialName"]')!.value,
        quantity: Number(row.querySelector<HTMLInputElement>('[name="materialQuantity"]')!.value),
        unit: row.querySelector<HTMLInputElement>('[name="materialUnit"]')!.value,
      }));
      const result = await api<{ message: string; deliveryStatus: string }>(`/api/admin/requests/${request.id}/material-followups`, {
        method: 'POST',
        body: JSON.stringify({ items, message: message.value }),
      });
      feedbackLine.textContent = result.message;
      feedbackLine.className = `px-followup-feedback ${result.deliveryStatus === 'sent' ? 'sent' : 'unsent'}`;
      form.reset();
      rows.replaceChildren();
      addRow();
      await loadHistory();
    } catch (error) {
      feedbackLine.textContent = error instanceof Error ? error.message : 'Could not save material request.';
      feedbackLine.className = 'px-followup-feedback unsent';
    } finally {
      submit.disabled = false;
    }
  });
  void loadHistory();
}

type QuoteRecord = {
  id: string;
  quoteNumber: string;
  publicToken?: string;
  lines: Array<{ type: 'material' | 'labor' | 'other'; description: string; quantity: number; unit: string; unitCost: number; unitPrice: number; lineCost: number; lineTotal: number; imageUrl?: string }>;
  materialSubtotal: number;
  laborSubtotal: number;
  otherSubtotal: number;
  costSubtotal: number;
  marginPercent: number;
  grossProfit: number;
  grossMarginPercent: number;
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  note: string;
  deliveryStatus: 'sent' | 'failed' | 'not_configured';
  createdBy: string;
  createdAt: string;
};

type QuoteLineType = 'material' | 'labor' | 'other';

async function openQuoteDialog(request: RequestItem, onClose?: () => void): Promise<void> {
  const existingDialog = document.querySelector<HTMLDialogElement>('.px-quote-dialog[open]');
  if (existingDialog) {
    existingDialog.focus();
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'px-followup-dialog px-quote-dialog';
  const heading = node('div', '', 'px-followup-heading');
  const headingText = node('div', '', '');
  headingText.append(node('p', 'PROJECT ESTIMATE'), node('h2', 'Build a customer quote'));
  const close = node('button', 'Close');
  close.type = 'button'; close.className = 'px-dialog-close'; close.setAttribute('aria-label', 'Close quote window');
  close.addEventListener('click', () => dialog.close());
  heading.append(headingText, close);

  const recipient = node('p', '', 'px-followup-recipient');
  recipient.append(node('strong', request.name), document.createTextNode(` · ${request.projectType} · ${request.propertyAddress}`));
  const form = document.createElement('form');
  form.className = 'px-followup-form px-quote-form';
  const lines = node('div', '', 'px-quote-lines');
  const groups = {} as Record<QuoteLineType, HTMLElement>;
  for (const [type, title, hint, buttonLabel, empty] of [
    ['material', 'Materials', 'Catalog items or custom materials', '+ Add material', 'No materials added.'],
    ['labor', 'Labor', 'Crew size × hours × hourly cost', '+ Add labor', 'No labor added yet.'],
    ['other', 'Fees', 'Flat amounts such as delivery, permits, or disposal', '+ Add fee', 'No fees added.'],
  ] as const) {
    const group = node('section', '', `px-quote-group px-quote-group-${type}`);
    const groupHeading = node('div', '', 'px-quote-group-heading');
    const groupTitle = node('div', '');
    groupTitle.append(node('strong', title), node('small', hint));
    const addButton = node('button', buttonLabel, 'px-add-item');
    addButton.type = 'button';
    addButton.addEventListener('click', () => addQuoteLine(type));
    groupHeading.append(groupTitle, addButton);
    const groupLines = node('div', '', 'px-quote-group-lines');
    groupLines.dataset.empty = empty;
    group.append(groupHeading, groupLines);
    groups[type] = groupLines;
    lines.append(group);
  }

  const totals = node('section', '', 'px-quote-totals');
  const noteLabel = node('label', '', 'px-followup-message-label');
  noteLabel.append(node('span', 'Quote note / scope notes'));
  const noteInput = document.createElement('textarea');
  noteInput.name = 'note'; noteInput.rows = 2; noteInput.maxLength = 2000;
  noteInput.placeholder = 'Describe assumptions, exclusions, or scope';
  noteLabel.append(noteInput);
  const status = node('p', '', 'px-followup-feedback');
  status.setAttribute('aria-live', 'polite');
  const save = node('button', 'Preview email');
  save.type = 'submit'; save.className = 'px-save-button';
  form.append(lines, totals, noteLabel, status, save);
  const historyPanel = node('section', '', 'px-followup-history');
  historyPanel.append(node('h3', 'Previous quotes'));
  const history = node('div', '', 'px-followup-history-list');
  historyPanel.append(history);
  dialog.append(heading, recipient, form, historyPanel);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); }, { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.showModal();

  let catalog: Material[] = [];
  let lineId = 0;

  function updateTotals(): void {
    const summary = new Map<string, number>([['material', 0], ['labor', 0], ['other', 0]]);
    let costSubtotal = 0;
    const marginPercent = Number(form.querySelector<HTMLInputElement>('[name="marginPercent"]')?.value) || 0;
    const marginFactor = 1 - marginPercent / 100;
    for (const row of lines.querySelectorAll<HTMLElement>('.px-quote-line')) {
      const type = row.dataset.type!;
      const quantity = Number(row.querySelector<HTMLInputElement>('[name="quantity"]')!.value) || 0;
      const unitCost = Number(row.querySelector<HTMLInputElement>('[name="unitCost"]')!.value) || 0;
      const price = marginFactor > 0 ? Math.round((unitCost / marginFactor) * 100) / 100 : 0;
      row.querySelector<HTMLInputElement>('[name="unitPrice"]')!.value = price.toFixed(2);
      const lineCost = Math.round(quantity * unitCost * 100) / 100;
      const amount = Math.round(quantity * price * 100) / 100;
      costSubtotal += lineCost;
      row.querySelector<HTMLElement>('.px-quote-line-total')!.textContent = `$${amount.toFixed(2)}`;
      summary.set(type, (summary.get(type) ?? 0) + amount);
    }
    const materialSubtotal = summary.get('material') ?? 0;
    const laborSubtotal = summary.get('labor') ?? 0;
    const otherSubtotal = summary.get('other') ?? 0;
    const subtotal = materialSubtotal + laborSubtotal + otherSubtotal;
    const grossProfit = Math.round((subtotal - costSubtotal) * 100) / 100;
    const grossMarginPercent = subtotal > 0 ? Math.round((grossProfit / subtotal) * 10000) / 100 : 0;
    const taxPercent = Number(form.querySelector<HTMLInputElement>('[name="taxPercent"]')?.value) || 0;
    const taxAmount = Math.round(subtotal * taxPercent) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    totals.replaceChildren();
    totals.append(node('h3', 'Price summary'));
    for (const [label, value] of [
      ['Materials', materialSubtotal], ['Labor', laborSubtotal], ['Other fees', otherSubtotal],
      ['Subtotal', subtotal], [`Tax (${taxPercent.toFixed(2)}%)`, taxAmount], ['QUOTE TOTAL', total],
    ] as const) {
      const isProfit = label.startsWith('Gross');
      const row = node('div', '', label === 'QUOTE TOTAL' ? 'px-quote-total-final' : isProfit ? 'px-quote-total-row px-quote-profit-row' : 'px-quote-total-row');
      row.append(node('span', label), node('strong', `$${value.toFixed(2)}`));
      totals.append(row);
    }
    const costInfo = node('div', '', 'px-quote-cost-info');
    costInfo.append(node('span', `Estimated cost $${costSubtotal.toFixed(2)}`), node('span', `Gross profit $${grossProfit.toFixed(2)} · ${grossMarginPercent.toFixed(1)}% margin`));
    totals.append(costInfo);
  }

  // Shared pieces for every line type; each type lays them out differently.
  function lineBasics(type: QuoteLineType, placeholder: string) {
    const row = node('div', '', `px-quote-line px-quote-line-${type}`);
    row.dataset.lineId = String(++lineId);
    row.dataset.type = type;
    const description = document.createElement('input');
    description.name = 'description'; description.required = true; description.minLength = 2; description.maxLength = 180;
    description.placeholder = placeholder;
    description.setAttribute('aria-label', 'Quote line description');
    const unitCost = document.createElement('input');
    unitCost.name = 'unitCost'; unitCost.type = 'number'; unitCost.min = '0'; unitCost.step = '0.01'; unitCost.value = '0'; unitCost.required = true;
    const unitPrice = document.createElement('input');
    unitPrice.name = 'unitPrice'; unitPrice.type = 'number'; unitPrice.readOnly = true; unitPrice.tabIndex = -1; unitPrice.value = '0.00';
    unitPrice.title = 'Calculated using the target gross margin';
    const amount = node('strong', '$0.00', 'px-quote-line-total');
    const amountField = node('div', '', 'px-quote-line-field px-quote-amount-field');
    amountField.append(node('span', 'Line total'), amount);
    const remove = node('button', '×'); remove.type = 'button'; remove.className = 'px-remove-item'; remove.setAttribute('aria-label', 'Remove quote line');
    remove.addEventListener('click', () => { row.remove(); updateTotals(); });
    for (const input of [description, unitCost]) input.addEventListener('input', updateTotals);
    return { row, description, unitCost, unitPrice, amountField, remove };
  }

  function hiddenInput(name: string, value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    return input;
  }

  function addQuoteLine(type: QuoteLineType): void {
    if (type === 'labor') addLaborLine();
    else if (type === 'other') addFeeLine();
    else addMaterialLine();
    updateTotals();
  }

  function addLaborLine(): void {
    const { row, description, unitCost, unitPrice, amountField, remove } = lineBasics('labor', 'Trade or task, e.g. Drywall installation');
    const crew = document.createElement('input');
    crew.name = 'crew'; crew.type = 'number'; crew.min = '1'; crew.step = '1'; crew.value = '1'; crew.required = true;
    const hours = document.createElement('input');
    hours.name = 'hours'; hours.type = 'number'; hours.min = '0.25'; hours.step = '0.25'; hours.value = '8'; hours.required = true;
    const quantity = hiddenInput('quantity', '8');
    const syncHours = () => {
      quantity.value = String(Math.round((Number(crew.value) || 0) * (Number(hours.value) || 0) * 100) / 100);
      updateTotals();
    };
    crew.addEventListener('input', syncHours);
    hours.addEventListener('input', syncHours);
    unitPrice.setAttribute('aria-label', 'Customer hourly rate USD');
    const fields = node('div', '', 'px-quote-labor-fields');
    fields.append(
      formField('Task', description, 'px-quote-line-field px-quote-task-field'),
      formField('Crew', crew, 'px-quote-line-field'),
      formField('Hours each', hours, 'px-quote-line-field'),
      formField('Cost / hour', unitCost, 'px-quote-line-field'),
      formField('Rate / hour', unitPrice, 'px-quote-line-field'),
      amountField, remove,
    );
    row.append(fields, quantity, hiddenInput('unit', 'hour'));
    groups.labor.append(row);
  }

  function addFeeLine(): void {
    const { row, description, unitCost, unitPrice, amountField, remove } = lineBasics('other', 'e.g. Delivery, permit, debris disposal');
    unitPrice.setAttribute('aria-label', 'Customer fee price USD');
    const fields = node('div', '', 'px-quote-fee-fields');
    fields.append(
      formField('Fee', description, 'px-quote-line-field px-quote-task-field'),
      formField('Our cost', unitCost, 'px-quote-line-field'),
      formField('Customer price', unitPrice, 'px-quote-line-field'),
      amountField, remove,
    );
    row.append(fields, hiddenInput('quantity', '1'), hiddenInput('unit', 'each'));
    groups.other.append(row);
  }

  function addMaterialLine(): void {
    const { row, description, unitCost, unitPrice, amountField, remove } = lineBasics('material', 'Material description');
    unitCost.placeholder = 'Cost'; unitCost.setAttribute('aria-label', 'Unit cost USD');
    unitPrice.setAttribute('aria-label', 'Customer unit price USD');
    const catalogSelect = document.createElement('select');
    catalogSelect.className = 'px-quote-catalog-select'; catalogSelect.setAttribute('aria-label', 'Select from material catalog');
    const customOption = document.createElement('option'); customOption.value = ''; customOption.textContent = 'Catalog item (optional)'; catalogSelect.append(customOption);
    for (const item of catalog) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · $${item.unitPrice.toFixed(2)}/${item.unit}`; catalogSelect.append(option);
    }
    catalogSelect.hidden = catalog.length === 0;
    const thumbnail = document.createElement('img');
    thumbnail.className = 'px-quote-thumb';
    thumbnail.src = '/assets/interior.jpg';
    thumbnail.alt = '';
    const quantity = document.createElement('input');
    quantity.name = 'quantity'; quantity.type = 'number'; quantity.min = '0.01'; quantity.step = '0.01'; quantity.value = '1'; quantity.required = true;
    quantity.setAttribute('aria-label', 'Quantity');
    const unit = document.createElement('input');
    unit.name = 'unit'; unit.required = true; unit.maxLength = 40;
    unit.placeholder = 'Unit'; unit.setAttribute('aria-label', 'Unit');
    catalogSelect.addEventListener('change', () => {
      const item = catalog.find((entry) => entry.id === catalogSelect.value);
      if (!item) return;
      description.value = item.name;
      unit.value = item.unit;
      unitCost.value = item.unitPrice.toFixed(2);
      thumbnail.src = item.imageUrl;
      updateTotals();
    });
    for (const input of [quantity, unit]) input.addEventListener('input', updateTotals);
    const header = node('div', '', 'px-quote-line-header');
    const productDetails = node('div', '', 'px-quote-product-details');
    productDetails.append(thumbnail, description);
    header.append(productDetails, remove, catalogSelect);
    const quantityField = formField('Quantity', quantity, 'px-quote-line-field');
    const unitField = formField('Unit', unit, 'px-quote-line-field');
    const costField = formField('Unit cost', unitCost, 'px-quote-line-field');
    const priceField = formField('Customer unit price', unitPrice, 'px-quote-line-field');
    const fields = node('div', '', 'px-quote-line-fields');
    fields.append(quantityField, unitField, costField, priceField, amountField);
    row.append(header, fields);
    groups.material.append(row);
  }
  const marginLabel = node('label', '', 'px-quote-tax-label');
  marginLabel.append(node('span', 'Target gross margin (%)'));
  const marginInput = document.createElement('input'); marginInput.name = 'marginPercent'; marginInput.type = 'number'; marginInput.min = '0'; marginInput.max = '80'; marginInput.step = '0.1'; marginInput.value = '25';
  marginInput.setAttribute('aria-label', 'Target gross margin percent');
  marginInput.addEventListener('input', updateTotals);
  form.insertBefore(marginLabel, noteLabel);
  marginLabel.append(marginInput);
  const taxLabel = node('label', '', 'px-quote-tax-label');
  taxLabel.append(node('span', 'Tax rate (%)'));
  const taxInput = document.createElement('input'); taxInput.name = 'taxPercent'; taxInput.type = 'number'; taxInput.min = '0'; taxInput.max = '20'; taxInput.step = '0.01'; taxInput.value = '0';
  taxInput.setAttribute('aria-label', 'Tax rate percent');
  taxInput.addEventListener('input', updateTotals);
  form.insertBefore(taxLabel, noteLabel);
  taxLabel.append(taxInput);

  try {
    const [materialsResult, quotesResult] = await Promise.all([
      api<{ materials: Material[] }>('/api/admin/materials'),
      api<{ quotes: QuoteRecord[] }>(`/api/admin/requests/${request.id}/quotes`),
    ]);
    catalog = materialsResult.materials;
    addQuoteLine('material');
    renderQuoteHistory(history, quotesResult.quotes);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load quote details.';
    status.className = 'px-followup-feedback unsent';
  }

  // Pre-send review: mirrors the customer email so staff can check it and sign it before anything is sent.
  const senderStorageKey = 'px-quote-sender-name';
  const preview = node('section', '', 'px-quote-preview');
  preview.hidden = true;
  dialog.insertBefore(preview, historyPanel);

  function showEditor(): void {
    preview.hidden = true;
    form.hidden = false;
    historyPanel.hidden = false;
    headingText.querySelector('h2')!.textContent = 'Build a customer quote';
  }

  function showPreview(): void {
    const money = (value: number) => `$${value.toFixed(2)}`;
    const typeNames: Record<string, string> = { material: 'Material', labor: 'Labor', other: 'Fee' };
    const rows = [...lines.querySelectorAll<HTMLElement>('.px-quote-line')].map((row) => {
      const quantity = Number(row.querySelector<HTMLInputElement>('[name="quantity"]')!.value) || 0;
      const unitPrice = Number(row.querySelector<HTMLInputElement>('[name="unitPrice"]')!.value) || 0;
      return {
        type: row.dataset.type!, quantity, unitPrice,
        description: row.querySelector<HTMLInputElement>('[name="description"]')!.value.trim(),
        unit: row.querySelector<HTMLInputElement>('[name="unit"]')!.value,
        lineTotal: Math.round(quantity * unitPrice * 100) / 100,
      };
    });
    const subtotalFor = (type: string) => rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.lineTotal, 0);
    const subtotal = Math.round(rows.reduce((sum, row) => sum + row.lineTotal, 0) * 100) / 100;
    const taxPercent = Number(taxInput.value) || 0;
    const taxAmount = Math.round(subtotal * taxPercent) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const signer = document.createElement('input');
    signer.name = 'senderName'; signer.required = true; signer.minLength = 2; signer.maxLength = 80;
    signer.autocomplete = 'name'; signer.placeholder = 'First and last name';
    try { signer.value = localStorage.getItem(senderStorageKey) ?? ''; } catch { /* storage unavailable */ }

    const meta = node('dl', '', 'px-preview-meta');
    for (const [label, value] of [
      ['From', 'Project X Contractors'],
      ['To', `${request.name} <${request.email}>`],
      ['Subject', `Project X quote (number assigned on send) — ${money(total)}`],
    ] as const) meta.append(node('dt', label), node('dd', value));

    const email = node('article', '', 'px-preview-email');
    const brand = node('header', '', 'px-preview-brand');
    const logo = document.createElement('img');
    logo.src = '/assets/logo.png'; logo.alt = 'Project X Contractors';
    brand.append(logo, node('p', 'PROJECT X CONTRACTORS'), node('h3', 'Project estimate'));
    const body = node('div', '', 'px-preview-body');
    body.append(
      node('p', `Hello ${request.name}, here is the estimate for your project.`),
      node('p', `${request.projectType} · ${request.propertyAddress}`, 'px-preview-muted'),
    );
    const table = node('div', '', 'px-preview-lines');
    for (const row of rows) {
      const line = node('div', '', 'px-preview-line');
      const copy = node('span', '');
      copy.append(node('strong', row.description), node('small', `${typeNames[row.type] ?? row.type} · ${row.quantity} ${row.unit} × ${money(row.unitPrice)}`));
      line.append(copy, node('span', money(row.lineTotal)));
      table.append(line);
    }
    const sums = node('div', '', 'px-preview-totals');
    for (const [label, value, className] of [
      ['Materials', subtotalFor('material'), ''], ['Labor', subtotalFor('labor'), ''], ['Other', subtotalFor('other'), ''],
      ['Subtotal', subtotal, ''], [`Tax (${taxPercent}%)`, taxAmount, ''], ['TOTAL', total, 'px-preview-grand'],
    ] as const) {
      const sum = node('div', '', className);
      sum.append(node('span', label), node('strong', money(value)));
      sums.append(sum);
    }
    body.append(table, sums);
    if (noteInput.value.trim()) body.append(node('p', noteInput.value.trim(), 'px-preview-note'));
    const signature = node('p', '', 'px-preview-signature');
    const signatureName = node('strong', '');
    const syncSignature = () => {
      signatureName.textContent = signer.value.trim() || '[Your name]';
      signatureName.classList.toggle('px-preview-placeholder', !signer.value.trim());
    };
    syncSignature();
    signer.addEventListener('input', syncSignature);
    signature.append(document.createTextNode('Sincerely,'), document.createElement('br'), signatureName, document.createElement('br'), document.createTextNode('Project X Contractors'));
    body.append(node('span', 'View itemized quote', 'px-preview-button'), signature);
    email.append(brand, body);

    const signerField = formField('Signed by (your name)', signer, 'px-followup-message-label');
    const previewStatus = node('p', '', 'px-followup-feedback');
    previewStatus.setAttribute('aria-live', 'polite');
    const back = node('button', '← Back to edit', 'px-add-item');
    back.type = 'button';
    back.addEventListener('click', showEditor);
    const confirm = node('button', 'Confirm and send', 'px-save-button');
    confirm.type = 'button';
    confirm.addEventListener('click', () => void send(signer, confirm, back, previewStatus));
    const actionsRow = node('div', '', 'px-preview-actions');
    actionsRow.append(back, confirm);

    preview.replaceChildren(node('p', 'Check the email below. Nothing is sent until you confirm.', 'px-preview-intro'), meta, email, signerField, previewStatus, actionsRow);
    headingText.querySelector('h2')!.textContent = 'Review before sending';
    form.hidden = true;
    historyPanel.hidden = true;
    preview.hidden = false;
    dialog.scrollTop = 0;
    if (!signer.value) signer.focus();
  }

  async function send(signer: HTMLInputElement, confirm: HTMLButtonElement, back: HTMLButtonElement, previewStatus: HTMLElement): Promise<void> {
    if (!signer.reportValidity()) return;
    try { localStorage.setItem(senderStorageKey, signer.value.trim()); } catch { /* storage unavailable */ }
    const quoteLines = [...lines.querySelectorAll<HTMLElement>('.px-quote-line')].map((row) => ({
      type: row.dataset.type,
      description: row.querySelector<HTMLInputElement>('[name="description"]')!.value,
      quantity: Number(row.querySelector<HTMLInputElement>('[name="quantity"]')!.value),
      unit: row.querySelector<HTMLInputElement>('[name="unit"]')!.value,
      unitCost: Number(row.querySelector<HTMLInputElement>('[name="unitCost"]')!.value),
      ...(row.querySelector<HTMLSelectElement>('.px-quote-catalog-select')?.value
        ? { materialId: row.querySelector<HTMLSelectElement>('.px-quote-catalog-select')!.value }
        : {}),
    }));
    confirm.disabled = true;
    back.disabled = true;
    previewStatus.textContent = 'Saving quote and sending email…';
    previewStatus.className = 'px-followup-feedback';
    try {
      const result = await api<QuoteRecord & { message: string; smsStatus?: string }>(`/api/admin/requests/${request.id}/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          lines: quoteLines, marginPercent: Number(marginInput.value), taxPercent: Number(taxInput.value),
          note: noteInput.value, senderName: signer.value.trim(),
        }),
      });
      showEditor();
      status.textContent = `${result.message}${smsNotice(result.smsStatus)}`;
      status.className = `px-followup-feedback ${result.deliveryStatus === 'sent' ? 'sent' : 'unsent'}`;
      // The POST response omits createdAt/createdBy/publicToken, so render the stored list (which includes the new quote).
      renderQuoteHistory(history, (await api<{ quotes: QuoteRecord[] }>(`/api/admin/requests/${request.id}/quotes`)).quotes);
      status.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      previewStatus.textContent = error instanceof Error ? error.message : 'Quote could not be saved.';
      previewStatus.className = 'px-followup-feedback unsent';
      confirm.disabled = false;
      back.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!lines.querySelector('.px-quote-line')) {
      status.textContent = 'Add at least one material, labor, or fee line.';
      status.className = 'px-followup-feedback unsent';
      return;
    }
    status.textContent = '';
    status.className = 'px-followup-feedback';
    showPreview();
  });
}

function renderQuoteHistory(container: HTMLElement, quotes: QuoteRecord[]): void {
  container.replaceChildren();
  if (!quotes.length) {
    container.append(node('p', 'No quotes created for this request yet.', 'px-empty'));
    return;
  }
  for (const quote of quotes) {
    const entry = node('article', '', 'px-followup-history-entry');
    const top = node('div', '', 'px-followup-history-top');
    const title = node('strong', `${quote.quoteNumber} · $${quote.total.toFixed(2)}`);
    const deliveryLabel = quote.deliveryStatus === 'sent' ? 'Emailed' : quote.deliveryStatus === 'failed' ? 'Email failed' : 'Email not configured';
    top.append(title, node('span', deliveryLabel, `px-delivery-status ${quote.deliveryStatus}`));
    const breakdown = node('p', `Cost $${quote.costSubtotal.toFixed(2)} · Gross profit $${quote.grossProfit.toFixed(2)} (${quote.grossMarginPercent.toFixed(1)}%) · Tax $${quote.taxAmount.toFixed(2)}`);
    const link = node('a', 'Open customer quote');
    link.href = `/step-2-quote?quote=${encodeURIComponent(quote.publicToken ?? '')}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    entry.append(top, breakdown, link, node('small', `${new Date(`${quote.createdAt.replace(' ', 'T')}Z`).toLocaleString()} · ${quote.createdBy}`));
    container.append(entry);
  }
}

type PublicQuoteView = {
  quoteNumber: string;
  customerName: string;
  projectType: string;
  propertyAddress: string;
  lines: Array<{ type: string; description: string; quantity: number; unit: string; unitPrice: number; lineTotal: number; imageUrl?: string }>;
  materialSubtotal: number;
  laborSubtotal: number;
  otherSubtotal: number;
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  note: string;
};

function hideStaticExample(main: HTMLElement): void {
  const exampleLabel = [...main.querySelectorAll<HTMLElement>('p')].find((element) => element.textContent?.trim().startsWith('EXAMPLE QUOTE'));
  // style.display, not .hidden: the inline display:flex on these blocks overrides the hidden attribute.
  if (exampleLabel?.parentElement) exampleLabel.parentElement.style.display = 'none';
}

async function setupPublicQuoteStep(): Promise<void> {
  const token = new URLSearchParams(location.search).get('quote');
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  hideStaticExample(main);
  if (!token) {
    // No personal link: show where the real quote comes from instead of made-up example figures.
    const info = node('section', '', 'px-public-quote');
    info.append(
      node('p', 'YOUR QUOTE', 'px-public-quote-kicker'),
      node('h2', 'Your itemized quote appears here'),
      node('p', 'After your site meeting we price your project with current material costs and email you a personal link. Open that link to see your real numbers here: labor, each material, fees and tax, line by line.', 'px-public-quote-message'),
    );
    const start = node('a', 'Not requested yet? Request a quote →', 'px-public-quote-back');
    start.href = '/contact';
    info.append(start);
    const steps = main.querySelector('nav[aria-label="Project steps"]');
    main.insertBefore(info, steps?.nextSibling ?? main.firstChild);
    return;
  }
  const section = node('section', '', 'px-public-quote');
  const loading = node('p', 'Loading your itemized quote…', 'px-public-quote-message');
  section.append(loading);
  const steps = main.querySelector('nav[aria-label="Project steps"]');
  main.insertBefore(section, steps?.nextSibling ?? main.firstChild);
  try {
    const quote = await api<PublicQuoteView>(`/api/quotes/${encodeURIComponent(token)}`);
    loading.remove();
    const header = node('div', '', 'px-public-quote-heading');
    header.append(node('p', `QUOTE ${quote.quoteNumber}`), node('h2', 'Your itemized estimate'));
    header.append(node('p', `${quote.projectType} · ${quote.propertyAddress}`));
    section.append(header);
    const list = node('div', '', 'px-public-quote-lines');
    for (const line of quote.lines) {
      const row = node('article', '', 'px-public-quote-line');
      const image = document.createElement('img');
      image.src = line.imageUrl || '/assets/interior.jpg';
      image.alt = '';
      image.loading = 'lazy';
      const description = node('div', '', 'px-public-quote-line-copy');
      description.append(node('strong', line.description), node('small', `${line.quantity} ${line.unit} · ${line.type}`));
      row.append(image, description, node('span', `$${line.unitPrice.toFixed(2)} / ${line.unit}`, 'px-public-quote-unit-price'), node('strong', `$${line.lineTotal.toFixed(2)}`, 'px-public-quote-line-price'));
      list.append(row);
    }
    section.append(list);
    const summary = node('div', '', 'px-public-quote-summary');
    for (const [label, amount] of [
      ['Materials', quote.materialSubtotal], ['Labor', quote.laborSubtotal], ['Other', quote.otherSubtotal],
      ['Subtotal', quote.subtotal], [`Tax (${quote.taxPercent}%)`, quote.taxAmount],
    ] as const) {
      const row = node('div', '', 'px-public-quote-total');
      row.append(node('span', label), node('strong', `$${amount.toFixed(2)}`));
      summary.append(row);
    }
    const total = node('div', '', 'px-public-quote-grand-total');
    total.append(node('span', 'TOTAL'), node('strong', `$${quote.total.toFixed(2)}`));
    summary.append(total);
    section.append(summary);
    if (quote.note) section.append(node('p', quote.note, 'px-public-quote-note'));
  } catch (error) {
    loading.className = 'px-public-quote-message px-public-quote-error';
    loading.textContent = error instanceof Error ? error.message : 'This quote could not be loaded.';
  }
}

function renderRequestsPage(user: StaffUser): void {
  const content = adminShell(user, 'Requests');
  const toolbar = node('div', '', 'px-requests-toolbar');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search name, project, address or email';
  search.setAttribute('aria-label', 'Search requests');
  const refresh = node('button', 'Refresh');
  refresh.type = 'button';
  refresh.className = 'px-refresh-button';
  toolbar.append(search, refresh);

  const statusNames = ['all', 'new', 'contacted', 'scheduled', 'in_progress', 'declined'] as const;
  let activeFilter: typeof statusNames[number] = 'all';
  let selectedId = new URLSearchParams(location.search).get('request') ?? '';
  let requests: RequestItem[] = [];
  const filters = node('div', '', 'px-request-filters');
  const workspace = node('div', '', 'px-request-workspace');
  const listPanel = node('section', '', 'px-request-list-panel');
  const listHeading = node('div', '', 'px-panel-heading');
  const listTitle = node('h2', 'All requests');
  const listCount = node('span', '0 requests');
  listHeading.append(listTitle, listCount);
  const list = node('div', '', 'px-request-list');
  listPanel.append(listHeading, list);
  const detail = node('section', '', 'px-request-detail-panel');
  workspace.append(listPanel, detail);

  const summary = node('div', '', 'px-request-summary');
  const filterButtons = new Map<typeof statusNames[number], HTMLButtonElement>();
  for (const filter of statusNames) {
    const button = node('button', '', 'px-filter-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      activeFilter = filter;
      update();
    });
    filterButtons.set(filter, button);
    filters.append(button);
  }
  content.append(toolbar, summary, filters, workspace);

  function update(): void {
    const newCount = requests.filter((item) => item.status === 'new').length;
    summary.replaceChildren(
      metric('All requests', requests.length, 'Stored in the Project X inbox', '#requests'),
      metric('Needs response', newCount, 'New requests awaiting contact', '#requests'),
      metric('Awaiting quote', requests.filter(awaitingQuote).length, 'No price quote sent yet', '#requests'),
    );
    for (const filter of statusNames) {
      const button = filterButtons.get(filter)!;
      const count = filter === 'all' ? requests.length : requests.filter((item) => item.status === filter).length;
      button.textContent = `${filter === 'all' ? 'All' : statusLabels[filter]} · ${count}`;
      button.classList.toggle('active', activeFilter === filter);
      button.setAttribute('aria-pressed', String(activeFilter === filter));
    }
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const visible = requests.filter((item) => {
      const matchesStatus = activeFilter === 'all' || item.status === activeFilter;
      const matchesSearch = !query || [item.name, item.email, item.projectType, item.propertyAddress].some((value) => value.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
    listTitle.textContent = activeFilter === 'all' ? 'All requests' : `${statusLabels[activeFilter]} requests`;
    listCount.textContent = `${visible.length} ${visible.length === 1 ? 'request' : 'requests'}`;
    if (!visible.length) {
      list.append(node('p', requests.length ? 'No requests match this search.' : 'No customer requests yet.', 'px-empty'));
      detail.replaceChildren(node('p', 'Select a request from the list to view its details.', 'px-empty'));
      return;
    }
    if (!visible.some((item) => item.id === selectedId)) selectedId = visible[0].id;
    for (const item of visible) {
      const row = node('button', '', `px-request-row${item.id === selectedId ? ' selected' : ''}`);
      row.type = 'button';
      row.setAttribute('aria-pressed', String(item.id === selectedId));
      const firstLine = node('span', '', 'px-request-row-first');
      firstLine.append(node('strong', item.name), node('span', statusLabels[item.status], `px-status px-status-${item.status}`));
      row.append(firstLine, node('span', item.projectType, 'px-request-row-type'), node('small', item.email), node('small', item.propertyAddress));
      if (!item.emailVerifiedAt) row.append(node('span', 'Email not confirmed yet', 'px-unverified-tag'));
      const quoteSummary = lastQuoteSummary(item);
      if (quoteSummary) row.append(node('span', quoteSummary.label, `px-quote-sent-tag${quoteSummary.sent ? '' : ' unsent'}`));
      else if (awaitingQuote(item)) row.append(node('span', 'Awaiting price quote', 'px-quote-pending-tag'));
      row.addEventListener('click', () => { selectedId = item.id; update(); });
      list.append(row);
    }
    const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
    renderRequestDetail(detail, selected, async () => {
      const result = await api<{ requests: RequestItem[] }>('/api/admin/requests');
      requests = result.requests;
      update();
    });
  }

  async function load(): Promise<void> {
    refresh.disabled = true;
    try {
      const result = await api<{ requests: RequestItem[] }>('/api/admin/requests');
      requests = result.requests;
      update();
    } catch (error) {
      list.replaceChildren(node('p', error instanceof Error ? error.message : 'Could not load requests.', 'px-request-error'));
    } finally {
      refresh.disabled = false;
    }
  }
  search.addEventListener('input', update);
  refresh.addEventListener('click', () => void load());
  void load();
}

type JobApplication = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  message: string;
  status: 'new' | 'reviewed' | 'contacted' | 'rejected';
  createdAt: string;
  resumeName: string | null;
  hasResume: boolean;
};

const applicationStatusLabels: Record<JobApplication['status'], string> = {
  new: 'New', reviewed: 'Reviewed', contacted: 'Contacted', rejected: 'Rejected',
};

function renderApplicationsPage(user: StaffUser): void {
  const content = adminShell(user, 'Applications');
  const intro = node('div', '', 'px-inventory-intro-row');
  intro.append(node('p', 'Job applications sent from the Careers page. Download resumes and track who you have contacted.', 'px-admin-intro'));
  const refresh = node('button', 'Refresh', 'px-refresh-button');
  refresh.type = 'button';
  intro.append(refresh);
  const panel = node('section', '', 'px-dashboard-panel');
  const heading = node('div', '', 'px-panel-heading');
  const count = node('span', 'Loading…');
  heading.append(node('h2', 'Applications'), count);
  const list = node('div', '', 'px-application-list');
  panel.append(heading, list);
  content.append(intro, panel);

  async function load(): Promise<void> {
    refresh.disabled = true;
    try {
      const { applications } = await api<{ applications: JobApplication[] }>('/api/admin/applications');
      const newCount = applications.filter((item) => item.status === 'new').length;
      count.textContent = `${applications.length} total · ${newCount} new`;
      list.replaceChildren();
      if (!applications.length) list.append(node('p', 'No applications yet. They will appear here when someone applies on the Careers page.', 'px-empty'));
      for (const item of applications) {
        const row = node('article', '', `px-application-row${item.status === 'new' ? ' is-new' : ''}`);
        const top = node('div', '', 'px-application-top');
        const who = node('div', '', 'px-application-who');
        who.append(node('strong', item.name), node('span', item.position, 'px-application-position'));
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Status for ${item.name}`);
        for (const [value, label] of Object.entries(applicationStatusLabels)) {
          const option = document.createElement('option');
          option.value = value; option.textContent = label;
          select.append(option);
        }
        select.value = item.status;
        select.addEventListener('change', async () => {
          select.disabled = true;
          try {
            await api(`/api/admin/applications/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
            await load();
          } catch (error) {
            select.value = item.status;
            select.disabled = false;
            list.prepend(node('p', error instanceof Error ? error.message : 'Could not update the application.', 'px-request-error'));
          }
        });
        top.append(who, select);
        const contact = node('div', '', 'px-application-contact');
        const mail = node('a', item.email); mail.href = `mailto:${item.email}`;
        contact.append(mail);
        if (item.phone) {
          const tel = node('a', item.phone); tel.href = `tel:${item.phone}`;
          contact.append(tel);
        }
        if (item.hasResume) {
          const download = node('a', `Download resume${item.resumeName ? ` (${item.resumeName})` : ''}`, 'px-application-resume');
          download.href = `${apiBase}/api/admin/applications/${encodeURIComponent(item.id)}/resume`;
          contact.append(download);
        } else {
          contact.append(node('span', 'No resume attached'));
        }
        row.append(top, contact);
        if (item.message) row.append(node('p', item.message, 'px-application-message'));
        row.append(node('small', `Received ${new Date(`${item.createdAt.replace(' ', 'T')}Z`).toLocaleString()}`));
        list.append(row);
      }
    } catch (error) {
      count.textContent = 'Unavailable';
      list.replaceChildren(node('p', error instanceof Error ? error.message : 'Could not load applications.', 'px-request-error'));
    } finally {
      refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', () => void load());
  void load();
}

type ExpenseEntry = {
  id: string;
  expenseDate: string;
  category: string;
  description: string;
  paidTo: string;
  amount: number;
  requestId: string | null;
  projectName: string | null;
  recordedBy: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
};

type FinanceSummary = {
  payments: number;
  refunds: number;
  netReceived: number;
  expenses: number;
  netProfit: number;
  marginPercent: number | null;
  expensesByCategory: Array<{ category: string; total: number; count: number }>;
  ledger: PaymentEntry[];
};

const expenseCategoryLabels: Record<string, string> = {
  payroll: 'Payroll / crew wages', subcontractor: 'Subcontractors', materials: 'Materials', equipment: 'Equipment & rental',
  vehicle: 'Vehicle & fuel', office: 'Office & admin', insurance: 'Insurance & permits', other: 'Other',
};

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Date range for each period shortcut, in the browser's local calendar.
function periodRange(period: string): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'this-month') return { from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 0)) };
  if (period === 'last-month') return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
  if (period === 'this-year') return { from: isoDay(new Date(y, 0, 1)), to: isoDay(new Date(y, 11, 31)) };
  return {};
}

type ErrorEntry = { id: number; source: 'server' | 'client'; message: string; detail: string; path: string; userAgent: string; createdAt: string };

function renderHealthPage(user: StaffUser): void {
  const content = adminShell(user, 'Health');
  const intro = node('div', '', 'px-inventory-intro-row');
  intro.append(node('p', 'Website status and recent errors. Serious server errors also text the company phone (and email ALERT_EMAIL) at most once every 15 minutes.', 'px-admin-intro'));
  const actions = node('div', '', 'px-health-actions');
  const refresh = node('button', 'Refresh', 'px-refresh-button');
  refresh.type = 'button';
  const clear = node('button', 'Clear log', 'px-row-action danger');
  clear.type = 'button';
  actions.append(refresh, clear);
  intro.append(actions);
  const cards = node('div', '', 'px-metrics px-health-metrics');
  const panel = node('section', '', 'px-dashboard-panel');
  const heading = node('div', '', 'px-panel-heading');
  const count = node('span', 'Loading…');
  heading.append(node('h2', 'Recent errors'), count);
  const list = node('div', '', 'px-health-list');
  panel.append(heading, list);
  const uptimeNote = node('section', '', 'px-source-guide');
  uptimeNote.append(
    node('h2', '“Site is down” alerts'),
    node('p', 'A server that is down cannot warn anyone itself. Add a free external monitor (for example UptimeRobot or Better Stack) that checks /api/health every 5 minutes and texts or emails you when it fails. /api/health only answers OK when the database responds too.'),
  );
  content.append(intro, cards, panel, uptimeNote);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  async function load(): Promise<void> {
    refresh.disabled = true;
    try {
      const [health, log] = await Promise.all([
        api<{ status: string; uptimeSeconds: number }>('/api/health').catch(() => ({ status: 'error', uptimeSeconds: 0 })),
        api<{ errors: ErrorEntry[]; last24h: { server: number; client: number } }>('/api/admin/errors'),
      ]);
      cards.replaceChildren(
        metric('Status', health.status === 'ok' ? 'Online' : 'Problem', health.status === 'ok' ? 'Server and database responding' : 'Database check failed', '#'),
        metric('Up for', formatUptime(health.uptimeSeconds), 'Since the last restart', '#'),
        metric('Server errors', log.last24h.server, 'Last 24 hours', '#'),
        metric('Browser errors', log.last24h.client, 'Last 24 hours, from visitors', '#'),
      );
      cards.firstElementChild?.classList.toggle('px-health-bad', health.status !== 'ok');
      count.textContent = `${log.errors.length} shown`;
      list.replaceChildren();
      if (!log.errors.length) list.append(node('p', 'No errors recorded. 🎉', 'px-empty'));
      for (const entry of log.errors) {
        const row = document.createElement('details');
        row.className = `px-health-row ${entry.source}`;
        const summary = document.createElement('summary');
        summary.append(
          node('span', entry.source === 'server' ? 'Server' : 'Browser', `px-health-badge ${entry.source}`),
          node('strong', entry.message),
          node('small', `${entry.path || '—'} · ${new Date(`${entry.createdAt.replace(' ', 'T')}Z`).toLocaleString()}`),
        );
        row.append(summary);
        if (entry.detail) row.append(node('pre', entry.detail));
        if (entry.userAgent) row.append(node('small', entry.userAgent, 'px-health-agent'));
        list.append(row);
      }
    } catch (error) {
      list.replaceChildren(node('p', error instanceof Error ? error.message : 'Could not load the error log.', 'px-request-error'));
    } finally {
      refresh.disabled = false;
    }
  }

  clear.addEventListener('click', async () => {
    if (clear.dataset.confirm !== 'yes') {
      clear.dataset.confirm = 'yes';
      clear.textContent = 'Click again to clear';
      return;
    }
    clear.dataset.confirm = '';
    clear.textContent = 'Clear log';
    await api('/api/admin/errors/clear', { method: 'POST' });
    await load();
  });
  refresh.addEventListener('click', () => void load());
  void load();
}

function renderFinancePage(user: StaffUser): void {
  const content = adminShell(user, 'Finance');
  let requests: RequestItem[] = [];

  const toolbar = node('div', '', 'px-materials-toolbar');
  const period = selectField('period', [['this-month', 'This month'], ['last-month', 'Last month'], ['this-year', 'This year'], ['all', 'All time']], 'this-month');
  period.setAttribute('aria-label', 'Period');
  const rangeLabel = node('span', '', 'px-finance-range');
  toolbar.append(period, rangeLabel);
  const status = node('p', '', 'px-materials-status');
  status.setAttribute('role', 'status');

  const cards = node('div', '', 'px-finance-cards px-finance-page-cards');
  const summarySection = node('section', '', 'px-finance');
  const summaryHeading = node('div', '', 'px-finance-heading');
  summaryHeading.append(node('h2', 'Profit'), node('span', 'Cash basis: money kept from customers (payments − refunds) minus recorded expenses. Voided entries are excluded.'));
  const breakdown = node('div', '', 'px-expense-breakdown');
  summarySection.append(summaryHeading, cards, breakdown);

  // Expense entry form + table
  const expensePanel = node('section', '', 'px-dashboard-panel');
  const expenseHeading = node('div', '', 'px-panel-heading');
  const expenseCount = node('span', '');
  expenseHeading.append(node('h2', 'Expenses'), expenseCount);
  const expenseForm = document.createElement('form');
  expenseForm.className = 'px-expense-form';
  const date = document.createElement('input');
  date.type = 'date'; date.required = true; date.value = isoDay(new Date());
  const category = selectField('category', Object.entries(expenseCategoryLabels), 'payroll');
  const description = document.createElement('input');
  description.required = true; description.minLength = 2; description.maxLength = 200; description.placeholder = 'e.g. Crew wages, week 40';
  const paidTo = document.createElement('input');
  paidTo.maxLength = 120; paidTo.placeholder = 'Employee, vendor…';
  const project = document.createElement('select');
  const amount = document.createElement('input');
  amount.type = 'number'; amount.min = '0.01'; amount.step = '0.01'; amount.required = true; amount.placeholder = '0.00';
  const addExpense = node('button', 'Add expense', 'px-save-button');
  addExpense.type = 'submit';
  expenseForm.append(
    formField('Date', date), formField('Category', category), formField('Description', description, 'px-expense-wide'),
    formField('Paid to', paidTo), formField('Project (optional)', project), formField('Amount (USD)', amount), addExpense,
  );
  const expenseTableWrap = node('div', '', 'px-material-table-wrap');
  const expenseTable = document.createElement('table');
  expenseTable.className = 'px-material-table px-expense-table';
  const expenseHead = document.createElement('thead');
  const expenseHeadRow = document.createElement('tr');
  for (const title of ['Date', 'Category', 'Description', 'Project', 'Amount', '']) expenseHeadRow.append(node('th', title));
  expenseHead.append(expenseHeadRow);
  const expenseBody = document.createElement('tbody');
  expenseTable.append(expenseHead, expenseBody);
  expenseTableWrap.append(expenseTable);
  expensePanel.append(expenseHeading, expenseForm, expenseTableWrap);

  const ledgerPanel = node('section', '', 'px-dashboard-panel');
  const ledgerHeading = node('div', '', 'px-panel-heading');
  const ledgerCount = node('span', '');
  ledgerHeading.append(node('h2', 'Customer payments'), ledgerCount);
  const ledgerList = node('div', '', 'px-ledger-list');
  ledgerPanel.append(ledgerHeading, node('p', 'Record payments and refunds from each request’s detail page. Voiding keeps the entry in this history.', 'px-ledger-hint'), ledgerList);

  const layout = node('div', '', 'px-finance-layout');
  layout.append(expensePanel, ledgerPanel);
  content.append(toolbar, status, summarySection, layout);

  function showStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function query(): string {
    const range = periodRange(period.value);
    rangeLabel.textContent = range.from ? `${new Date(`${range.from}T00:00:00`).toLocaleDateString()} – ${new Date(`${range.to}T00:00:00`).toLocaleDateString()}` : 'All recorded entries';
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    return params.toString() ? `?${params}` : '';
  }

  function card(tone: string, label: string, value: string, detail: string): HTMLElement {
    const element = node('div', '', `px-finance-card px-finance-${tone}`);
    element.append(node('span', label), node('strong', value), node('small', detail));
    return element;
  }

  function renderSummary(summary: FinanceSummary): void {
    cards.replaceChildren(
      card('received', 'Money in', usd.format(summary.netReceived), `${usd.format(summary.payments)} payments − ${usd.format(summary.refunds)} refunds`),
      card('pending', 'Expenses', usd.format(summary.expenses), `${summary.expensesByCategory.reduce((sum, row) => sum + row.count, 0)} recorded`),
      card(summary.netProfit >= 0 ? 'total' : 'loss', 'Net profit', usd.format(summary.netProfit), summary.marginPercent === null ? 'No money received in this period' : `${summary.marginPercent}% of money in`),
    );
    breakdown.replaceChildren();
    if (!summary.expensesByCategory.length) {
      breakdown.append(node('p', 'No expenses in this period.', 'px-ledger-hint'));
      return;
    }
    const max = Math.max(...summary.expensesByCategory.map((row) => row.total));
    for (const row of summary.expensesByCategory) {
      const line = node('div', '', 'px-expense-bar-row');
      const bar = node('span', '', 'px-expense-bar');
      const fill = node('span', '');
      fill.style.width = `${max > 0 ? (row.total / max) * 100 : 0}%`;
      bar.append(fill);
      line.append(node('span', expenseCategoryLabels[row.category] ?? row.category, 'px-expense-bar-label'), bar, node('strong', usd.format(row.total)));
      breakdown.append(line);
    }
  }

  function renderExpenses(expenses: ExpenseEntry[]): void {
    const active = expenses.filter((entry) => !entry.voidedAt).length;
    expenseCount.textContent = `${active} active${expenses.length > active ? ` · ${expenses.length - active} voided` : ''}`;
    expenseBody.replaceChildren();
    if (!expenses.length) {
      const row = document.createElement('tr');
      const empty = node('td', 'No expenses in this period. Use the form above to add one.');
      empty.colSpan = 6;
      row.append(empty);
      expenseBody.append(row);
      return;
    }
    for (const entry of expenses) {
      const row = document.createElement('tr');
      if (entry.voidedAt) row.className = 'px-expense-voided';
      const descriptionCell = node('td', entry.description);
      descriptionCell.append(node('small', [entry.paidTo, `added by ${entry.recordedBy}`].filter(Boolean).join(' · ')));
      if (entry.voidedAt) descriptionCell.append(node('small', `Voided by ${entry.voidedBy}: ${entry.voidReason}`, 'px-ledger-void-note'));
      const actions = node('td', '', 'px-material-actions');
      if (!entry.voidedAt) {
        actions.append(voidControl(async (reason) => {
          try {
            await api(`/api/admin/expenses/${entry.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
            showStatus(`Expense “${entry.description}” voided. It stays in the history.`);
            await load();
          } catch (error) {
            showStatus(error instanceof Error ? error.message : 'Could not void the expense.', true);
          }
        }));
      }
      row.append(
        node('td', new Date(`${entry.expenseDate}T00:00:00`).toLocaleDateString()),
        node('td', expenseCategoryLabels[entry.category] ?? entry.category),
        descriptionCell,
        node('td', entry.projectName ?? '—'),
        node('td', usd.format(entry.amount), 'px-expense-amount'),
        actions,
      );
      expenseBody.append(row);
    }
  }

  function renderLedger(entries: PaymentEntry[]): void {
    ledgerCount.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    ledgerList.replaceChildren();
    if (!entries.length) ledgerList.append(node('p', 'No customer payments in this period.', 'px-empty'));
    for (const entry of entries) {
      ledgerList.append(paymentEntryRow(entry, async (reason) => {
        try {
          await api(`/api/admin/payments/${entry.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
          showStatus('Payment voided. It stays in the history.');
          await load();
        } catch (error) {
          showStatus(error instanceof Error ? error.message : 'Could not void the payment.', true);
        }
      }, `${entry.kind === 'refund' ? 'Refund' : 'Payment'} · ${entry.customerName ?? ''}`));
    }
  }

  async function load(): Promise<void> {
    const suffix = query();
    try {
      const [summary, expenseResult] = await Promise.all([
        api<FinanceSummary>(`/api/admin/finance${suffix}`),
        api<{ expenses: ExpenseEntry[] }>(`/api/admin/expenses${suffix}`),
      ]);
      renderSummary(summary);
      renderExpenses(expenseResult.expenses);
      renderLedger(summary.ledger);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Could not load finance data.', true);
    }
  }

  async function loadProjects(): Promise<void> {
    try {
      requests = (await api<{ requests: RequestItem[] }>('/api/admin/requests')).requests;
    } catch {
      requests = [];
    }
    project.replaceChildren();
    const none = document.createElement('option');
    none.value = ''; none.textContent = 'Company overhead';
    project.append(none);
    for (const item of requests.filter((entry) => entry.status !== 'declined')) {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = `${item.name} · ${item.projectType}`;
      project.append(option);
    }
  }

  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!expenseForm.reportValidity()) return;
    addExpense.disabled = true;
    try {
      await api('/api/admin/expenses', {
        method: 'POST',
        body: JSON.stringify({
          expenseDate: date.value, category: category.value, description: description.value, paidTo: paidTo.value,
          amount: Number(amount.value), requestId: project.value,
        }),
      });
      showStatus(`Expense recorded: ${description.value} · ${usd.format(Number(amount.value))}`);
      description.value = ''; paidTo.value = ''; amount.value = '';
      description.focus();
      await load();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Could not record the expense.', true);
    } finally {
      addExpense.disabled = false;
    }
  });
  period.addEventListener('change', () => void load());
  void loadProjects();
  void load();
}


type MeetingTone = 'planned' | 'progress' | 'postponed' | 'done' | 'cancelled' | 'alert' | 'event';
type EntryStatus = 'scheduled' | 'postponed' | 'done' | 'cancelled';
type CalendarEvent = {
  id: string;
  title: string;
  eventDate: string;
  startTime: string;
  kind: 'site_meeting' | 'job' | 'delivery' | 'inspection' | 'other';
  status: EntryStatus;
  note: string;
  requestId: string | null;
  projectName: string | null;
  updatedBy: string;
};
type CalendarEntry = {
  key: string;
  date: Date;
  hasTime: boolean;
  title: string;
  tone: MeetingTone;
  note: string;
  status: EntryStatus;
  request?: RequestItem;
  event?: CalendarEvent;
};

const meetingAlertWindowMs = 1000 * 60 * 60 * 48;
const meetingToneLabels: Record<MeetingTone, string> = {
  planned: 'Planned meeting', progress: 'Work in progress', postponed: 'Postponed', done: 'Done',
  cancelled: 'Cancelled', alert: 'Soon or overdue', event: 'Team event',
};
const entryStatusLabels: Record<EntryStatus, string> = { scheduled: 'Scheduled', postponed: 'Postponed', done: 'Done', cancelled: 'Cancelled' };
const eventKindLabels: Record<CalendarEvent['kind'], string> = {
  site_meeting: 'Site meeting', job: 'Job / work day', delivery: 'Delivery', inspection: 'Inspection', other: 'Other',
};

// The contact form sends datetime-local values ("2026-10-05T10:00"); older free-text entries return null.
function parseMeetingDate(value: string): { date: Date; hasTime: boolean } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0));
  if (date.getMonth() !== Number(month) - 1) return null;
  return { date, hasTime: hour !== undefined };
}

function isOverdue(date: Date, hasTime: boolean, now: Date): boolean {
  const end = hasTime ? date.getTime() : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return end < now.getTime();
}

function meetingTone(request: RequestItem, date: Date, hasTime: boolean, now: Date): { tone: MeetingTone; note: string } {
  const status = request.meetingStatus ?? 'scheduled';
  if (request.status === 'declined' || status === 'cancelled') return { tone: 'cancelled', note: request.status === 'declined' ? 'Request declined' : 'Meeting cancelled' };
  if (status === 'done') return { tone: 'done', note: 'Meeting done' };
  if (status === 'postponed') return { tone: 'postponed', note: request.meetingNote ? `Postponed · ${request.meetingNote}` : 'Postponed — confirm the new date' };
  if (request.status === 'in_progress') return { tone: 'progress', note: 'Work in progress' };
  if (isOverdue(date, hasTime, now)) return { tone: 'alert', note: 'Meeting date has passed — mark it done or reschedule' };
  if (date.getTime() - now.getTime() <= meetingAlertWindowMs) return { tone: 'alert', note: 'Meeting within 48 hours' };
  return { tone: 'planned', note: statusLabels[request.status] };
}

function eventTone(event: CalendarEvent, date: Date, hasTime: boolean, now: Date): { tone: MeetingTone; note: string } {
  if (event.status === 'cancelled') return { tone: 'cancelled', note: 'Cancelled' };
  if (event.status === 'done') return { tone: 'done', note: 'Done' };
  if (event.status === 'postponed') return { tone: 'postponed', note: event.note ? `Postponed · ${event.note}` : 'Postponed' };
  if (isOverdue(date, hasTime, now)) return { tone: 'alert', note: 'Date has passed — mark it done or reschedule' };
  return { tone: 'event', note: eventKindLabels[event.kind] };
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Short explanation of what happened to the customer text after a save.
function smsNotice(status: string | undefined): string {
  if (status === 'sent') return ' The customer was notified by SMS.';
  if (status === 'no_consent') return ' No SMS sent: the customer did not opt in to texts.';
  if (status === 'not_configured') return ' SMS is not set up yet (add Twilio settings), so no text was sent.';
  if (status === 'failed') return ' The SMS could not be delivered; call the customer instead.';
  return '';
}

function statusPicker(value: EntryStatus): { element: HTMLElement; value: () => EntryStatus } {
  let current = value;
  const group = node('div', '', 'px-status-picker');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Status');
  const buttons: HTMLButtonElement[] = [];
  for (const status of ['scheduled', 'postponed', 'done', 'cancelled'] as const) {
    const button = node('button', entryStatusLabels[status], `px-status-option px-status-option-${status}`);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    const sync = () => buttons.forEach((b) => { const on = b.dataset.status === current; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
    button.dataset.status = status;
    button.addEventListener('click', () => { current = status; sync(); });
    buttons.push(button);
    group.append(button);
    sync();
  }
  buttons.forEach((b) => { const on = b.dataset.status === current; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  return { element: group, value: () => current };
}

function calendarDialog(eyebrow: string, title: string): { dialog: HTMLDialogElement; form: HTMLFormElement; error: HTMLElement; actions: HTMLElement } {
  const dialog = document.createElement('dialog');
  dialog.className = 'px-followup-dialog px-calendar-dialog';
  const top = node('div', '', 'px-followup-heading');
  const titleBlock = node('div', '');
  titleBlock.append(node('p', eyebrow), node('h2', title));
  const close = node('button', 'Close', 'px-dialog-close');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  top.append(titleBlock, close);
  const form = document.createElement('form');
  form.className = 'px-calendar-form';
  const error = node('p', '', 'px-materials-status error');
  error.setAttribute('role', 'alert');
  const actions = node('div', '', 'px-calendar-form-actions');
  dialog.append(top, form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  return { dialog, form, error, actions };
}

function renderCalendarPage(user: StaffUser): void {
  const content = adminShell(user, 'Meeting calendar');
  const monthParam = /^(\d{4})-(\d{2})$/.exec(new URLSearchParams(location.search).get('month') ?? '');
  const today = new Date();
  let visibleMonth = monthParam
    ? new Date(Number(monthParam[1]), Number(monthParam[2]) - 1, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  let entries: CalendarEntry[] = [];
  let undated: RequestItem[] = [];
  let requests: RequestItem[] = [];

  const toolbar = node('div', '', 'px-calendar-toolbar');
  const previous = node('button', '‹ Previous', 'px-refresh-button');
  const todayButton = node('button', 'Today', 'px-refresh-button');
  const next = node('button', 'Next ›', 'px-refresh-button');
  const monthTitle = node('h2', '', 'px-calendar-month');
  monthTitle.setAttribute('aria-live', 'polite');
  const addButton = node('button', '+ Add event', 'px-action-link');
  for (const button of [previous, todayButton, next, addButton]) button.type = 'button';
  const navGroup = node('div', '', 'px-calendar-nav');
  navGroup.append(previous, todayButton, next);
  toolbar.append(navGroup, monthTitle, addButton);

  const legend = node('ul', '', 'px-calendar-legend');
  legend.setAttribute('aria-label', 'Color legend');
  for (const tone of ['planned', 'event', 'progress', 'postponed', 'done', 'cancelled', 'alert'] as const) {
    const item = node('li', '', `px-meeting-tone-${tone}`);
    item.append(node('span', '', 'px-calendar-swatch'), document.createTextNode(meetingToneLabels[tone]));
    legend.append(item);
  }

  const status = node('p', '', 'px-materials-status');
  status.setAttribute('role', 'status');
  const summary = node('div', '', 'px-request-summary px-calendar-summary');
  const layout = node('div', '', 'px-calendar-layout');
  const calendarPanel = node('section', '', 'px-dashboard-panel px-calendar-panel');
  const grid = node('div', '', 'px-calendar-grid');
  grid.setAttribute('role', 'grid');
  const agenda = node('ol', '', 'px-calendar-agenda');
  calendarPanel.append(grid, agenda);
  const side = node('section', '', 'px-dashboard-panel px-calendar-side');
  layout.append(calendarPanel, side);
  content.append(toolbar, legend, status, summary, layout);

  function showStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function chip(entry: CalendarEntry, tag: 'button' | 'li' = 'button'): HTMLElement {
    const button = node('button', '', `px-meeting-chip px-meeting-tone-${entry.tone}${entry.status === 'cancelled' ? ' is-cancelled' : ''}`);
    button.type = 'button';
    button.title = `${entry.title} · ${entry.note}`;
    if (entry.hasTime) button.append(node('time', entry.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    button.append(node('strong', entry.title));
    if (entry.status === 'postponed') button.append(node('em', 'Postponed', 'px-chip-badge'));
    if (entry.status === 'done') button.append(node('em', '✓', 'px-chip-badge'));
    button.addEventListener('click', () => (entry.request ? openMeetingDialog(entry.request) : entry.event ? openEventDialog(entry.event) : undefined));
    if (tag === 'button') return button;
    const item = node('li', '');
    item.append(button);
    return item;
  }

  function render(): void {
    const now = new Date();
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    monthTitle.textContent = visibleMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const params = new URLSearchParams(location.search);
    params.set('month', `${year}-${String(month + 1).padStart(2, '0')}`);
    history.replaceState(null, '', `${location.pathname}?${params}`);

    const inMonth = entries.filter((entry) => entry.date.getFullYear() === year && entry.date.getMonth() === month);
    const byDay = new Map<string, CalendarEntry[]>();
    for (const entry of inMonth) byDay.set(dateKey(entry.date), [...(byDay.get(dateKey(entry.date)) ?? []), entry]);
    const alerts = entries.filter((entry) => entry.tone === 'alert');
    const postponed = entries.filter((entry) => entry.tone === 'postponed');
    summary.replaceChildren(
      metric('This month', inMonth.filter((entry) => entry.status !== 'cancelled').length, 'Meetings and events', '#calendar'),
      metric('Need attention', alerts.length, 'Within 48 hours or already past', '#calendar'),
      metric('Postponed', postponed.length, 'Waiting for a confirmed date', '#calendar'),
    );

    grid.replaceChildren();
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const header = node('div', new Date(2026, 1, 1 + weekday).toLocaleDateString([], { weekday: 'short' }), 'px-calendar-weekday');
      header.setAttribute('role', 'columnheader');
      grid.append(header);
    }
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7);
    for (let index = 0; index < weeks * 7; index += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const cell = node('div', '', 'px-calendar-day');
      cell.setAttribute('role', 'gridcell');
      if (day.getMonth() !== month) cell.classList.add('outside');
      if (dateKey(day) === dateKey(now)) cell.classList.add('today');
      const dayEntries = (byDay.get(dateKey(day)) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
      cell.setAttribute('aria-label', `${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${dayEntries.length} entries`);
      const dayHead = node('div', '', 'px-calendar-day-head');
      dayHead.append(node('span', String(day.getDate()), 'px-calendar-date'));
      if (day.getMonth() === month) {
        const add = node('button', '+', 'px-calendar-add');
        add.type = 'button';
        add.setAttribute('aria-label', `Add event on ${day.toLocaleDateString([], { month: 'long', day: 'numeric' })}`);
        add.addEventListener('click', () => openEventDialog(undefined, dateKey(day)));
        dayHead.append(add);
      }
      cell.append(dayHead);
      for (const entry of day.getMonth() === month ? dayEntries : []) cell.append(chip(entry));
      grid.append(cell);
    }

    // Phone layout: a compact list of only the days that have entries.
    agenda.replaceChildren();
    if (!inMonth.length) agenda.append(node('li', 'Nothing scheduled this month.', 'px-empty'));
    for (const [key, dayEntries] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const group = node('li', '', 'px-calendar-agenda-day');
      group.append(node('strong', dayEntries[0].date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })));
      const list = node('ul', '');
      for (const entry of dayEntries.sort((a, b) => a.date.getTime() - b.date.getTime())) list.append(chip(entry, 'li'));
      group.append(list);
      group.dataset.day = key;
      agenda.append(group);
    }

    side.replaceChildren();
    const section = (title: string, list: CalendarEntry[], empty: string) => {
      const heading = node('div', '', 'px-panel-heading');
      heading.append(node('h2', title), node('span', String(list.length)));
      const ul = node('ul', '', 'px-calendar-side-list');
      if (!list.length) ul.append(node('li', empty, 'px-empty'));
      for (const entry of [...list].sort((a, b) => a.date.getTime() - b.date.getTime())) {
        const item = chip(entry, 'li');
        item.append(node('small', `${entry.date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${entry.note}`));
        ul.append(item);
      }
      side.append(heading, ul);
    };
    section('Needs attention', alerts, 'Nothing upcoming or overdue.');
    section('Postponed', postponed, 'Nothing postponed.');
    const undatedHeading = node('div', '', 'px-panel-heading');
    undatedHeading.append(node('h2', 'Meeting without a date'), node('span', String(undated.length)));
    const undatedList = node('ul', '', 'px-calendar-side-list');
    if (!undated.length) undatedList.append(node('li', 'Every requested meeting has a calendar date.', 'px-empty'));
    for (const request of undated) {
      const item = node('li', '');
      const set = node('button', request.name, 'px-calendar-undated');
      set.type = 'button';
      set.addEventListener('click', () => openMeetingDialog(request));
      item.append(set, node('small', request.preferredMeeting ? `“${request.preferredMeeting}” · set a date` : 'Set a date'));
      undatedList.append(item);
    }
    side.append(undatedHeading, undatedList);
  }

  async function load(): Promise<void> {
    try {
      const [requestResult, eventResult] = await Promise.all([
        api<{ requests: RequestItem[] }>('/api/admin/requests'),
        api<{ events: CalendarEvent[] }>('/api/admin/calendar/events'),
      ]);
      requests = requestResult.requests;
      const now = new Date();
      entries = [];
      undated = [];
      for (const request of requests) {
        if (!request.preferredMeeting) continue;
        const parsed = parseMeetingDate(request.preferredMeeting);
        if (!parsed) { undated.push(request); continue; }
        entries.push({ key: `r-${request.id}`, title: request.name, request, status: request.meetingStatus ?? 'scheduled', ...parsed, ...meetingTone(request, parsed.date, parsed.hasTime, now) });
      }
      for (const event of eventResult.events) {
        const parsed = parseMeetingDate(event.startTime ? `${event.eventDate}T${event.startTime}` : event.eventDate);
        if (!parsed) continue;
        entries.push({ key: `e-${event.id}`, title: event.title, event, status: event.status, ...parsed, ...eventTone(event, parsed.date, parsed.hasTime, now) });
      }
      render();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Could not load the calendar.', true);
    }
  }

  function openMeetingDialog(request: RequestItem): void {
    const { dialog, form, error, actions } = calendarDialog('CUSTOMER SITE MEETING', request.name);
    const parsed = parseMeetingDate(request.preferredMeeting ?? '');
    const when = document.createElement('input');
    when.type = 'datetime-local';
    when.value = parsed ? `${dateKey(parsed.date)}T${parsed.hasTime ? parsed.date.toTimeString().slice(0, 5) : '09:00'}` : '';
    const picker = statusPicker(request.meetingStatus ?? 'scheduled');
    const note = document.createElement('textarea');
    note.rows = 2; note.maxLength = 500; note.value = request.meetingNote ?? '';
    note.placeholder = 'e.g. Customer asked to move it — call Friday to confirm';
    const info = node('p', `${request.projectType} · ${request.propertyAddress}`, 'px-calendar-form-info');
    const open = node('a', 'Open request →', 'px-link-action');
    open.href = `/admin/requests?request=${encodeURIComponent(request.id)}`;
    info.append(document.createTextNode(' '), open);
    const save = node('button', 'Save meeting', 'px-save-button');
    save.type = 'submit';
    actions.append(save);
    form.append(info, formField('Date and time', when), formField('Status', picker.element), formField('Note', note), error, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const result = await api<{ smsStatus: string }>(`/api/admin/requests/${request.id}/meeting`, {
          method: 'PATCH',
          body: JSON.stringify({ preferredMeeting: when.value, meetingStatus: picker.value(), meetingNote: note.value }),
        });
        dialog.close();
        showStatus(`${request.name}: meeting ${picker.value() === 'scheduled' ? 'saved' : entryStatusLabels[picker.value()].toLowerCase()}.${smsNotice(result.smsStatus)}`,
          result.smsStatus === 'failed');
        await load();
      } catch (saveError) {
        error.textContent = saveError instanceof Error ? saveError.message : 'Could not save the meeting.';
      } finally {
        save.disabled = false;
      }
    });
    dialog.showModal();
    when.focus();
  }

  function openEventDialog(existing?: CalendarEvent, day?: string): void {
    const { dialog, form, error, actions } = calendarDialog(existing ? 'EDIT EVENT' : 'NEW EVENT', existing ? existing.title : 'Add to the calendar');
    const title = document.createElement('input');
    title.required = true; title.minLength = 2; title.maxLength = 160; title.value = existing?.title ?? '';
    title.placeholder = 'e.g. Tile delivery, framing inspection';
    const date = document.createElement('input');
    date.type = 'date'; date.required = true; date.value = existing?.eventDate ?? day ?? dateKey(new Date());
    const time = document.createElement('input');
    time.type = 'time'; time.value = existing?.startTime ?? '';
    const kind = selectField('kind', Object.entries(eventKindLabels), existing?.kind ?? 'job');
    const project = selectField('project', [['', 'No project'], ...requests.filter((r) => r.status !== 'declined').map((r) => [r.id, `${r.name} · ${r.projectType}`] as [string, string])], existing?.requestId ?? '');
    const picker = statusPicker(existing?.status ?? 'scheduled');
    const note = document.createElement('textarea');
    note.rows = 2; note.maxLength = 1000; note.value = existing?.note ?? '';
    note.placeholder = 'Crew, gate code, reason for postponing…';
    const row = node('div', '', 'px-calendar-form-row');
    row.append(formField('Date', date), formField('Start time (optional)', time));
    const row2 = node('div', '', 'px-calendar-form-row');
    row2.append(formField('Type', kind), formField('Project', project));
    const save = node('button', existing ? 'Save changes' : 'Add event', 'px-save-button');
    save.type = 'submit';
    if (existing) {
      const remove = node('button', 'Delete event', 'px-row-action danger');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (remove.dataset.confirm !== 'yes') {
          remove.dataset.confirm = 'yes';
          remove.textContent = 'Click again to delete';
          return;
        }
        remove.disabled = true;
        try {
          await api(`/api/admin/calendar/events/${existing.id}`, { method: 'DELETE' });
          dialog.close();
          showStatus(`Deleted “${existing.title}”.`);
          await load();
        } catch (deleteError) {
          remove.disabled = false;
          error.textContent = deleteError instanceof Error ? deleteError.message : 'Could not delete the event.';
        }
      });
      actions.append(remove);
      form.append(node('p', `Last changed by ${existing.updatedBy}`, 'px-calendar-form-info'));
    }
    actions.append(save);
    form.append(formField('Title', title), row, row2, formField('Status', picker.element), formField('Note', note), error, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await api(existing ? `/api/admin/calendar/events/${existing.id}` : '/api/admin/calendar/events', {
          method: existing ? 'PATCH' : 'POST',
          body: JSON.stringify({ title: title.value, eventDate: date.value, startTime: time.value, kind: kind.value, status: picker.value(), note: note.value, requestId: project.value }),
        });
        const target = new Date(`${date.value}T00:00:00`);
        visibleMonth = new Date(target.getFullYear(), target.getMonth(), 1);
        dialog.close();
        showStatus(existing ? `Updated “${title.value}”.` : `Added “${title.value}” on ${target.toLocaleDateString()}.`);
        await load();
      } catch (saveError) {
        error.textContent = saveError instanceof Error ? saveError.message : 'Could not save the event.';
      } finally {
        save.disabled = false;
      }
    });
    dialog.showModal();
    title.focus();
  }

  previous.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); render(); });
  next.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); render(); });
  todayButton.addEventListener('click', () => { visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); });
  addButton.addEventListener('click', () => openEventDialog());
  void load();
}


function setupAdminPage(): void {
  // Works for clean (/admin/requests) and legacy (/admin/requests.html) addresses.
  const currentPage = location.pathname.split('/').at(-1)?.replace(/\.html$/, '');
  if (currentPage === 'login') {
    setupLoginPage();
    return;
  }

  api<{ user: StaffUser | null }>('/api/auth/me').then(({ user }) => {
    if (!user) {
      location.replace('/admin/login');
      return;
    }
    document.querySelectorAll<HTMLAnchorElement>('a[href="/admin/login"]').forEach((link) => {
      if (link.textContent?.trim().toLowerCase() !== 'sign out') return;
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        await api('/api/auth/logout', { method: 'POST' });
        location.assign('/admin/login');
      });
    });
    document.querySelectorAll('aside span').forEach((element) => {
      if (element.textContent?.trim() === '[Your name]') element.textContent = user.email;
    });
    if (currentPage === 'requests') renderRequestsPage(user);
    if (currentPage === 'calendar') renderCalendarPage(user);
    if (currentPage === 'applications') renderApplicationsPage(user);
    if (currentPage === 'finance') renderFinancePage(user);
    if (currentPage === 'health') renderHealthPage(user);
    if (currentPage === 'dashboard') void renderDashboard(user);
    if (currentPage === 'materials' || currentPage === 'price-list') void renderMaterials(user);
    if (currentPage === 'inventory') void renderInventory(user);
  }).catch(() => location.replace('/admin/login'));
}

function adminShell(user: StaffUser, pageTitle: string): HTMLElement {
  const shell = node('div', '', 'px-admin-shell');
  const sidebar = node('aside', '', 'px-admin-sidebar');
  const brand = node('a', '', 'px-admin-brand');
  brand.href = '/admin/dashboard';
  const logo = document.createElement('img');
  logo.src = '/assets/logo.png';
  logo.alt = 'Project X Contractors';
  brand.append(logo, node('span', 'OPERATIONS'));
  const nav = node('nav', '', 'px-admin-nav');
  for (const [label, href, active] of [
    ['Overview', '/admin/dashboard', pageTitle === 'Overview'],
    ['Requests', '/admin/requests', pageTitle === 'Requests'],
    ['Calendar', '/admin/calendar', pageTitle === 'Meeting calendar'],
    ['Materials & prices', '/admin/materials', pageTitle === 'Materials & prices'],
    ['Inventory', '/admin/inventory', pageTitle === 'Inventory'],
    ['Finance', '/admin/finance', pageTitle === 'Finance'],
    ['Health', '/admin/health', pageTitle === 'Health'],
    ['Applications', '/admin/applications', pageTitle === 'Applications'],
  ] as const) {
    const link = node('a', label, active ? 'active' : undefined);
    link.href = href;
    nav.append(link);
  }
  const userBox = node('div', '', 'px-admin-user');
  userBox.append(node('strong', user.email), node('span', `${user.role} account`));
  const logout = node('button', 'Sign out');
  logout.type = 'button';
  logout.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.assign('/admin/login');
  });
  userBox.append(logout);
  sidebar.append(brand, nav, userBox);

  const main = node('main', '', 'px-admin-main');
  const header = node('header', '', 'px-admin-header');
  const titleBlock = node('div', '', 'px-admin-title');
  titleBlock.append(node('p', 'PROJECT X · OPERATIONS'), node('h1', pageTitle));
  header.append(titleBlock);
  const content = node('section', '', 'px-admin-content');
  main.append(header, content);
  shell.append(sidebar, main);
  document.body.replaceChildren(shell);
  return content;
}

function metric(label: string, value: number | string, detail: string, href: string): HTMLAnchorElement {
  const card = node('a', '', 'px-metric') as HTMLAnchorElement;
  card.href = href;
  card.append(node('span', label), node('strong', String(value)), node('small', detail));
  return card;
}

type DashboardFinance = {
  projects: number;
  quotedProjects: number;
  quotedValue: number;
  pending: { count: number; value: number };
  approved: { count: number; value: number };
  outstanding: number;
  received: number;
  expenses: number;
  netProfit: number;
};

function renderFinance(finance: DashboardFinance): HTMLElement {
  const section = node('section', '', 'px-finance');
  const heading = node('div', '', 'px-finance-heading');
  heading.append(node('h2', 'Revenue'), node('span', 'Each project is valued at its latest quote. Declined requests are excluded.'));
  const cards = node('div', '', 'px-finance-cards');
  const card = (tone: string, label: string, value: string, detail: string) => {
    const element = node('a', '', `px-finance-card px-finance-${tone}`);
    element.href = '/admin/requests';
    element.append(node('span', label), node('strong', value), node('small', detail));
    return element;
  };
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  cards.append(
    card('total', 'Total quoted', usd.format(finance.quotedValue), `${plural(finance.projects, 'project')} · ${finance.quotedProjects} quoted`),
    card('pending', 'Awaiting approval', usd.format(finance.pending.value), `${plural(finance.pending.count, 'quote')} sent, not yet approved`),
    card('approved', 'Approved, to collect', usd.format(finance.outstanding), `${usd.format(finance.approved.value)} approved across ${plural(finance.approved.count, 'project')}`),
    card('received', 'Received', usd.format(finance.received), 'Payments minus refunds'),
  );
  const profit = card(finance.netProfit >= 0 ? 'total' : 'loss', 'Net profit', usd.format(finance.netProfit), `${usd.format(finance.received)} received − ${usd.format(finance.expenses)} expenses`);
  (profit as HTMLAnchorElement).href = '/admin/finance';
  cards.append(profit);
  // Share of approved value already collected.
  const collected = finance.approved.value > 0 ? Math.min(100, (finance.received / finance.approved.value) * 100) : 0;
  const progress = node('div', '', 'px-finance-progress');
  const bar = node('div', '', 'px-finance-bar');
  const fill = node('span', '');
  fill.style.width = `${collected}%`;
  bar.append(fill);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${collected.toFixed(0)}% of approved value collected`);
  progress.append(bar, node('small', finance.approved.value > 0 ? `${collected.toFixed(0)}% of approved value collected` : 'No approved quotes yet'));
  section.append(heading, cards, progress);
  return section;
}

async function renderDashboard(user: StaffUser): Promise<void> {
  const content = adminShell(user, 'Overview');
  const greeting = node('div', '', 'px-welcome');
  greeting.append(node('h2', 'Good morning'), node('p', 'Here are the items that need your attention.'));
  const actionLinks = node('div', '', 'px-quick-actions');
  for (const [label, href] of [['Review requests', '/admin/requests'], ['Meeting calendar', '/admin/calendar'], ['Add a material', '/admin/materials']] as const) {
    const link = node('a', label, 'px-action-link');
    link.href = href;
    actionLinks.append(link);
  }
  content.append(greeting, actionLinks);
  try {
    const [stats, requestsResult, materialsResult] = await Promise.all([
      api<{
        requests: { total: number; new: number };
        materials: { total: number; missingPrice: number; lowStock: number };
        finance: DashboardFinance;
      }>('/api/admin/dashboard'),
      api<{ requests: RequestItem[] }>('/api/admin/requests'),
      api<{ materials: Material[] }>('/api/admin/materials'),
    ]);
    const metrics = node('div', '', 'px-metrics');
    metrics.append(
      metric('New requests', stats.requests.new, `${stats.requests.total} total requests`, '/admin/requests'),
      metric('Material catalog', stats.materials.total, 'Saved items and unit prices', '/admin/materials'),
      metric('Prices to review', stats.materials.missingPrice, 'Items without a confirmed price', '/admin/materials'),
      metric('Low stock', stats.materials.lowStock, '2 or fewer units recorded', '/admin/materials'),
    );
    content.append(renderFinance(stats.finance), metrics);

    const columns = node('div', '', 'px-dashboard-columns');
    const requestPanel = node('section', '', 'px-dashboard-panel');
    requestPanel.append(node('h2', 'Latest requests'));
    if (requestsResult.requests.length === 0) requestPanel.append(node('p', 'No requests have been submitted yet.', 'px-empty'));
    for (const item of requestsResult.requests.slice(0, 5)) {
      const row = node('a', '', 'px-dashboard-row');
      row.href = '/admin/requests';
      const summary = node('span', '', 'px-dashboard-row-summary');
      summary.append(node('strong', item.name), node('small', item.projectType));
      const quoteSummary = lastQuoteSummary(item);
      if (quoteSummary) summary.append(node('span', quoteSummary.label, `px-quote-sent-tag${quoteSummary.sent ? '' : ' unsent'}`));
      else if (awaitingQuote(item)) summary.append(node('span', 'Awaiting price quote', 'px-quote-pending-tag'));
      row.href = `/admin/requests?request=${encodeURIComponent(item.id)}`;
      row.append(summary, node('span', statusLabels[item.status], `px-status px-status-${item.status}`), node('small', item.propertyAddress));
      requestPanel.append(row);
    }

    const materialsPanel = node('section', '', 'px-dashboard-panel');
    const panelHeading = node('div', '', 'px-panel-heading');
    panelHeading.append(node('h2', 'Recently updated materials'));
    const viewAll = node('a', 'View catalog');
    viewAll.href = '/admin/materials';
    panelHeading.append(viewAll);
    materialsPanel.append(panelHeading);
    if (materialsResult.materials.length === 0) materialsPanel.append(node('p', 'Your catalog is empty. Add a material to start building the price list.', 'px-empty'));
    for (const item of materialsResult.materials.slice(0, 5)) {
      const row = node('div', '', 'px-dashboard-row');
      const summary = node('span', '', 'px-dashboard-row-summary');
      summary.append(node('strong', item.name), node('small', `${item.category} · ${item.supplier || 'Supplier not set'}`));
      row.append(summary, node('strong', `$${item.unitPrice.toFixed(2)} / ${item.unit}`));
      materialsPanel.append(row);
    }
    columns.append(requestPanel, materialsPanel);
    content.append(columns);
  } catch (error) {
    content.append(node('p', error instanceof Error ? error.message : 'Dashboard data could not be loaded.', 'px-request-error'));
  }
}

function formField(labelText: string, input: HTMLElement, className?: string): HTMLLabelElement {
  const label = node('label', '', className);
  label.append(node('span', labelText), input);
  return label;
}

const materialCategories = ['Lumber', 'Drywall', 'Tile', 'Fasteners', 'Electrical', 'Plumbing', 'Bathroom', 'Balcony & deck', 'Paint & primer', 'Equipment rental', 'Labor & fees', 'Other'];
const materialUnits = ['each', 'sheet', 'sq ft', 'linear ft', 'box', 'bag', 'gallon', 'bucket', 'hour', 'day', 'project'];
const priceSourceLabels: Record<string, string> = {
  manual: 'Manual / retailer price check', invoice: 'Supplier invoice', csv: 'CSV price sheet', supplier_api: 'Authorized supplier API / feed',
};

function selectField(name: string, options: Array<[string, string]>, value: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.name = name;
  for (const [optionValue, label] of options) {
    const option = document.createElement('option'); option.value = optionValue; option.textContent = label; select.append(option);
  }
  // Keep values saved before the option lists changed selectable.
  if (value && !options.some(([optionValue]) => optionValue === value)) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
  }
  select.value = value || options[0][0];
  return select;
}

async function renderMaterials(user: StaffUser): Promise<void> {
  const content = adminShell(user, 'Materials & prices');
  let materials: Material[] = [];

  const toolbar = node('div', '', 'px-materials-toolbar');
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'Search name, SKU or supplier'; search.setAttribute('aria-label', 'Search materials');
  const categoryFilter = selectField('categoryFilter', [['', 'All categories'], ...materialCategories.map((c) => [c, c] as [string, string])], '');
  categoryFilter.setAttribute('aria-label', 'Filter by category');
  const addButton = node('button', '+ Add material', 'px-action-link');
  addButton.type = 'button';
  toolbar.append(search, categoryFilter, addButton);

  const panel = node('section', '', 'px-dashboard-panel');
  const heading = node('div', '', 'px-panel-heading');
  const count = node('span', 'Loading…');
  heading.append(node('h2', 'Material catalog'), count);
  const status = node('p', '', 'px-materials-status');
  status.setAttribute('role', 'status');
  const tableWrap = node('div', '', 'px-material-table-wrap');
  const table = document.createElement('table');
  table.className = 'px-material-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const title of ['Material', 'Category', 'Unit price', 'Supplier / source', 'Stock', '']) headRow.append(node('th', title));
  head.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(head, tbody);
  tableWrap.append(table);
  panel.append(heading, status, tableWrap);

  const guide = document.createElement('details');
  guide.className = 'px-source-guide px-materials-guide';
  guide.append(node('summary', 'Where should prices come from?'));
  guide.append(node('p', 'Lowe’s store prices are location-specific. Catalog items marked with a store and date are snapshots, not a live feed. Open the product link and verify before quoting; authorized Pro catalog/EDI access is needed for automatic updates.'));
  const sourceList = node('ul', '');
  sourceList.append(
    node('li', 'Lowe’s: checked product links and a store snapshot. Ask Lowe’s Pro for authorized catalog/EDI/API access before automating; do not scrape store pages.'),
    node('li', 'TW Perry and other local distributors: request your account-specific price file, EDI/API access, and update schedule from the rep.'),
    node('li', 'Gordian RSMeans: paid construction cost data for estimating benchmarks, not a live local shelf-price feed.'),
  );
  guide.append(sourceList);

  content.append(node('p', 'Keep one reviewed price per unit. Add, edit, or remove items here; change stock in Inventory so every movement is recorded.', 'px-admin-intro'), toolbar, panel, guide);

  function showStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function render(): void {
    const query = search.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const visible = materials.filter((item) => (!category || item.category === category)
      && (!query || [item.name, item.sku, item.supplier].some((value) => (value ?? '').toLowerCase().includes(query))));
    count.textContent = visible.length === materials.length ? `${materials.length} saved` : `${visible.length} of ${materials.length}`;
    tbody.replaceChildren();
    if (!visible.length) {
      const row = document.createElement('tr');
      const empty = node('td', materials.length ? 'No materials match this search.' : 'No materials yet. Use “+ Add material” to add your first item.');
      empty.colSpan = 6;
      row.append(empty);
      tbody.append(row);
      return;
    }
    for (const item of visible) {
      const row = document.createElement('tr');
      const nameCell = node('td', '', 'px-material-name-cell');
      const preview = document.createElement('img');
      preview.className = 'px-material-thumbnail';
      preview.src = item.imageUrl || '/assets/interior.jpg';
      preview.alt = '';
      preview.loading = 'lazy';
      preview.onerror = () => { preview.src = '/assets/interior.jpg'; };
      const nameText = node('span', '', 'px-material-name-copy');
      nameText.append(node('strong', item.name), node('small', item.sku ? `SKU ${item.sku}` : item.unit));
      nameCell.append(preview, nameText);
      const vendor = node('td', item.supplier || 'Supplier not set');
      if (item.supplierUrl) {
        const link = node('a', 'Open product');
        link.href = item.supplierUrl; link.target = '_blank'; link.rel = 'noreferrer';
        vendor.append(link);
      }
      vendor.append(node('small', [item.supplierStore, item.priceCheckedAt ? `checked ${new Date(`${item.priceCheckedAt.replace(' ', 'T')}Z`).toLocaleDateString()}` : priceSourceLabels[item.priceSource] ?? item.priceSource].filter(Boolean).join(' · ')));
      const actions = node('td', '', 'px-material-actions');
      const edit = node('button', 'Edit', 'px-row-action');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit ${item.name}`);
      edit.addEventListener('click', () => openMaterialDialog(item));
      const remove = node('button', 'Remove', 'px-row-action danger');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${item.name}`);
      remove.addEventListener('click', () => confirmRemove(item));
      actions.append(edit, remove);
      row.append(nameCell, node('td', item.category), node('td', `$${item.unitPrice.toFixed(2)} / ${item.unit}`), vendor, node('td', String(item.stockQty), item.stockQty <= 2 ? 'px-stock-low' : ''), actions);
      tbody.append(row);
    }
  }

  async function load(): Promise<void> {
    try {
      materials = (await api<{ materials: Material[] }>('/api/admin/materials')).materials;
      render();
    } catch (error) {
      count.textContent = 'Unavailable';
      showStatus(error instanceof Error ? error.message : 'Could not load materials.', true);
    }
  }

  function openMaterialDialog(existing?: Material): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'px-followup-dialog px-material-dialog';
    const top = node('div', '', 'px-followup-heading');
    const titleBlock = node('div', '');
    titleBlock.append(node('p', existing ? 'EDIT MATERIAL' : 'NEW MATERIAL'), node('h2', existing ? existing.name : 'Add a material'));
    const close = node('button', 'Close', 'px-dialog-close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    top.append(titleBlock, close);

    const form = document.createElement('form');
    form.className = 'px-material-form';
    const text = (name: string, value: string, options: { type?: string; placeholder?: string; maxLength?: number; required?: boolean } = {}) => {
      const input = document.createElement('input');
      input.name = name; input.type = options.type ?? 'text'; input.value = value;
      if (options.placeholder) input.placeholder = options.placeholder;
      if (options.maxLength) input.maxLength = options.maxLength;
      input.required = Boolean(options.required);
      return input;
    };
    const name = text('name', existing?.name ?? '', { placeholder: 'e.g. Type X drywall, 5/8 in.', maxLength: 180, required: true });
    name.minLength = 2;
    const category = selectField('category', materialCategories.map((c) => [c, c]), existing?.category ?? '');
    const unit = selectField('unit', materialUnits.map((u) => [u, u]), existing?.unit ?? '');
    const price = text('unitPrice', existing ? existing.unitPrice.toFixed(2) : '', { type: 'number', placeholder: '0.00', required: true });
    price.min = '0'; price.step = '0.01';
    const supplier = text('supplier', existing?.supplier ?? '', { placeholder: 'e.g. TW Perry', maxLength: 120 });
    const sku = text('sku', existing?.sku ?? '', { placeholder: 'Optional item code', maxLength: 80 });
    const supplierUrl = text('supplierUrl', existing?.supplierUrl ?? '', { type: 'url', placeholder: 'https://www.lowes.com/pd/...', maxLength: 500 });
    const supplierStore = text('supplierStore', existing?.supplierStore ?? '', { placeholder: 'e.g. Washington, DC #3256', maxLength: 160 });
    const imageUrl = text('imageUrl', existing?.imageUrl?.startsWith('http') ? existing.imageUrl : '', { type: 'url', placeholder: 'Product image URL (optional)', maxLength: 500 });
    const source = selectField('priceSource', Object.entries(priceSourceLabels), existing?.priceSource ?? 'manual');
    form.append(
      formField('Material name', name, 'px-wide-field'), formField('Category', category), formField('Unit', unit),
      formField('Unit price (USD)', price), formField('Price source', source),
      formField('Supplier', supplier), formField('Supplier SKU', sku),
      formField('Supplier product URL', supplierUrl, 'px-wide-field'),
      formField('Store / ZIP used for price', supplierStore), formField('Product thumbnail URL', imageUrl),
    );
    let stock: HTMLInputElement | null = null;
    if (existing) {
      form.append(node('p', `On-hand stock: ${existing.stockQty} ${existing.unit}. Change it in Inventory so the movement is recorded.`, 'px-material-stock-note'));
      if (existing.imageUrl && !existing.imageUrl.startsWith('http')) {
        form.append(node('p', 'This item uses a saved thumbnail. Leave the thumbnail URL empty to keep it.', 'px-material-stock-note'));
      }
    } else {
      stock = text('stockQty', '0', { type: 'number' });
      stock.min = '0'; stock.step = '1';
      form.append(formField('Starting stock', stock));
    }
    const error = node('p', '', 'px-materials-status error');
    error.setAttribute('role', 'alert');
    const save = node('button', existing ? 'Save changes' : 'Add material', 'px-save-button');
    save.type = 'submit';
    form.append(error, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      error.textContent = '';
      const keptImage = existing?.imageUrl && !existing.imageUrl.startsWith('http') && !imageUrl.value ? existing.imageUrl : imageUrl.value;
      const body = {
        name: name.value, category: category.value, unit: unit.value, unitPrice: Number(price.value), priceSource: source.value,
        supplier: supplier.value, sku: sku.value, supplierUrl: supplierUrl.value, supplierStore: supplierStore.value,
        imageUrl: keptImage,
        ...(stock ? { stockQty: Number(stock.value) } : {}),
      };
      try {
        const result = await api<{ message: string }>(existing ? `/api/admin/materials/${existing.id}` : '/api/admin/materials', {
          method: existing ? 'PATCH' : 'POST', body: JSON.stringify(body),
        });
        dialog.close();
        showStatus(result.message);
        await load();
      } catch (saveError) {
        error.textContent = saveError instanceof Error ? saveError.message : 'Material could not be saved.';
      } finally {
        save.disabled = false;
      }
    });
    dialog.append(top, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.showModal();
    name.focus();
  }

  function confirmRemove(item: Material): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'px-followup-dialog px-confirm-dialog';
    const body = node('div', '', 'px-confirm-body');
    body.append(
      node('h2', `Remove “${item.name}”?`),
      node('p', 'It will disappear from the catalog, Inventory and quote item lists. Past quotes and stock history keep their records.'),
    );
    const actions = node('div', '', 'px-confirm-actions');
    const cancel = node('button', 'Cancel', 'px-row-action');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const confirm = node('button', 'Remove material', 'px-row-action danger solid');
    confirm.type = 'button';
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        const result = await api<{ message: string }>(`/api/admin/materials/${item.id}`, { method: 'DELETE' });
        dialog.close();
        showStatus(`${item.name}: ${result.message}`);
        await load();
      } catch (removeError) {
        confirm.disabled = false;
        body.append(node('p', removeError instanceof Error ? removeError.message : 'Could not remove the material.', 'px-materials-status error'));
      }
    });
    actions.append(cancel, confirm);
    body.append(actions);
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    cancel.focus();
  }

  search.addEventListener('input', render);
  categoryFilter.addEventListener('change', render);
  addButton.addEventListener('click', () => openMaterialDialog());
  await load();
}


type StockAction = 'receive' | 'use' | 'count';
const stockActionLabels: Record<StockAction, string> = { receive: 'Receive', use: 'Use / issue', count: 'Set count' };
const stockNoteSuggestions: Record<StockAction, string[]> = {
  receive: ['Supplier delivery', 'Invoice #', 'Returned from job site'],
  use: ['Used on job', 'Issued to crew', 'Damaged / discarded'],
  count: ['Physical count', 'Annual stocktake', 'Correction after audit'],
};
const roundQty = (value: number) => Math.round(value * 100) / 100;

async function renderInventory(user: StaffUser): Promise<void> {
  const content = adminShell(user, 'Inventory');
  let items: Material[] = [];
  let movements: InventoryMovement[] = [];
  let flashId = '';

  const introRow = node('div', '', 'px-inventory-intro-row');
  introRow.append(node('p', 'Receive, use, or count stock. Every change is saved with the staff member, a note, and the time.', 'px-admin-intro'));
  const recordButton = node('button', '+ Record movement', 'px-action-link');
  recordButton.type = 'button';
  introRow.append(recordButton);
  const summary = node('div', '', 'px-metrics px-inventory-metrics');
  const status = node('p', '', 'px-materials-status');
  status.setAttribute('role', 'status');

  const stockPanel = node('section', '', 'px-dashboard-panel');
  const stockHeading = node('div', '', 'px-panel-heading');
  const stockCount = node('span', 'Loading…');
  stockHeading.append(node('h2', 'Current stock'), stockCount);
  const toolbar = node('div', '', 'px-materials-toolbar px-inventory-toolbar');
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'Search materials'; search.setAttribute('aria-label', 'Search stock');
  const lowOnly = document.createElement('label');
  lowOnly.className = 'px-inventory-low-toggle';
  const lowCheckbox = document.createElement('input');
  lowCheckbox.type = 'checkbox';
  lowOnly.append(lowCheckbox, document.createTextNode(' Reorder only'));
  toolbar.append(search, lowOnly);
  const tableWrap = node('div', '', 'px-material-table-wrap');
  const table = document.createElement('table');
  table.className = 'px-material-table px-inventory-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const heading of ['Material', 'On hand', 'Unit value', 'Stock value', 'Status', '']) headRow.append(node('th', heading));
  head.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(head, tbody);
  tableWrap.append(table);
  stockPanel.append(stockHeading, toolbar, tableWrap);

  const movementPanel = node('section', '', 'px-dashboard-panel');
  movementPanel.append(node('h2', 'Recent stock movements'));
  const movementList = node('div', '', 'px-movement-list');
  movementPanel.append(movementList);
  const layout = node('div', '', 'px-inventory-layout');
  layout.append(stockPanel, movementPanel);
  content.append(introRow, summary, status, layout);

  function showStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function renderStock(): void {
    const query = search.value.trim().toLowerCase();
    const visible = items.filter((item) => (!lowCheckbox.checked || item.stockQty <= 2)
      && (!query || `${item.name} ${item.category}`.toLowerCase().includes(query)));
    stockCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    recordButton.disabled = items.length === 0;
    tbody.replaceChildren();
    if (!visible.length) {
      const row = document.createElement('tr');
      const empty = node('td', items.length ? 'No materials match this view.' : 'No materials in inventory yet. Add one in Materials & prices first.');
      empty.colSpan = 6;
      row.append(empty); tbody.append(row);
      return;
    }
    for (const item of visible) {
      const row = document.createElement('tr');
      if (item.id === flashId) row.className = 'px-row-flash';
      const itemCell = node('td', item.name);
      itemCell.append(node('small', `${item.category} · ${item.unit}`));
      const low = item.stockQty <= 2;
      const actions = node('td', '', 'px-material-actions');
      for (const action of ['receive', 'use', 'count'] as const) {
        const button = node('button', action === 'receive' ? '+ Receive' : action === 'use' ? '− Use' : 'Count', `px-row-action${action === 'receive' ? ' positive' : ''}`);
        button.type = 'button';
        button.setAttribute('aria-label', `${stockActionLabels[action]}: ${item.name}`);
        button.disabled = action === 'use' && item.stockQty <= 0;
        button.addEventListener('click', () => openMovementDialog(item.id, action));
        actions.append(button);
      }
      row.append(itemCell, node('td', `${roundQty(item.stockQty)} ${item.unit}`, 'px-inventory-qty'), node('td', `$${item.unitPrice.toFixed(2)}`),
        node('td', `$${(item.unitPrice * item.stockQty).toFixed(2)}`), node('td', low ? 'Reorder' : 'In stock', low ? 'px-stock-low' : 'px-stock-ok'), actions);
      tbody.append(row);
    }
  }

  function renderMovements(): void {
    movementList.replaceChildren();
    if (!movements.length) movementList.append(node('p', 'No stock movements recorded yet.', 'px-empty'));
    for (const movement of movements) {
      const row = node('div', '', 'px-movement-row');
      const quantityText = `${movement.quantityChange > 0 ? '+' : ''}${roundQty(movement.quantityChange)} ${movement.unit}`;
      const details = node('div', '', 'px-movement-details');
      details.append(node('strong', movement.materialName), node('span', movement.note), node('small', `${movement.actorEmail} · ${new Date(`${movement.createdAt.replace(' ', 'T')}Z`).toLocaleString()}`));
      row.append(node('strong', quantityText, movement.quantityChange > 0 ? 'positive' : 'negative'), details);
      movementList.append(row);
    }
  }

  async function load(): Promise<void> {
    try {
      const result = await api<{
        inventory: { itemCount: number; unitCount: number; lowStockCount: number; stockValue: number };
        items: Material[];
        movements: InventoryMovement[];
      }>('/api/admin/inventory');
      items = result.items;
      movements = result.movements;
      summary.replaceChildren(
        metric('Catalog items', result.inventory.itemCount, 'Materials tracked', '/admin/materials'),
        metric('Units on hand', roundQty(result.inventory.unitCount), 'Across all catalog items', '/admin/inventory'),
        metric('Low stock', result.inventory.lowStockCount, '2 units or fewer', '/admin/inventory'),
        metric('Recorded value', `$${result.inventory.stockValue.toFixed(2)}`, 'Based on saved unit prices', '/admin/inventory'),
      );
      renderStock();
      renderMovements();
    } catch (error) {
      stockCount.textContent = 'Unavailable';
      showStatus(error instanceof Error ? error.message : 'Could not load inventory.', true);
    }
  }

  function openMovementDialog(materialId: string, initialAction: StockAction): void {
    let action = initialAction;
    let material = items.find((item) => item.id === materialId) ?? items[0];
    if (!material) return;

    const dialog = document.createElement('dialog');
    dialog.className = 'px-followup-dialog px-stock-dialog';
    const top = node('div', '', 'px-followup-heading');
    const titleBlock = node('div', '');
    const title = node('h2', '');
    titleBlock.append(node('p', 'STOCK MOVEMENT'), title);
    const close = node('button', 'Close', 'px-dialog-close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    top.append(titleBlock, close);

    const form = document.createElement('form');
    form.className = 'px-stock-movement-form';
    const tabs = node('div', '', 'px-stock-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabButtons = new Map<StockAction, HTMLButtonElement>();
    for (const option of ['receive', 'use', 'count'] as const) {
      const tab = node('button', stockActionLabels[option], `px-stock-tab px-stock-tab-${option}`);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => { action = option; quantity.value = ''; note.value = ''; update(); quantity.focus(); });
      tabButtons.set(option, tab);
      tabs.append(tab);
    }

    const materialSelect = selectField('materialId', items.map((item) => [item.id, `${item.name} · ${roundQty(item.stockQty)} ${item.unit}`]), material.id);
    materialSelect.addEventListener('change', () => {
      material = items.find((item) => item.id === materialSelect.value) ?? material;
      update();
    });

    const quantityLabel = node('span', '');
    const quantity = document.createElement('input');
    quantity.type = 'number'; quantity.min = '0'; quantity.step = 'any'; quantity.inputMode = 'decimal'; quantity.required = true;
    quantity.setAttribute('aria-label', 'Quantity');
    const stepper = node('div', '', 'px-stock-stepper');
    const minus = node('button', '−', 'px-stock-step');
    minus.type = 'button'; minus.setAttribute('aria-label', 'Decrease by 1');
    const plus = node('button', '+', 'px-stock-step');
    plus.type = 'button'; plus.setAttribute('aria-label', 'Increase by 1');
    const unitTag = node('span', '', 'px-stock-unit');
    minus.addEventListener('click', () => { quantity.value = String(Math.max(0, roundQty((Number(quantity.value) || 0) - 1))); update(); });
    plus.addEventListener('click', () => { quantity.value = String(roundQty((Number(quantity.value) || 0) + 1)); update(); });
    quantity.addEventListener('input', update);
    stepper.append(minus, quantity, plus, unitTag);
    const quantityField = node('label', '', 'px-stock-field');
    quantityField.append(quantityLabel, stepper);

    const preview = node('div', '', 'px-stock-preview');
    preview.setAttribute('aria-live', 'polite');

    const note = document.createElement('input');
    note.required = true; note.minLength = 3; note.maxLength = 300;
    note.placeholder = 'Invoice number, job name, or reason';
    const noteField = node('label', '', 'px-stock-field');
    noteField.append(node('span', 'Note / reference'), note);
    const chips = node('div', '', 'px-stock-chips');

    const error = node('p', '', 'px-materials-status error');
    error.setAttribute('role', 'alert');
    const save = node('button', '', 'px-save-button');
    save.type = 'submit';
    form.append(tabs, formField('Material', materialSelect, 'px-stock-field'), quantityField, preview, noteField, chips, error, save);

    // Change that will be sent, or null when the input cannot produce a valid movement.
    function change(): number | null {
      const entered = Number(quantity.value);
      if (quantity.value === '' || !Number.isFinite(entered) || entered < 0) return null;
      if (action === 'count') return roundQty(entered - material.stockQty);
      if (entered === 0) return null;
      return action === 'receive' ? roundQty(entered) : -roundQty(entered);
    }

    function update(): void {
      title.textContent = `${stockActionLabels[action]} · ${material.name}`;
      for (const [option, tab] of tabButtons) {
        tab.classList.toggle('active', option === action);
        tab.setAttribute('aria-selected', String(option === action));
      }
      quantityLabel.textContent = action === 'count' ? 'Counted on hand' : action === 'receive' ? 'Quantity received' : 'Quantity used';
      unitTag.textContent = material.unit;
      const delta = change();
      const current = roundQty(material.stockQty);
      const after = delta === null ? null : roundQty(current + delta);
      preview.replaceChildren();
      const now = node('div', '', 'px-stock-preview-cell');
      now.append(node('span', 'Now'), node('strong', `${current} ${material.unit}`));
      const next = node('div', '', 'px-stock-preview-cell');
      next.append(node('span', 'After'), node('strong', after === null ? '—' : `${after} ${material.unit}`));
      const diff = node('div', '', 'px-stock-preview-cell');
      diff.append(node('span', 'Change'), node('strong', delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`));
      preview.append(now, node('span', '→', 'px-stock-preview-arrow'), next, diff);
      const negative = after !== null && after < 0;
      const noChange = action === 'count' && delta === 0;
      preview.classList.toggle('invalid', negative);
      preview.classList.toggle('up', delta !== null && delta > 0);
      preview.classList.toggle('down', delta !== null && delta < 0);
      error.textContent = negative ? `Only ${current} ${material.unit} on hand — you cannot use more than that.` : noChange ? 'The count matches current stock; nothing to record.' : '';
      save.disabled = delta === null || negative || delta === 0;
      save.textContent = action === 'receive' ? 'Add to stock' : action === 'use' ? 'Remove from stock' : 'Save count';
      chips.replaceChildren();
      for (const suggestion of stockNoteSuggestions[action]) {
        const chip = node('button', suggestion, 'px-stock-chip');
        chip.type = 'button';
        chip.addEventListener('click', () => { note.value = suggestion.endsWith('#') ? `${suggestion} ` : suggestion; note.focus(); });
        chips.append(chip);
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const delta = change();
      if (delta === null || delta === 0 || !form.reportValidity()) return;
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        await api('/api/admin/inventory/movements', {
          method: 'POST',
          // expectedStock lets the server reject the change if someone else moved stock since this window opened.
          body: JSON.stringify({ materialId: material.id, quantityChange: delta, note: note.value, expectedStock: material.stockQty }),
        });
        const name = material.name;
        flashId = material.id;
        dialog.close();
        await load();
        showStatus(`${name}: ${delta > 0 ? '+' : ''}${delta} ${material.unit} recorded.`);
      } catch (saveError) {
        error.textContent = saveError instanceof Error ? saveError.message : 'Stock movement could not be saved.';
        // Refresh so the preview uses the latest stock before the user retries.
        await load();
        material = items.find((item) => item.id === material.id) ?? material;
        materialSelect.replaceChildren(...items.map((item) => {
          const option = document.createElement('option');
          option.value = item.id; option.textContent = `${item.name} · ${roundQty(item.stockQty)} ${item.unit}`;
          return option;
        }));
        materialSelect.value = material.id;
        const message = error.textContent;
        update();
        error.textContent = message;
      }
    });

    dialog.append(top, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    update();
    dialog.showModal();
    quantity.focus();
  }

  search.addEventListener('input', renderStock);
  lowCheckbox.addEventListener('change', renderStock);
  recordButton.addEventListener('click', () => { if (items.length) openMovementDialog(items[0].id, 'receive'); });
  await load();
}


function setupProjectGallery(): void {
  const grid = document.querySelector<HTMLElement>('[data-project-grid]');
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLAnchorElement>('[data-project-photo]')];
  const filterButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-project-filters] [data-filter]')];
  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      for (const other of filterButtons) {
        const active = other === button;
        other.setAttribute('aria-pressed', String(active));
        other.style.background = active ? '#3fb0d8' : 'transparent';
        other.style.color = active ? '#08131a' : '#eef4f8';
        other.style.borderColor = active ? '#3fb0d8' : '#263644';
      }
      for (const card of cards) card.hidden = filter !== 'all' && card.dataset.category !== filter;
    });
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'px-lightbox';
  dialog.setAttribute('aria-label', 'Project photo');
  const image = document.createElement('img');
  const caption = node('p', '', 'px-lightbox-caption');
  const close = node('button', '×', 'px-lightbox-close');
  close.type = 'button'; close.setAttribute('aria-label', 'Close photo');
  const previous = node('button', '‹', 'px-lightbox-nav px-lightbox-prev');
  previous.type = 'button'; previous.setAttribute('aria-label', 'Previous photo');
  const next = node('button', '›', 'px-lightbox-nav px-lightbox-next');
  next.type = 'button'; next.setAttribute('aria-label', 'Next photo');
  const figure = node('figure', '', 'px-lightbox-figure');
  figure.append(image, caption);
  dialog.append(figure, previous, next, close);
  document.body.append(dialog);

  let index = 0;
  const visibleCards = () => cards.filter((card) => !card.hidden);
  function show(card: HTMLAnchorElement): void {
    const preview = card.querySelector('img')!;
    image.src = card.href;
    image.alt = preview.alt;
    const texts = [...card.querySelectorAll(':scope > span')].map((element) => element.textContent?.trim() ?? '');
    caption.replaceChildren(node('strong', texts[1] ?? ''), document.createTextNode(texts[2] ? ` · ${texts[2]}` : ''));
    index = visibleCards().indexOf(card);
    if (!dialog.open) dialog.showModal();
  }
  function step(direction: number): void {
    const list = visibleCards();
    if (list.length) show(list[(index + direction + list.length) % list.length]);
  }
  for (const card of cards) {
    card.addEventListener('click', (event) => {
      event.preventDefault();
      show(card);
    });
  }
  close.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
}

const runtimeStyles = document.createElement('style');
runtimeStyles.textContent = `
.px-inbox-row{display:flex;flex-direction:column;gap:6px;padding:16px 20px;border-bottom:1px solid #263644;border-left:3px solid transparent;text-decoration:none;color:#eef4f8;font-size:13px}
.px-inbox-row:hover{background:#1b2a36;border-left-color:#3fb0d8}
.px-inbox-row>span:last-child{font-size:12px;color:#9fb0bf}
.px-inbox-row-top,.px-request-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
.px-request-status{padding:4px 9px;color:#9cc3ff;background:#16263d;font-size:11px;font-weight:700}
.px-request-detail{padding:24px;display:flex;flex-direction:column;gap:20px;color:#eef4f8}
.px-request-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 18px}
.px-request-field{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:1px solid #263644;overflow-wrap:anywhere}
.px-request-field span:first-child{font-size:10px;font-weight:800;letter-spacing:.14em;color:#9fb0bf}
.px-request-field span:last-child{font-size:14px;font-weight:600;line-height:1.5}
.px-request-field:last-child{grid-column:1/-1}
.px-request-actions{display:flex;flex-wrap:wrap;gap:10px}
.px-request-actions button{min-height:42px;padding:0 13px;color:#eef4f8;background:transparent;border:1px solid #3a5263;font-size:10px;font-weight:800;letter-spacing:.08em}
.px-request-actions button:hover{border-color:#3fb0d8;color:#3fb0d8}
.px-inbox-empty,.px-request-error{margin:0;padding:20px;color:#9fb0bf;font-size:13px;line-height:1.5}
.px-request-error{color:#ffaaa0}
.px-admin-shell{min-height:100vh;display:grid;grid-template-columns:230px minmax(0,1fr);background:#f3f6f5;color:#18272d;font-family:'DM Sans',Arial,sans-serif}
.px-admin-sidebar{position:sticky;top:0;height:100vh;padding:24px 16px;background:#12242b;color:#edf3f4;display:flex;flex-direction:column;gap:28px}
.px-admin-brand{display:flex;flex-direction:column;gap:10px;padding:2px 8px;text-decoration:none;color:#edf3f4;font-size:10px;font-weight:800;letter-spacing:.19em}
.px-admin-brand img{width:150px;height:auto;max-height:55px;object-fit:contain;object-position:left center}
.px-admin-nav{display:flex;flex-direction:column;gap:5px}
.px-admin-nav a{padding:12px 13px;border-radius:4px;color:#c3d0d3;text-decoration:none;font-size:13px;font-weight:700}
.px-admin-nav a:hover,.px-admin-nav a.active{background:#203942;color:#7dd1e5}
.px-admin-user{margin-top:auto;display:flex;flex-direction:column;gap:5px;padding:16px 8px 0;border-top:1px solid #31454b;font-size:12px}
.px-admin-user span{color:#a8b8bc;font-size:11px;text-transform:capitalize}
.px-admin-user button{align-self:flex-start;margin-top:8px;padding:0;color:#c9d4d6;background:none;border:0;font-size:12px;text-decoration:underline}
.px-admin-main{min-width:0}
.px-admin-header{min-height:92px;padding:22px clamp(20px,4vw,58px);display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #dce5e3}
.px-admin-title p{margin:0 0 5px;color:#59828d;font-size:9px;font-weight:800;letter-spacing:.18em}
.px-admin-title h1{margin:0;font:800 25px/1.2 'Manrope','DM Sans',sans-serif;color:#17272e}
.px-admin-content{max-width:1500px;margin:auto;padding:30px clamp(20px,4vw,58px) 60px}
.px-welcome{display:flex;align-items:baseline;justify-content:space-between;gap:16px}
.px-welcome h2{margin:0;font:800 20px 'Manrope','DM Sans',sans-serif}
.px-welcome p,.px-admin-intro{color:#60747b;font-size:13px;line-height:1.6}
.px-quick-actions{display:flex;gap:10px;margin:17px 0 22px}
.px-action-link,.px-save-button{min-height:42px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;background:#176d7f;color:#fff;border:0;border-radius:3px;text-decoration:none;font-size:12px;font-weight:800}
.px-action-link:hover,.px-save-button:hover{background:#125767}
.px-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.px-metric{min-height:132px;padding:17px 18px;display:flex;flex-direction:column;gap:7px;background:#fff;border:1px solid #dce5e3;border-top:3px solid #3a9eb0;text-decoration:none;color:#19292f}
.px-metric span{color:#5d7077;font-size:11px;font-weight:700}
.px-metric strong{font:800 31px 'Manrope','DM Sans',sans-serif}
.px-metric small{color:#788a8e;font-size:10px}
.px-dashboard-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
.px-dashboard-panel{min-width:0;background:#fff;border:1px solid #dce5e3;border-radius:4px}
.px-dashboard-panel>h2,.px-panel-heading{margin:0;padding:16px 18px;border-bottom:1px solid #e4eae8;font:800 14px 'Manrope','DM Sans',sans-serif}
.px-panel-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}
.px-panel-heading h2{margin:0;font:800 14px 'Manrope','DM Sans',sans-serif}
.px-panel-heading a,.px-panel-heading span{font-size:11px;color:#176d7f}
.px-dashboard-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 17px;border-bottom:1px solid #edf0ef;color:#23343a;text-decoration:none;font-size:12px}
.px-dashboard-row:last-child{border-bottom:0}
.px-dashboard-row-summary{min-width:0;display:flex;flex-direction:column;gap:4px}
.px-dashboard-row-summary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.px-dashboard-row small{color:#77878c;font-size:10px}
.px-dashboard-row>strong{white-space:nowrap;font-size:11px}
.px-status{padding:4px 7px;background:#edf5f1;color:#327352;border-radius:2px;font-size:10px;text-transform:uppercase}
.px-empty{padding:18px;color:#708087;font-size:12px;line-height:1.6}
.px-admin-intro{margin:0 0 18px}
.px-material-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(290px,.8fr);gap:16px;align-items:start}
.px-material-table-wrap{overflow:auto}
.px-material-table{width:100%;border-collapse:collapse;text-align:left}
.px-material-table th{padding:11px 13px;background:#f7f9f8;color:#74848a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.px-material-table td{padding:12px 13px;border-top:1px solid #edf0ef;color:#33464c;font-size:11px;vertical-align:top}
.px-material-table td:first-child{min-width:160px;font-weight:700}
.px-material-table td.px-material-name-cell{min-width:245px;font-weight:400}
.px-material-thumbnail{width:56px;height:46px;flex:none;object-fit:cover;border:1px solid #dce5e3;border-radius:3px;background:#f1f5f4}
.px-material-name-copy{min-width:0;display:flex;flex-direction:column;gap:4px}
.px-material-name-copy strong{font-size:11px;line-height:1.45;color:#263a40}
.px-material-name-cell{display:flex;align-items:center;gap:10px}
.px-material-table td small{display:block;margin-top:4px;color:#819095;font-size:10px;font-weight:400;text-transform:capitalize}
.px-material-side{display:flex;flex-direction:column;gap:14px}
.px-material-form{padding:15px 17px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.px-material-form label{display:flex;flex-direction:column;gap:6px;color:#52666c;font-size:10px;font-weight:700}
.px-material-form label:first-child,.px-material-form label:nth-child(5),.px-material-form label:nth-child(8){grid-column:1/-1}
.px-material-form label.px-wide-field{grid-column:1/-1}
.px-material-form input,.px-material-form select{width:100%;min-width:0;min-height:38px;padding:8px 9px;color:#23343a;background:#fff;border:1px solid #cbd6d4;border-radius:3px;font:12px 'DM Sans',sans-serif}
.px-save-button{grid-column:1/-1;width:100%;cursor:pointer}
.px-save-button:disabled{opacity:.6}
.px-source-guide{padding:17px 18px;background:#e8f2f1;border-left:3px solid #348c99;border-radius:2px}
.px-source-guide h2{margin:0 0 9px;font:800 13px 'Manrope','DM Sans',sans-serif}
.px-source-guide p,.px-source-guide li,.px-source-guide small{color:#4c6268;font-size:10px;line-height:1.6}
.px-source-guide ul{padding-left:18px}
.px-source-guide li{margin:6px 0}
.px-requests-toolbar{display:flex;gap:10px;margin-bottom:14px}
.px-requests-toolbar input{width:min(100%,480px);min-height:42px;padding:0 12px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-refresh-button{min-height:42px;padding:0 15px;border:1px solid #b9cbca;border-radius:3px;background:#fff;color:#315860;font-size:11px;font-weight:800}
.px-refresh-button:hover{border-color:#258da0;color:#176d7f}
.px-request-summary{display:grid;grid-template-columns:repeat(3,minmax(0,220px));gap:10px;margin-bottom:14px}
.px-request-summary .px-metric{min-height:94px;padding:12px 15px;border-top-width:2px}
.px-request-summary .px-metric strong{font-size:24px}
.px-request-filters{display:flex;gap:7px;overflow:auto;padding:0 0 14px}
.px-filter-button{min-height:34px;padding:0 11px;white-space:nowrap;border:1px solid #d1dcda;border-radius:3px;background:#fff;color:#52686e;font-size:10px;font-weight:700;text-transform:capitalize}
.px-filter-button.active{border-color:#176d7f;background:#e6f3f4;color:#176d7f}
.px-request-workspace{display:grid;grid-template-columns:minmax(270px,.8fr) minmax(0,1.2fr);gap:14px;align-items:start}
.px-request-list-panel,.px-request-detail-panel{min-width:0;background:#fff;border:1px solid #dce5e3;border-radius:4px;overflow:hidden}
.px-request-list{max-height:calc(100vh - 360px);min-height:240px;overflow:auto}
.px-request-row{width:100%;padding:13px 14px;display:flex;flex-direction:column;align-items:stretch;gap:6px;text-align:left;background:#fff;border:0;border-bottom:1px solid #edf0ef;border-left:3px solid transparent;color:#20343a;cursor:pointer}
.px-request-row:hover{background:#f6faf9}
.px-request-row.selected{background:#eaf5f6;border-left-color:#238da0}
.px-request-row-first{display:flex;justify-content:space-between;align-items:center;gap:8px}
.px-request-row-first strong{font-size:12px}
.px-request-row .px-status{white-space:nowrap}
.px-request-row-type{font-size:11px;font-weight:700;color:#315860}
.px-request-row small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#73858a;font-size:10px}
.px-request-detail-panel>.px-empty{padding:25px}
.px-request-detail-panel .px-request-detail{padding:20px;background:#fff;color:#20343a}
.px-request-detail-panel .px-request-heading{padding-bottom:14px;border-bottom:1px solid #e5ebea}
.px-request-detail-panel .px-request-heading h2{color:#20343a}
.px-request-detail-panel .px-request-status{border-radius:2px;background:#edf5f1;color:#327352}
.px-request-detail-panel .px-request-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.px-request-detail-panel .px-request-field{min-width:0;padding:11px 0;border-bottom:1px solid #e8eeed}
.px-request-detail-panel .px-request-field span:first-child{color:#77898d;font-size:9px}
.px-request-detail-panel .px-request-field span:last-child,.px-request-detail-panel .px-request-field a{overflow-wrap:anywhere;color:#273c42;font-size:12px;line-height:1.5}
.px-request-detail-panel .px-request-field a{color:#176d7f;text-decoration:none}
.px-request-detail-panel .px-request-field:last-child{grid-column:1/-1}
.px-request-actions{padding-top:4px}
.px-request-actions .px-primary-action,.px-request-actions .px-secondary-action{min-height:38px;padding:0 12px;border:1px solid #176d7f;border-radius:3px;background:#176d7f;color:#fff;font-size:10px;font-weight:800;text-transform:none;letter-spacing:0}
.px-request-actions .px-primary-action:hover{background:#125767}
.px-request-actions .px-secondary-action{background:#fff;color:#687c81;border-color:#ccd8d6}
.px-request-actions button:disabled{opacity:.5;cursor:default}
.px-request-detail-panel .px-request-error{color:#a64238;background:#fff5f3}
.px-followup-dialog{width:min(680px,calc(100vw - 28px));max-height:min(88vh,860px);padding:0;border:1px solid #cbd8d6;border-radius:5px;background:#f5f8f7;color:#20343a;box-shadow:0 24px 80px #10232a55}
.px-followup-dialog::backdrop{background:#10242b88;backdrop-filter:blur(2px)}
.px-followup-heading{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 22px;background:#fff;border-bottom:1px solid #e0e8e6}
.px-followup-heading p{margin:0 0 6px;color:#398899;font-size:9px;font-weight:800;letter-spacing:.16em}
.px-followup-heading h2{margin:0;font:800 19px 'Manrope','DM Sans',sans-serif}
.px-dialog-close{min-height:34px;padding:0 10px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#536970;font-size:11px;font-weight:700}
.px-followup-recipient{margin:0;padding:13px 22px;color:#64777b;font-size:11px;border-bottom:1px solid #e2e9e7}
.px-followup-recipient strong{color:#253b41}
.px-followup-form{padding:18px 22px 20px;display:flex;flex-direction:column;gap:12px}
.px-followup-section-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px}
.px-add-item{min-height:31px;padding:0 10px;border:1px solid #bad0d1;border-radius:3px;background:#fff;color:#176d7f;font-size:10px;font-weight:800}
.px-followup-items{display:flex;flex-direction:column;gap:7px}
.px-followup-item-row{display:grid;grid-template-columns:minmax(0,1fr) 84px 100px 32px;gap:7px}
.px-followup-item-row input,.px-followup-message-label textarea{width:100%;min-width:0;padding:9px 10px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#20343a;font:11px 'DM Sans',sans-serif}
.px-followup-item-row input{min-height:37px}
.px-remove-item{min-height:35px;border:0;border-radius:3px;background:#f7e9e7;color:#a34c42;font-size:18px}
.px-followup-message-label{display:flex;flex-direction:column;gap:6px;color:#566b70;font-size:10px;font-weight:700}
.px-followup-message-label textarea{resize:vertical}
.px-followup-feedback{margin:0;color:#75868a;font-size:11px;line-height:1.5}
.px-followup-feedback.sent{padding:9px 11px;background:#e9f4ed;color:#327352}
.px-followup-feedback.unsent{padding:9px 11px;background:#fff3e2;color:#89571a}
.px-followup-form .px-save-button{min-height:42px}
.px-followup-history{padding:0 22px 20px}
.px-followup-history h3{margin:0;padding:14px 0 8px;border-top:1px solid #dfe8e6;font:800 12px 'Manrope','DM Sans',sans-serif}
.px-followup-history-entry{padding:10px 0;border-bottom:1px solid #e3eae8}
.px-followup-history-top{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:10px}
.px-delivery-status{padding:4px 7px;border-radius:2px;font-size:9px;font-weight:800}
.px-delivery-status.sent{background:#e5f3ea;color:#327352}
.px-delivery-status.failed,.px-delivery-status.not_configured{background:#fff0dc;color:#89571a}
.px-followup-history-entry ul{margin:7px 0;padding-left:20px;color:#50656a;font-size:10px;line-height:1.6}
.px-followup-history-entry p{margin:6px 0;color:#60747a;font-size:10px;line-height:1.5}
.px-followup-history-entry small{color:#7a8b8e;font-size:9px}
.px-quote-dialog{width:min(980px,calc(100vw - 28px));box-sizing:border-box}
.px-quote-dialog *, .px-quote-dialog *::before, .px-quote-dialog *::after{box-sizing:border-box}
.px-quote-form{gap:11px}
.px-quote-add-buttons{display:flex;flex-wrap:wrap;gap:6px}
.px-quote-lines{display:flex;flex-direction:column;gap:8px}
.px-quote-line{display:flex;flex-direction:column;gap:12px;padding:14px;background:#fff;border:1px solid #dce5e3;border-radius:4px}
.px-quote-line-header{display:grid;grid-template-columns:minmax(0,1fr) 34px;grid-template-rows:auto auto;gap:10px;align-items:center;min-width:0}
.px-quote-product-details{grid-column:1;grid-row:1;display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;align-items:center;min-width:0}
.px-quote-thumb{width:48px;height:42px;object-fit:cover;border-radius:3px;background:#eaf0ee}
.px-quote-product-details input,.px-quote-line-header>.px-quote-catalog-select{width:100%;min-width:0;min-height:38px;padding:8px 10px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#283d43;font:12px 'DM Sans',sans-serif}
.px-quote-line-header>.px-quote-catalog-select{grid-column:1;grid-row:2}
.px-quote-line-header>.px-remove-item{grid-column:2;grid-row:1;min-width:34px;width:34px;height:34px;min-height:34px;align-self:start}
.px-quote-line-fields{display:grid;grid-template-columns:repeat(4,minmax(100px,1fr)) minmax(100px,.8fr);gap:10px;align-items:end}
.px-quote-line-field{display:flex;flex-direction:column;gap:5px;min-width:0;color:#61747a;font-size:10px;font-weight:700}
.px-quote-line-field input{width:100%;min-width:0;height:38px;padding:8px 9px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#283d43;font:12px 'DM Sans',sans-serif}
.px-quote-line-field input[readonly]{background:#eef4f3;color:#176d7f;font-weight:700}
.px-quote-lines{gap:14px}
.px-quote-group{--group-accent:#287f8d;--group-tint:#eef6f6;border-top:3px solid var(--group-accent);background:#fff;border-radius:4px;box-shadow:0 0 0 1px #dce5e3}
.px-quote-group-labor{--group-accent:#4f63c4;--group-tint:#f0f2fb}
.px-quote-group-other{--group-accent:#b8741c;--group-tint:#fbf3e7}
.px-quote-group-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 14px;background:var(--group-tint)}
.px-quote-group-heading>div{display:flex;flex-direction:column;gap:2px}
.px-quote-group-heading strong{color:#20383e;font:800 13px 'Manrope','DM Sans',sans-serif}
.px-quote-group-heading small{color:#6b7e82;font-size:10px}
.px-quote-group-heading .px-add-item{border-color:var(--group-accent);color:var(--group-accent)}
.px-quote-group-lines{display:flex;flex-direction:column}
.px-quote-group-lines:empty::before{content:attr(data-empty);padding:12px 14px;color:#8a9a9e;font-size:11px}
.px-quote-group-lines .px-quote-line{border:0;border-top:1px solid #e6ecea;border-radius:0}
.px-quote-group-lines .px-quote-line:first-child{border-top:0}
.px-quote-labor-fields,.px-quote-fee-fields{display:grid;gap:10px;align-items:end}
.px-quote-labor-fields{grid-template-columns:minmax(160px,2fr) 64px 80px 96px 96px minmax(84px,.8fr) 34px}
.px-quote-fee-fields{grid-template-columns:minmax(180px,2.4fr) 110px 110px minmax(84px,.8fr) 34px}
.px-quote-labor-fields>.px-remove-item,.px-quote-fee-fields>.px-remove-item{width:34px;height:38px;min-height:38px}
.px-quote-task-field input{font-weight:600}
.px-quote-preview{padding:16px 22px 22px;display:flex;flex-direction:column;gap:14px}
.px-quote-preview[hidden]{display:none}
.px-preview-intro{margin:0;color:#5b6f74;font-size:12px}
.px-preview-meta{display:grid;grid-template-columns:70px minmax(0,1fr);gap:6px 10px;margin:0;padding:12px 14px;background:#fff;border:1px solid #dce5e3;border-radius:4px;font-size:12px}
.px-preview-meta dt{color:#7a8b8f;font-weight:700}
.px-preview-meta dd{margin:0;color:#20343a;overflow-wrap:anywhere}
.px-preview-email{background:#fff;border:1px solid #dce6e5;font-family:Arial,sans-serif}
.px-preview-brand{padding:20px 24px;background:#12313a;color:#fff}
.px-preview-brand img{display:block;height:44px;width:auto;margin:0 0 12px}
.px-preview-brand p{margin:0;color:#85d7e8;font-size:11px;font-weight:700;letter-spacing:2px}
.px-preview-brand h3{margin:10px 0 0;font-size:21px}
.px-preview-body{padding:20px 24px;font-size:13px;color:#20343a}
.px-preview-body>p{margin:0 0 10px;line-height:1.6}
.px-preview-muted{color:#60747b}
.px-preview-lines{border-top:2px solid #cbd8d6}
.px-preview-line{display:flex;justify-content:space-between;gap:12px;padding:9px 4px;border-bottom:1px solid #e5eceb}
.px-preview-line>span:first-child{display:flex;flex-direction:column;gap:3px;min-width:0}
.px-preview-line strong{font-weight:600;overflow-wrap:anywhere}
.px-preview-line small{color:#74858a;font-size:11px}
.px-preview-line>span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.px-preview-totals{width:min(100%,300px);margin:12px 0 12px auto}
.px-preview-totals>div{display:flex;justify-content:space-between;padding:4px}
.px-preview-totals strong{font-weight:400;font-variant-numeric:tabular-nums}
.px-preview-totals .px-preview-grand{margin-top:6px;padding-top:10px;border-top:2px solid #176d7f;font-weight:700;font-size:15px}
.px-preview-totals .px-preview-grand strong{font-weight:700}
.px-preview-note{padding:11px;background:#edf5f4;font-size:12px}
.px-preview-button{display:inline-block;margin:6px 0 4px;padding:11px 16px;background:#176d7f;color:#fff;font-size:12px;font-weight:700}
.px-preview-signature{margin:18px 0 0!important;line-height:1.6}
.px-preview-placeholder{color:#b0412f}
.px-preview-actions{display:flex;justify-content:space-between;align-items:center;gap:10px}
.px-preview-actions .px-save-button{width:auto;min-height:42px;padding:0 22px}
.px-preview-actions button:disabled{opacity:.55}
.px-quote-amount-field strong{height:38px;display:flex;align-items:center;justify-content:flex-end;color:#20383e;font-size:13px;font-variant-numeric:tabular-nums}
.px-quote-line-total{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.px-quote-tax-label{display:flex;align-items:center;justify-content:flex-end;gap:10px;color:#5a6f74;font-size:10px;font-weight:700}
.px-quote-tax-label input{width:100px;min-height:34px;padding:6px 8px;border:1px solid #cfdbd9;border-radius:3px;background:#fff;color:#283d43;font:11px 'DM Sans',sans-serif}
.px-quote-totals{width:min(100%,390px);margin-left:auto;padding:16px 18px;background:#f8fbfa;border:1px solid #d7e3e1;border-radius:4px}
.px-quote-totals h3{margin:0 0 8px;padding-bottom:9px;border-bottom:1px solid #e2eae8;color:#20383e;font:800 13px 'Manrope','DM Sans',sans-serif}
.px-quote-total-row,.px-quote-total-final{display:flex;justify-content:space-between;gap:12px;padding:5px 0;color:#5d7075;font-size:11px}
.px-quote-total-row strong,.px-quote-total-final strong{color:#23383e;font-variant-numeric:tabular-nums}
.px-quote-total-final{margin-top:5px;padding-top:10px;border-top:2px solid #287f8d;color:#173940;font-size:13px;font-weight:800}
.px-quote-total-final{margin-top:8px;padding:12px 0 2px;font-size:13px}
.px-quote-total-final strong{color:#176d7f;font-size:22px}
.px-quote-profit-row{color:#287452;font-weight:700}
.px-quote-cost-info{display:flex;justify-content:space-between;gap:10px;margin-top:9px;padding-top:9px;border-top:1px solid #e2eae8;color:#6b7e82;font-size:9px}
.px-quote-history-entry>a{display:inline-block;margin:0 0 7px;color:#176d7f;font-size:10px;font-weight:700;text-decoration:none}
.px-public-quote{max-width:980px;margin:28px auto;padding:clamp(18px,4vw,36px);background:#142029;border:1px solid #344c5b;display:flex;flex-direction:column;gap:16px}
.px-public-quote-heading p,.px-public-quote-kicker{margin:0;color:#3fb0d8;font-size:10px;font-weight:800;letter-spacing:.14em}
.px-public-quote-heading h2,.px-deposit-summary h2{margin:5px 0;color:#eef4f8;font-size:25px}
.px-public-quote-heading p:last-child,.px-public-quote-message{margin:0;color:#aebdc7;font-size:12px;line-height:1.6}
.px-public-quote-lines{display:flex;flex-direction:column;border-top:1px solid #344c5b}
.px-public-quote-line{display:grid;grid-template-columns:64px minmax(0,1fr) minmax(105px,auto) 90px;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #344c5b}
.px-public-quote-line img{width:60px;height:48px;object-fit:cover;border:1px solid #455d69}
.px-public-quote-line-copy{min-width:0;display:flex;flex-direction:column;gap:4px}
.px-public-quote-line-copy strong{font-size:12px;overflow-wrap:anywhere}
.px-public-quote-line-copy small,.px-public-quote-unit-price{color:#9fb0bf;font-size:10px}
.px-public-quote-line-price{text-align:right;font-size:12px;white-space:nowrap}
.px-public-quote-summary{width:min(100%,380px);margin-left:auto}
.px-public-quote-total,.px-public-quote-grand-total{display:flex;justify-content:space-between;gap:16px;padding:7px 0;color:#aebdc7;font-size:12px}
.px-public-quote-total strong{color:#eef4f8}
.px-public-quote-grand-total{margin-top:5px;padding-top:13px;border-top:2px solid #3fb0d8;color:#eef4f8;font-size:13px;font-weight:800}
.px-public-quote-grand-total strong{color:#3fb0d8;font-size:20px}
.px-public-quote-note{margin:0;padding:12px;background:#1a2b35;color:#b8c6ce;font-size:11px;line-height:1.6}
.px-public-quote-message{padding:12px;background:#1a2b35}
.px-public-quote-error{color:#ffaaa0;background:#34201f}
.px-deposit-summary{margin-top:28px}
.px-public-deposit-total{font-size:14px;font-weight:800;color:#eef4f8}
.px-public-deposit-total strong{color:#3fb0d8;font-size:18px}
.px-public-quote-back{color:#79c9df;font-size:12px;font-weight:700;text-decoration:none}
.px-inventory-intro-row{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:16px}
.px-inventory-intro-row .px-admin-intro{margin:0;max-width:720px}
.px-inventory-metrics{margin-bottom:16px}
.px-inventory-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(290px,.75fr);gap:15px;align-items:start}
.px-inventory-main-column{min-width:0;display:flex;flex-direction:column;gap:14px}
.px-inventory-table td:nth-child(2),.px-inventory-table td:nth-child(3),.px-inventory-table td:nth-child(4){white-space:nowrap;font-variant-numeric:tabular-nums}
.px-stock-low,.px-stock-ok{font-size:10px!important;font-weight:800!important;white-space:nowrap}
.px-stock-low{color:#a15c1b!important}
.px-stock-ok{color:#327352!important}
.px-stock-form label:nth-child(2){grid-column:1/-1}
.px-movement-list{max-height:330px;overflow:auto}
.px-movement-row{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;padding:12px 15px;border-bottom:1px solid #edf0ef}
.px-movement-row>strong{font-size:12px;font-variant-numeric:tabular-nums}
.px-movement-row>strong.positive{color:#327352}
.px-movement-row>strong.negative{color:#a64238}
.px-movement-details{min-width:0;display:flex;flex-direction:column;gap:4px}
.px-movement-details strong{font-size:11px}
.px-movement-details span,.px-movement-details small{overflow-wrap:anywhere;color:#687b80;font-size:10px;line-height:1.5}
.px-status.px-status-in_progress,.px-request-detail-panel .px-request-status.px-status-in_progress{background:#fdf3cc;color:#6f5a06}
.px-status.px-status-declined,.px-request-detail-panel .px-request-status.px-status-declined{background:#fde8d7;color:#8a4512}
.px-request-detail-panel .px-request-actions{align-items:center;gap:18px;padding-top:2px}
.px-request-actions .px-link-action,.px-quote-pending-notice .px-link-action{min-height:0;padding:0;border:0;background:none;color:#176d7f;font-size:12px;font-weight:700;letter-spacing:0;cursor:pointer}
.px-request-actions .px-link-action:hover,.px-quote-pending-notice .px-link-action:hover{color:#125767;text-decoration:underline}
.px-request-status-control{margin-left:auto;display:flex;align-items:center;gap:8px;color:#77898d;font-size:11px;font-weight:700}
.px-request-status-control select{min-height:36px;padding:0 8px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:600 12px 'DM Sans',sans-serif}
.px-quote-pending-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-left:3px solid #d9ae0b;background:#fdf6dc}
.px-quote-pending-notice p{margin:0;color:#5e4c06;font-size:12px;line-height:1.5}
.px-quote-pending-notice .px-link-action{flex:none;color:#6f5a06}
.px-quote-sent-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-left:3px solid #2f8a57;background:#e8f4ec}
.px-quote-sent-notice.unsent{border-left-color:#d9ae0b;background:#fdf6dc}
.px-quote-sent-notice p{margin:0;display:flex;flex-direction:column;gap:3px;min-width:0;font-size:12px;line-height:1.45}
.px-quote-sent-notice p strong{color:#1f5c39;overflow-wrap:anywhere}
.px-quote-sent-notice.unsent p strong{color:#5e4c06}
.px-quote-sent-notice p span{color:#5b6f74;font-size:11px;overflow-wrap:anywhere}
.px-quote-sent-total{flex:none;color:#1f5c39;font:800 17px 'Manrope','DM Sans',sans-serif;font-variant-numeric:tabular-nums}
.px-quote-sent-notice.unsent .px-quote-sent-total{color:#5e4c06}
.px-quote-sent-tag{align-self:flex-start;color:#2a7149;font-size:10px;font-weight:800;font-variant-numeric:tabular-nums}
.px-quote-sent-tag::before{content:'✓';margin-right:5px}
.px-quote-sent-tag.unsent{color:#8a6d05}
.px-quote-sent-tag.unsent::before{content:'!'}
.px-materials-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.px-materials-toolbar input,.px-materials-toolbar select{min-height:42px;padding:0 12px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-materials-toolbar input{flex:1 1 260px;max-width:420px}
.px-materials-toolbar .px-action-link{margin-left:auto;cursor:pointer}
.px-materials-status{margin:0;padding:0 18px;color:#327352;font-size:12px;line-height:1.5}
.px-materials-status:not(:empty){padding:10px 18px;background:#e9f4ed}
.px-materials-status.error{color:#a64238}
.px-materials-status.error:not(:empty){background:#fff5f3}
.px-material-actions{white-space:nowrap;text-align:right}
.px-row-action{min-height:30px;padding:0 10px;margin-left:6px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#315860;font-size:11px;font-weight:700;cursor:pointer}
.px-row-action:hover{border-color:#176d7f;color:#176d7f}
.px-row-action.danger{color:#a64238}
.px-row-action.danger:hover{border-color:#a64238;background:#fff5f3}
.px-row-action.danger.solid{background:#a64238;border-color:#a64238;color:#fff}
.px-row-action:disabled{opacity:.55;cursor:default}
.px-material-table td.px-stock-low{color:#a15c1b;font-weight:800}
.px-materials-guide{margin-top:16px}
.px-materials-guide summary{cursor:pointer;font:800 13px 'Manrope','DM Sans',sans-serif;color:#20343a}
.px-material-dialog .px-material-form{padding:18px 22px 22px}
.px-material-dialog .px-material-form label:nth-child(5){grid-column:auto}
.px-material-dialog .px-material-form>p{grid-column:1/-1;margin:0}
.px-material-stock-note{padding:9px 11px;background:#eef4f3;color:#4c6268;font-size:11px;line-height:1.5}
.px-confirm-dialog{width:min(440px,calc(100vw - 28px))}
.px-confirm-body{padding:22px;display:flex;flex-direction:column;gap:12px}
.px-confirm-body h2{margin:0;font:800 18px 'Manrope','DM Sans',sans-serif;color:#20343a}
.px-confirm-body p{margin:0;color:#5b6f74;font-size:12px;line-height:1.6}
.px-confirm-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.px-inventory-intro-row .px-action-link{cursor:pointer}
.px-inventory-intro-row .px-action-link:disabled{opacity:.5;cursor:default}
.px-inventory-toolbar{margin:0;padding:12px 18px;border-bottom:1px solid #edf0ef}
.px-inventory-low-toggle{display:inline-flex;align-items:center;gap:6px;color:#52666c;font-size:12px;font-weight:700;cursor:pointer}
.px-inventory-qty{font-weight:800;color:#20343a}
.px-row-action.positive{color:#2a7149}
.px-row-action.positive:hover{border-color:#2a7149;background:#eef7f1}
@keyframes px-row-flash{from{background:#dff2e6}to{background:transparent}}
.px-row-flash td{animation:px-row-flash 2.4s ease-out}
.px-stock-dialog{width:min(520px,calc(100vw - 28px))}
.px-stock-movement-form{padding:18px 22px 22px;display:flex;flex-direction:column;gap:14px}
.px-stock-tabs{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd8d6;border-radius:4px;overflow:hidden}
.px-stock-tab{min-height:40px;border:0;border-right:1px solid #cbd8d6;background:#fff;color:#52666c;font-size:12px;font-weight:800;cursor:pointer}
.px-stock-tab:last-child{border-right:0}
.px-stock-tab.active{background:#176d7f;color:#fff}
.px-stock-tab-receive.active{background:#2a7149}
.px-stock-tab-use.active{background:#a15c1b}
.px-stock-field{display:flex;flex-direction:column;gap:6px;color:#52666c;font-size:10px;font-weight:700}
.px-stock-field select,.px-stock-field>input{min-height:40px;padding:0 10px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-stock-stepper{display:grid;grid-template-columns:44px minmax(0,1fr) 44px auto;align-items:stretch;border:1px solid #cbd8d6;border-radius:3px;overflow:hidden;background:#fff}
.px-stock-stepper input{min-width:0;min-height:48px;border:0;border-left:1px solid #e1e8e6;border-right:1px solid #e1e8e6;text-align:center;font:800 20px 'Manrope','DM Sans',sans-serif;color:#20343a;font-variant-numeric:tabular-nums}
.px-stock-stepper input:focus{outline:2px solid #176d7f;outline-offset:-2px}
.px-stock-step{border:0;background:#f5f8f7;color:#176d7f;font-size:20px;font-weight:800;cursor:pointer}
.px-stock-step:hover{background:#e6f3f4}
.px-stock-unit{display:flex;align-items:center;padding:0 12px;background:#f5f8f7;border-left:1px solid #e1e8e6;color:#52666c;font-size:12px;font-weight:700}
.px-stock-preview{display:grid;grid-template-columns:1fr auto 1fr 1fr;align-items:center;gap:8px;padding:12px 14px;border:1px solid #dce5e3;border-left:3px solid #9fb0bf;border-radius:3px;background:#f8fbfa}
.px-stock-preview.up{border-left-color:#2a7149;background:#f1f8f3}
.px-stock-preview.down{border-left-color:#a15c1b;background:#fdf7ef}
.px-stock-preview.invalid{border-left-color:#a64238;background:#fff5f3}
.px-stock-preview-cell{display:flex;flex-direction:column;gap:3px}
.px-stock-preview-cell span{color:#77898d;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.px-stock-preview-cell strong{color:#20343a;font:800 15px 'Manrope','DM Sans',sans-serif;font-variant-numeric:tabular-nums}
.px-stock-preview-arrow{color:#9fb0bf;font-size:18px}
.px-stock-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:-6px}
.px-stock-chip{min-height:28px;padding:0 10px;border:1px solid #d1dcda;border-radius:14px;background:#fff;color:#52666c;font-size:11px;cursor:pointer}
.px-stock-chip:hover{border-color:#176d7f;color:#176d7f}
.px-stock-movement-form .px-save-button:disabled{opacity:.45;cursor:default}
.px-stock-movement-form .px-materials-status:empty{display:none}
@media(max-width:600px){.px-material-actions .px-row-action{margin:3px 0 0 4px}.px-stock-preview{grid-template-columns:1fr 1fr}.px-stock-preview-arrow{display:none}}
.px-health-actions{display:flex;gap:8px;align-items:center}
.px-health-metrics{margin-bottom:16px}
.px-health-bad{border-top-color:#a64238!important}
.px-health-bad strong{color:#a64238}
.px-health-list{display:flex;flex-direction:column}
.px-health-row{border-top:1px solid #edf0ef;padding:10px 16px}
.px-health-row summary{display:grid;grid-template-columns:70px minmax(0,1fr);gap:4px 10px;align-items:center;cursor:pointer;list-style:none}
.px-health-row summary::-webkit-details-marker{display:none}
.px-health-row summary strong{font-size:12px;color:#20343a;overflow-wrap:anywhere}
.px-health-row summary small{grid-column:2;color:#77898d;font-size:10px}
.px-health-badge{justify-self:start;padding:3px 7px;border-radius:2px;font-size:9px;font-weight:800;text-transform:uppercase}
.px-health-badge.server{background:#fbe1de;color:#8c2820}
.px-health-badge.client{background:#fdf3cc;color:#6a5505}
.px-health-row pre{margin:8px 0 0;padding:10px;max-height:220px;overflow:auto;background:#f5f8f7;color:#3d5157;font-size:10px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.px-health-agent{display:block;margin-top:6px;color:#8a9a9e;font-size:9px}
.px-application-list{display:flex;flex-direction:column}
.px-application-row{display:flex;flex-direction:column;gap:8px;padding:14px 18px;border-bottom:1px solid #edf0ef;border-left:3px solid transparent;font-size:12px}
.px-application-row.is-new{border-left-color:#d9ae0b;background:#fffcf0}
.px-application-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.px-application-who{display:flex;flex-direction:column;gap:3px;min-width:0}
.px-application-who strong{font-size:14px;color:#20343a}
.px-application-position{color:#176d7f;font-size:11px;font-weight:800}
.px-application-top select{min-height:34px;padding:0 8px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:600 12px 'DM Sans',sans-serif}
.px-application-contact{display:flex;flex-wrap:wrap;gap:6px 16px;color:#77878c}
.px-application-contact a{color:#176d7f;font-weight:700;text-decoration:none;overflow-wrap:anywhere}
.px-application-contact a:hover{text-decoration:underline}
.px-application-message{margin:0;padding:10px 12px;background:#f5f8f7;color:#3d5157;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.px-application-row small{color:#82939a;font-size:10px}
.px-step-state{display:flex;flex-direction:column;gap:12px;font-family:Montserrat,system-ui,sans-serif;color:#eef4f8}
.px-step-state-icon{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;font-size:22px;font-weight:900;background:#12303f;color:#3fb0d8}
.px-step-state-success .px-step-state-icon{background:#11301f;color:#72cf9a}
.px-step-state-error .px-step-state-icon{background:#34201f;color:#ffaaa0}
.px-step-state h3{margin:4px 0 0;font-size:24px;line-height:1.25;font-weight:800;outline:none}
.px-step-state p{margin:0;font-size:15px;line-height:1.65;color:#9fb0bf}
.px-step-state-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.px-step-state-primary,.px-step-state-secondary{display:inline-flex;align-items:center;min-height:48px;padding:0 20px;font:800 12px Montserrat,system-ui,sans-serif;letter-spacing:.12em;text-decoration:none;cursor:pointer}
.px-step-state-primary{border:0;background:#3fb0d8;color:#08131a}
.px-step-state-secondary{border:1px solid #4a6070;background:transparent;color:#eef4f8}
.px-confirm-card{padding:clamp(24px,4vw,40px);background:#142029;border:1px solid #263644;border-top:3px solid #3fb0d8}
.px-unverified-tag{align-self:flex-start;color:#8a6d05;font-size:10px;font-weight:800}
.px-unverified-tag::before{content:'✉ '}
.px-header-cta{transition:background-color .2s ease,transform .2s ease}
.px-header-cta>span{transition:transform .2s ease}
.px-header-cta:hover,.px-header-cta:focus-visible{background:#7dd1e5!important;opacity:1!important;transform:translateY(-1px)}
.px-header-cta:hover>span,.px-header-cta:focus-visible>span{transform:translateX(3px)}
.px-header-cta:focus-visible{outline:2px solid #eef4f8;outline-offset:3px}
html{scroll-behavior:smooth}
[data-project-photo][hidden]{display:none!important}
[data-project-photo] img{transition:transform .25s ease}
[data-project-photo]:hover img,[data-project-photo]:focus-visible img{transform:scale(1.03)}
.px-lightbox{width:100vw;max-width:100vw;height:100vh;max-height:100vh;margin:0;padding:0;border:0;background:rgba(6,11,16,.94);color:#eef4f8}
.px-lightbox[open]{display:flex;align-items:center;justify-content:center}
.px-lightbox::backdrop{background:transparent}
.px-lightbox-figure{margin:0;max-width:min(1200px,calc(100vw - 120px));display:flex;flex-direction:column;gap:12px}
.px-lightbox-figure img{display:block;max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;margin:0 auto}
.px-lightbox-caption{margin:0;text-align:center;color:#9fb0bf;font:15px Montserrat,system-ui,sans-serif}
.px-lightbox-caption strong{color:#eef4f8}
.px-lightbox button{position:absolute;display:flex;align-items:center;justify-content:center;width:48px;height:48px;border:1px solid #263644;background:#142029;color:#eef4f8;font-size:28px;line-height:1;cursor:pointer}
.px-lightbox button:hover,.px-lightbox button:focus-visible{border-color:#3fb0d8;color:#3fb0d8}
.px-lightbox-close{top:16px;right:16px}
.px-lightbox-prev{left:16px;top:50%;transform:translateY(-50%)}
.px-lightbox-next{right:16px;top:50%;transform:translateY(-50%)}
@media(max-width:600px){.px-lightbox-figure{max-width:calc(100vw - 24px)}.px-lightbox-prev,.px-lightbox-next{top:auto;bottom:16px;transform:none}.px-lightbox-figure img{max-height:calc(100vh - 170px)}}
.px-finance{margin:0 0 18px;padding:16px 18px 14px;background:#fff;border:1px solid #dce5e3;border-radius:4px}
.px-finance-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.px-finance-heading h2{margin:0;font:800 15px 'Manrope','DM Sans',sans-serif}
.px-finance-heading span{color:#7a8b8f;font-size:10px}
.px-finance-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.px-finance-loss{--finance-accent:#a64238;--finance-tint:#fff3f1}
.px-finance-loss strong{color:#a64238}
.px-finance-range{color:#60747b;font-size:12px;font-weight:700}
.px-expense-breakdown{display:flex;flex-direction:column;gap:7px;margin-top:14px}
.px-expense-bar-row{display:grid;grid-template-columns:170px minmax(0,1fr) 110px;align-items:center;gap:10px;font-size:12px}
.px-expense-bar-label{color:#52666c;font-weight:700}
.px-expense-bar{height:8px;border-radius:4px;background:#edf1f0;overflow:hidden}
.px-expense-bar span{display:block;height:100%;background:#d9ae0b}
.px-expense-bar-row strong{text-align:right;font-variant-numeric:tabular-nums}
.px-finance-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:15px;align-items:start}
.px-expense-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;padding:14px 18px;border-bottom:1px solid #edf0ef;background:#f8fbfa}
.px-expense-form label{display:flex;flex-direction:column;gap:5px;color:#52666c;font-size:10px;font-weight:700}
.px-expense-form input,.px-expense-form select{min-width:0;min-height:38px;padding:0 9px;border:1px solid #cbd6d4;border-radius:3px;background:#fff;color:#23343a;font:12px 'DM Sans',sans-serif}
.px-expense-form .px-expense-wide{grid-column:span 2}
.px-expense-form .px-save-button{grid-column:auto;min-height:38px}
.px-expense-amount{font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.px-expense-voided td{color:#9aa8ab!important}
.px-expense-voided td:not(:last-child){text-decoration:line-through}
.px-expense-voided td small{text-decoration:none}
.px-ledger-list{display:flex;flex-direction:column;max-height:560px;overflow:auto}
.px-ledger-hint{margin:0;padding:10px 18px;color:#708087;font-size:11px;line-height:1.5}
.px-ledger-row{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;align-items:start;padding:11px 15px;border-top:1px solid #edf0ef}
.px-ledger-amount{font-size:13px;font-variant-numeric:tabular-nums}
.px-ledger-amount.payment{color:#2a7149}
.px-ledger-amount.refund{color:#a15c1b}
.px-ledger-details{min-width:0;display:flex;flex-direction:column;gap:3px;font-size:11px}
.px-ledger-details span,.px-ledger-details small{color:#687b80;overflow-wrap:anywhere}
.px-ledger-row.voided .px-ledger-amount,.px-ledger-row.voided .px-ledger-details>strong{color:#9aa8ab;text-decoration:line-through}
.px-ledger-void-note{color:#a64238!important;font-weight:700}
.px-void-control{display:flex;justify-content:flex-end}
.px-void-form{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}
.px-void-form input{min-width:160px;min-height:30px;padding:0 8px;border:1px solid #cbd6d4;border-radius:3px;font:11px 'DM Sans',sans-serif}
.px-void-form .px-row-action{margin-left:0}
.px-payment-form{grid-template-columns:150px 110px minmax(0,1fr) auto!important}
.px-payment-form select{min-height:34px;padding:0 8px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-payment-history{display:flex;flex-direction:column}
.px-payment-history-title{margin:6px 0 0;color:#77898d;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.px-payment-history .px-ledger-row{padding:9px 0}
@media(max-width:1000px){.px-finance-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){.px-expense-bar-row{grid-template-columns:110px minmax(0,1fr) 80px}.px-expense-form .px-expense-wide{grid-column:auto}.px-ledger-row{grid-template-columns:80px minmax(0,1fr)}.px-ledger-row .px-void-control{grid-column:1/-1}.px-payment-form{grid-template-columns:1fr 1fr!important}}
.px-finance-card{min-width:0;padding:12px 14px;display:flex;flex-direction:column;gap:5px;border-left:3px solid var(--finance-accent);background:var(--finance-tint);color:#19292f;text-decoration:none}
.px-finance-card span{color:#55696f;font-size:11px;font-weight:700}
.px-finance-card strong{font:800 24px 'Manrope','DM Sans',sans-serif;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.px-finance-card small{color:#6f8186;font-size:10px;line-height:1.4}
.px-finance-total{--finance-accent:#287f8d;--finance-tint:#eef6f6}
.px-finance-pending{--finance-accent:#d9ae0b;--finance-tint:#fdf7e1}
.px-finance-approved{--finance-accent:#4f63c4;--finance-tint:#f0f2fb}
.px-finance-received{--finance-accent:#2f8a57;--finance-tint:#e8f4ec}
.px-finance-progress{display:flex;align-items:center;gap:10px;margin-top:12px}
.px-finance-bar{flex:1;height:6px;border-radius:3px;background:#e6ecea;overflow:hidden}
.px-finance-bar span{display:block;height:100%;background:#2f8a57}
.px-finance-progress small{color:#6f8186;font-size:10px;white-space:nowrap}
.px-quote-money{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid #e3eae8;border-radius:3px;font-size:12px}
.px-quote-money-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.px-quote-money-row>span:first-child{min-width:120px;color:#77898d;font-size:11px;font-weight:700}
.px-quote-money-row strong{font-variant-numeric:tabular-nums}
.px-quote-money-actions{display:flex;gap:14px;margin-left:auto}
.px-approval{padding:3px 7px;border-radius:2px;font-size:11px}
.px-approval-pending{background:#fdf3cc;color:#6f5a06}
.px-approval-approved{background:#e3f3e8;color:#1f5c39}
.px-approval-rejected{background:#fde8d7;color:#86410f}
.px-quote-money-remaining{color:#8a6d05;font-size:11px;font-weight:700}
.px-quote-money-paid{color:#2a7149;font-size:11px;font-weight:700}
.px-payment-form{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:8px;align-items:center}
.px-payment-form input{min-width:0;min-height:34px;padding:0 9px;border:1px solid #ccd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-payment-form .px-link-action{min-height:0;padding:0;border:0;background:none;color:#176d7f;font-size:12px;font-weight:700;cursor:pointer}
.px-payment-form .px-link-action:hover{text-decoration:underline}
@media(max-width:900px){.px-finance-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.px-finance-card strong{font-size:20px}.px-quote-money-actions{margin-left:0}.px-payment-form{grid-template-columns:1fr 1fr}.px-payment-form input:nth-child(2){grid-column:1/-1;grid-row:2}}
.px-quote-pending-tag{align-self:flex-start;color:#8a6d05;font-size:10px;font-weight:800}
.px-quote-pending-tag::before{content:'';display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#d9ae0b;vertical-align:1px}
.px-calendar-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.px-calendar-nav{display:flex;gap:6px}
.px-calendar-month{margin:0;font:800 18px 'Manrope','DM Sans',sans-serif;color:#17272e}
.px-calendar-legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 14px;padding:0;list-style:none;color:#52666c;font-size:11px;font-weight:700}
.px-calendar-legend li{display:flex;align-items:center;gap:7px;background:none;border:0}
.px-calendar-swatch{width:12px;height:12px;border-radius:2px;background:var(--tone-bar)}
.px-meeting-tone-planned{--tone-bg:#e3f3e8;--tone-fg:#1f5c39;--tone-bar:#2f8a57}
.px-meeting-tone-progress{--tone-bg:#fdf3cc;--tone-fg:#6a5505;--tone-bar:#d9ae0b}
.px-meeting-tone-cancelled{--tone-bg:#fde8d7;--tone-fg:#86410f;--tone-bar:#e2782a}
.px-meeting-tone-alert{--tone-bg:#fbe1de;--tone-fg:#8c2820;--tone-bar:#cc372b}
.px-meeting-tone-postponed{--tone-bg:#ece8fb;--tone-fg:#4a3a99;--tone-bar:#6a55c9}
.px-meeting-tone-done{--tone-bg:#eef1f1;--tone-fg:#5d6e72;--tone-bar:#9fb0b4}
.px-meeting-tone-event{--tone-bg:#e4f0fb;--tone-fg:#1d4f7f;--tone-bar:#2f7fc4}
.px-meeting-chip{width:100%;border-top:0;border-right:0;border-bottom:0;text-align:left;font-family:inherit;cursor:pointer}
.px-meeting-chip.is-cancelled strong{text-decoration:line-through}
.px-chip-badge{flex:none;margin-left:auto;padding:0 4px;border-radius:2px;background:rgba(255,255,255,.6);font-size:9px;font-style:normal;font-weight:800;text-transform:uppercase}
.px-calendar-day-head{display:flex;justify-content:space-between;align-items:center}
.px-calendar-add{width:22px;height:22px;border:1px solid transparent;border-radius:3px;background:transparent;color:#176d7f;font-size:15px;font-weight:800;line-height:1;cursor:pointer;opacity:0}
.px-calendar-day:hover .px-calendar-add,.px-calendar-add:focus-visible{opacity:1;border-color:#bad0d1}
@media(hover:none){.px-calendar-add{opacity:.6}}
.px-calendar-toolbar .px-action-link{cursor:pointer}
.px-calendar-undated{padding:0;border:0;background:none;text-align:left;cursor:pointer;font-family:inherit}
.px-calendar-dialog{width:min(520px,calc(100vw - 28px))}
.px-calendar-form{padding:18px 22px 22px;display:flex;flex-direction:column;gap:12px}
.px-calendar-form label{display:flex;flex-direction:column;gap:6px;color:#52666c;font-size:10px;font-weight:700}
.px-calendar-form input,.px-calendar-form select,.px-calendar-form textarea{min-width:0;min-height:40px;padding:0 10px;border:1px solid #cbd8d6;border-radius:3px;background:#fff;color:#20343a;font:12px 'DM Sans',sans-serif}
.px-calendar-form textarea{padding:9px 10px;resize:vertical}
.px-calendar-form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.px-calendar-form-info{margin:0;color:#60747b;font-size:11px;line-height:1.5}
.px-calendar-form-actions{display:flex;justify-content:space-between;align-items:center;gap:10px}
.px-calendar-form-actions .px-save-button{width:auto;margin-left:auto;padding:0 20px}
.px-calendar-form .px-materials-status:empty{display:none}
.px-status-picker{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cbd8d6;border-radius:4px;overflow:hidden}
.px-status-option{min-height:36px;border:0;border-right:1px solid #cbd8d6;background:#fff;color:#52666c;font-size:11px;font-weight:800;cursor:pointer}
.px-status-option:last-child{border-right:0}
.px-status-option.active{color:#fff}
.px-status-option-scheduled.active{background:#2f8a57}
.px-status-option-postponed.active{background:#6a55c9}
.px-status-option-done.active{background:#5d6e72}
.px-status-option-cancelled.active{background:#e2782a}
@media(max-width:600px){.px-calendar-form-row{grid-template-columns:1fr}.px-status-picker{grid-template-columns:1fr 1fr}}
.px-calendar-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px;align-items:start}
.px-calendar-panel{overflow:hidden}
.px-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.px-calendar-weekday{padding:9px 8px;background:#f7f9f8;border-bottom:1px solid #e4eae8;color:#74848a;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.px-calendar-day{min-width:0;min-height:112px;padding:6px;display:flex;flex-direction:column;gap:4px;border-right:1px solid #edf0ef;border-bottom:1px solid #edf0ef}
.px-calendar-day:nth-child(7n){border-right:0}
.px-calendar-day.outside{background:#fafbfb}
.px-calendar-day.outside .px-calendar-date{color:#b3bfc2}
.px-calendar-date{align-self:flex-start;min-width:22px;padding:2px 5px;border-radius:3px;color:#40555b;font-size:11px;font-weight:800;text-align:center}
.px-calendar-day.today .px-calendar-date{background:#176d7f;color:#fff}
.px-meeting-chip{min-width:0;display:flex;gap:5px;align-items:baseline;padding:4px 6px;border-left:3px solid var(--tone-bar);border-radius:2px;background:var(--tone-bg);color:var(--tone-fg);text-decoration:none;font-size:10px;line-height:1.3}
.px-meeting-chip:hover{filter:brightness(.96)}
.px-meeting-chip:focus-visible{outline:2px solid #176d7f;outline-offset:1px}
.px-meeting-chip time{flex:none;font-weight:700;font-variant-numeric:tabular-nums}
.px-meeting-chip strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.px-calendar-agenda{display:none;margin:0;padding:0;list-style:none}
.px-calendar-agenda-day{padding:11px 14px;border-bottom:1px solid #edf0ef}
.px-calendar-agenda-day>strong{display:block;margin-bottom:7px;color:#2a3f45;font-size:11px}
.px-calendar-agenda-day ul,.px-calendar-side-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.px-calendar-agenda .px-meeting-chip{font-size:12px;padding:7px 9px}
.px-calendar-side-list{padding:12px 14px 16px}
.px-calendar-side-list li{display:flex;flex-direction:column;gap:4px}
.px-calendar-side-list li.px-empty{padding:0}
.px-calendar-side-list small{color:#71838a;font-size:10px;line-height:1.4;overflow-wrap:anywhere}
.px-calendar-undated{color:#176d7f;font-size:12px;font-weight:700;text-decoration:none}
@media(max-width:1100px){.px-calendar-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){.px-calendar-toolbar{flex-wrap:wrap}.px-calendar-month{order:-1;width:100%}.px-calendar-grid{display:none}.px-calendar-agenda{display:block}}
@media(max-width:900px){.px-admin-shell{grid-template-columns:180px minmax(0,1fr)}.px-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.px-dashboard-columns,.px-material-layout{grid-template-columns:1fr}}
@media(max-width:900px){.px-request-workspace,.px-inventory-layout{grid-template-columns:minmax(0,1fr)}.px-request-list{max-height:330px}}
@media(max-width:600px){.px-admin-shell{display:block}.px-admin-sidebar{position:static;width:auto;height:auto;padding:12px;gap:12px}.px-admin-brand img{width:120px}.px-admin-nav{flex-direction:row;overflow:auto}.px-admin-nav a{white-space:nowrap}.px-admin-user{display:none}.px-admin-content{padding:20px 14px}.px-welcome{display:block}.px-welcome p{margin-bottom:4px}.px-metrics{gap:8px}.px-metric{min-height:112px;padding:12px}.px-metric strong{font-size:26px}.px-quick-actions{margin:12px 0}.px-dashboard-columns{gap:12px}.px-material-form{padding:13px;gap:10px}.px-material-table{min-width:650px}.px-request-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.px-request-detail-panel .px-request-fields{grid-template-columns:1fr}.px-request-detail-panel .px-request-field:last-child{grid-column:auto}.px-requests-toolbar{align-items:stretch}.px-requests-toolbar input{flex:1;min-width:0}.px-request-detail-panel .px-request-actions{flex-wrap:wrap;gap:12px 18px}.px-request-status-control{margin-left:0;width:100%}.px-request-status-control select{flex:1}.px-quote-pending-notice{flex-direction:column;align-items:flex-start}.px-inventory-intro-row{align-items:flex-start;flex-direction:column}.px-inventory-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.px-inventory-table{min-width:640px}.px-stock-form label{grid-column:1/-1}}
@media(max-width:600px){.px-followup-dialog{width:calc(100vw - 18px);max-height:92vh}.px-followup-heading,.px-followup-form{padding-right:15px;padding-left:15px}.px-followup-history{padding-right:15px;padding-left:15px}.px-followup-item-row{grid-template-columns:minmax(0,1fr) 64px 75px 30px;gap:5px}.px-followup-item-row input{padding:8px 6px;font-size:10px}}
@media(max-width:760px){.px-quote-line{padding:11px}.px-quote-line-header{grid-template-columns:minmax(0,1fr) 32px;gap:7px}.px-quote-product-details{grid-template-columns:42px minmax(0,1fr);gap:7px}.px-quote-thumb{width:42px;height:38px}.px-quote-line-header>.px-quote-catalog-select{grid-column:1;grid-row:2}.px-quote-labor-fields,.px-quote-fee-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.px-quote-task-field{grid-column:1/-1}.px-quote-labor-fields>.px-remove-item,.px-quote-fee-fields>.px-remove-item{justify-self:end}.px-quote-group-heading{padding:10px 11px}.px-quote-line-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.px-quote-amount-field{grid-column:1/-1}.px-quote-dialog .px-followup-heading{padding-right:15px;padding-left:15px}}
@media(max-width:600px){.px-public-quote{margin:18px 0;padding:18px 15px}.px-public-quote-line{grid-template-columns:48px minmax(0,1fr) 75px;gap:8px}.px-public-quote-line img{width:44px;height:42px}.px-public-quote-unit-price{display:none}.px-public-quote-line-price{font-size:11px}.px-public-quote-heading h2,.px-deposit-summary h2{font-size:21px}}
`;
document.head.append(runtimeStyles);

setupContactForm();
setupEmailConfirmation();
setupCareersForm();
setupProjectGallery();
if (location.pathname.startsWith('/admin/')) setupAdminPage();
if (location.pathname === '/step-2-quote') void setupPublicQuoteStep();
