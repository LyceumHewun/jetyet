import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function same(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
export function vault(key: string) {
  const bytes = Buffer.from(key, "hex");
  return {
    seal(value: string) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", bytes, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      );
    },
    open(value: string) {
      const b = Buffer.from(value, "base64"),
        decipher = createDecipheriv("aes-256-gcm", bytes, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([
        decipher.update(b.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
