import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { accountToken, accountUrlFromToken } from "./contact";

const url = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;

describe("account keys", () => {
  it("round-trips a key back to its account", () => {
    expect(accountUrlFromToken(accountToken(url, "chee / ok"))).toBe(url);
  });
  it("takes a bare automerge url, and ignores space around it", () => {
    expect(accountUrlFromToken(`  ${url}\n`)).toBe(url);
  });
  it("takes a key with no name", () => {
    expect(accountUrlFromToken(accountToken(url, ""))).toBe(url);
  });
  it("refuses things that aren't keys", () => {
    expect(accountUrlFromToken("")).toBeUndefined();
    expect(accountUrlFromToken("hello")).toBeUndefined();
    expect(accountUrlFromToken("account:chee/not-a-doc-id")).toBeUndefined();
  });
});
