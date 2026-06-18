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
    <div style="margin:0 0 16px;background:#fff4e5;border-left:4px solid #f59e0b;padding:12px;border-radius:6px;color:#7a4b00;font-size:13px;line-height:1.55">
      <p style="margin:0">This is a <strong>priority project</strong> for District 6, and we need the fruit table photos submitted as soon as you can. Thank you for helping us wrap this up quickly.</p>
    </div>`;
}

function shiftAndPaymentNoticeHtml() {
  return `
    <div style="margin:16px 0 0;padding:12px 14px;border-left:4px solid #2563eb;background:#f0f6ff;border-radius:6px;color:#1a2f55;font-size:13px;line-height:1.6">
      <p style="margin:0"><strong>If you are logged into your shift right now:</strong> please go ahead and complete the fruit audit photos today. You do not need to wait for another message from us.</p>
      <p style="margin:10px 0 0"><strong>If you are not on shift:</strong> reply to this email or let me know, and I will make sure you are paid for the time it takes to complete the audit.</p>
    </div>`;
}

function fruitAuditCaptureStepsHtml() {
  return `
    <ol style="padding-left:20px;margin:0 0 16px;font-size:14px;line-height:1.65;color:#333">
      <li>Open the fruit photo app using the link below.</li>
      <li>For each fruit set listed, capture the required side-view photos (front, right side, back, and left side).</li>
      <li>When all required photos are captured, click <strong>Submit</strong>.</li>
    </ol>`;
}

function fruitAuditRequestStepsHtml(dashboardUrl) {
  return `
    <ol style="padding-left:20px;margin:0 0 16px;font-size:14px;line-height:1.65;color:#333">
      <li>Open the <a href="${escapeHtml(dashboardUrl)}">District 6 assignment dashboard</a> and sign in with your name and email.</li>
      <li>Request the Fred Meyer store where you will be taking photos. You can submit a request even if someone else is currently listed on that store, as long as the audit photos have not been submitted yet.</li>
      <li>After I approve your request, return to the dashboard and open the fruit photo app for your store.</li>
      <li>Capture the required side-view photos for each fruit set, then click <strong>Submit</strong>.</li>
    </ol>`;
}

function fieldAppUrlForStore(fieldAppUrl, storeId, district = '6') {
  const padded = String(storeId || '').replace(/\D/g, '').padStart(3, '0');
  const base = fieldAppUrl || `https://fuel.retail-odyssey.com/fruit-audit?district=${encodeURIComponent(String(district))}`;
  return `${base}${base.includes('?') ? '&' : '?'}store=${encodeURIComponent(padded)}`;
}

function assignedStoresHtml(assignments) {
  const rows = (assignments || []).map(item => (
    `<li style="margin:6px 0"><strong>FM ${escapeHtml(item.storeId)}</strong>${item.scheduledLabel ? ` <span style="color:#666">(${escapeHtml(item.scheduledLabel)})</span>` : ''}</li>`
  )).join('');
  if (!rows) return '';
  return `
    <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>Your current assignment(s)</strong></p>
    <ul style="padding-left:20px;margin:0 0 16px">${rows}</ul>`;
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
      <p style="margin:0 0 16px"><strong>${escapeHtml(request.name)}</strong> (${escapeHtml(request.email)}) requested FM ${escapeHtml(request.storeId)} on the ${escapeHtml(districtLabel(meta))} fruit audit tracker.</p>
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
      <p style="margin:0 0 16px">Hi ${escapeHtml(request.name)},</p>
      <p style="margin:0 0 16px">Thank you — your request for <strong>FM ${escapeHtml(request.storeId)}</strong> has been sent to me for review. I will email you once it is approved or if I need anything else from you.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%;margin:0 0 16px">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Requested at</td><td>${escapeHtml(fmtWhen(request.requestedAt))}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#444">After approval, the steps are straightforward:</p>
      ${fruitAuditCaptureStepsHtml()}
      <p style="margin:0 0 8px;font-size:13px;color:#444">
        <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">Open fruit photo app</a>
      </p>
      ${shiftAndPaymentNoticeHtml()}
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
      <p style="margin:0 0 16px">Hi ${escapeHtml(request.name)},</p>
      <p style="margin:0 0 16px">Your request for <strong>FM ${escapeHtml(request.storeId)}</strong> has been approved. You are all set to capture and submit the fruit audit photos.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%;margin:0 0 16px">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Store</td><td><strong>${escapeHtml(storeLine(meta))}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Approved at</td><td>${escapeHtml(fmtWhen(request.resolvedAt))}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>What to do next</strong></p>
      ${fruitAuditCaptureStepsHtml()}
      <p style="margin:0 0 8px;font-size:13px;color:#444">
        <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">Open fruit photo app for FM ${escapeHtml(request.storeId)}</a>
      </p>
      ${shiftAndPaymentNoticeHtml()}
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
    ? `<p style="margin:0 0 16px;font-size:13px;color:#444">${escapeHtml(request.resolutionNote)}</p>`
    : '';
  const html = emailShell(
    `${districtLabel(meta)} fruit audit request update`,
    `
      <p style="margin:0 0 16px">Hi ${escapeHtml(request.name)},</p>
      <p style="margin:0 0 16px">Thank you for offering to help. Your request for <strong>FM ${escapeHtml(request.storeId)}</strong> was not approved at this time, so the current assignment will stay in place.</p>
      ${reasonLine}
      <p style="margin:0;font-size:13px;color:#444">If you still need a store assignment, you are welcome to request another store on the dashboard or reply to this email and I can help.</p>
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
  alreadyAssigned = false,
  assignments = [],
}) {
  if (!email) return { ok: false, skipped: true };
  const firstStoreId = assignments[0] && assignments[0].storeId;
  const storeFieldUrl = firstStoreId
    ? fieldAppUrlForStore(fieldAppUrl, firstStoreId, '6')
    : (fieldAppUrl || dashboardUrl);

  if (alreadyAssigned && assignments.length) {
    const subject = `Reminder: District 6 fruit audit photos needed${assignments.length === 1 ? ` - FM ${assignments[0].storeId}` : ''}`;
    const html = emailShell(
      'District 6 fruit audit — friendly reminder',
      `
        ${priorityProjectNoticeHtml()}
        <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')},</p>
        <p style="margin:0 0 16px">Thank you again for your help on this project. You are already assigned on the District 6 fruit audit tracker, and we still need the photos submitted as soon as you can.</p>
        ${assignedStoresHtml(assignments)}
        <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>What to do</strong></p>
        ${fruitAuditCaptureStepsHtml()}
        <p style="margin:0 0 16px">
          <a href="${escapeHtml(storeFieldUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open fruit photo app</a>
        </p>
        <p style="margin:0 0 16px;font-size:13px;color:#444">
          Assignment dashboard: <a href="${escapeHtml(dashboardUrl)}">${escapeHtml(dashboardUrl)}</a>
        </p>
        ${shiftAndPaymentNoticeHtml()}
      `,
      dashboardUrl,
    );
    return sendEmail(resend, { to: [email], cc, subject, html });
  }

  const subject = 'District 6 fruit audit — how to request your store and submit photos';
  const html = emailShell(
    'District 6 fruit audit — quick instructions',
    `
      ${priorityProjectNoticeHtml()}
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')},</p>
      <p style="margin:0 0 16px">We are collecting fruit table photos for a priority District 6 audit. If you can help at your store, the process is simple and should only take a few minutes once you are at the fruit sets.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>How to get started</strong></p>
      ${fruitAuditRequestStepsHtml(dashboardUrl)}
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open D6 assignment dashboard</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#444">
        Photo app (after assignment): <a href="${escapeHtml(fieldAppUrl || dashboardUrl)}">${escapeHtml(fieldAppUrl || dashboardUrl)}</a>
      </p>
      ${shiftAndPaymentNoticeHtml()}
    `,
    dashboardUrl,
  );
  return sendEmail(resend, { to: [email], cc, subject, html });
}

async function sendD6FruitAuditShiftInvite(resend, {
  name,
  email,
  storeId,
  shiftDateLabel,
  dashboardUrl,
  fieldAppUrl,
  cc,
}) {
  if (!email) return { ok: false, skipped: true };
  const store = String(storeId || '').replace(/\D/g, '').padStart(3, '0');
  const fieldUrl = fieldAppUrlForStore(fieldAppUrl, store, '6');
  const whenLine = shiftDateLabel
    ? ` for <strong>${escapeHtml(shiftDateLabel)}</strong>`
    : ' for your upcoming shift';
  const subject = `District 6 fruit audit — FM ${store}${shiftDateLabel ? ` on ${shiftDateLabel}` : ''}`;
  const html = emailShell(
    `District 6 fruit audit — FM ${store}`,
    `
      ${priorityProjectNoticeHtml()}
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')},</p>
      <p style="margin:0 0 16px">I am setting up your shift${whenLine} at <strong>FM ${escapeHtml(store)}</strong> for the District 6 fruit audit. This is a priority project, and we need the photos submitted as soon as you can once you are at the store.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>How to get started</strong></p>
      ${fruitAuditRequestStepsHtml(dashboardUrl)}
      <p style="margin:0 0 16px">On the dashboard, request <strong>FM ${escapeHtml(store)}</strong>. You can submit that request even if someone else is currently listed on the store, as long as the audit photos have not been submitted yet. I will approve your assignment as soon as I see the request.</p>
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open D6 assignment dashboard</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#444"><strong>After you are assigned</strong></p>
      ${fruitAuditCaptureStepsHtml()}
      <p style="margin:0 0 16px">
        <a href="${escapeHtml(fieldUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open fruit photo app for FM ${escapeHtml(store)}</a>
      </p>
      ${shiftAndPaymentNoticeHtml()}
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
  sendD6FruitAuditShiftInvite,
  assignmentReviewUrl,
  notifyRecipients,
  d1MonitorCcEmails,
  d1PhotoRoutingNoticeHtml,
};
