import { isIP } from "node:net";
import { z } from "zod";

export const resetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("monthly"),
    day: z.number().int().min(1).max(31),
    hour: z.number().int().min(0).max(23).default(0),
  }),
  z.object({
    kind: z.literal("interval"),
    days: z.number().int().min(1).max(3650),
    anchor: z.iso.datetime({ offset: true }),
  }),
]);
export const quotaSchema = z.object({
  limit: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(null),
  direction: z.enum(["out", "in", "both"]).default("both"),
  reset: resetSchema.default({ kind: "monthly", day: 1, hour: 0 }),
});
const reservedNodeNames = new Set([
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "PASS",
  "COMPATIBLE",
]);
export const hostSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .transform((v) =>
      v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v,
    )
    .refine(
      (v) =>
        v.length >= 1 &&
        v.length <= 253 &&
        (isIP(v) !== 0 || (/^[a-zA-Z0-9.-]+$/.test(v) && !v.startsWith("-"))),
      "Invalid IP address or hostname",
    ),
  port: z.number().int().min(1).max(65535).default(22),
  username: z
    .string()
    .regex(/^[a-z_][a-z0-9_-]*[$]?$/i)
    .default("root"),
  authType: z.enum(["password", "key"]).default("key"),
  credential: z.string().max(32768).default(""),
  passphrase: z.string().max(1000).default(""),
  quota: quotaSchema.default({
    limit: null,
    direction: "both",
    reset: { kind: "monthly", day: 1, hour: 0 },
  }),
  initialIn: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  initialOut: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  enabled: z.boolean().default(true),
});
export const nodeSchema = z.object({
  hostId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(
      (v) => !reservedNodeNames.has(v.toUpperCase()),
      "Node name cannot use a reserved mihomo proxy name",
    ),
  address: z
    .string()
    .refine(
      (v) => isIP(v) !== 0,
      "A public-facing IPv4 or IPv6 address is required",
    ),
  port: z.number().int().min(1).max(65535).default(443),
  hopping: z
    .string()
    .regex(/^$|^\d{1,5}-\d{1,5}$/)
    .default("")
    .refine(
      (v) =>
        !v ||
        (() => {
          const [a, b] = v.split("-").map(Number);
          return a > 0 && b <= 65535 && a < b;
        })(),
      "Invalid port range",
    ),
  hopInterval: z.number().int().min(5).max(3600).default(30),
  enabled: z.boolean().default(true),
});
import {
  DEFAULT_ECH_PUBLIC_NAME,
  DEFAULT_HYSTERIA_VERSION,
  DEFAULT_TLS_SNI,
  MIN_BBR_VERSION,
  MIN_ECH_VERSION,
  MIN_PINNED_TLS_VERSION,
  compareHysteriaVersion,
  isValidDnsName,
  type TlsSecurityMode,
} from "./tls";

export {
  DEFAULT_ECH_PUBLIC_NAME,
  DEFAULT_HYSTERIA_VERSION,
  DEFAULT_TLS_SNI,
  MIN_BBR_VERSION,
  MIN_ECH_VERSION,
  MIN_PINNED_TLS_VERSION,
  compareHysteriaVersion,
  isValidDnsName,
  type TlsSecurityMode,
};

export const tlsSecuritySchema = z.enum(["legacy", "pinned"]);

const optionalDnsNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .default("")
  .refine((v) => !v || isValidDnsName(v), "Enter a valid domain name");

const deploymentOptionsShape = {
  protocol: z.literal("hysteria2"),
  tuning: z.boolean(),
  congestion: z.enum(["brutal", "bbr"]),
  tlsSecurity: tlsSecuritySchema.default("legacy"),
  sni: optionalDnsNameSchema,
  ech: z.boolean().default(false),
  echPublicName: optionalDnsNameSchema,
};

function normalizeDeploymentOptions<
  T extends {
    tlsSecurity: TlsSecurityMode;
    sni: string;
    ech: boolean;
    echPublicName: string;
  },
>(value: T): T {
  const pinned = value.tlsSecurity === "pinned";
  return {
    ...value,
    sni: pinned ? value.sni || DEFAULT_TLS_SNI : "",
    echPublicName: value.ech ? value.echPublicName || DEFAULT_ECH_PUBLIC_NAME : "",
  };
}

export const deploymentOptionsSchema = z
  .object(deploymentOptionsShape)
  .refine(
    (v) => !v.ech || v.tlsSecurity === "pinned",
    "ECH requires forced SNI and pinSHA256 TLS security",
  )
  .transform(normalizeDeploymentOptions);
export const deploymentVersionSchema = z.string().regex(/^v2\.\d+\.\d+$/);
export const deploymentRequestSchema = z
  .object({
    ...deploymentOptionsShape,
    version: deploymentVersionSchema,
  })
  .refine(
    (v) => !v.ech || v.tlsSecurity === "pinned",
    "ECH requires forced SNI and pinSHA256 TLS security",
  )
  .transform(normalizeDeploymentOptions);
export type DeploymentOptions = z.infer<typeof deploymentOptionsSchema>;
export type DeploymentOptionsInput = z.input<typeof deploymentOptionsSchema>;
export const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Use letters, numbers, dots, underscores, or hyphens",
  );

export const templateFormatSchema = z.enum(["mihomo", "sing-box"]);
export type TemplateFormat = z.infer<typeof templateFormatSchema>;

export const userSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    username: usernameSchema.transform((name) => name.toLowerCase()),
    note: z.string().max(2000).default(""),
    enabled: z.boolean().default(true),
    expires: z.iso.datetime({ offset: true }).nullable().default(null),
    quota: quotaSchema.default({
      limit: null,
      direction: "both",
      reset: { kind: "monthly", day: 1, hour: 0 },
    }),
    nodeIds: z.array(z.uuid()).max(1000).default([]),
    templateIds: z.array(z.uuid()).min(1).max(100),
    defaultTemplates: z.record(templateFormatSchema, z.uuid()),
  })
  .refine(
    (v) =>
      Object.values(v.defaultTemplates).every((id) =>
        v.templateIds.includes(id),
      ),
    "Default template must be available to this user",
  );
export type Quota = z.infer<typeof quotaSchema>;
export type Reset = z.infer<typeof resetSchema>;
export type HostInput = z.infer<typeof hostSchema>;
export type NodeInput = z.infer<typeof nodeSchema>;
export type UserInput = z.infer<typeof userSchema>;
