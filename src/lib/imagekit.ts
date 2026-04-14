import { createHmac, randomUUID } from "node:crypto";

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 30;

export interface ImageKitUploadAuth {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
}

function getRequiredEnv(name: "IMAGEKIT_PUBLIC_KEY" | "IMAGEKIT_PRIVATE_KEY") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for ImageKit upload auth`);
  }
  return value;
}

export function getImageKitUploadAuth(): ImageKitUploadAuth {
  const publicKey = getRequiredEnv("IMAGEKIT_PUBLIC_KEY");
  const privateKey = getRequiredEnv("IMAGEKIT_PRIVATE_KEY");
  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + DEFAULT_TOKEN_TTL_SECONDS;
  const signature = createHmac("sha1", privateKey)
    .update(`${token}${expire}`)
    .digest("hex");

  return {
    token,
    expire,
    signature,
    publicKey,
  };
}
