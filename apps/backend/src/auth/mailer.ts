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
    subject: "Sign in to Tabcom",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color: #0F172A;">Sign in to Tabcom</h2>
        <p style="color: #475569; line-height: 1.6;">
          Click the button below to sign in. This link expires in 15 minutes
          and can only be used once.
        </p>
        <a href="${verifyUrl}"
           style="display: inline-block; margin-top: 16px; padding: 12px 24px;
                  background: #0F172A; color: #fff; text-decoration: none;
                  border-radius: 10px; font-weight: 600;">
          Sign in
        </a>
        <p style="margin-top: 24px; color: #94A3B8; font-size: 12px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
