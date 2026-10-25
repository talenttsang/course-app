import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createMockServer } from "../support/mock-supabase.mjs";
import { selectAllowed } from "../support/rls.mjs";

const schema = readFileSync("supabase/schema.sql", "utf8");

const buyerPolicy = `
  alter table course_videos enable row level security;
  create policy "buyers read lessons"
    on course_videos for select
    using (
      exists (
        select 1 from purchases
        where purchases.user_id = auth.uid()
          and purchases.course_id = course_videos.course_id
      )
    );
`;

const inPolicy = `
  alter table course_videos enable row level security;
  create policy "buyers via in"
    on course_videos for select to authenticated
    using (
      course_id in (
        select course_id from purchases where user_id = (select auth.uid())
      )
    );
`;

function ctx(role: "anon" | "authenticated", uid: string | null, purchases: { user_id: string; course_id: string }[]) {
  return { role, uid, tables: { purchases } };
}

describe("policy behaviour, independent of the wording that ships today", () => {
  const lesson = { id: "l1", course_id: "c1", source_id: "vid" };
  const purchases = [{ user_id: "owner", course_id: "c1" }];

  it("treats an open policy as world-readable whatever it is named", () => {
    for (const using of ["true", "1 = 1", "not false", "auth.uid() = user_id or true"]) {
      const sql = `
        alter table course_videos enable row level security;
        create policy "lessons are listed" on course_videos for select using (${using});
      `;
      expect(selectAllowed(sql, "course_videos", lesson, ctx("anon", null, [])), using).toBe(true);
    }
  });

  it("accepts a purchase check written as exists or as in", () => {
    expect(selectAllowed(buyerPolicy, "course_videos", lesson, ctx("anon", null, purchases))).toBe(false);
    expect(selectAllowed(buyerPolicy, "course_videos", lesson, ctx("authenticated", "stranger", purchases))).toBe(false);
    expect(selectAllowed(buyerPolicy, "course_videos", lesson, ctx("authenticated", "owner", purchases))).toBe(true);

    expect(selectAllowed(inPolicy, "course_videos", lesson, ctx("anon", null, purchases))).toBe(false);
    expect(selectAllowed(inPolicy, "course_videos", lesson, ctx("authenticated", "owner", purchases))).toBe(true);
    expect(selectAllowed(inPolicy, "course_videos", lesson, ctx("authenticated", "stranger", purchases))).toBe(false);
  });

  it("still enforces the policies that are already correct", () => {
    const purchase = { id: "p1", user_id: "student", course_id: "c1" };
    expect(selectAllowed(schema, "purchases", purchase, ctx("anon", null, []))).toBe(false);
    expect(selectAllowed(schema, "purchases", purchase, { role: "authenticated", uid: "student", tables: {} })).toBe(true);
    expect(selectAllowed(schema, "purchases", purchase, { role: "authenticated", uid: "other", tables: {} })).toBe(false);
    expect(selectAllowed(schema, "admins", { email: "staff@example.test" }, ctx("authenticated", "student", []))).toBe(false);
    expect(
      selectAllowed(schema, "lesson_progress", { user_id: "student", video_id: "v" }, {
        role: "authenticated",
        uid: "student",
        tables: {},
      })
    ).toBe(true);
    expect(selectAllowed(schema, "courses", { id: "c1" }, ctx("anon", null, []))).toBe(true);
  });
});

describe("anonymous reads against the stand-in", () => {
  async function withMock<T>(run: (port: number) => Promise<T>) {
    const server = createMockServer() as ReturnType<typeof createServer>;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      return await run(port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("a student who bought a course can read lesson source ids", async () => {
    await withMock(async (port) => {
      const tokenRes = await fetch(`http://127.0.0.1:${port}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: "test-anon-key" },
        body: JSON.stringify({ email: "student@example.test", password: "Student-pass-123" }),
      });
      expect(tokenRes.ok).toBe(true);
      const token = (await tokenRes.json()).access_token as string;
      const videos = await fetch(`http://127.0.0.1:${port}/rest/v1/course_videos?select=source_id`, {
        headers: { apikey: "test-anon-key", Authorization: `Bearer ${token}` },
      });
      const rows = (await videos.json()) as { source_id?: string }[];
      expect(rows.some((row) => typeof row.source_id === "string" && row.source_id.length > 0)).toBe(true);

      const purchases = await fetch(`http://127.0.0.1:${port}/rest/v1/purchases?select=id`, {
        headers: { apikey: "test-anon-key", Authorization: "Bearer test-anon-key" },
      });
      expect(await purchases.json()).toEqual([]);
    });
  });

  // KNOWN BUG: course_videos is readable by the anonymous key. The stand-in
  // applies whatever SELECT policy schema.sql currently has, so a purchase
  // check written any other way makes this assertion pass.
  // Was a locked defect; the policy now checks the viewer owns the course,
  // so this guards the fix instead of recording the bug.
  it("BUG-RLS: an anonymous client cannot read lesson source ids", async () => {
    await withMock(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/rest/v1/course_videos?select=source_id&limit=5`, {
        headers: { apikey: "test-anon-key", Authorization: "Bearer test-anon-key" },
      });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as { source_id?: string }[];
      const leaked = rows.some((row) => typeof row.source_id === "string" && row.source_id.length > 0);
      expect(leaked).toBe(false);
    });
  });
});
