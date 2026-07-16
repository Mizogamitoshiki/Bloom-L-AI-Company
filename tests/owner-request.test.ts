import { describe, expect, it } from "vitest";
import { assertOwnerRequest, OWNER_ACTION_HEADER, OWNER_ACTION_VALUE } from "../apps/dashboard/lib/owner-request";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/test", { method: "POST", headers });
}

describe("owner UI request guard", () => {
  it("同一Originかつ確認ヘッダー付きだけを許可する", () => {
    expect(() => assertOwnerRequest(request({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "sec-fetch-site": "same-origin",
      [OWNER_ACTION_HEADER]: OWNER_ACTION_VALUE,
    }))).not.toThrow();
  });

  it("確認ヘッダーなし・別Origin・cross-siteを拒否する", () => {
    expect(() => assertOwnerRequest(request({ origin: "http://localhost:3000", host: "localhost:3000" }))).toThrow(/代表者/);
    expect(() => assertOwnerRequest(request({ origin: "http://evil.test", host: "localhost:3000", [OWNER_ACTION_HEADER]: OWNER_ACTION_VALUE }))).toThrow(/Origin/);
    expect(() => assertOwnerRequest(request({ origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "cross-site", [OWNER_ACTION_HEADER]: OWNER_ACTION_VALUE }))).toThrow(/別サイト/);
  });
});
