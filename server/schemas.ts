import { z } from "zod";

export const webServiceInputSchema = z
  .object({
    name: z.string().trim().default(""),
    enabled: z.boolean().default(true),
    matchMode: z.enum(["host", "default"]).default("host"),
    groupId: z.string().trim().default("local"),
    domains: z.array(z.string().trim()).default([]),
    listenPort: z.coerce.number().int().min(1).max(65535).default(18080),
    entryPoints: z.array(z.string().trim().min(1)).min(1).default(["web"]),
    targetUrl: z.string().trim().url(),
    middlewares: z.array(z.string().trim()).default([]),
    priority: z.coerce.number().int().optional(),
    tls: z
      .object({
        mode: z.enum(["none", "file-certificate", "resolver"]).default("none"),
        certificateId: z.string().optional(),
        resolver: z.string().optional()
      })
      .default({ mode: "none" }),
    notes: z.string().optional()
  })
  .superRefine((service, context) => {
    if (service.matchMode !== "default" && !service.domains.some((domain) => domain.trim())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one frontend domain is required for host rules.",
        path: ["domains"]
      });
    }
  });

export const certificateInputSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  source: z.enum(["self-signed", "upload", "path", "acme", "sync"]),
  domains: z.array(z.string().trim()).default([]),
  certPem: z.string().optional(),
  keyPem: z.string().optional(),
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
  days: z.coerce.number().int().min(1).max(3980).default(365),
  acme: z
    .object({
      email: z.string().optional(),
      caServer: z.string().optional(),
      dnsProvider: z.string().optional(),
      resolver: z.string().optional()
    })
    .optional(),
  sync: z
    .object({
      target: z.string().optional(),
      lastSyncTime: z.string().optional()
    })
    .optional()
});

export const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1)
});

export const groupInputSchema = z.object({
  name: z.string().trim().min(1),
  collapsed: z.boolean().default(false)
});
