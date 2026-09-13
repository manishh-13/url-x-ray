import { describe, expect, it } from "vitest";
import { basePathFromEnv, resolveBasePath } from "../../scripts/base-path.mjs";

describe("static hosting base path", () => {
  it("defaults to the project Pages subpath", () => {
    expect(basePathFromEnv({})).toBe("/url-x-ray");
  });
  it.each(["", "/"])("supports root-hosted pages for %s", (value) => {
    expect(resolveBasePath(value)).toBe("");
  });
  it.each(["/url-x-ray", "/project_2", "/a/b"])("accepts stable subpath %s", (value) => {
    expect(resolveBasePath(value)).toBe(value);
  });
  it.each(["url-x-ray", "//example.com", "/url-x-ray/", "/..", "/.", "/a/../b", "/a/./b", "/a//b", "/a\\b", "/a?secret", "/a#fragment", "/a b", "/a%2fb"])("rejects ambiguous path %s", (value) => {
    expect(() => resolveBasePath(value)).toThrow("PAGES_BASE_PATH");
  });
});
