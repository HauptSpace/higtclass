import { applyOp, OpError, type Op, type Workspace } from "@sumira/core";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Hono, type Context } from "hono";
import type { Db } from "./db.ts";

// Accounts, shared workspaces and sync. Every change is the same JSON
// operation the app already uses for undo: the app sends its operations, the
// server applies them to the stored copy in order and keeps a numbered log,
// and other devices fetch what they missed. Conflicting operations (a row
// someone else deleted) are refused, and the device reloads the shared copy.

const hash = promisify(scrypt) as (pass: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 90;
const INVITE_DAYS = 14;
const MAX_DATA = 25_000_000;
const MAX_OPS = 500;

export type Role = "owner" | "editor" | "viewer";

interface UserRow {
  id: string;
  email: string;
  name: string;
  pass: string;
}

const id = (prefix: string) => prefix + randomBytes(9).toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await hash(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const got = await hash(password, Buffer.from(salt, "hex"), 64);
  const want = Buffer.from(key, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A few wrong passwords are fine; a script trying thousands is not. */
const attempts = new Map<string, { n: number; until: number }>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) {
    attempts.set(key, { n: 1, until: now + 10 * 60_000 });
    return false;
  }
  a.n++;
  return a.n > 10;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cloudRoutes(db: Db) {
  const app = new Hono<{ Variables: { user: UserRow } }>();

  const issue = (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    db.prepare("INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)").run(sha(token), userId, now, now + SESSION_DAYS * 86_400_000);
    return token;
  };

  const userOf = (c: Context): UserRow | null => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return null;
    const row = db
      .prepare("SELECT u.id, u.email, u.name, u.pass FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?")
      .get(sha(token), Date.now()) as UserRow | undefined;
    return row ?? null;
  };

  const roleOf = (workspaceId: string, userId: string): Role | null => {
    const row = db.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as { role: Role } | undefined;
    return row?.role ?? null;
  };

  const workspacesOf = (userId: string) =>
    db
      .prepare("SELECT w.id, w.name, w.version, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.updated DESC")
      .all(userId);

  const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name });

  app.post("/auth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; password?: string; name?: string } | null;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!EMAIL.test(email)) return c.json({ error: "bad_email" }, 400);
    if (password.length < 8) return c.json({ error: "short_password" }, 400);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return c.json({ error: "email_taken" }, 409);
    const user: UserRow = { id: id("u_"), email, name: String(body?.name ?? "").trim().slice(0, 80), pass: await hashPassword(password) };
    db.prepare("INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)").run(user.id, user.email, user.name, user.pass, Date.now());
    return c.json({ token: issue(user.id), user: publicUser(user), workspaces: [] });
  });

  app.post("/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; password?: string } | null;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const ip = c.req.header("x-forwarded-for") ?? "local";
    if (tooMany(`${ip}|${email}`)) return c.json({ error: "too_many" }, 429);
    const user = db.prepare("SELECT id, email, name, pass FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (!user || !(await checkPassword(String(body?.password ?? ""), user.pass))) return c.json({ error: "wrong_login" }, 401);
    attempts.delete(`${ip}|${email}`);
    return c.json({ token: issue(user.id), user: publicUser(user), workspaces: workspacesOf(user.id) });
  });

  // Everything below needs a signed-in person.
  app.use("/*", async (c, next) => {
    if (c.req.path.includes("/auth/")) return next();
    const user = userOf(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    c.set("user", user);
    return next();
  });

  app.post("/auth/logout", (c) => {
    const auth = c.req.header("authorization") ?? "";
    db.prepare("DELETE FROM sessions WHERE token = ?").run(sha(auth.slice(7)));
    return c.json({ ok: true });
  });

  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json({ user: publicUser(user), workspaces: workspacesOf(user.id) });
  });

  /** Upload a workspace (the tables already on this device) as a new shared one. */
  app.post("/workspaces", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => null)) as { name?: string; data?: Workspace } | null;
    const data = body?.data ?? { tables: [] };
    if (!Array.isArray(data.tables)) return c.json({ error: "bad_request" }, 400);
    const text = JSON.stringify(data);
    if (text.length > MAX_DATA) return c.json({ error: "too_large" }, 413);
    const wsId = id("w_");
    const now = Date.now();
    db.prepare("INSERT INTO workspaces (id, name, data, version, updated) VALUES (?, ?, ?, 0, ?)").run(wsId, String(body?.name ?? "Sumira").slice(0, 80), text, now);
    db.prepare("INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(wsId, user.id);
    return c.json({ id: wsId, version: 0, role: "owner" });
  });

  app.get("/workspaces/:id", (c) => {
    const user = c.get("user");
    const role = roleOf(c.req.param("id"), user.id);
    if (!role) return c.json({ error: "not_found" }, 404);
    const row = db.prepare("SELECT id, name, data, version FROM workspaces WHERE id = ?").get(c.req.param("id")) as { id: string; name: string; data: string; version: number };
    return c.json({ id: row.id, name: row.name, version: row.version, role, data: JSON.parse(row.data) });
  });

  app.patch("/workspaces/:id", async (c) => {
    const user = c.get("user");
    if (roleOf(c.req.param("id"), user.id) !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    const name = String(body?.name ?? "").trim().slice(0, 80);
    if (!name) return c.json({ error: "bad_request" }, 400);
    db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, c.req.param("id"));
    return c.json({ ok: true });
  });

  /** Apply a device's changes in order. */
  app.post("/workspaces/:id/ops", async (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    const role = roleOf(wsId, user.id);
    if (!role) return c.json({ error: "not_found" }, 404);
    if (role === "viewer") return c.json({ error: "read_only" }, 403);
    const body = (await c.req.json().catch(() => null)) as { client?: string; ops?: Op[] } | null;
    const ops = body?.ops;
    if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) return c.json({ error: "bad_request" }, 400);
    const client = String(body?.client ?? "").slice(0, 64);
    const row = db.prepare("SELECT data, version FROM workspaces WHERE id = ?").get(wsId) as { data: string; version: number };
    let data = JSON.parse(row.data) as Workspace;
    try {
      for (const op of ops) data = applyOp(data, op);
    } catch (e) {
      // Someone else changed the same thing first: the device takes the shared copy.
      if (e instanceof OpError || e instanceof TypeError) return c.json({ error: "conflict", version: row.version, data: JSON.parse(row.data) }, 409);
      throw e;
    }
    const text = JSON.stringify(data);
    if (text.length > MAX_DATA) return c.json({ error: "too_large" }, 413);
    const now = Date.now();
    let version = row.version;
    db.exec("BEGIN");
    try {
      const insert = db.prepare("INSERT INTO changes (workspace_id, version, op, client, user_id, created) VALUES (?, ?, ?, ?, ?, ?)");
      for (const op of ops) insert.run(wsId, ++version, JSON.stringify(op), client, user.id, now);
      db.prepare("UPDATE workspaces SET data = ?, version = ?, updated = ? WHERE id = ?").run(text, version, now, wsId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return c.json({ version });
  });

  /** What changed since a version; the whole copy when the device is too far behind. */
  app.get("/workspaces/:id/changes", (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    if (!roleOf(wsId, user.id)) return c.json({ error: "not_found" }, 404);
    const since = Number(c.req.query("since") ?? 0);
    const row = db.prepare("SELECT data, version FROM workspaces WHERE id = ?").get(wsId) as { data: string; version: number };
    if (since >= row.version) return c.json({ version: row.version, changes: [] });
    const changes = db
      .prepare("SELECT version, op, client FROM changes WHERE workspace_id = ? AND version > ? ORDER BY version LIMIT 1001")
      .all(wsId, since) as { version: number; op: string; client: string }[];
    if (changes.length > 1000 || !changes.length || changes[0].version !== since + 1) {
      return c.json({ version: row.version, data: JSON.parse(row.data) });
    }
    return c.json({ version: row.version, changes: changes.map((ch) => ({ version: ch.version, client: ch.client, op: JSON.parse(ch.op) })) });
  });

  app.get("/workspaces/:id/members", (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    if (!roleOf(wsId, user.id)) return c.json({ error: "not_found" }, 404);
    const members = db
      .prepare("SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.role, u.email")
      .all(wsId);
    return c.json({ members });
  });

  /** A link that adds whoever opens it, as an editor or a viewer. */
  app.post("/workspaces/:id/invites", async (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    if (roleOf(wsId, user.id) !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null)) as { role?: string } | null;
    const role = body?.role === "viewer" ? "viewer" : "editor";
    const token = randomBytes(18).toString("base64url");
    db.prepare("INSERT INTO invites (token, workspace_id, role, created_by, expires) VALUES (?, ?, ?, ?, ?)").run(token, wsId, role, user.id, Date.now() + INVITE_DAYS * 86_400_000);
    return c.json({ token, role });
  });

  app.post("/invites/:token", (c) => {
    const user = c.get("user");
    const invite = db.prepare("SELECT workspace_id, role FROM invites WHERE token = ? AND expires > ?").get(c.req.param("token"), Date.now()) as
      | { workspace_id: string; role: Role }
      | undefined;
    if (!invite) return c.json({ error: "invite_expired" }, 404);
    if (!roleOf(invite.workspace_id, user.id)) {
      db.prepare("INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(invite.workspace_id, user.id, invite.role);
    }
    return c.json({ workspaceId: invite.workspace_id });
  });

  app.patch("/workspaces/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    if (roleOf(wsId, user.id) !== "owner" || c.req.param("userId") === user.id) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null)) as { role?: string } | null;
    const role = body?.role === "viewer" ? "viewer" : "editor";
    db.prepare("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ? AND role != 'owner'").run(role, wsId, c.req.param("userId"));
    return c.json({ ok: true });
  });

  /** The owner removes someone, or anyone leaves. */
  app.delete("/workspaces/:id/members/:userId", (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    const target = c.req.param("userId");
    const mine = roleOf(wsId, user.id);
    if (!mine || (target !== user.id && mine !== "owner") || roleOf(wsId, target) === "owner") return c.json({ error: "forbidden" }, 403);
    db.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ?").run(wsId, target);
    return c.json({ ok: true });
  });

  return app;
}
