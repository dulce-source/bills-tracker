(() => {
  'use strict';

  const STORE_KEY = 'billsTracker.v1';
  const DEFAULT_CATEGORIES = ['Housing', 'Utilities', 'Phone & Internet', 'Insurance', 'Subscriptions', 'Credit card', 'Loan', 'Other'];
  const REPEATS = {
    none: 'One-time',
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Every 3 months',
    yearly: 'Yearly',
  };
  const MONTH_STEPS = { monthly: 1, quarterly: 3, yearly: 12 };
  const DAY_STEPS = { weekly: 7, biweekly: 14 };

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  };
  const dayDiff = (a, b) =>
    Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const hasAlarm = (b) => b.reminderDays !== '' && b.reminderDays != null;

  // ---------- state ----------
  function emptyState() {
    return { bills: [], payments: [], notified: {}, dismissed: {}, currency: 'USD' };
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (d && Array.isArray(d.bills)) return { ...emptyState(), ...d, payments: Array.isArray(d.payments) ? d.payments : [] };
    } catch (e) {
      /* storage unavailable or corrupt: start fresh */
    }
    return emptyState();
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Couldn't save. This browser is blocking storage.");
    }
  }

  let currencyFmt;
  function setCurrency(code) {
    try {
      currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
    } catch (e) {
      currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
    }
  }
  const money = (n) => currencyFmt.format(Number(n) || 0);

  function dateLabel(iso) {
    const d = parseISO(iso);
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function dueText(days) {
    if (days < 0) return `Overdue by ${plural(-days, 'day')}`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due in ${days} days`;
  }

  function nextDueDate(bill) {
    const d = parseISO(bill.dueDate);
    if (DAY_STEPS[bill.repeat]) {
      d.setDate(d.getDate() + DAY_STEPS[bill.repeat]);
      return toISO(d);
    }
    const months = MONTH_STEPS[bill.repeat];
    const day = bill.anchorDay || d.getDate();
    const y = d.getFullYear();
    const m = d.getMonth() + months;
    const lastDay = new Date(y, m + 1, 0).getDate();
    return toISO(new Date(y, m, Math.min(day, lastDay)));
  }

  const activeBills = () => state.bills.filter((b) => !b.done);

  // ---------- rendering ----------
  function renderStats() {
    const today = startOfToday();
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const monthKey = toISO(today).slice(0, 7);
    const active = activeBills();
    const unpaid = active.filter((b) => !b.autopay && parseISO(b.dueDate) <= monthEnd);
    const overdue = active.filter((b) => dayDiff(today, parseISO(b.dueDate)) < 0);
    const paid = state.payments.filter((p) => p.paidDate.startsWith(monthKey));
    $('#stats').innerHTML = `
      <div class="stat"><div class="label">Left to pay this month</div><div class="value">${money(unpaid.reduce((s, b) => s + (Number(b.amount) || 0), 0))}</div></div>
      <div class="stat"><div class="label">Paid this month</div><div class="value">${money(paid.reduce((s, p) => s + (Number(p.amount) || 0), 0))}</div></div>
      <div class="stat ${overdue.length ? 'alert' : ''}"><div class="label">Overdue</div><div class="value">${overdue.length}</div></div>`;
  }

  function billCard(b, today) {
    const days = dayDiff(today, parseISO(b.dueDate));
    const tone = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'later';
    const chips = [
      b.category ? `<span class="chip">${esc(b.category)}</span>` : '',
      `<span class="chip">${REPEATS[b.repeat] || 'One-time'}</span>`,
      b.autopay ? '<span class="chip">Autopay</span>' : '',
      hasAlarm(b) ? `<span class="chip alarm" title="Alarm set">🔔 ${alarmLabel(b)}</span>` : '',
    ].join('');
    return `
      <article class="bill ${tone}" data-id="${esc(b.id)}">
        <div class="bill-main">
          <div class="bill-title"><h3>${esc(b.name)}</h3>${chips}</div>
          <div class="bill-meta"><span class="due ${tone}">${dueText(days)}</span> · ${dateLabel(b.dueDate)}</div>
          ${b.notes ? `<p class="notes">${esc(b.notes)}</p>` : ''}
          <div class="bill-links">
            <button class="link" type="button" data-act="edit">Edit</button>
            <button class="link" type="button" data-act="history">History</button>
            <button class="link" type="button" data-act="calendar">Add to calendar</button>
            <button class="link danger" type="button" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="bill-side">
          <div class="amount">${b.amount !== '' && b.amount != null ? money(b.amount) : '—'}</div>
          <button class="btn primary sm" type="button" data-act="pay">Mark paid</button>
        </div>
      </article>`;
  }

  function alarmLabel(b) {
    const d = Number(b.reminderDays);
    const when = d === 0 ? 'on the day' : d === 7 ? '1 week before' : `${plural(d, 'day')} before`;
    return `${when}, ${b.reminderTime || '09:00'}`;
  }

  function renderBills() {
    const today = startOfToday();
    const active = activeBills().sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
    if (!active.length) {
      $('#billGroups').innerHTML = `
        <div class="empty">
          <h2>No bills yet</h2>
          <p>Add your first bill with its due date, notes and an alarm, and it will show up here.</p>
          <button class="btn primary" type="button" data-act="add">+ Add your first bill</button>
        </div>`;
      return;
    }
    const groups = [
      { key: 'overdue', title: 'Overdue', items: [] },
      { key: 'week', title: 'Due in the next 7 days', items: [] },
      { key: 'later', title: 'Later', items: [] },
    ];
    for (const b of active) {
      const days = dayDiff(today, parseISO(b.dueDate));
      groups[days < 0 ? 0 : days <= 7 ? 1 : 2].items.push(b);
    }
    $('#billGroups').innerHTML = groups
      .filter((g) => g.items.length)
      .map((g) => {
        const total = g.items.reduce((s, b) => s + (Number(b.amount) || 0), 0);
        return `<section class="group ${g.key}"><h2><span>${g.title}</span><span>${money(total)}</span></h2>${g.items.map((b) => billCard(b, today)).join('')}</section>`;
      })
      .join('');
  }

  function reminderAt(b) {
    if (!hasAlarm(b)) return null;
    const d = parseISO(b.dueDate);
    d.setDate(d.getDate() - Number(b.reminderDays));
    const [h, m] = (b.reminderTime || '09:00').split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }

  const alarmKey = (b) => `${b.id}@${b.dueDate}`;

  function renderReminders() {
    const now = new Date();
    const today = startOfToday();
    const ringing = activeBills().filter((b) => {
      const at = reminderAt(b);
      return at && now >= at && !state.dismissed[alarmKey(b)];
    });
    if (!ringing.length) {
      $('#reminders').innerHTML = '';
      return;
    }
    $('#reminders').innerHTML = `
      <div class="reminder-box" role="alert">
        <h2>🔔 ${ringing.length === 1 ? 'Reminder' : `${ringing.length} reminders`}</h2>
        ${ringing
          .map(
            (b) => `
          <div class="reminder-item" data-id="${esc(b.id)}">
            <span><strong>${esc(b.name)}</strong> ${b.amount ? money(b.amount) : ''} · ${dueText(dayDiff(today, parseISO(b.dueDate))).toLowerCase()}</span>
            <span class="row">
              <button class="btn primary sm" type="button" data-act="pay">Mark paid</button>
              <button class="btn sm" type="button" data-act="dismiss">Dismiss</button>
            </span>
          </div>`
          )
          .join('')}
      </div>`;
  }

  function billNameById() {
    const names = new Map();
    for (const p of state.payments) names.set(p.billId, p.billName);
    for (const b of state.bills) names.set(b.id, b.name);
    return names;
  }

  function renderHistoryFilter() {
    const sel = $('#historyFilter');
    const current = sel.value || 'all';
    const names = [...billNameById().entries()].sort((a, b) => a[1].localeCompare(b[1]));
    sel.innerHTML = `<option value="all">All bills</option>${names.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('')}`;
    sel.value = names.some(([id]) => id === current) ? current : 'all';
  }

  function renderHistory() {
    renderHistoryFilter();
    const filter = $('#historyFilter').value;
    const list = state.payments
      .filter((p) => filter === 'all' || p.billId === filter)
      .sort((a, b) => b.paidDate.localeCompare(a.paidDate) || (b.createdAt || 0) - (a.createdAt || 0));
    if (!list.length) {
      $('#historyList').innerHTML = `
        <div class="empty">
          <h2>No payments yet</h2>
          <p>When you mark a bill as paid, it's recorded here with the date and amount.</p>
        </div>`;
      return;
    }
    const months = new Map();
    for (const p of list) {
      const key = p.paidDate.slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(p);
    }
    $('#historyList').innerHTML = [...months.entries()]
      .map(([key, items]) => {
        const title = parseISO(`${key}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const total = items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        return `
          <section class="month">
            <div class="month-head"><span>${title}</span><span class="total">${money(total)}</span></div>
            ${items.map(payRow).join('')}
          </section>`;
      })
      .join('');
  }

  function payRow(p) {
    const late = p.dueDate ? dayDiff(parseISO(p.dueDate), parseISO(p.paidDate)) : 0;
    const tag = late > 0 ? `<span class="tag late">${plural(late, 'day')} late</span>` : '<span class="tag ontime">On time</span>';
    return `
      <div class="pay-row" data-pay="${esc(p.id)}">
        <div>
          <div class="name">${esc(p.billName)}</div>
          <div class="meta">Paid ${dateLabel(p.paidDate)}${p.dueDate ? ` · due ${dateLabel(p.dueDate)}` : ''}</div>
          ${p.note ? `<div class="meta">${esc(p.note)}</div>` : ''}
        </div>
        <div class="side">
          <div class="amount">${money(p.amount)}</div>
          ${tag}
          <div><button class="link danger" type="button" data-act="delete-pay">Remove</button></div>
        </div>
      </div>`;
  }

  function renderNotifStatus() {
    const status = $('#notifStatus');
    const btn = $('#notifBtn');
    if (!('Notification' in window)) {
      status.textContent = 'not supported in this browser';
      btn.hidden = true;
      return;
    }
    const p = Notification.permission;
    status.textContent = p === 'granted' ? 'On' : p === 'denied' ? 'Blocked (allow them in your browser site settings)' : 'Off';
    btn.hidden = p !== 'default';
  }

  function renderAll() {
    renderStats();
    renderReminders();
    renderBills();
    renderHistory();
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(message, actionLabel, onAction) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    el.hidden = false;
    if (actionLabel) {
      el.querySelector('button').addEventListener('click', () => {
        el.hidden = true;
        onAction();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), actionLabel ? 8000 : 4000);
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    for (const id of ['bills', 'history', 'settings']) $(`#tab-${id}`).hidden = id !== name;
    if (name === 'settings') renderNotifStatus();
    window.scrollTo(0, 0);
  }

  // ---------- bill form ----------
  let editingId = null;

  function openBillForm(bill) {
    editingId = bill ? bill.id : null;
    $('#billDialogTitle').textContent = bill ? 'Edit bill' : 'Add bill';
    $('#f-name').value = bill?.name ?? '';
    $('#f-amount').value = bill?.amount ?? '';
    $('#f-due').value = bill?.dueDate ?? toISO(startOfToday());
    $('#f-repeat').value = bill?.repeat ?? 'monthly';
    $('#f-category').value = bill?.category ?? '';
    $('#f-remindDays').value = bill ? (bill.reminderDays ?? '') : '1';
    $('#f-remindTime').value = bill?.reminderTime ?? '09:00';
    $('#f-autopay').checked = !!bill?.autopay;
    $('#f-notes').value = bill?.notes ?? '';
    $('#billError').textContent = '';
    const cats = new Set([...DEFAULT_CATEGORIES, ...state.bills.map((b) => b.category).filter(Boolean)]);
    $('#categoryList').innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join('');
    $('#billDialog').showModal();
    $('#f-name').focus();
  }

  function submitBillForm(e) {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const due = $('#f-due').value;
    const amountRaw = $('#f-amount').value.trim();
    if (!name) return showError('#billError', 'Please give the bill a name.', '#f-name');
    if (!due) return showError('#billError', 'Please choose a due date.', '#f-due');
    if (amountRaw !== '' && !(Number(amountRaw) >= 0)) return showError('#billError', 'Amount must be a number of 0 or more.', '#f-amount');

    const existing = editingId ? state.bills.find((b) => b.id === editingId) : null;
    const bill = existing || { id: uid(), createdAt: Date.now() };
    if (!existing || existing.dueDate !== due) bill.anchorDay = parseISO(due).getDate();
    Object.assign(bill, {
      name,
      amount: amountRaw === '' ? '' : Math.round(Number(amountRaw) * 100) / 100,
      dueDate: due,
      repeat: $('#f-repeat').value,
      category: $('#f-category').value.trim(),
      reminderDays: $('#f-remindDays').value,
      reminderTime: $('#f-remindTime').value || '09:00',
      autopay: $('#f-autopay').checked,
      notes: $('#f-notes').value.trim(),
    });
    if (!existing) state.bills.push(bill);
    save();
    $('#billDialog').close();
    renderAll();
    checkReminders();
    toast(existing ? `Saved changes to ${name}.` : `Added ${name}.`);
  }

  function showError(sel, msg, focusSel) {
    $(sel).textContent = msg;
    $(focusSel).focus();
  }

  // ---------- payments ----------
  let payingId = null;

  function openPayForm(bill) {
    payingId = bill.id;
    $('#payInfo').textContent = `${bill.name}, due ${dateLabel(bill.dueDate)}`;
    $('#p-amount').value = bill.amount ?? '';
    $('#p-date').value = toISO(startOfToday());
    $('#p-note').value = '';
    $('#payError').textContent = '';
    $('#payDialog').showModal();
  }

  function submitPayForm(e) {
    e.preventDefault();
    const bill = state.bills.find((b) => b.id === payingId);
    if (!bill) return $('#payDialog').close();
    const amountRaw = $('#p-amount').value.trim();
    const paidDate = $('#p-date').value;
    if (!paidDate) return showError('#payError', 'Please choose the date you paid.', '#p-date');
    if (amountRaw !== '' && !(Number(amountRaw) >= 0)) return showError('#payError', 'Amount must be a number of 0 or more.', '#p-amount');

    const before = { dueDate: bill.dueDate, done: !!bill.done };
    const payment = {
      id: uid(),
      billId: bill.id,
      billName: bill.name,
      category: bill.category || '',
      amount: amountRaw === '' ? 0 : Math.round(Number(amountRaw) * 100) / 100,
      dueDate: bill.dueDate,
      paidDate,
      note: $('#p-note').value.trim(),
      createdAt: Date.now(),
    };
    state.payments.push(payment);
    if (bill.repeat && bill.repeat !== 'none') bill.dueDate = nextDueDate(bill);
    else bill.done = true;
    save();
    $('#payDialog').close();
    renderAll();
    const msg = bill.done ? `${bill.name} paid.` : `${bill.name} paid. Next due ${dateLabel(bill.dueDate)}.`;
    toast(msg, 'Undo', () => {
      state.payments = state.payments.filter((p) => p.id !== payment.id);
      Object.assign(bill, before);
      save();
      renderAll();
    });
  }

  // ---------- alarms ----------
  let audioCtx = null;

  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function chime() {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime;
      [0, 0.35, 0.7].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 2 ? 1046.5 : 880;
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.32);
      });
    } catch (e) {
      /* sound is a nice-to-have */
    }
  }

  function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, tag });
    } catch (e) {
      /* some mobile browsers only allow notifications from a service worker */
    }
  }

  function checkReminders() {
    const now = new Date();
    const today = startOfToday();
    let changed = false;
    const fired = [];
    for (const b of activeBills()) {
      const at = reminderAt(b);
      if (!at || now < at) continue;
      const key = alarmKey(b);
      if (!state.notified[key]) {
        state.notified[key] = now.getTime();
        changed = true;
        fired.push(b);
      }
    }
    if (fired.length) {
      chime();
      for (const b of fired) {
        const when = dueText(dayDiff(today, parseISO(b.dueDate))).toLowerCase();
        notify(`Bill reminder: ${b.name}`, `${b.amount ? money(b.amount) + ' ' : ''}${when} (${dateLabel(b.dueDate)})`, alarmKey(b));
      }
    }
    if (changed) save();
    renderReminders();
  }

  // ---------- calendar (.ics) ----------
  const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsDate = (iso) => iso.replace(/-/g, '');
  const ICS_RULES = {
    weekly: 'FREQ=WEEKLY',
    biweekly: 'FREQ=WEEKLY;INTERVAL=2',
    monthly: 'FREQ=MONTHLY',
    quarterly: 'FREQ=MONTHLY;INTERVAL=3',
    yearly: 'FREQ=YEARLY',
  };

  function icsEvent(b, stamp) {
    const end = parseISO(b.dueDate);
    end.setDate(end.getDate() + 1);
    const lines = [
      'BEGIN:VEVENT',
      `UID:${b.id}@bills-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(b.dueDate)}`,
      `DTEND;VALUE=DATE:${icsDate(toISO(end))}`,
      `SUMMARY:${icsEscape(`Pay ${b.name}${b.amount ? ` (${money(b.amount)})` : ''}`)}`,
    ];
    if (b.notes) lines.push(`DESCRIPTION:${icsEscape(b.notes)}`);
    if (ICS_RULES[b.repeat]) lines.push(`RRULE:${ICS_RULES[b.repeat]}`);
    const days = hasAlarm(b) ? Number(b.reminderDays) : 1;
    const [h, m] = (b.reminderTime || '09:00').split(':').map(Number);
    const minutes = -days * 1440 + (h || 0) * 60 + (m || 0);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`${b.name} is due ${dateLabel(b.dueDate)}`)}`,
      `TRIGGER:${minutes < 0 ? '-' : ''}PT${Math.abs(minutes)}M`,
      'END:VALARM',
      'END:VEVENT'
    );
    return lines;
  }

  function downloadCalendar(bills, filename) {
    if (!bills.length) return toast('There are no bills to add yet.');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bills Tracker//EN', 'CALSCALE:GREGORIAN'];
    for (const b of bills) lines.push(...icsEvent(b, stamp));
    lines.push('END:VCALENDAR');
    download(filename, lines.join('\r\n'), 'text/calendar');
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bill';

  // ---------- events ----------
  function onBillAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add') return openBillForm(null);
    const holder = btn.closest('[data-id]');
    const bill = holder && state.bills.find((b) => b.id === holder.dataset.id);
    if (!bill) return;
    if (act === 'pay') openPayForm(bill);
    else if (act === 'edit') openBillForm(bill);
    else if (act === 'dismiss') {
      state.dismissed[alarmKey(bill)] = Date.now();
      save();
      renderReminders();
    } else if (act === 'history') {
      renderHistoryFilter();
      $('#historyFilter').value = bill.id;
      renderHistory();
      showTab('history');
    } else if (act === 'calendar') downloadCalendar([bill], `${slug(bill.name)}.ics`);
    else if (act === 'delete') {
      if (!confirm(`Delete "${bill.name}"? Its payment history will be kept.`)) return;
      state.bills = state.bills.filter((b) => b.id !== bill.id);
      save();
      renderAll();
      toast(`Deleted ${bill.name}.`);
    }
  }

  function onHistoryAction(e) {
    const btn = e.target.closest('[data-act="delete-pay"]');
    if (!btn) return;
    const id = btn.closest('[data-pay]').dataset.pay;
    const payment = state.payments.find((p) => p.id === id);
    if (!payment) return;
    state.payments = state.payments.filter((p) => p.id !== id);
    save();
    renderAll();
    toast(`Removed ${payment.billName} payment from history.`, 'Undo', () => {
      state.payments.push(payment);
      save();
      renderAll();
    });
  }

  function exportBackup() {
    const data = { app: 'bills-tracker', version: 1, exportedAt: new Date().toISOString(), ...state };
    download(`bills-tracker-backup-${toISO(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.bills)) throw new Error('not a backup');
        if (!confirm(`Restore ${plural(d.bills.length, 'bill')} and ${plural((d.payments || []).length, 'payment')}? This replaces what's in this browser now.`)) return;
        state = {
          ...emptyState(),
          bills: d.bills,
          payments: Array.isArray(d.payments) ? d.payments : [],
          notified: d.notified || {},
          dismissed: d.dismissed || {},
          currency: d.currency || 'USD',
        };
        setCurrency(state.currency);
        $('#currency').value = state.currency;
        save();
        renderAll();
        toast('Backup restored.');
      } catch (err) {
        toast("That file isn't a Bills Tracker backup.");
      }
    };
    reader.readAsText(file);
  }

  function init() {
    setCurrency(state.currency);
    $('#currency').value = state.currency;

    $('#addBtn').addEventListener('click', () => openBillForm(null));
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('#billGroups').addEventListener('click', onBillAction);
    $('#reminders').addEventListener('click', onBillAction);
    $('#historyList').addEventListener('click', onHistoryAction);
    $('#historyFilter').addEventListener('change', renderHistory);

    $('#billForm').addEventListener('submit', submitBillForm);
    $('#payForm').addEventListener('submit', submitPayForm);
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

    $('#notifBtn').addEventListener('click', async () => {
      unlockAudio();
      try {
        await Notification.requestPermission();
      } catch (e) {
        /* older Safari uses callbacks; status below still updates */
      }
      renderNotifStatus();
    });
    $('#testAlarm').addEventListener('click', () => {
      unlockAudio();
      chime();
      notify('Bill reminder: Test', 'This is what a bill alarm looks like.', 'test');
      toast('🔔 This is what a bill alarm sounds like.');
    });
    $('#icsAll').addEventListener('click', () => downloadCalendar(activeBills(), 'bills.ics'));
    $('#currency').addEventListener('change', (e) => {
      state.currency = e.target.value;
      setCurrency(state.currency);
      save();
      renderAll();
    });
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#importInput').addEventListener('change', (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });
    $('#clearBtn').addEventListener('click', () => {
      if (!confirm('Delete every bill and all payment history from this browser? This cannot be undone.')) return;
      const currency = state.currency;
      state = { ...emptyState(), currency };
      save();
      renderAll();
      toast('All data deleted.');
    });

    // Browsers only allow sound after the person has interacted with the page.
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    renderAll();
    checkReminders();
    setInterval(checkReminders, 30000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        renderAll();
        checkReminders();
      }
    });
  }

  init();
})();
