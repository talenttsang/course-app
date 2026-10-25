import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href?: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({
    from() {
      throw new Error("the headline render must not touch the browser client");
    },
  }),
}));

function rows(table: string, filters: [string, string][]) {
  const has = (column: string, value: string) => filters.some(([key, got]) => key === column && got === value);
  if (table === "courses") {
    return has("slug", "starter") ? [{ id: "course-a", title: "Starter", description: "The starter course." }] : [];
  }
  if (table === "purchases") {
    return has("user_id", "user-1") && has("course_id", "course-a") ? [{ id: "purchase-1" }] : [];
  }
  if (table === "course_videos") {
    return has("course_id", "course-a")
      ? [
          {
            id: "lesson-a1",
            title: "One",
            source_id: "aaaaaaaaaaa",
            source_type: "youtube",
            module_title: "Basics",
            position: 1,
          },
          {
            id: "lesson-a2",
            title: "Two",
            source_id: "bbbbbbbbbbb",
            source_type: "youtube",
            module_title: "Basics",
            position: 2,
          },
        ]
      : [];
  }
  if (table === "lesson_progress") {
    // One completion in this course and one in a different course. The page
    // currently hands every row to the viewer.
    return has("user_id", "user-1")
      ? [{ video_id: "lesson-a1" }, { video_id: "lesson-from-another-course" }]
      : [];
  }
  throw new Error(`unexpected table ${table}`);
}

function query(table: string) {
  const filters: [string, string][] = [];
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push([column, String(value)]);
      return api;
    },
    order() {
      return api;
    },
    async maybeSingle() {
      return { data: rows(table, filters)[0] ?? null, error: null };
    },
    async single() {
      return { data: rows(table, filters)[0] ?? null, error: null };
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows(table, filters), error: null }).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1", email: "student@example.test" } }, error: null }),
    },
    from: (table: string) => query(table),
  }),
  supabaseAdmin: () => {
    throw new Error("the course page must not use the service role");
  },
  publicOrigin: () => "http://127.0.0.1:3000",
}));

import CoursePage from "@/app/course/[slug]/page";

async function renderStarter() {
  // params is a Promise from Next 15 on, so the page awaits it.
  const element = await CoursePage({ params: Promise.resolve({ slug: "starter" }) });
  return renderToStaticMarkup(element);
}

describe("course progress headline", () => {
  it("renders a course where one finished lesson belongs to another course", async () => {
    const html = await renderStarter();
    expect(html).toContain("Starter");
    expect(html).toContain("1/2");
    expect(html).toContain("of 2 lessons");
  });

  // KNOWN BUG: the headline uses every progress row, so this student sees
  // "2 of 2" while the chapter says 1/2. Filtering in the page query or in
  // the viewer both make the headline "1 of 2".
  it.fails("BUG-PROGRESS: the course headline counts only this course's lessons", async () => {
    const html = await renderStarter();
    expect(html).toContain("1 of 2 lessons");
    expect(html).not.toContain("2 of 2 lessons");
  });
});
