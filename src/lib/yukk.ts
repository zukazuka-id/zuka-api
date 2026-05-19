/**
 * Yukk QRIS Payment Gateway — Provider Adapter
 *
 * Isolates all Yukk-specific concerns:
 * - Access token acquisition (SHA256withRSA) with caching
 * - API request signing (HMAC-SHA512)
 * - QRIS payment creation & query
 * - Webhook signature verification & normalization
 *
 * Modes:
 * - PAYMENT_PROVIDER_MODE=fake → returns deterministic mock responses
 * - Credentials missing (not fake) → throws clear error
 * - Credentials present → real network calls with signed requests
 */

import crypto from "node:crypto";
import { getCachedToken, setCachedToken, clearCachedToken } from "./yukk-token-cache.js";

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function isFakeMode(): boolean {
  return getEnv("PAYMENT_PROVIDER_MODE") === "fake";
}

interface YukkConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  storeId: string;
  privateKey: string;
  partnerClientId: string;
  partnerClientSecret: string;
  partnerChannelId: string;
}

function getConfig(): YukkConfig {
  return {
    baseUrl: getEnv("YUKK_BASE_URL") ?? "",
    clientId: getEnv("YUKK_CLIENT_ID") ?? "",
    clientSecret: getEnv("YUKK_CLIENT_SECRET") ?? "",
    storeId: getEnv("YUKK_STORE_ID") ?? "",
    privateKey: getEnv("YUKK_PRIVATE_KEY") ?? "",
    partnerClientId: getEnv("YUKK_PARTNER_CLIENT_ID") ?? "",
    partnerClientSecret: getEnv("YUKK_PARTNER_CLIENT_SECRET") ?? "",
    partnerChannelId: getEnv("YUKK_PARTNER_CHANNEL_ID") ?? "",
  };
}

function isConfigured(): boolean {
  const c = getConfig();
  return (
    !!c.baseUrl &&
    !!c.clientId &&
    !!c.clientSecret &&
    !!c.storeId &&
    !!c.privateKey
  );
}

function requireConfigured(): YukkConfig {
  if (!isConfigured()) {
    throw new Error(
      "Yukk integration is not configured. Set YUKK_BASE_URL, YUKK_CLIENT_ID, YUKK_CLIENT_SECRET, YUKK_STORE_ID, and YUKK_PRIVATE_KEY, or set PAYMENT_PROVIDER_MODE=fake for development."
    );
  }
  return getConfig();
}

// ---------------------------------------------------------------------------
// Normalized types
// ---------------------------------------------------------------------------

export interface YukkQrisPayment {
  partnerReferenceNo: string;
  referenceNo: string;
  qrContent: string;
  storeId: string;
  timeoutInSeconds: number;
  timeoutDateTime: string;
  responseCode: string;
  responseMessage: string;
}

export interface YukkPaymentStatus {
  originalPartnerReferenceNo: string;
  originalReferenceNo: string;
  serviceCode: string;
  latestTransactionStatus: string;
  transactionStatusDesc: string;
  paidTime: string | null;
  amount: { value: string; currency: string };
  responseCode: string;
  responseMessage: string;
}

export interface YukkWebhookEvent {
  orderId: string;
  providerReference: string;
  status: "paid" | "pending" | "unknown";
  amount: string;
  rrn: string;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Returns current timestamp in ISO-8601 Jakarta time (GMT+7) without ms.
 * Format: YYYY-MM-DDTHH:mm:ss+07:00
 */
export function generateTimestamp(): string {
  const now = new Date();
  // Convert to GMT+7
  const jakartaOffset = 7 * 60; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const jakartaDate = new Date(utcMs + jakartaOffset * 60_000);

  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  return (
    `${jakartaDate.getFullYear()}-${pad(jakartaDate.getMonth() + 1)}-${pad(jakartaDate.getDate())}` +
    `T${pad(jakartaDate.getHours())}:${pad(jakartaDate.getMinutes())}:${pad(jakartaDate.getSeconds())}+07:00`
  );
}

/**
 * Generates a unique numeric string for X-EXTERNAL-ID.
 * Format: timestamp (13 digits) + random 6 digits, unique per day.
 */
export function generateExternalId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return ts + rand;
}

// ---------------------------------------------------------------------------
// Signature: SHA256withRSA (for access token request)
// ---------------------------------------------------------------------------

/**
 * Generates an asymmetric SHA256withRSA signature.
 * stringToSign = client_ID + "|" + X-TIMESTAMP
 */
export function generateAccessTokenSignature(
  clientId: string,
  timestamp: string,
  privateKeyPem: string
): string {
  const stringToSign = `${clientId}|${timestamp}`;
  const signer = crypto.createSign("SHA256");
  signer.update(stringToSign);
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

// ---------------------------------------------------------------------------
// Signature: HMAC-SHA512 (for API calls + webhook verification)
// ---------------------------------------------------------------------------

/**
 * Generates a symmetric HMAC-SHA512 signature for API requests.
 *
 * stringToSign = HTTPMethod + ":" + EndpointUrl + ":" + AccessToken + ":"
 *                + Lowercase(HexEncode(SHA-256(minify(RequestBody)))) + ":"
 *                + TimeStamp
 */
export function generateApiSignature(args: {
  httpMethod: string;
  endpointUrl: string;
  accessToken: string;
  requestBody: string;
  timestamp: string;
  clientSecret: string;
}): string {
  const bodyHash = crypto
    .createHash("sha256")
    .update(args.requestBody)
    .digest("hex")
    .toLowerCase();

  const stringToSign = [
    args.httpMethod,
    args.endpointUrl,
    args.accessToken,
    bodyHash,
    args.timestamp,
  ].join(":");

  return crypto
    .createHmac("sha512", args.clientSecret)
    .update(stringToSign)
    .digest("base64");
}

// ---------------------------------------------------------------------------
// Access Token
// ---------------------------------------------------------------------------

export interface AccessTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  responseCode: string;
  responseMessage: string;
}

/**
 * Gets a valid Yukk access token, using the cache when possible.
 * POST /v1.0/access-token/b2b
 */
export async function getYukkAccessToken(): Promise<string> {
  // Check cache first
  const cached = getCachedToken();
  if (cached) return cached;

  if (isFakeMode()) {
    const fakeToken = "fake-yukk-access-token";
    setCachedToken(fakeToken, 900);
    return fakeToken;
  }

  const config = requireConfigured();
  const timestamp = generateTimestamp();
  const signature = generateAccessTokenSignature(
    config.clientId,
    timestamp,
    config.privateKey
  );

  const endpoint = "/v1.0/access-token/b2b";
  const url = `${config.baseUrl}${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ZUKA-API/1.0",
      "X-TIMESTAMP": timestamp,
      "X-CLIENT-KEY": config.clientId,
      "X-SIGNATURE": signature,
    },
    body: JSON.stringify({ grantType: "client_credentials" }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Yukk access token request failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as AccessTokenResponse;

  if (data.responseCode !== "2007300") {
    throw new Error(
      `Yukk access token error (${data.responseCode}): ${data.responseMessage}`
    );
  }

  setCachedToken(data.accessToken, data.expiresIn);
  return data.accessToken;
}

// ---------------------------------------------------------------------------
// QRIS Payment Creation
// ---------------------------------------------------------------------------

export interface CreateQrisPaymentArgs {
  partnerReferenceNo: string;
  amount: string; // e.g. "475000.00"
  additionalInfo?: Record<string, unknown>;
}

/**
 * POST /v1.0/qr/qr-mpm-generate
 */
export async function createYukkQrisPayment(
  args: CreateQrisPaymentArgs
): Promise<YukkQrisPayment> {
  if (isFakeMode()) {
    return {
      partnerReferenceNo: args.partnerReferenceNo,
      referenceNo: "fake-ref-" + Date.now(),
      qrContent: "fake-qr-content-for-testing",
      storeId: "fake-store-id",
      timeoutInSeconds: 1800,
      timeoutDateTime: new Date(Date.now() + 1_800_000).toISOString(),
      responseCode: "2004700",
      responseMessage: "Successful",
    };
  }

  const config = requireConfigured();
  const accessToken = await getYukkAccessToken();
  const timestamp = generateTimestamp();
  const externalId = generateExternalId();

  const requestBody = JSON.stringify({
    partnerReferenceNo: args.partnerReferenceNo,
    amount: { value: args.amount, currency: "IDR" },
    feeAmount: { value: "0.00", currency: "IDR" },
    storeId: config.storeId,
    additionalInfo: args.additionalInfo ?? {},
  });

  const endpoint = "/v1.0/qr/qr-mpm-generate";
  const signature = generateApiSignature({
    httpMethod: "POST",
    endpointUrl: endpoint,
    accessToken,
    requestBody,
    timestamp,
    clientSecret: config.clientSecret,
  });

  const url = `${config.baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ZUKA-API/1.0",
      Authorization: `Bearer ${accessToken}`,
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signature,
      "X-PARTNER-ID": config.clientId,
      "X-EXTERNAL-ID": externalId,
      "CHANNEL-ID": "00001",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Yukk QRIS creation failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as YukkQrisPayment;

  if (data.responseCode !== "2004700") {
    throw new Error(
      `Yukk QRIS error (${data.responseCode}): ${data.responseMessage}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Payment Query
// ---------------------------------------------------------------------------

export interface QueryPaymentArgs {
  originalPartnerReferenceNo: string;
}

/**
 * POST /v1.0/qr/qr-mpm-query
 */
export async function queryYukkPayment(
  args: QueryPaymentArgs
): Promise<YukkPaymentStatus> {
  if (isFakeMode()) {
    return {
      originalPartnerReferenceNo: args.originalPartnerReferenceNo,
      originalReferenceNo: "fake-ref-001",
      serviceCode: "47",
      latestTransactionStatus: "03",
      transactionStatusDesc: "Pending",
      paidTime: null,
      amount: { value: "0.00", currency: "IDR" },
      responseCode: "2005100",
      responseMessage: "Successful",
    };
  }

  const config = requireConfigured();
  const accessToken = await getYukkAccessToken();
  const timestamp = generateTimestamp();
  const externalId = generateExternalId();

  const requestBody = JSON.stringify({
    originalPartnerReferenceNo: args.originalPartnerReferenceNo,
    serviceCode: "47",
    externalStoreId: config.storeId,
  });

  const endpoint = "/v1.0/qr/qr-mpm-query";
  const signature = generateApiSignature({
    httpMethod: "POST",
    endpointUrl: endpoint,
    accessToken,
    requestBody,
    timestamp,
    clientSecret: config.clientSecret,
  });

  const url = `${config.baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ZUKA-API/1.0",
      Authorization: `Bearer ${accessToken}`,
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signature,
      "X-PARTNER-ID": config.clientId,
      "X-EXTERNAL-ID": externalId,
      "CHANNEL-ID": "00001",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Yukk payment query failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as YukkPaymentStatus;

  if (data.responseCode !== "2005100") {
    throw new Error(
      `Yukk payment query error (${data.responseCode}): ${data.responseMessage}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Webhook Signature Verification
// ---------------------------------------------------------------------------

export interface VerifyWebhookSignatureArgs {
  httpMethod: string;
  endpointUrl: string;
  accessToken: string;
  requestBody: string;
  timestamp: string;
  signature: string;
}

/**
 * Verifies a webhook signature from Yukk using PARTNER credentials.
 * Yukk sends webhooks signed with the partner client secret we gave them.
 *
 * Same HMAC-SHA512 formula as API signing, but uses partner credentials.
 */
export function verifyYukkWebhookSignature(
  args: VerifyWebhookSignatureArgs
): boolean {
  if (isFakeMode()) {
    return true;
  }

  const config = getConfig();

  if (!config.partnerClientSecret) {
    throw new Error(
      "Yukk integration is not configured. Set YUKK_PARTNER_CLIENT_SECRET, or set PAYMENT_PROVIDER_MODE=fake for development."
    );
  }

  const expected = generateApiSignature({
    httpMethod: args.httpMethod,
    endpointUrl: args.endpointUrl,
    accessToken: args.accessToken,
    requestBody: args.requestBody,
    timestamp: args.timestamp,
    clientSecret: config.partnerClientSecret,
  });

  return crypto.timingSafeEqual(
    Buffer.from(expected, "base64"),
    Buffer.from(args.signature, "base64")
  );
}

// ---------------------------------------------------------------------------
// Webhook Normalization
// ---------------------------------------------------------------------------

export interface YukkRawWebhookBody {
  originalPartnerReferenceNo?: string;
  originalReferenceNo?: string;
  latestTransactionStatus?: string;
  transactionStatusDesc?: string;
  amount?: { value?: string; currency?: string };
  externalStoreId?: string;
  additionalInfo?: { additionalField?: string; rrn?: string };
  responseCode?: string;
  responseMessage?: string;
}

/**
 * Normalizes a raw Yukk webhook body into our internal format.
 *
 * Mapping:
 * - originalPartnerReferenceNo → orderId
 * - originalReferenceNo → providerReference
 * - latestTransactionStatus → status ("00"=paid, "03"=pending)
 * - amount.value → amount
 * - additionalInfo.rrn → rrn
 */
export function normalizeYukkWebhook(
  body: YukkRawWebhookBody
): YukkWebhookEvent {
  const statusMap: Record<string, "paid" | "pending"> = {
    "00": "paid",
    "03": "pending",
  };

  const rawStatus = body.latestTransactionStatus ?? "";
  const status = statusMap[rawStatus] ?? "unknown";

  return {
    orderId: body.originalPartnerReferenceNo ?? "",
    providerReference: body.originalReferenceNo ?? "",
    status,
    amount: body.amount?.value ?? "0.00",
    rrn: body.additionalInfo?.rrn ?? "",
    raw: body as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for testing
// ---------------------------------------------------------------------------

export { clearCachedToken };
