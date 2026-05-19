/**
 * Unit tests for Yukk QRIS provider adapter.
 *
 * All network calls are mocked. No real Yukk credentials needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  generateTimestamp,
  generateExternalId,
  generateAccessTokenSignature,
  generateApiSignature,
  getYukkAccessToken,
  createYukkQrisPayment,
  queryYukkPayment,
  verifyYukkWebhookSignature,
  normalizeYukkWebhook,
  clearCachedToken,
  type YukkRawWebhookBody,
} from "../../lib/yukk";
import {
  getCachedToken,
  setCachedToken,
} from "../../lib/yukk-token-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a fresh RSA key pair for signing tests */
function generateRsaKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

// ---------------------------------------------------------------------------
// Token Cache
// ---------------------------------------------------------------------------

describe("yukk-token-cache", () => {
  beforeEach(() => {
    clearCachedToken();
  });

  it("returns null when no token cached", () => {
    expect(getCachedToken()).toBeNull();
  });

  it("stores and retrieves a token", () => {
    setCachedToken("tok_abc", 900);
    expect(getCachedToken()).toBe("tok_abc");
  });

  it("returns null when token has expired (with safety margin)", () => {
    // Set a token that expired 61 seconds ago
    setCachedToken("tok_old", 1);
    expect(getCachedToken()).toBeNull();
  });

  it("clears a cached token", () => {
    setCachedToken("tok_xyz", 900);
    clearCachedToken();
    expect(getCachedToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateTimestamp
// ---------------------------------------------------------------------------

describe("generateTimestamp", () => {
  it("returns a string in +07:00 format without milliseconds", () => {
    const ts = generateTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });
});

// ---------------------------------------------------------------------------
// generateExternalId
// ---------------------------------------------------------------------------

describe("generateExternalId", () => {
  it("returns a numeric string", () => {
    const id = generateExternalId();
    expect(id).toMatch(/^\d+$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateExternalId()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// generateAccessTokenSignature (SHA256withRSA)
// ---------------------------------------------------------------------------

describe("generateAccessTokenSignature", () => {
  it("produces a base64 string verifiable with the public key", () => {
    const keys = generateRsaKeyPair();
    const clientId = "test-client-id";
    const timestamp = "2025-06-26T15:25:31+07:00";

    const signature = generateAccessTokenSignature(
      clientId,
      timestamp,
      keys.privatePem
    );

    // Verify with public key
    const stringToSign = `${clientId}|${timestamp}`;
    const verifier = crypto.createVerify("SHA256");
    verifier.update(stringToSign);
    verifier.end();
    expect(verifier.verify(keys.publicPem, signature, "base64")).toBe(true);
  });

  it("fails verification with wrong data", () => {
    const keys = generateRsaKeyPair();
    const signature = generateAccessTokenSignature(
      "client-a",
      "2025-01-01T00:00:00+07:00",
      keys.privatePem
    );

    const verifier = crypto.createVerify("SHA256");
    verifier.update("wrong-data");
    verifier.end();
    expect(verifier.verify(keys.publicPem, signature, "base64")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateApiSignature (HMAC-SHA512)
// ---------------------------------------------------------------------------

describe("generateApiSignature", () => {
  it("produces a deterministic base64 signature", () => {
    const args = {
      httpMethod: "POST",
      endpointUrl: "/v1.0/qr/qr-mpm-generate",
      accessToken: "test-token",
      requestBody: '{"hello":"world"}',
      timestamp: "2021-11-29T09:22:18.172+07:00",
      clientSecret: "test-secret",
    };

    const sig1 = generateApiSignature(args);
    const sig2 = generateApiSignature(args);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
  });

  it("produces different signatures for different bodies", () => {
    const base = {
      httpMethod: "POST",
      endpointUrl: "/v1.0/qr/qr-mpm-generate",
      accessToken: "tok",
      timestamp: "2025-01-01T00:00:00+07:00",
      clientSecret: "secret",
    };

    const sig1 = generateApiSignature({ ...base, requestBody: '{"a":1}' });
    const sig2 = generateApiSignature({ ...base, requestBody: '{"a":2}' });
    expect(sig1).not.toBe(sig2);
  });

  it("computes correct body hash as lowercase hex SHA-256 of minified body", () => {
    const secret = "my-secret";
    const body = '{"hello":"world"}';
    const expectedHash = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex")
      .toLowerCase();

    const expectedStringToSign = `POST:/v1.0/test:token:${expectedHash}:2025-01-01T00:00:00+07:00`;
    const expectedSig = crypto
      .createHmac("sha512", secret)
      .update(expectedStringToSign)
      .digest("base64");

    const actualSig = generateApiSignature({
      httpMethod: "POST",
      endpointUrl: "/v1.0/test",
      accessToken: "token",
      requestBody: body,
      timestamp: "2025-01-01T00:00:00+07:00",
      clientSecret: secret,
    });

    expect(actualSig).toBe(expectedSig);
  });
});

// ---------------------------------------------------------------------------
// getYukkAccessToken
// ---------------------------------------------------------------------------

describe("getYukkAccessToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearCachedToken();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns a fake token in fake mode", async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    const token = await getYukkAccessToken();
    expect(token).toBe("fake-yukk-access-token");
  });

  it("caches the fake token", async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    const t1 = await getYukkAccessToken();
    const t2 = await getYukkAccessToken();
    expect(t1).toBe(t2);
  });

  it("throws clear error when credentials are missing and not in fake mode", async () => {
    // Ensure no Yukk env vars
    delete process.env.YUKK_BASE_URL;
    delete process.env.YUKK_CLIENT_ID;
    delete process.env.YUKK_CLIENT_SECRET;
    delete process.env.YUKK_STORE_ID;
    delete process.env.YUKK_PRIVATE_KEY;
    delete process.env.PAYMENT_PROVIDER_MODE;

    await expect(getYukkAccessToken()).rejects.toThrow(
      "Yukk integration is not configured"
    );
  });

  it("makes a signed network request when credentials are present", async () => {
    const keys = generateRsaKeyPair();
    process.env.YUKK_BASE_URL = "https://yukk.test";
    process.env.YUKK_CLIENT_ID = "client-123";
    process.env.YUKK_CLIENT_SECRET = "secret-abc";
    process.env.YUKK_STORE_ID = "store-1";
    process.env.YUKK_PRIVATE_KEY = keys.privatePem;

    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "real-token-xyz",
        tokenType: "Bearer",
        expiresIn: 900,
        responseCode: "2007300",
        responseMessage: "Successful",
      }),
      text: async () => "",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    const token = await getYukkAccessToken();
    expect(token).toBe("real-token-xyz");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify the request was made to the correct URL
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://yukk.test/v1.0/access-token/b2b");

    // Second call should use cache
    const token2 = await getYukkAccessToken();
    expect(token2).toBe("real-token-xyz");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // No additional call
  });

  it("throws on non-2007300 response code", async () => {
    const keys = generateRsaKeyPair();
    process.env.YUKK_BASE_URL = "https://yukk.test";
    process.env.YUKK_CLIENT_ID = "client-123";
    process.env.YUKK_CLIENT_SECRET = "secret-abc";
    process.env.YUKK_STORE_ID = "store-1";
    process.env.YUKK_PRIVATE_KEY = keys.privatePem;

    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "",
        tokenType: "",
        expiresIn: 0,
        responseCode: "4017300",
        responseMessage: "Unauthorized",
      }),
      text: async () => "",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    await expect(getYukkAccessToken()).rejects.toThrow("4017300");
  });
});

// ---------------------------------------------------------------------------
// createYukkQrisPayment
// ---------------------------------------------------------------------------

describe("createYukkQrisPayment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearCachedToken();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns a fake response in fake mode", async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    const result = await createYukkQrisPayment({
      partnerReferenceNo: "ref-001",
      amount: "475000.00",
    });

    expect(result.responseCode).toBe("2004700");
    expect(result.partnerReferenceNo).toBe("ref-001");
    expect(result.qrContent).toBe("fake-qr-content-for-testing");
  });

  it("throws clear error when not configured", async () => {
    delete process.env.YUKK_BASE_URL;
    delete process.env.PAYMENT_PROVIDER_MODE;

    await expect(
      createYukkQrisPayment({
        partnerReferenceNo: "ref-001",
        amount: "100000.00",
      })
    ).rejects.toThrow("Yukk integration is not configured");
  });

  it("makes a signed request with correct headers when configured", async () => {
    const keys = generateRsaKeyPair();
    process.env.YUKK_BASE_URL = "https://yukk.test";
    process.env.YUKK_CLIENT_ID = "client-123";
    process.env.YUKK_CLIENT_SECRET = "secret-abc";
    process.env.YUKK_STORE_ID = "store-1";
    process.env.YUKK_PRIVATE_KEY = keys.privatePem;

    // Mock the access token fetch
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("access-token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "tok-qr",
            tokenType: "Bearer",
            expiresIn: 900,
            responseCode: "2007300",
            responseMessage: "Successful",
          }),
          text: async () => "",
        } as Response;
      }

      if (urlStr.includes("qr-mpm-generate")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            partnerReferenceNo: "ref-001",
            referenceNo: "yukk-ref-001",
            qrContent: "000201010212...",
            storeId: "store-1",
            additionalInfo: {},
            timeoutInSeconds: 1800,
            timeoutDateTime: "2025-06-26T17:10:14+07:00",
            responseCode: "2004700",
            responseMessage: "Successful",
          }),
          text: async () => "",
        } as Response;
      }

      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    });

    const result = await createYukkQrisPayment({
      partnerReferenceNo: "ref-001",
      amount: "100000.00",
    });

    expect(result.referenceNo).toBe("yukk-ref-001");
    expect(result.qrContent).toContain("00020101");

    // Verify the generate call had correct headers
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const generateCall = calls.find(
      (c) => (c[0] as string).includes("qr-mpm-generate")
    );
    expect(generateCall).toBeDefined();
    const headers = (generateCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-qr");
    expect(headers["X-PARTNER-ID"]).toBe("client-123");
    expect(headers["CHANNEL-ID"]).toBe("00001");
    expect(headers["X-SIGNATURE"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// queryYukkPayment
// ---------------------------------------------------------------------------

describe("queryYukkPayment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearCachedToken();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns a fake response in fake mode", async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    const result = await queryYukkPayment({
      originalPartnerReferenceNo: "ref-001",
    });

    expect(result.responseCode).toBe("2005100");
    expect(result.latestTransactionStatus).toBe("03");
  });

  it("throws clear error when not configured", async () => {
    delete process.env.YUKK_BASE_URL;
    delete process.env.PAYMENT_PROVIDER_MODE;

    await expect(
      queryYukkPayment({ originalPartnerReferenceNo: "ref-001" })
    ).rejects.toThrow("Yukk integration is not configured");
  });
});

// ---------------------------------------------------------------------------
// verifyYukkWebhookSignature
// ---------------------------------------------------------------------------

describe("verifyYukkWebhookSignature", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns true in fake mode", () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    const result = verifyYukkWebhookSignature({
      httpMethod: "POST",
      endpointUrl: "/v1.0/qr/qr-mpm-notify",
      accessToken: "any",
      requestBody: "{}",
      timestamp: "2025-01-01T00:00:00+07:00",
      signature: "anything",
    });
    expect(result).toBe(true);
  });

  it("throws when partner client secret is missing", () => {
    delete process.env.YUKK_PARTNER_CLIENT_SECRET;
    delete process.env.PAYMENT_PROVIDER_MODE;

    expect(() =>
      verifyYukkWebhookSignature({
        httpMethod: "POST",
        endpointUrl: "/v1.0/qr/qr-mpm-notify",
        accessToken: "tok",
        requestBody: "{}",
        timestamp: "2025-01-01T00:00:00+07:00",
        signature: "sig",
      })
    ).toThrow("Yukk integration is not configured");
  });

  it("returns true for a valid signature", () => {
    const partnerSecret = "partner-secret-abc";
    process.env.YUKK_PARTNER_CLIENT_SECRET = partnerSecret;

    const args = {
      httpMethod: "POST",
      endpointUrl: "/v1.0/qr/qr-mpm-notify",
      accessToken: "notify-token",
      requestBody: '{"originalPartnerReferenceNo":"ref-001"}',
      timestamp: "2025-06-26T15:00:00+07:00",
    };

    // Generate the expected signature
    const validSig = generateApiSignature({
      ...args,
      clientSecret: partnerSecret,
    });

    const result = verifyYukkWebhookSignature({ ...args, signature: validSig });
    expect(result).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const partnerSecret = "partner-secret-abc";
    process.env.YUKK_PARTNER_CLIENT_SECRET = partnerSecret;

    const args = {
      httpMethod: "POST",
      endpointUrl: "/v1.0/qr/qr-mpm-notify",
      accessToken: "token",
      requestBody: "{}",
      timestamp: "2025-01-01T00:00:00+07:00",
    };

    // Compute a valid signature for different data, then tamper with it
    const validSig = generateApiSignature({
      ...args,
      clientSecret: partnerSecret,
    });

    // Flip a byte in the valid signature to make it invalid but same length
    const sigBytes = Buffer.from(validSig, "base64");
    const tamperedBytes = Buffer.from(sigBytes);
    tamperedBytes[0] ^= 0xff; // flip first byte
    const tamperedSig = tamperedBytes.toString("base64");

    const result = verifyYukkWebhookSignature({
      ...args,
      signature: tamperedSig,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeYukkWebhook
// ---------------------------------------------------------------------------

describe("normalizeYukkWebhook", () => {
  it("maps a paid webhook correctly", () => {
    const body: YukkRawWebhookBody = {
      originalPartnerReferenceNo: "order-001",
      originalReferenceNo: "yukk-ref-001",
      latestTransactionStatus: "00",
      transactionStatusDesc: "Success",
      amount: { value: "475000.00", currency: "IDR" },
      externalStoreId: "store-1",
      additionalInfo: {
        additionalField: undefined,
        rrn: "210430233071",
      },
    };

    const event = normalizeYukkWebhook(body);

    expect(event.orderId).toBe("order-001");
    expect(event.providerReference).toBe("yukk-ref-001");
    expect(event.status).toBe("paid");
    expect(event.amount).toBe("475000.00");
    expect(event.rrn).toBe("210430233071");
    expect(event.raw).toEqual(body);
  });

  it("maps a pending webhook correctly", () => {
    const body: YukkRawWebhookBody = {
      originalPartnerReferenceNo: "order-002",
      originalReferenceNo: "yukk-ref-002",
      latestTransactionStatus: "03",
      transactionStatusDesc: "Pending",
      amount: { value: "100000.00", currency: "IDR" },
      additionalInfo: { rrn: "" },
    };

    const event = normalizeYukkWebhook(body);
    expect(event.status).toBe("pending");
    expect(event.amount).toBe("100000.00");
  });

  it("handles unknown status gracefully", () => {
    const body: YukkRawWebhookBody = {
      originalPartnerReferenceNo: "order-003",
      latestTransactionStatus: "99",
    };

    const event = normalizeYukkWebhook(body);
    expect(event.status).toBe("unknown");
  });

  it("handles missing fields gracefully", () => {
    const event = normalizeYukkWebhook({});
    expect(event.orderId).toBe("");
    expect(event.providerReference).toBe("");
    expect(event.status).toBe("unknown");
    expect(event.amount).toBe("0.00");
    expect(event.rrn).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Secrets are never logged or returned
// ---------------------------------------------------------------------------

describe("secrets safety", () => {
  it("normalized webhook event does not leak secrets", () => {
    const body: YukkRawWebhookBody = {
      originalPartnerReferenceNo: "order-001",
      additionalInfo: { rrn: "123" },
    };

    const event = normalizeYukkWebhook(body);
    const serialized = JSON.stringify(event);

    // Should not contain any key that looks like a secret
    expect(serialized).not.toContain("clientSecret");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("YUKK_");
  });
});
