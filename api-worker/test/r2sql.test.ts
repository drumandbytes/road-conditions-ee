import { afterEach, describe, expect, it, vi } from "vitest";
import { queryR2Sql } from "../src/r2sql";

function mockFetchJson(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("queryR2Sql", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the query and returns the rows on success", async () => {
    const fetchMock = mockFetchJson(200, {
      result: { rows: [{ event: "pollFast", level: "INFO" }] },
      success: true,
      errors: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await queryR2Sql("acct1", "tok1", "my-bucket", "SELECT * FROM t");

    expect(rows).toEqual([{ event: "pollFast", level: "INFO" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sql.cloudflarestorage.com/api/v1/accounts/acct1/r2-sql/query/my-bucket");
    expect(init.headers.Authorization).toBe("Bearer tok1");
    expect(JSON.parse(init.body)).toEqual({ query: "SELECT * FROM t" });
  });

  it("throws with the API's own error message on a failed query", async () => {
    const fetchMock = mockFetchJson(400, {
      result: null,
      success: false,
      errors: [{ code: 40004, message: "invalid query: boom" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(queryR2Sql("acct1", "tok1", "my-bucket", "SELECT bad")).rejects.toThrow("invalid query: boom");
  });

  it("returns an empty array when the query matched no rows", async () => {
    const fetchMock = mockFetchJson(200, { result: { rows: [] }, success: true, errors: [] });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await queryR2Sql("acct1", "tok1", "my-bucket", "SELECT * FROM t WHERE 1=0");

    expect(rows).toEqual([]);
  });
});
