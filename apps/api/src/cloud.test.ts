import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { createApp } from "./main.ts";

function setup() {
  const app = createApp({ db: openDb(":memory:"), client: null });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return call;
}

const table = { id: "t_1", name: "Витрати", icon: "≡", createdAt: 1, columns: [{ id: "c_1", name: "Сума", type: "money" }], rows: [] };

describe("accounts and sync", () => {
  it("registers, logs in and refuses a wrong password", async () => {
    const call = setup();
    const reg = await call("POST", "/auth/register", { email: "Oksana@Example.com", password: "long-enough" });
    expect(reg.status).toBe(200);
    expect(reg.json.user.email).toBe("oksana@example.com");
    expect((await call("POST", "/auth/register", { email: "oksana@example.com", password: "long-enough" })).status).toBe(409);
    expect((await call("POST", "/auth/register", { email: "x@y.z", password: "short" })).json.error).toBe("short_password");
    expect((await call("POST", "/auth/login", { email: "oksana@example.com", password: "nope-nope" })).status).toBe(401);
    const login = await call("POST", "/auth/login", { email: "oksana@example.com", password: "long-enough" });
    expect(login.status).toBe(200);
    expect((await call("GET", "/me", undefined, login.json.token)).json.user.email).toBe("oksana@example.com");
    expect((await call("GET", "/me")).status).toBe(401);
  });

  it("syncs changes between two devices and refuses a conflicting one", async () => {
    const call = setup();
    const { token } = (await call("POST", "/auth/register", { email: "a@b.cd", password: "password1" })).json;
    const ws = (await call("POST", "/workspaces", { name: "Мої", data: { tables: [table] } }, token)).json;
    const row = { id: "r_1", createdAt: 2, values: { c_1: 85 } };
    const push = await call("POST", `/workspaces/${ws.id}/ops`, { client: "phone", ops: [{ type: "rows.insert", tableId: "t_1", rows: [row] }] }, token);
    expect(push.json.version).toBe(1);
    // The laptop asks what changed since version 0.
    const pulled = await call("GET", `/workspaces/${ws.id}/changes?since=0`, undefined, token);
    expect(pulled.json.changes).toHaveLength(1);
    expect(pulled.json.changes[0].client).toBe("phone");
    // Deleting a row that is already gone is a conflict: the device gets the shared copy back.
    await call("POST", `/workspaces/${ws.id}/ops`, { client: "phone", ops: [{ type: "rows.delete", tableId: "t_1", rowIds: ["r_1"] }] }, token);
    const clash = await call("POST", `/workspaces/${ws.id}/ops`, { client: "laptop", ops: [{ type: "cells.set", tableId: "t_1", cells: [{ rowId: "r_1", columnId: "c_1", value: 90 }] }] }, token);
    expect(clash.status).toBe(409);
    expect(clash.json.data.tables[0].rows).toEqual([]);
  });

  it("invites a teammate as a viewer who can read but not change", async () => {
    const call = setup();
    const owner = (await call("POST", "/auth/register", { email: "sam@clean.es", password: "password1" })).json.token;
    const ws = (await call("POST", "/workspaces", { name: "Team", data: { tables: [table] } }, owner)).json;
    const invite = (await call("POST", `/workspaces/${ws.id}/invites`, { role: "viewer" }, owner)).json;
    const lucia = (await call("POST", "/auth/register", { email: "lucia@clean.es", password: "password1" })).json.token;
    expect((await call("GET", `/workspaces/${ws.id}`, undefined, lucia)).status).toBe(404);
    expect((await call("POST", `/invites/${invite.token}`, undefined, lucia)).json.workspaceId).toBe(ws.id);
    const seen = await call("GET", `/workspaces/${ws.id}`, undefined, lucia);
    expect(seen.json.role).toBe("viewer");
    expect(seen.json.data.tables[0].name).toBe("Витрати");
    const write = await call("POST", `/workspaces/${ws.id}/ops`, { client: "x", ops: [{ type: "table.update", tableId: "t_1", patch: { name: "Hack" } }] }, lucia);
    expect(write.status).toBe(403);
    // Only the owner invites; the viewer can't.
    expect((await call("POST", `/workspaces/${ws.id}/invites`, { role: "editor" }, lucia)).status).toBe(403);
    const members = (await call("GET", `/workspaces/${ws.id}/members`, undefined, owner)).json.members;
    expect(members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`).sort()).toEqual(["lucia@clean.es:viewer", "sam@clean.es:owner"]);
  });
});
