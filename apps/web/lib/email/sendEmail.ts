import "server-only";
import nodemailer from "nodemailer";
import { MissingEnvVarError } from "@/lib/supabase/env";

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.BREVO_SMTP_HOST;
  const port = process.env.BREVO_SMTP_PORT;
  const login = process.env.BREVO_SMTP_LOGIN;
  const password = process.env.BREVO_SMTP_PASSWORD;

  const missing = [
    !host && "BREVO_SMTP_HOST",
    !port && "BREVO_SMTP_PORT",
    !login && "BREVO_SMTP_LOGIN",
    !password && "BREVO_SMTP_PASSWORD",
  ].filter((v): v is string => Boolean(v));
  if (missing.length > 0) {
    throw new MissingEnvVarError(missing);
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: false, // 587 is STARTTLS, not implicit TLS — `secure: true` is for port 465 only.
    auth: { user: login, pass: password },
  });
  return cachedTransporter;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Best-effort transactional email via Brevo SMTP. Every operational notification this
 * app sends (reservation approved/cancelled, new tasks, password reset) already has an
 * in-app or auth-flow equivalent that must succeed independently of email delivery — a
 * caller must never let a failed send here fail the reservation/task/password action
 * itself. This function therefore never throws: it catches everything, logs it
 * server-side, and returns `{ success: false }` for the caller to optionally surface as
 * "the action worked, but the email may not have gone out."
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Fleet";
  if (!fromAddress) {
    console.error("sendEmail: EMAIL_FROM_ADDRESS is not set — skipping send.");
    return { success: false, error: "missing_from_address" };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { success: true };
  } catch (err) {
    console.error("sendEmail failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "unknown_error" };
  }
}
