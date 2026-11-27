// Email an invoice (PDF) and / or the EDI file to the store. POST {company, sale, what: {email, edi}}
// with the person's sign-in (Authorization: Bearer <token>). The database checks they belong to the company
// (invoice_data / sale_sent run as them), so nobody can email another company's invoice.
// Sent from invoices@storeowl.app with the wholesaler's name; replies go to the wholesaler's own email.
// Needs in Vercel: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and MAIL_FROM to change the address).

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { invModel, invoicePdf, pdfName, ediFile, ediName, ediSubject, ediBlocked, invEmail, invEmailText } from '../src/invoice.js';
import { todayIso } from '../src/rules.js';
import { stmtModel, stmtPdf, stmtName, stmtEmailText } from '../src/statement.js';

const env = (k) => (process.env[k] || '').trim();

export function mailer() {
  if (!env('SMTP_HOST') || !env('SMTP_USER') || !env('SMTP_PASS')) return null;
  return nodemailer.createTransport({ host: env('SMTP_HOST'), port: +env('SMTP_PORT') || 587, secure: env('SMTP_PORT') === '465',
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') } });
}
const clean = (s) => String(s || '').replace(/[\r\n<>"]/g, ' ').trim().slice(0, 80);

// The emails for one invoice (pure, so tests can check them without sending).
export function buildMails(d, what) {
  const { sale, customer: cust, company: co } = d, out = [];
  const M = invModel({ sale, co, cust, today: todayIso() });
  const from = '"' + clean(co.name) + '" <' + (env('MAIL_FROM') || 'invoices@storeowl.app') + '>';
  const reply = (co.email || '').trim() || undefined;
  if (what.email) {
    const to = invEmail(cust), t = invEmailText('invoice', M, co);
    out.push(to ? { kind: 'email', to, mail: { from, replyTo: reply, to, subject: t.subject, text: t.text,
      attachments: [{ filename: pdfName(M), content: Buffer.from(invoicePdf(M).bytes), contentType: 'application/pdf' }] } } : { kind: 'email', to: '', err: 'This store has no email for invoices.' });
  }
  if (what.edi) {
    const to = (cust.edi_email || '').trim();
    if (!to) out.push({ kind: 'edi', to: '', err: 'This store has no EDI email.' });
    else if (ediBlocked(sale, cust)) out.push({ kind: 'edi', to, err: 'The EDI file can’t be made yet: check the customer # on the customer’s Details.' });
    else out.push({ kind: 'edi', to, mail: { from, replyTo: reply, to, subject: ediSubject(co, cust, sale), text: invEmailText('edi', M, co).text,
      attachments: [{ filename: ediName(sale, cust), content: ediFile(sale, cust), contentType: 'application/octet-stream' }] } });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), key = env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
  if (!tok || !url || !key) return res.status(401).json({ error: 'Sign in again to send it.' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (b.statement) return sendStatement(req, res, b, tok, url, key);
  const what = { email: !!(b.what && b.what.email), edi: !!(b.what && b.what.edi) };
  if (!b.company || !b.sale || !(what.email || what.edi)) return res.status(400).json({ error: 'Pick what to send.' });
  const sb = createClient(url, key, { global: { headers: { Authorization: 'Bearer ' + tok } }, auth: { persistSession: false } });
  const rpc = async (n, a) => { const { data, error } = await sb.rpc(n, a); if (error) throw new Error(error.message); return data; };
  let d;
  try { d = await rpc('invoice_data', { p_company: b.company, p_sale: b.sale }); } catch (e) { return res.status(403).json({ error: e.message }); }
  const t = mailer();
  if (!t) return res.status(503).json({ error: 'Emails aren’t set up yet (StoreOwl needs to add the email sender).' });
  const sent = [];
  let sale = d.sale;
  for (const m of buildMails(d, what)) {
    let ok = !m.err, err = m.err || '';
    if (ok) { try { await t.sendMail(m.mail); } catch (e) { ok = false; err = String(e.message || e).slice(0, 200); } }
    sent.push({ kind: m.kind, to: m.to, ok, err });
    try { sale = await rpc('sale_sent', { p_company: b.company, p_sale: b.sale, p: { kind: m.kind, to: m.to, ok, err } }); } catch (e) { /* the email still went */ }
  }
  return res.status(200).json({ sent, sale });
}

// A store's statement as a PDF. POST {company, statement: {customer, from, to}}; the database checks the person can see it.
export function buildStatementMail(co, cust, acct, from, to) {
  const M = stmtModel({ co, cust, acct, from, to, today: todayIso() }), t = stmtEmailText(M, co);
  const mailTo = invEmail(cust);
  if (!mailTo) return { to: '', err: 'This store has no email.' };
  return { to: mailTo, mail: { from: '"' + clean(co.name) + '" <' + (env('MAIL_FROM') || 'invoices@storeowl.app') + '>', replyTo: (co.email || '').trim() || undefined, to: mailTo,
    subject: t.subject, text: t.text, attachments: [{ filename: stmtName(M), content: Buffer.from(stmtPdf(M).bytes), contentType: 'application/pdf' }] } };
}
async function sendStatement(req, res, b, tok, url, key) {
  const st = b.statement || {};
  if (!b.company || !st.customer || !st.from || !st.to) return res.status(400).json({ error: 'Pick the store and the dates.' });
  const sb = createClient(url, key, { global: { headers: { Authorization: 'Bearer ' + tok } }, auth: { persistSession: false } });
  const rpc = async (n, a) => { const { data, error } = await sb.rpc(n, a); if (error) throw new Error(error.message); return data; };
  let cust, acct, co;
  try {
    cust = await rpc('customer_get', { p_company: b.company, p_id: st.customer });
    acct = await rpc('customer_account', { p_company: b.company, p_customer: st.customer, p_from: st.from, p_to: st.to });
    co = ((await rpc('my_companies', {})) || []).find((c) => c.id === b.company);
  } catch (e) { return res.status(403).json({ error: e.message }); }
  if (!co) return res.status(403).json({ error: 'Company not found.' });
  const t = mailer();
  if (!t) return res.status(503).json({ error: 'Emails aren’t set up yet (StoreOwl needs to add the email sender).' });
  const m = buildStatementMail(co, cust, acct, st.from, st.to);
  let ok = !m.err, err = m.err || '';
  if (ok) { try { await t.sendMail(m.mail); } catch (e) { ok = false; err = String(e.message || e).slice(0, 200); } }
  try { await rpc('statement_sent', { p_company: b.company, p_customer: st.customer, p: { to: m.to, from: st.from, upto: st.to, ok, err } }); } catch (e) { /* the email still went */ }
  return res.status(ok ? 200 : 400).json(ok ? { to: m.to } : { error: err });
}
