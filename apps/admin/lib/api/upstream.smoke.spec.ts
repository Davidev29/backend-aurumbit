import { NextResponse, NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

describe("next/server no vitest (smoke)", () => {
  it("constrói NextRequest e NextResponse", async () => {
    const req = new NextRequest("http://localhost/api/finance/payables", {
      method: "GET",
      headers: { "x-org-id": "org-1", cookie: "aurum_session=sess-1" },
    });
    expect(req.headers.get("x-org-id")).toBe("org-1");
    expect(req.cookies.get("aurum_session")?.value).toBe("sess-1");
    expect(req.nextUrl.pathname).toBe("/api/finance/payables");

    const res = NextResponse.json({ ok: true }, { status: 200 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
