import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";

import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendOtpBypassEmail } from "./email.js";

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
  ],
});
