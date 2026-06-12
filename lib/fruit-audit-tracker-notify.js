const DEFAULT_RECIPIENT = 'tyson.gauthier@retailodyssey.com';

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

function notifyRecipients() {
  const configured = String(process.env.FRUIT_AUDIT_TRACKER_NOTIFY_EMAIL || DEFAULT_RECIPIENT)
    .split(/[,\s]+/)
    .map(email => email.trim())
    .filter(Boolean);
  return [...new Set(configured)];
}

function storeLine(meta) {
  const sets = meta.setCount ? `${meta.setCount} fruit set${meta.setCount === 1 ? '' : 's'}` : 'fruit audit';
  return `FM ${meta.id} - District 1 - ${sets}`;
}

function emailShell(title, bodyHtml, dashboardUrl) {
  return `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-size:13px;color:#666">
        <a href="${escapeHtml(dashboardUrl)}">Open live District 1 fruit dashboard</a>
      </p>
    </div>`;
}

async function sendFruitTrackerNotification(resend, { subject, html }) {
  const to = notifyRecipients();
  if (!to.length) {
    console.warn('Fruit audit tracker notify: no recipients configured');
    return { ok: false, skipped: true };
  }
  if (!resend) {
    console.warn('Fruit audit tracker notify skipped: Resend not configured');
    return { ok: false, skipped: true };
  }

  const from = process.env.FRUIT_AUDIT_TRACKER_NOTIFY_FROM || 'D1 Fruit Audit Tracker <fruitaudit@the-dump-bin.com>';
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error('Fruit audit tracker notify email failed:', error);
    return { ok: false, error: error.message || 'send failed' };
  }

  console.log(`Fruit audit tracker notify sent to ${to.join(', ')} - ${subject} (id: ${data?.id || 'n/a'})`);
  return { ok: true, id: data?.id };
}

async function sendPledgeSignedUp(resend, { pledge, meta, deadline, dashboardUrl }) {
  const subject = `D1 fruit audit FM ${pledge.storeId} claimed - ${pledge.name}`;
  const html = emailShell(
    'New District 1 fruit audit commitment',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> committed to audit this District 1 fruit store.</p>
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
  return sendFruitTrackerNotification(resend, { subject, html });
}

async function sendPledgeReleased(resend, { pledge, meta, dashboardUrl }) {
  const subject = `D1 fruit audit FM ${pledge.storeId} claim released - ${pledge.name}`;
  const html = emailShell(
    'District 1 fruit audit commitment released',
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> released their fruit audit claim.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${escapeHtml(pledge.email)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Originally committed</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Released at</td><td>${escapeHtml(fmtWhen(new Date().toISOString()))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#444">This store is <strong>open</strong> again on the dashboard.</p>
    `,
    dashboardUrl,
  );
  return sendFruitTrackerNotification(resend, { subject, html });
}

module.exports = {
  sendPledgeSignedUp,
  sendPledgeReleased,
  notifyRecipients,
};
