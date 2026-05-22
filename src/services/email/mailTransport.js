import nodemailer from "nodemailer";

/**
 * Shared SMTP transport for transactional mail (order receipts, daily reports).
 * @returns {import("nodemailer").Transporter | null}
 */
export function buildMailTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: pass ? { user, pass } : { user },
  });
}

export function mailFromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@ksastore.local";
}

export function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
