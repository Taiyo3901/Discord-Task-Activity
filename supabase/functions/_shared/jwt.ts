import { SignJWT } from "npm:jose@5";

const DEFAULT_TTL_SECONDS = 60 * 60 * 6;

export async function mintSupabaseJwt(userId: string, secret: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const key = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}
