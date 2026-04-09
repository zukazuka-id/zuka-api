/**
 * OTP email delivery service.
 *
 * 3-tier system:
 * 1. OTP_BYPASS_EMAIL set → send all OTPs to this email (production testing)
 * 2. Production without bypass → integrate SMS vendor (TODO)
 * 3. Dev/test → console log only
 */

interface OtpEmailPayload {
  to: string;
  phoneNumber: string;
  code: string;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;

export async function sendOtpBypassEmail({ to, phoneNumber, code }: OtpEmailPayload): Promise<void> {
  if (RESEND_API_KEY) {
    await sendViaResend(to, phoneNumber, code);
  } else {
    // Fallback: log prominently for testing
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  [OTP BYPASS EMAIL] To: ${to}`);
    console.log(`  Phone: ${phoneNumber}`);
    console.log(`  Code: ${code}`);
    console.log(`${"=".repeat(50)}\n`);
    console.warn("[WARN] No RESEND_API_KEY set — OTP email logged to console instead of sent.");
  }
}

async function sendViaResend(to: string, phoneNumber: string, code: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "ZUKA <onboarding@resend.dev>",
      to,
      subject: "[ZUKA TEST OTP]",
      html: `
        <div style="font-family: monospace; max-width: 400px; margin: 40px auto; text-align: center;">
          <h2 style="color: #7c3aed;">ZUKA Test OTP</h2>
          <p style="color: #666;">Phone: ${phoneNumber}</p>
          <div style="background: #f3f0ff; border: 3px solid #7c3aed; border-radius: 12px; padding: 24px; margin: 20px 0;">
            <span style="font-size: 48px; font-weight: bold; letter-spacing: 12px; color: #7c3aed;">${code}</span>
          </div>
          <p style="color: #999; font-size: 14px;">This code expires in 5 minutes.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[OTP EMAIL] Failed to send via Resend: ${error}`);
    throw new Error(`Failed to send OTP email: ${response.status}`);
  }
}
