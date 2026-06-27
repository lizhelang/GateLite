import { describe, expect, it } from "vitest";
import { desiredDnsContent, evaluateRecordStatus, normalizeRecordName } from "../server/dns";
import type { ManagedDnsRecordConfig } from "../server/config";

const baseRecord: ManagedDnsRecordConfig = {
  zoneName: "zooe.cc",
  type: "A",
  name: "*.zooe.cc",
  content: "@ipv4",
  proxied: true,
  ttl: 1,
  comment: "Managed by GateLite"
};

describe("GateLite DNS management", () => {
  it("normalizes relative and apex record names inside the configured zone", () => {
    expect(normalizeRecordName("@", "zooe.cc")).toBe("zooe.cc");
    expect(normalizeRecordName("gl", "zooe.cc")).toBe("gl.zooe.cc");
    expect(normalizeRecordName("*.zooe.cc", "zooe.cc")).toBe("*.zooe.cc");
  });

  it("expands @ipv4 placeholders from the discovered public address", () => {
    expect(desiredDnsContent(baseRecord, "117.8.140.70")).toBe("117.8.140.70");
    expect(desiredDnsContent({ content: "1804.surfacer.cc" }, "117.8.140.70")).toBe("1804.surfacer.cc");
  });

  it("marks matching records as ok", () => {
    const status = evaluateRecordStatus({
      desired: baseRecord,
      currentIpv4: "117.8.140.70",
      existingRecords: [
        {
          id: "record-1",
          type: "A",
          name: "*.zooe.cc",
          content: "117.8.140.70",
          proxied: true,
          ttl: 1,
          comment: "Managed by GateLite"
        }
      ]
    });

    expect(status.status).toBe("ok");
    expect(status.action).toBe("none");
  });

  it("plans an update when a managed A record points at the old IP", () => {
    const status = evaluateRecordStatus({
      desired: baseRecord,
      currentIpv4: "117.8.140.70",
      existingRecords: [
        {
          id: "record-1",
          type: "A",
          name: "*.zooe.cc",
          content: "10.0.0.1",
          proxied: true,
          ttl: 1
        }
      ]
    });

    expect(status.status).toBe("needs-update");
    expect(status.action).toBe("update");
    expect(status.desiredContent).toBe("117.8.140.70");
  });

  it("creates missing CNAME delegation records without trying to turn them into A records", () => {
    const status = evaluateRecordStatus({
      desired: {
        zoneName: "surfacer.cc",
        type: "CNAME",
        name: "*.1804.surfacer.cc",
        content: "1804.surfacer.cc",
        proxied: false,
        ttl: 1
      },
      existingRecords: [],
      currentIpv4: "117.8.140.70"
    });

    expect(status.status).toBe("missing");
    expect(status.action).toBe("create");
    expect(status.desiredContent).toBe("1804.surfacer.cc");
  });

  it("blocks A record management when a CNAME already owns that name", () => {
    const status = evaluateRecordStatus({
      desired: {
        zoneName: "surfacer.cc",
        type: "A",
        name: "*.1804.surfacer.cc",
        content: "@ipv4"
      },
      currentIpv4: "117.8.140.70",
      existingRecords: [
        {
          id: "record-1",
          type: "CNAME",
          name: "*.1804.surfacer.cc",
          content: "1804.surfacer.cc"
        }
      ]
    });

    expect(status.status).toBe("conflict");
    expect(status.action).toBe("blocked");
  });
});
