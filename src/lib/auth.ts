import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";

import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

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
    modelName: "account",
    additionalFields: {
      phoneNumber: {
        type: "string",
        required: false,
        input: false,
      },
      phoneNumberVerified: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  account: {
    modelName: "auth_credential",
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
      sendOTP: ({ phoneNumber: phone, code }) => {
        // TODO: integrate SMS provider (e.g., Twilio, Vonage)
        console.log(`[DEV OTP] To: ${phone} | Code: ${code}`);
      },
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@zuka.temp`,
        getTempName: (phone) => phone,
      },
    }),
  ],
});
