const AUDIT_REVIEWER_APRIL = 'april.gauthier@retailodyssey.com';
const AUDIT_REVIEWER_TYSON = 'tyson.gauthier@retailodyssey.com';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function notifyRecipients() {
  const april = process.env.TRACKER_NOTIFY_APRIL || process.env.AUDIT_RECIPIENT_EMAIL || AUDIT_REVIEWER_APRIL;
  const tyson = process.env.TRACKER_NOTIFY_TYSON || AUDIT_REVIEWER_TYSON;
  return [...new Set([april, tyson].filter(Boolean))];
}

function storeLine(meta) {
  const loc = [meta.city, meta.state].filter(Boolean).join(', ');
  return loc ? `FM ${meta.id} — ${loc}` : `FM ${meta.id}`;
}

function emailShell(title, bodyHtml, dashboardUrl) {
  return `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-size:13px;color:#666">
        <a href="${escapeHtml(dashboardUrl)}">Open live audit dashboard</a>
      </p>
    </div>`;
}

async function sendTrackerNotification(resend, { subject, html }) {
  const to = notifyRecipients();
  if (!to.length) {
    console.warn('Tracker notify: no recipients configured');
    return { ok: false, skipped: true };
  }
  if (!resend) {
    console.warn('Tracker notify skipped: Resend not configured');
    return { ok: false, skipped: true };
  }

  const from = process.env.TRACKER_NOTIFY_FROM || 'Fuel Audit Tracker <audits@the-dump-bin.com>';
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error('Tracker notify email failed:', error);
    return { ok: false, error: error.message || 'send failed' };
  }

  console.log(`Tracker notify sent to ${to.join(', ')} — ${subject} (id: ${data?.id || 'n/a'})`);
  return { ok: true, id: data?.id };
}

async function sendPledgeSignedUp(resend, { pledge, meta, deadline, dashboardUrl }) {
  const subject = `FM ${pledge.storeId} audit claimed — ${pledge.name}`;
  const html = emailShell(
    'New audit commitment',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> committed to complete the follow-up audit before the deadline.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td><a href="mailto:${escapeHtml(pledge.email)}">${escapeHtml(pledge.email)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Committed at</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Deadline</td><td>${escapeHtml(fmtWhen(deadline))}</td></tr>
      </table>
    `,
    dashboardUrl,
  );
  return sendTrackerNotification(resend, { subject, html });
}

async function sendPledgeReleased(resend, { pledge, meta, dashboardUrl }) {
  const subject = `FM ${pledge.storeId} audit claim released — ${pledge.name}`;
  const html = emailShell(
    'Audit commitment released',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> released their claim and will not complete this store on the current commitment.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${escapeHtml(pledge.email)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Originally committed</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Released at</td><td>${escapeHtml(fmtWhen(new Date().toISOString()))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#444">This store is <strong>open</strong> again on the dashboard for someone else to claim.</p>
    `,
    dashboardUrl,
  );
  return sendTrackerNotification(resend, { subject, html });
}

module.exports = {
  sendPledgeSignedUp,
  sendPledgeReleased,
  notifyRecipients,
};
