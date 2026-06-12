const DEFAULT_RECIPIENT = 'tyson.gauthier@retailodyssey.com';
const DEFAULT_DASHBOARD_URL = 'https://fuel.retail-odyssey.com/fruit-audit-dashboard';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtWhen(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function fmtHours(value) {
  const n = Number(value) || 0;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function notifyRecipients() {
  const configured = String(process.env.FRUIT_AUDIT_TRACKER_NOTIFY_EMAIL || DEFAULT_RECIPIENT)
    .split(/[,\s]+/)
    .map(email => email.trim())
    .filter(Boolean);
  return [...new Set(configured)];
}

function uniqueEmails(values) {
  const out = [];
  (values || []).forEach(email => {
    const trimmed = String(email || '').trim();
    if (!trimmed) return;
    if (!out.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  });
  return out;
}

function storeLine(meta) {
  const sets = meta.setCount ? `${meta.setCount} fruit set${meta.setCount === 1 ? '' : 's'}` : 'fruit audit';
  return `FM ${meta.id} - District 1 - ${sets}`;
}

function emailShell(title, bodyHtml, dashboardUrl) {
  const url = dashboardUrl || DEFAULT_DASHBOARD_URL;
  return `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-size:13px;color:#666">
        <a href="${escapeHtml(url)}">Open live District 1 fruit dashboard</a>
      </p>
    </div>`;
}

async function sendEmail(resend, { to, cc, subject, html }) {
  const toList = uniqueEmails(to);
  const toKeys = new Set(toList.map(email => email.toLowerCase()));
  const ccList = uniqueEmails(cc).filter(email => !toKeys.has(email.toLowerCase()));
  if (!toList.length) {
    console.warn(`Fruit audit tracker notify: no recipients configured for ${subject}`);
    return { ok: false, skipped: true };
  }
  if (!resend) {
    console.warn('Fruit audit tracker notify skipped: Resend not configured');
    return { ok: false, skipped: true };
  }

  const from = process.env.FRUIT_AUDIT_TRACKER_NOTIFY_FROM || 'D1 Fruit Audit Tracker <fruitaudit@the-dump-bin.com>';
  const payload = {
    from,
    to: toList,
    subject,
    html,
  };
  if (ccList.length) payload.cc = ccList;

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    console.error('Fruit audit tracker notify email failed:', error);
    return { ok: false, error: error.message || 'send failed' };
  }

  console.log(`Fruit audit tracker notify sent to ${toList.join(', ')} - ${subject} (id: ${data?.id || 'n/a'})`);
  return { ok: true, id: data?.id };
}

async function sendFruitTrackerNotification(resend, { subject, html }) {
  const to = notifyRecipients();
  if (!to.length) {
    console.warn('Fruit audit tracker notify: no recipients configured');
    return { ok: false, skipped: true };
  }
  return sendEmail(resend, { to, subject, html });
}

async function sendPledgeSignedUp(resend, { pledge, meta, deadline, dashboardUrl, recipients }) {
  const subject = `D1 fruit audit FM ${pledge.storeId} claimed - ${pledge.name}`;
  const html = emailShell(
    'New District 1 fruit audit claim',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> claimed this District 1 fruit audit store.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td><a href="mailto:${escapeHtml(pledge.email)}">${escapeHtml(pledge.email)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Claimed at</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Complete by</td><td>${escapeHtml(fmtWhen(deadline))}</td></tr>
      </table>
    `,
    dashboardUrl,
  );
  if (recipients && recipients.length) return sendEmail(resend, { to: recipients, subject, html });
  return sendFruitTrackerNotification(resend, { subject, html });
}

async function sendPledgeReleased(resend, { pledge, meta, dashboardUrl, recipients }) {
  const subject = `D1 fruit audit FM ${pledge.storeId} claim released - ${pledge.name}`;
  const html = emailShell(
    'District 1 fruit audit claim released',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> released their fruit audit claim.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${escapeHtml(pledge.email)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Originally claimed</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Released at</td><td>${escapeHtml(fmtWhen(new Date().toISOString()))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#444">This store is <strong>open</strong> again on the dashboard.</p>
    `,
    dashboardUrl,
  );
  if (recipients && recipients.length) return sendEmail(resend, { to: recipients, subject, html });
  return sendFruitTrackerNotification(resend, { subject, html });
}

async function sendOpeningsAvailable(resend, { releasedPledges, metas, dashboardUrl, recipients, cc }) {
  const pledges = Array.isArray(releasedPledges) ? releasedPledges : [];
  if (!pledges.length) return { ok: false, skipped: true };

  const url = dashboardUrl || DEFAULT_DASHBOARD_URL;
  const storeRows = pledges.map(pledge => {
    const meta = (metas || {})[pledge.storeId] || { id: pledge.storeId };
    return `<li style="margin:6px 0"><strong>${escapeHtml(storeLine(meta))}</strong> was released by ${escapeHtml(pledge.name)}.</li>`;
  }).join('');
  const subject = pledges.length === 1
    ? `D1 fruit audit opening available - FM ${pledges[0].storeId}`
    : `D1 fruit audit openings available - ${pledges.length} stores`;
  const html = emailShell(
    pledges.length === 1 ? 'A District 1 fruit audit store opened up' : 'District 1 fruit audit stores opened up',
    `
      <p style="margin:0 0 16px">${pledges.length === 1 ? 'A claimed District 1 fruit audit store is' : 'Claimed District 1 fruit audit stores are'} open again. If you can help, snag ${pledges.length === 1 ? 'it' : 'one'} on the live dashboard:</p>
      <p style="margin:0 0 16px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
      <ul style="padding-left:20px;margin:0 0 16px">${storeRows}</ul>
      <p style="margin:0;color:#444;font-size:13px">The first person to claim an open store on the dashboard gets it.</p>
    `,
    url,
  );

  return sendEmail(resend, {
    to: recipients && recipients.length ? recipients : notifyRecipients(),
    cc,
    subject,
    html,
  });
}

async function sendCompletionHoursEarned(resend, { completion, meta, submissionHours, totalHours, completedStores, dashboardUrl, cc }) {
  if (!completion || !completion.email) return { ok: false, skipped: true };
  const hours = Number(totalHours) || 1;
  const earnedThisSubmission = Number(submissionHours) || Number(completion.earnedHours) || 1;
  const stores = Array.isArray(completedStores) && completedStores.length
    ? completedStores
    : [completion.storeId];
  const subject = `D1 fruit audit FM ${completion.storeId} complete - ${fmtHours(hours)} hour${hours === 1 ? '' : 's'} earned`;
  const html = emailShell(
    'District 1 fruit audit submission received',
    `
      <p style="margin:0 0 16px">Your photos for <strong>${escapeHtml(storeLine(meta))}</strong> were received successfully.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store submitted</td><td><strong>FM ${escapeHtml(completion.storeId)}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">This submission</td><td><strong>${fmtHours(earnedThisSubmission)} hour${earnedThisSubmission === 1 ? '' : 's'} earned</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Total District 1 fruit audit hours</td><td><strong>${fmtHours(hours)}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Pay rule</td><td>Friday stores earn 1 hour each. Saturday stores earn 0.5 hours each.</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Completed stores counted</td><td>FM ${stores.map(escapeHtml).join(', FM ')}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Photos submitted</td><td>${Number(completion.photoCount) || 0}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Submitted at</td><td>${escapeHtml(fmtWhen(completion.completedAt))}</td></tr>
      </table>
      <p style="margin:16px 0 0;color:#444;font-size:13px">Tyson is copied for payroll tracking.</p>
    `,
    dashboardUrl,
  );

  return sendEmail(resend, {
    to: [completion.email],
    cc: cc || notifyRecipients(),
    subject,
    html,
  });
}

module.exports = {
  sendPledgeSignedUp,
  sendPledgeReleased,
  sendOpeningsAvailable,
  sendCompletionHoursEarned,
  notifyRecipients,
};
