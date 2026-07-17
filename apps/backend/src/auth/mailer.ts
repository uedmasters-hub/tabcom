import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM ?? "Tabcom <login@tabcom.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Sends the magic-link email, or — when RESEND_API_KEY isn't set —
 * logs the link to the server console instead. This isn't a testing
 * hack bolted on; it's the standard "dev mode" pattern most real
 * products ship with, so local development never requires a live
 * email account. Production simply requires setting RESEND_API_KEY.
 */
export async function sendMagicLinkEmail(
  email: string,
  verifyUrl: string
): Promise<void> {
  if (!resend) {
    console.log(
      `\n[tabcom:auth] DEV MODE — no RESEND_API_KEY set. Magic link for ${email}:\n  ${verifyUrl}\n`
    );
    return;
  }

  await resend.emails.send({
    from: MAIL_FROM,
    to: email,
    subject: "Verify your email — Tabcom",
    html: `
      <div style="background: #F1F5F9; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 24px; padding: 48px 32px; text-align: center;">
          <h1 style="margin: 0; color: #0F172A; font-size: 30px; letter-spacing: -0.02em;">
            Verify your email
          </h1>
          <p style="margin: 20px 0 0; color: #475569; font-size: 15px; line-height: 1.65;">
            Please verify your email address to complete your sign-in.
            This link expires in <strong>15 minutes</strong> and can only be
            used once.
          </p>
          <a href="${verifyUrl}"
             style="display: block; margin: 28px 0 0; padding: 16px 24px;
                    background: #0F172A; color: #ffffff; text-decoration: none;
                    border-radius: 14px; font-weight: 700; font-size: 17px;">
            Verify email
          </a>
          <p style="margin: 28px 0 0; color: #64748B; font-size: 13px; line-height: 1.6;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      </div>
    `,
  });
}
