// In-memory stand-in for the Auth and PostgREST endpoints this app calls.
// It exists so local end-to-end tests can sign in, grant courses, and edit
// lessons without a Supabase project and without touching production.
//
// Row-level security matches supabase/schema.sql, including the public read
// policy on courses and course_videos. Service-role requests bypass it.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { selectAllowed } from "./rls.mjs";

const SCHEMA_SQL = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

export const IDS = {
  student: "11111111-1111-4111-8111-111111111111",
  outsider: "22222222-2222-4222-8222-222222222222",
  staff: "33333333-3333-4333-8333-333333333333",
  colleague: "44444444-4444-4444-8444-444444444444",
  courseStarter: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  courseExtended: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  lesson1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  lesson2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  lesson3: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
};

// Always the stand-in value. A real service-role key in the shell must not
// become the secret this process accepts.
const SERVICE_ROLE = "test-service-role";

const state = {
  users: [],
  courses: [],
  lessons: [],
  purchases: [],
  progress: [],
  admins: [],
  tokens: new Map(),
  refreshes: new Map(),
};

function seed() {
  state.users = [
    user(IDS.colleague, "colleague@example.test", "Colleague-pass-123", "2024-01-01T00:00:00.000Z", {
      full_name: "Casey Colleague",
      has_password: true,
    }),
    user(IDS.outsider, "outsider@example.test", "Outsider-pass-123", "2024-02-01T00:00:00.000Z", {
      full_name: "Olivia Outsider",
      has_password: true,
    }),
    user(IDS.student, "student@example.test", "Student-pass-123", "2024-03-01T00:00:00.000Z", {
      full_name: "Sam Student",
      has_password: true,
      welcome_sent_at: "2024-03-01T01:00:00.000Z",
    }),
    user(IDS.staff, "staff@example.test", "Staff-pass-123", "2024-04-01T00:00:00.000Z", {
      full_name: "Sidney Staff",
      has_password: true,
    }),
  ];
  state.courses = [
    {
      id: IDS.courseStarter,
      slug: "starter",
      title: "Starter Program",
      description: "The starter course.",
      bigcommerce_product_id: 3463,
      created_at: "2024-01-01T00:00:00.000Z",
    },
    {
      id: IDS.courseExtended,
      slug: "extended",
      title: "Extended Program",
      description: "The extended course, with no lessons yet.",
      bigcommerce_product_id: 3464,
      created_at: "2024-01-02T00:00:00.000Z",
    },
  ];
  state.lessons = [
    lesson(IDS.lesson1, IDS.courseStarter, "Consultation", "Read the pattern", "abcdefghijk", 1),
    lesson(IDS.lesson2, IDS.courseStarter, "Consultation", "Take the template", "bbcdefghijk", 2),
    lesson(IDS.lesson3, IDS.courseExtended, "Colour", "Match the colour", "cccdefghijk", 1),
  ];
  state.purchases = [
    purchase(IDS.student, IDS.courseStarter, 1001),
    purchase(IDS.staff, IDS.courseStarter, 0),
    purchase(IDS.staff, IDS.courseExtended, 0),
    purchase(IDS.colleague, IDS.courseStarter, 0),
  ];
  // lesson3 belongs to a course this student does not own. The course page
  // loads every progress row, so this extra id inflates the headline count.
  state.progress = [
    { user_id: IDS.student, video_id: IDS.lesson1, completed_at: "2024-03-02T00:00:00.000Z" },
    { user_id: IDS.student, video_id: IDS.lesson3, completed_at: "2024-03-03T00:00:00.000Z" },
  ];
  state.admins = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      email: "colleague@example.test",
      added_by: "staff@example.test",
      created_at: "2024-01-01T00:00:00.000Z",
    },
  ];
  state.tokens = new Map();
  state.refreshes = new Map();
}

function user(id, email, password, createdAt, metadata) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: createdAt,
    confirmed_at: createdAt,
    last_sign_in_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: metadata,
    identities: [],
    is_anonymous: false,
    password,
  };
}

function lesson(id, courseId, chapter, title, sourceId, position) {
  return {
    id,
    course_id: courseId,
    module_title: chapter,
    title,
    source_id: sourceId,
    source_type: "youtube",
    position,
    created_at: "2024-01-01T00:00:00.000Z",
  };
}

function purchase(userId, courseId, orderId) {
  return {
    id: randomUUID(),
    user_id: userId,
    course_id: courseId,
    bigcommerce_order_id: orderId,
    purchased_at: "2024-03-01T00:00:00.000Z",
  };
}

function publicUser(row) {
  const { password: _password, ...rest } = row;
  return rest;
}

function bearer(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function isService(req) {
  return bearer(req) === SERVICE_ROLE || req.headers.apikey === SERVICE_ROLE;
}

function actorId(req) {
  if (isService(req)) return null;
  return state.tokens.get(bearer(req)) || null;
}

function send(req, res, status, body, extraHeaders = {}) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Expose-Headers",
    "content-range, x-total-count, location"
  );
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sessionFor(row) {
  const access = `access.${row.id}.${randomUUID()}`;
  const refresh = `refresh.${row.id}.${randomUUID()}`;
  state.tokens.set(access, row.id);
  state.refreshes.set(refresh, row.id);
  row.last_sign_in_at = new Date().toISOString();
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: publicUser(row),
  };
}

function tableOf(name) {
  if (name === "courses") return state.courses;
  if (name === "course_videos") return state.lessons;
  if (name === "purchases") return state.purchases;
  if (name === "lesson_progress") return state.progress;
  if (name === "admins") return state.admins;
  return null;
}

// SELECT visibility follows supabase/schema.sql, including a policy written
// differently from the one that ships today. Service-role requests bypass it.
function visible(table, req, row) {
  if (isService(req)) return true;
  const uid = actorId(req);
  return selectAllowed(SCHEMA_SQL, table, row, {
    role: uid ? "authenticated" : "anon",
    uid,
    tables: {
      courses: state.courses,
      course_videos: state.lessons,
      purchases: state.purchases,
      lesson_progress: state.progress,
      admins: state.admins,
    },
  });
}

function canWrite(table, req, row) {
  if (isService(req)) return true;
  const uid = actorId(req);
  if (!uid) return false;
  if (table === "lesson_progress") return row.user_id === uid;
  return false;
}

function attachEmbeds(table, row, select) {
  const out = { ...row };
  if (!select || !select.includes("courses(")) return out;
  const match = select.match(/(?:(\w+):)?courses\(([^)]*)\)/);
  if (!match || table !== "purchases") return out;
  const alias = match[1] || "courses";
  const course = state.courses.find((c) => c.id === row.course_id) || null;
  out[alias] = course ? { ...course } : null;
  return out;
}

function applyQuery(rows, search) {
  let out = rows.slice();
  for (const [key, raw] of search.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (raw.startsWith("eq.")) {
      const expected = raw.slice(3);
      out = out.filter((row) => String(row[key]) === expected);
    } else if (raw.startsWith("in.(") && raw.endsWith(")")) {
      const list = raw.slice(4, -1).split(",").filter(Boolean);
      out = out.filter((row) => list.includes(String(row[key])));
    } else if (raw === "is.null") {
      out = out.filter((row) => row[key] == null);
    }
  }
  const orders = search.getAll("order");
  for (const order of orders) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      if (a[col] === b[col]) return 0;
      if (a[col] == null) return 1;
      if (b[col] == null) return -1;
      return a[col] < b[col] ? (dir === "desc" ? 1 : -1) : dir === "desc" ? -1 : 1;
    });
  }
  const limitRaw = search.get("limit");
  if (limitRaw !== null) {
    const limit = Number(limitRaw);
    if (Number.isInteger(limit) && limit >= 0) out = out.slice(0, limit);
  }
  return out;
}

function pgError(status, message) {
  return {
    status,
    body: { code: "23505", message, details: null, hint: null },
  };
}

function insertRow(table, req, row) {
  if (!canWrite(table, req, row)) {
    return { status: 401, body: { message: "new row violates row-level security", code: "42501" } };
  }
  if (table === "courses") {
    if (state.courses.some((c) => c.slug === row.slug)) {
      return pgError(409, 'duplicate key value violates unique constraint "courses_slug_key"');
    }
    if (state.courses.some((c) => c.bigcommerce_product_id === row.bigcommerce_product_id)) {
      return pgError(
        409,
        'duplicate key value violates unique constraint "courses_bigcommerce_product_id_key"'
      );
    }
    row.id = row.id || randomUUID();
    row.created_at = row.created_at || new Date().toISOString();
    state.courses.push(row);
  } else if (table === "course_videos") {
    row.id = row.id || randomUUID();
    row.created_at = row.created_at || new Date().toISOString();
    state.lessons.push(row);
  } else if (table === "purchases") {
    const existing = state.purchases.find(
      (p) => p.user_id === row.user_id && p.course_id === row.course_id
    );
    if (existing) {
      return pgError(409, 'duplicate key value violates unique constraint "purchases_user_id_course_id_key"');
    }
    row.id = row.id || randomUUID();
    row.purchased_at = row.purchased_at || new Date().toISOString();
    state.purchases.push(row);
  } else if (table === "lesson_progress") {
    const existing = state.progress.find(
      (p) => p.user_id === row.user_id && p.video_id === row.video_id
    );
    if (existing) {
      return pgError(409, 'duplicate key value violates unique constraint "lesson_progress_pkey"');
    }
    row.completed_at = row.completed_at || new Date().toISOString();
    state.progress.push(row);
  } else if (table === "admins") {
    if (state.admins.some((a) => a.email === row.email)) {
      return pgError(409, 'duplicate key value violates unique constraint "admins_email_key"');
    }
    row.id = row.id || randomUUID();
    row.created_at = row.created_at || new Date().toISOString();
    state.admins.push(row);
  }
  return { status: 201, body: row };
}

function upsertRows(table, req, rows, search, prefer) {
  const conflict = (search.get("on_conflict") || "").split(",").filter(Boolean);
  const ignore = prefer.includes("ignore-duplicates");
  const saved = [];
  for (const row of rows) {
    const existing = conflict.length
      ? tableOf(table).find((candidate) => conflict.every((col) => candidate[col] === row[col]))
      : null;
    if (existing && ignore) {
      saved.push(existing);
      continue;
    }
    if (existing && !ignore) {
      Object.assign(existing, row);
      saved.push(existing);
      continue;
    }
    const result = insertRow(table, req, row);
    if (result.status >= 400) return result;
    saved.push(result.body);
  }
  return { status: 201, body: saved };
}

async function handleRest(req, res, table, search) {
  const method = req.method || "GET";
  const prefer = req.headers.prefer || "";
  const accept = req.headers.accept || "";
  const wantsObject = accept.includes("application/vnd.pgrst.object+json");
  const rows = tableOf(table);
  if (!rows) return send(req, res, 404, { message: `unknown table ${table}` });

  if (method === "GET" || method === "HEAD") {
    const matched = applyQuery(rows.filter((row) => visible(table, req, row)), search);
    const shaped = matched.map((row) => attachEmbeds(table, row, search.get("select")));
    const headers = { "content-range": `*/${shaped.length}` };
    if (method === "HEAD") return send(req, res, 200, undefined, headers);
    if (wantsObject) {
      if (shaped.length !== 1) {
        return send(req, res, 406, {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `${shaped.length} rows`,
          hint: null,
        });
      }
      return send(req, res, 200, shaped[0], headers);
    }
    return send(req, res, 200, shaped, headers);
  }

  const payload = await readBody(req);
  const incoming = Array.isArray(payload) ? payload : [payload];

  if (method === "POST") {
    const result = prefer.includes("resolution=")
      ? upsertRows(table, req, incoming, search, prefer)
      : incoming.length === 1
        ? insertRow(table, req, incoming[0])
        : upsertRows(table, req, incoming, search, "resolution=merge-duplicates");
    if (result.status >= 400) return send(req, res, result.status, result.body);
    const body = Array.isArray(result.body) ? result.body : [result.body];
    return send(req, res, result.status, wantsObject ? body[0] : body);
  }

  if (method === "PATCH") {
    const matched = applyQuery(rows.filter((row) => visible(table, req, row)), search);
    if (matched.some((row) => !canWrite(table, req, row))) {
      return send(req, res, 401, { message: "new row violates row-level security", code: "42501" });
    }
    for (const row of matched) Object.assign(row, payload);
    return send(req, res, 200, wantsObject ? matched[0] ?? null : matched);
  }

  if (method === "DELETE") {
    const matched = applyQuery(rows.filter((row) => visible(table, req, row)), search);
    if (matched.some((row) => !canWrite(table, req, row))) {
      return send(req, res, 401, { message: "new row violates row-level security", code: "42501" });
    }
    const doomed = new Set(matched);
    const list = tableOf(table);
    for (let i = list.length - 1; i >= 0; i--) {
      if (doomed.has(list[i])) list.splice(i, 1);
    }
    if (table === "courses") {
      const ids = new Set(matched.map((row) => row.id));
      state.lessons = state.lessons.filter((row) => !ids.has(row.course_id));
      state.purchases = state.purchases.filter((row) => !ids.has(row.course_id));
    }
    return send(req, res, 200, matched);
  }

  return send(req, res, 405, { message: "method not allowed" });
}

async function handleAuth(req, res, pathname, search) {
  const method = req.method || "GET";

  if (pathname === "/auth/v1/token" && method === "POST") {
    const body = await readBody(req);
    const grant = search.get("grant_type");
    if (grant === "refresh_token") {
      const id = state.refreshes.get(body.refresh_token);
      const row = state.users.find((u) => u.id === id);
      if (!row) return send(req, res, 400, { msg: "Invalid refresh token" });
      return send(req, res, 200, sessionFor(row));
    }
    const row = state.users.find((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!row || !row.password || row.password !== body.password) {
      return send(req, res, 400, { msg: "Invalid login credentials" });
    }
    return send(req, res, 200, sessionFor(row));
  }

  if (pathname === "/auth/v1/logout" && method === "POST") {
    state.tokens.delete(bearer(req));
    return send(req, res, 204, undefined);
  }

  if (pathname === "/auth/v1/user" && method === "GET") {
    const id = state.tokens.get(bearer(req));
    const row = state.users.find((u) => u.id === id);
    if (!row) return send(req, res, 401, { msg: "invalid claim: missing sub claim" });
    return send(req, res, 200, publicUser(row));
  }

  if (pathname === "/auth/v1/user" && method === "PUT") {
    const id = state.tokens.get(bearer(req));
    const row = state.users.find((u) => u.id === id);
    if (!row) return send(req, res, 401, { msg: "invalid claim: missing sub claim" });
    const body = await readBody(req);
    if (typeof body.password === "string") row.password = body.password;
    if (body.data && typeof body.data === "object") {
      row.user_metadata = { ...row.user_metadata, ...body.data };
    }
    if (body.user_metadata && typeof body.user_metadata === "object") {
      row.user_metadata = { ...row.user_metadata, ...body.user_metadata };
    }
    return send(req, res, 200, publicUser(row));
  }

  if (pathname === "/auth/v1/otp" && method === "POST") {
    return send(req, res, 200, {});
  }

  if (pathname === "/auth/v1/admin/users" && method === "GET") {
    if (!isService(req)) return send(req, res, 401, { msg: "not allowed" });
    const page = Number(search.get("page") || "1");
    const perPage = Number(search.get("per_page") || "50");
    const start = (page - 1) * perPage;
    const slice = state.users.slice(start, start + perPage).map(publicUser);
    return send(req, res, 200, { users: slice }, { "x-total-count": String(state.users.length) });
  }

  if (pathname === "/auth/v1/admin/users" && method === "POST") {
    if (!isService(req)) return send(req, res, 401, { msg: "not allowed" });
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase();
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      return send(req, res, 422, { msg: "A user with this email address has already been registered" });
    }
    const row = user(randomUUID(), email, body.password || "", new Date().toISOString(), {
      ...(body.user_metadata || {}),
    });
    state.users.push(row);
    return send(req, res, 200, publicUser(row));
  }

  const adminUser = pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
  if (adminUser) {
    if (!isService(req)) return send(req, res, 401, { msg: "not allowed" });
    const row = state.users.find((u) => u.id === adminUser[1]);
    if (method === "GET") {
      if (!row) return send(req, res, 404, { msg: "User not found" });
      return send(req, res, 200, publicUser(row));
    }
    if (method === "PUT") {
      if (!row) return send(req, res, 404, { msg: "User not found" });
      const body = await readBody(req);
      if (typeof body.email === "string") row.email = body.email.toLowerCase();
      if (typeof body.password === "string") row.password = body.password;
      if (body.user_metadata && typeof body.user_metadata === "object") {
        row.user_metadata = { ...body.user_metadata };
      }
      return send(req, res, 200, publicUser(row));
    }
    if (method === "DELETE") {
      if (!row) return send(req, res, 404, { msg: "User not found" });
      state.users = state.users.filter((u) => u.id !== row.id);
      state.purchases = state.purchases.filter((p) => p.user_id !== row.id);
      state.progress = state.progress.filter((p) => p.user_id !== row.id);
      return send(req, res, 200, publicUser(row));
    }
  }

  if (pathname === "/auth/v1/admin/generate_link" && method === "POST") {
    if (!isService(req)) return send(req, res, 401, { msg: "not allowed" });
    const body = await readBody(req);
    const row = state.users.find((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!row) return send(req, res, 400, { msg: "User not found" });
    return send(req, res, 200, {
      ...publicUser(row),
      action_link: "http://127.0.0.1:3000/auth/confirm?token_hash=mock",
      email_otp: "123456",
      hashed_token: "mockhashedtoken",
      redirect_to: "",
      verification_type: body.type || "magiclink",
    });
  }

  return send(req, res, 404, { message: `no auth route ${method} ${pathname}` });
}

export function createMockServer() {
  seed();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "OPTIONS") {
        const origin = req.headers.origin || "*";
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
          "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*",
          "Access-Control-Max-Age": "600",
        });
        res.end();
        return;
      }
      if (url.pathname === "/__test/health") return send(req, res, 200, { ok: true });
      if (url.pathname === "/__test/reset" && req.method === "POST") {
        seed();
        return send(req, res, 200, { ok: true });
      }
      if (url.pathname.startsWith("/auth/v1/")) {
        return await handleAuth(req, res, url.pathname, url.searchParams);
      }
      const rest = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (rest) return await handleRest(req, res, rest[1], url.searchParams);
      return send(req, res, 404, { message: `no route ${req.method} ${url.pathname}` });
    } catch (err) {
      console.error("[mock-supabase]", err);
      if (!res.headersSent) send(req, res, 500, { message: err instanceof Error ? err.message : String(err) });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith("mock-supabase.mjs")) {
  const port = Number(process.env.MOCK_SUPABASE_PORT || 54321);
  createMockServer().listen(port, "127.0.0.1", () => {
    console.log(`[mock-supabase] listening on ${port}`);
  });
}
