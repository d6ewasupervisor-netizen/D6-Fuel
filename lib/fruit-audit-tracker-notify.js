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

function notifyRecipients() {
  const configured = String(process.env.FRUIT_AUDIT_TRACKER_NOTIFY_EMAIL || DEFAULT_RECIPIENT)
    .split(/[,\s]+/)
    .map(email => email.trim())
    .filter(Boolean);
  return [...new Set(configured)];
}

function d1MonitorCcEmails() {
  const configured = String(process.env.D1_FRUIT_AUDIT_MONITOR_CC_EMAILS || '')
    .split(/[,\s]+/)
    .map(email => email.trim())
    .filter(Boolean);
  const base = configured.length
    ? configured
    : [DEFAULT_RECIPIENT, 'james.carr@retailodyssey.com'];
  return uniqueEmails(base);
}

function d1PhotoRoutingNoticeHtml() {
  return `
    <div style="margin:0 0 16px;background:#eef4ff;border-left:4px solid #4b7bec;padding:12px;border-radius:6px;color:#1a2f55;font-size:13px">
      <p style="margin:0 0 8px"><strong>Informational copy only</strong></p>
      <p style="margin:0">These photos are automatically routed to the District 1 OneDrive folder. No action is required on your part. This message provides copies of the audit photos for your records and helps monitor progress.</p>
    </div>`;
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

function districtLabel(meta) {
  return `District ${String((meta && meta.district) || '1')}`;
}

function districtShort(meta) {
  return `D${String((meta && meta.district) || '1')}`;
}

function storeLine(meta) {
  const sets = meta.setCount ? `${meta.setCount} fruit set${meta.setCount === 1 ? '' : 's'}` : 'fruit audit';
  return `FM ${meta.id} - ${districtLabel(meta)} - ${sets}`;
}

function emailShell(title, bodyHtml, dashboardUrl) {
  const url = dashboardUrl || DEFAULT_DASHBOARD_URL;
  return `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-size:13px;color:#666">
        <a href="${escapeHtml(url)}">Open live fruit dashboard</a>
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

async function sendAssigneeAssignmentNotice(resend, {
  pledge,
  meta,
  deadline,
  dashboardUrl,
  fieldAppUrl,
  assignedBy,
}) {
  if (!pledge || !pledge.email) return { ok: false, skipped: true };
  const district = districtLabel(meta);
  const subject = `${districtShort(meta)} fruit audit assignment - FM ${pledge.storeId}`;
  const assignedByLine = assignedBy && assignedBy.name
    ? `<tr><td style="padding:6px 12px 6px 0;color:#666">Assigned by</td><td>${escapeHtml(assignedBy.name)}${assignedBy.email ? ` (${escapeHtml(assignedBy.email)})` : ''}</td></tr>`
    : '';
  const html = emailShell(
    `Your ${district} fruit audit assignment`,
    `
      <p style="margin:0 0 16px">You have been assigned a ${escapeHtml(district)} fruit audit store. Open the field app to capture required 360-degree fruit set photos, then submit from the app.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${escapeHtml(pledge.email)}</td></tr>
        ${assignedByLine}
        <tr><td style="padding:6px 12px 6px 0;color:#666">Complete by</td><td>${escapeHtml(fmtWhen(deadline))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#444">
        <a href="${escapeHtml(fieldAppUrl || 'https://fuel.retail-odyssey.com/fruit-audit?district=1')}">Open fruit photo app</a>
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#666">After photos are submitted, they are automatically routed to the District 1 OneDrive folder. Submission confirmation emails are informational copies for your records.</p>
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [pledge.email], subject, html });
}

async function sendPledgeSignedUp(resend, { pledge, meta, deadline, dashboardUrl, recipients }) {
  const district = districtLabel(meta);
  const subject = `${districtShort(meta)} fruit audit FM ${pledge.storeId} assigned - ${pledge.name}`;
  const html = emailShell(
    `New ${district} fruit audit assignment`,
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> was assigned this ${escapeHtml(district)} fruit audit store.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td><a href="mailto:${escapeHtml(pledge.email)}">${escapeHtml(pledge.email)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Assigned at</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Complete by</td><td>${escapeHtml(fmtWhen(deadline))}</td></tr>
      </table>
    `,
    dashboardUrl,
  );
  if (recipients && recipients.length) return sendEmail(resend, { to: recipients, subject, html });
  return sendFruitTrackerNotification(resend, { subject, html });
}

async function sendPledgeReleased(resend, { pledge, meta, dashboardUrl, recipients }) {
  const district = districtLabel(meta);
  const subject = `${districtShort(meta)} fruit audit FM ${pledge.storeId} assignment released - ${pledge.name}`;
  const html = emailShell(
    `${district} fruit audit assignment released`,
    `
      <p style="margin:0 0 16px"><strong>${escapeHtml(pledge.name)}</strong> released their ${escapeHtml(district)} fruit audit assignment.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${escapeHtml(pledge.email)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Originally assigned</td><td>${escapeHtml(fmtWhen(pledge.pledgedAt))}</td></tr>
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
  const firstMeta = (metas || {})[pledges[0] && pledges[0].storeId] || {};
  const district = districtLabel(firstMeta);
  const subject = pledges.length === 1
    ? `${districtShort(firstMeta)} fruit audit opening available - FM ${pledges[0].storeId}`
    : `${districtShort(firstMeta)} fruit audit openings available - ${pledges.length} stores`;
  const html = emailShell(
    pledges.length === 1 ? `A ${district} fruit audit store opened up` : `${district} fruit audit stores opened up`,
    `
      <p style="margin:0 0 16px">${pledges.length === 1 ? `An assigned ${escapeHtml(district)} fruit audit store is` : `Assigned ${escapeHtml(district)} fruit audit stores are`} open again. If you can help, take ${pledges.length === 1 ? 'it' : 'one'} on the live dashboard:</p>
      <p style="margin:0 0 16px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
      <ul style="padding-left:20px;margin:0 0 16px">${storeRows}</ul>
      <p style="margin:0;color:#444;font-size:13px">The first person assigned to an open store on the dashboard gets it.</p>
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

function priorityProjectNoticeHtml() {
  return `
    <div style="margin:0 0 16px;background:#fff4e5;border-left:4px solid #f59e0b;padding:12px;border-radius:6px;color:#7a4b00;font-size:13px">
      <p style="margin:0"><strong>Priority project:</strong> We need these fruit table photos submitted as soon as possible. Thank you for helping us close this out quickly.</p>
    </div>`;
}

function assignmentReviewUrl(dashboardUrl, district, requestId) {
  const base = dashboardUrl || DEFAULT_DASHBOARD_URL;
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}district=${encodeURIComponent(String(district || '6'))}&request=${encodeURIComponent(requestId)}`;
}

async function sendAssignmentRequestToAdmin(resend, {
  request,
  meta,
  dashboardUrl,
  district,
  cc,
}) {
  if (!request || !request.id) return { ok: false, skipped: true };
  const reviewUrl = assignmentReviewUrl(dashboardUrl, district || meta.district, request.id);
  const assigneeRows = (request.currentAssignees || []).length
    ? request.currentAssignees.map(item => (
      `<li style="margin:6px 0"><strong>${escapeHtml(item.name)}</strong> (${escapeHtml(item.email)})${item.scheduledLabel ? ` — ${escapeHtml(item.scheduledLabel)}` : ''}</li>`
    )).join('')
    : '<li style="margin:6px 0;color:#666">No active assignee — store is open.</li>';
  const subject = `${districtShort(meta)} fruit audit assignment request - FM ${request.storeId} - ${request.name}`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="margin:0 0 12px">Assignment request needs review</h2>
      <p style="margin:0 0 16px"><strong>${escapeHtml(request.name)}</strong> requested FM ${escapeHtml(request.storeId)} on the ${escapeHtml(districtLabel(meta))} fruit audit tracker.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%;margin:0 0 16px">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Requester</td><td>${escapeHtml(request.name)} (${escapeHtml(request.email)})</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Requested at</td><td>${escapeHtml(fmtWhen(request.requestedAt))}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>Current assignee(s)</strong></p>
      <ul style="padding-left:20px;margin:0 0 16px">${assigneeRows}</ul>
      ${request.note ? `<p style="margin:0 0 16px;font-size:13px;color:#444"><strong>Note:</strong> ${escapeHtml(request.note)}</p>` : ''}
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review request on dashboard</a>
      </p>
      <p style="margin:0;font-size:12px;color:#666">Approve to assign the requester (replacing any incomplete assignment). Deny to leave the current assignment in place.</p>
    </div>`;
  return sendEmail(resend, {
    to: notifyRecipients(),
    cc,
    subject,
    html,
  });
}

async function sendAssignmentRequestAckToRequester(resend, {
  request,
  meta,
  dashboardUrl,
  fieldAppUrl,
  cc,
}) {
  if (!request || !request.email) return { ok: false, skipped: true };
  const subject = `${districtShort(meta)} fruit audit request received - FM ${request.storeId}`;
  const html = emailShell(
    `${districtLabel(meta)} fruit audit request received`,
    `
      ${priorityProjectNoticeHtml()}
      <p style="margin:0 0 16px">Your request for <strong>FM ${escapeHtml(request.storeId)}</strong> was sent to Tyson for review. You will get another email once it is approved or denied.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Requester</td><td>${escapeHtml(request.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Requested at</td><td>${escapeHtml(fmtWhen(request.requestedAt))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#444">After approval, open the photo app, capture the required side-view photos for each fruit set, and click <strong>Submit</strong>.</p>
      <p style="margin:8px 0 0;font-size:13px;color:#444">
        <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">Open fruit photo app</a>
      </p>
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [request.email], cc, subject, html });
}

async function sendAssignmentRequestApproved(resend, {
  request,
  pledge,
  meta,
  dashboardUrl,
  fieldAppUrl,
  cc,
}) {
  if (!request || !request.email) return { ok: false, skipped: true };
  const subject = `${districtShort(meta)} fruit audit approved - FM ${request.storeId}`;
  const html = emailShell(
    `Your ${districtLabel(meta)} fruit audit assignment is approved`,
    `
      ${priorityProjectNoticeHtml()}
      <p style="margin:0 0 16px">Your request for <strong>FM ${escapeHtml(request.storeId)}</strong> was approved. You can start taking photos now.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Auditor</td><td>${escapeHtml(pledge.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Approved at</td><td>${escapeHtml(fmtWhen(request.resolvedAt))}</td></tr>
      </table>
      <ol style="padding-left:20px;margin:16px 0 0;font-size:13px;color:#444;line-height:1.6">
        <li>Open the fruit photo app with the link below.</li>
        <li>Capture the required photos for each fruit set.</li>
        <li>Click <strong>Submit</strong> when finished.</li>
      </ol>
      <p style="margin:16px 0 0;font-size:13px;color:#444">
        <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">Open fruit photo app for FM ${escapeHtml(request.storeId)}</a>
      </p>
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [request.email], cc, subject, html });
}

async function sendAssignmentRequestDenied(resend, {
  request,
  meta,
  dashboardUrl,
  cc,
}) {
  if (!request || !request.email) return { ok: false, skipped: true };
  const subject = `${districtShort(meta)} fruit audit request update - FM ${request.storeId}`;
  const reasonLine = request.resolutionNote
    ? `<p style="margin:0 0 16px;font-size:13px;color:#444"><strong>Note:</strong> ${escapeHtml(request.resolutionNote)}</p>`
    : '';
  const html = emailShell(
    `${districtLabel(meta)} fruit audit request update`,
    `
      <p style="margin:0 0 16px">Your request for <strong>FM ${escapeHtml(request.storeId)}</strong> was not approved at this time.</p>
      ${reasonLine}
      <p style="margin:0;font-size:13px;color:#444">You can request another open store on the dashboard if needed.</p>
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [request.email], cc, subject, html });
}

async function sendD6FruitAuditInvite(resend, {
  name,
  email,
  dashboardUrl,
  fieldAppUrl,
  cc,
}) {
  if (!email) return { ok: false, skipped: true };
  const subject = 'D6 fruit audit - request your store and submit photos';
  const html = emailShell(
    'District 6 fruit audit — quick photo request',
    `
      ${priorityProjectNoticeHtml()}
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')},</p>
      <p style="margin:0 0 16px">We need a few fruit table photos from your store. The process is simple:</p>
      <ol style="padding-left:20px;margin:0 0 16px;font-size:14px;line-height:1.6">
        <li>Open the <strong>District 6 assignment dashboard</strong> and request your store (you can request even if someone else is currently assigned, as long as photos have not been submitted yet).</li>
        <li>After Tyson approves your request, open the fruit photo app from the dashboard.</li>
        <li>Take the required side-view photos for each fruit set.</li>
        <li>Click <strong>Submit</strong>.</li>
      </ol>
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open D6 assignment dashboard</a>
      </p>
      <p style="margin:0;font-size:13px;color:#444">
        Photo app: <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">${escapeHtml(fieldAppUrl || dashboardUrl)}</a>
      </p>
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [email], cc, subject, html });
}

async function sendCompletionReceived(resend, { completion, meta, completedCount, completedStores, dashboardUrl, cc }) {
  if (!completion || !completion.email) return { ok: false, skipped: true };
  const count = Number(completedCount) || 1;
  const stores = Array.isArray(completedStores) && completedStores.length
    ? completedStores
    : [completion.storeId];
  const district = districtLabel(meta);
  const isD1 = String((meta && meta.district) || '') === '1';
  const subject = `${districtShort(meta)} fruit audit FM ${completion.storeId} complete`;
  const html = emailShell(
    `${district} fruit audit submission received`,
    `
      <p style="margin:0 0 16px">Your photos for <strong>${escapeHtml(storeLine(meta))}</strong> were received successfully.</p>
      ${isD1 ? d1PhotoRoutingNoticeHtml() : ''}
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store submitted</td><td><strong>FM ${escapeHtml(completion.storeId)}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Completed store count</td><td><strong>${count}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Completed stores counted</td><td>FM ${stores.map(escapeHtml).join(', FM ')}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Photos submitted</td><td>${Number(completion.photoCount) || 0}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Submitted at</td><td>${escapeHtml(fmtWhen(completion.completedAt))}</td></tr>
      </table>
      ${isD1
    ? '<p style="margin:16px 0 0;color:#444;font-size:13px">District supervisors are copied for progress monitoring.</p>'
    : '<p style="margin:16px 0 0;color:#444;font-size:13px">Tyson is copied for completion tracking.</p>'}
    `,
    dashboardUrl,
  );

  const ccList = isD1 ? uniqueEmails([...(cc || []), ...d1MonitorCcEmails()]) : (cc || notifyRecipients());
  return sendEmail(resend, {
    to: [completion.email],
    cc: ccList,
    subject,
    html,
  });
}

module.exports = {
  sendPledgeSignedUp,
  sendPledgeReleased,
  sendOpeningsAvailable,
  sendCompletionReceived,
  sendAssigneeAssignmentNotice,
  sendAssignmentRequestToAdmin,
  sendAssignmentRequestAckToRequester,
  sendAssignmentRequestApproved,
  sendAssignmentRequestDenied,
  sendD6FruitAuditInvite,
  assignmentReviewUrl,
  notifyRecipients,
  d1MonitorCcEmails,
  d1PhotoRoutingNoticeHtml,
};
