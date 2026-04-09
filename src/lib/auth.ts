import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber, admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";

import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendOtpBypassEmail } from "./email.js";

// Access control for admin plugin
const ac = createAccessControl({
  user: ["create", "list", "get", "update", "set-role", "ban", "delete", "set-password"],
  session: ["list", "revoke", "delete"],
} as const);

const adminRole = ac.newRole({
  user: ["create", "list", "get", "update", "set-role", "ban", "delete", "set-password"],
  session: ["list", "revoke", "delete"],
});

const userRole = ac.newRole({
  user: ["get", "update"],
  session: ["list", "revoke"],
});

// Dev OTP store: maps phoneNumber → last OTP code sent
export const devOtpStore = new Map<string, string>();

const isDevOrTest = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.authCredential,
      verification: schema.verification,
    },
  }),
  user: {
    additionalFields: {
      phoneNumber: {
        type: "string",
        required: false,
      },
      phoneNumberVerified: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const email = user.email;
      if (!email) return;

      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (RESEND_API_KEY) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "ZUKA <onboarding@resend.dev>",
            to: email,
            subject: "Reset your ZUKA password",
            html: `
              <div style="font-family: monospace; max-width: 400px; margin: 40px auto; text-align: center;">
                <h2 style="color: #7c3aed;">Reset Your Password</h2>
                <p>Click the button below to reset your password:</p>
                <a href="${url}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 20px 0;">
                  Reset Password
                </a>
                <p style="color: #999; font-size: 14px;">If you didn't request this, ignore this email.</p>
              </div>
            `,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`[RESET PASSWORD] Failed to send email: ${error}`);
          throw new Error(`Failed to send reset email: ${response.status}`);
        }
      } else {
        console.log(`\n${"=".repeat(50)}`);
        console.log(`  [RESET PASSWORD] To: ${email}`);
        console.log(`  URL: ${url}`);
        console.log(`${"=".repeat(50)}\n`);
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        // Store for dev OTP bypass
        devOtpStore.set(phone, code);

        if (process.env.OTP_BYPASS_EMAIL) {
          // Production testing mode — send all OTPs to bypass email
          await sendOtpBypassEmail({
            to: process.env.OTP_BYPASS_EMAIL,
            phoneNumber: phone,
            code,
          });
        } else if (process.env.NODE_ENV !== "production") {
          // Dev mode — console log only
          console.log(`[DEV OTP] To: ${phone} | Code: ${code}`);
        }
        // Production without bypass: SMS vendor integration goes here (TODO)
      },
      // In dev/test, accept "123456" as a valid OTP bypass
      ...(isDevOrTest
        ? {
            verifyOTP: async ({ phoneNumber: phone, code }) => {
              if (code === "123456") {
                console.log(`[DEV OTP] Bypass activated for ${phone}`);
                return true;
              }
              // Fall through to default verification via stored code
              const storedCode = devOtpStore.get(phone);
              return code === storedCode;
            },
          }
        : {}),
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@zuka.temp`,
        getTempName: (phone) => phone,
      },
    }),
    admin({
      ac,
      roles: { admin: adminRole, user: userRole },
      defaultRole: "user",
    }),
  ],
});
