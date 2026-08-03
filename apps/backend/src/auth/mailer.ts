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
function emailShell(title: string, bodyHtml: string, cta?: { href: string; label: string }): string {
  return `
    <div style="background: #F1F5F9; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 24px; padding: 48px 32px; text-align: center;">
        <h1 style="margin: 0; color: #0F172A; font-size: 30px; letter-spacing: -0.02em;">
          ${title}
        </h1>
        <div style="margin: 20px 0 0; color: #475569; font-size: 15px; line-height: 1.65; text-align: left;">
          ${bodyHtml}
        </div>
        ${
          cta
            ? `<a href="${cta.href}"
                 style="display: block; margin: 28px 0 0; padding: 16px 24px;
                        background: #0F172A; color: #ffffff; text-decoration: none;
                        border-radius: 14px; font-weight: 700; font-size: 17px;">
                ${cta.label}
              </a>`
            : ""
        }
        <p style="margin: 28px 0 0; color: #64748B; font-size: 13px; line-height: 1.6;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;
}

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
    subject: "Your Tabcom sign-in link",
    html: emailShell(
      "Sign in to Tabcom",
      `<p style="margin:0;">Use the button below to finish signing in. This link expires in <strong>15 minutes</strong> and can only be used once.</p>`,
      { href: verifyUrl, label: "Sign in" }
    ),
  });
}

/** Confirmation after an unregistered email is added to the invite waitlist. */
export async function sendInviteRequestConfirmationEmail(email: string): Promise<void> {
  const body = `
    <p style="margin:0 0 12px;">Thank you for your interest in Tabcom. We've received your request for early access.</p>
    <p style="margin:0 0 12px;">We'll be rolling out invite keys soon, so keep an eye on your inbox.</p>
    <p style="margin:0;">In the meantime, you can continue using Tabcom as a Guest.</p>
  `;

  if (!resend) {
    console.log(
      `\n[tabcom:auth] DEV MODE — invite-request confirmation for ${email}:\n` +
        `  Thank you for your interest in Tabcom. We've received your request for early access.\n`
    );
    return;
  }

  await resend.emails.send({
    from: MAIL_FROM,
    to: email,
    subject: "We've received your Tabcom invite request",
    html: emailShell("Request received", body),
  });
}
