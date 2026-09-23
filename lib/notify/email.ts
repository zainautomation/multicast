import nodemailer from "nodemailer";
import { Resend } from "resend";

export function emailConfigured() {
  return !!(process.env.EMAIL_RESEND_API_KEY || process.env.EMAIL_SMTP_HOST);
}

export async function sendEmail(to: string, subject: string, html: string, text: string) {
  const from = process.env.EMAIL_FROM || "Multicast <multicast@localhost>";
  if (process.env.EMAIL_RESEND_API_KEY) {
    const r = await new Resend(process.env.EMAIL_RESEND_API_KEY).emails.send({ from, to, subject, html, text });
    if (r.error) throw new Error(`Resend: ${r.error.message}`);
    return;
  }
  if (process.env.EMAIL_SMTP_HOST) {
    const t = nodemailer.createTransport({
      host: process.env.EMAIL_SMTP_HOST,
      port: Number(process.env.EMAIL_SMTP_PORT || 587),
      secure: Number(process.env.EMAIL_SMTP_PORT) === 465,
      auth: process.env.EMAIL_SMTP_USER ? { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS } : undefined,
    });
    await t.sendMail({ from, to, subject, html, text });
    return;
  }
  throw new Error("Email is not configured (set EMAIL_RESEND_API_KEY or EMAIL_SMTP_HOST)");
}

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function emailLayout(title: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#F4F1EA;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1B1A17">
<div style="max-width:640px;margin:0 auto;padding:28px 20px">
<div style="font-family:Georgia,serif;font-size:20px;font-weight:600;margin-bottom:16px">Multicast</div>
<div style="background:#FFFFFF;border:1px solid #E2DDD2;border-radius:16px;padding:24px">
<h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;margin:0 0 14px">${escHtml(title)}</h1>
${inner}
</div></div></body></html>`;
}

export const button = (href: string, label: string, primary = false) =>
  `<a href="${escHtml(href)}" style="display:inline-block;margin:6px 8px 0 0;padding:11px 18px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;${
    primary ? "background:#A8461F;color:#FFFFFF" : "background:#FFFFFF;color:#1B1A17;border:1px solid #D6D0C3"
  }">${escHtml(label)}</a>`;
