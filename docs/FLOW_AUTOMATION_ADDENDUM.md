# Flow-automation addendum — Fuel Cooler audit inbox

**Use this with the main Fuel audit prompt.** The Gmail → OneDrive parser behavior is unchanged; only the **Fuel app email routing** differs for one store.

---

## No changes required for attachment parsing

- Subject: `^FM\s*(\d{3})\s+Audit\b`
- Filenames: `FM{###}_{Fixture}_{A|B|C}.jpg`
- Save path: `…\Follow Up Fuel\{049|053|214|286|351|486|652|657}\`
- Headers (optional): `X-Fuel-Audit-Store`, `X-Fuel-Audit-Photo-Count`
- Parser inbox: `d6ewa.supervisor@gmail.com` (CC is sufficient)

Implement `fuel-audit-inbox.js` per the main prompt; this addendum does **not** alter that design.

---

## Fuel app email routing (for human context only)

| Store | **To** (primary) | **CC** |
|-------|------------------|--------|
| **053** | `tyson.gauthier@retailodyssey.com` | Auditor email (from app sign-in), `d6ewa.supervisor@gmail.com` — **not** April |
| All other audit stores | `april.gauthier@retailodyssey.com` | `tyson.gauthier@retailodyssey.com`, auditor email, `d6ewa.supervisor@gmail.com` |

April is **not** on FM 053 audit emails. Tyson is **not** duplicated in CC when he is already the To recipient for 053.

---

## Auditor identity (Fuel app)

Audit mode uses a separate **auditor sign-in** (not the setup-mode login):

- Store (dropdown of 8 audit stores)
- Full name
- Email → **CC** on submit

Stored in the browser as `d6fuel_audit_session`. The parser does not read this; it only affects Resend To/CC.

---

## Test checklist after `fuel-audit-inbox` is live

1. **FM 486** — To April, CC Tyson + inbox + auditor.
2. **FM 053** — To Tyson only (no April), CC inbox + auditor.
3. Confirm files under `…\486\` and `…\053\` with expected filenames.
4. Confirm `FM ### Before Photos` mail is ignored (marked read, no save).
