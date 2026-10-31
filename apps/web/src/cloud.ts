import type { Op, Workspace } from "@higtclass/core";
import { useEffect } from "react";
import { useStore, type Account, type CloudLink, type Role } from "./store.ts";

// Talking to the Zifra server: sign in, keep this device's tables in the
// shared copy, and bring in what other devices and teammates changed.
// The app keeps working offline; changes wait in `pending` until the server
// confirms them.

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class CloudError extends Error {
  code: string;
  status: number;
  data?: unknown;
  constructor(code: string, status: number, data?: unknown) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

async function call<T>(method: string, path: string, body?: unknown, token = useStore.getState().account?.token): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CloudError("offline", 0);
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new CloudError(json?.error ?? (res.status >= 500 ? "offline" : "error"), res.status, json);
  return json;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  version: number;
  role: Role;
}

export const cloud = {
  register: (email: string, password: string, name: string) =>
    call<{ token: string; user: Account["user"]; workspaces: WorkspaceInfo[] }>("POST", "/auth/register", { email, password, name }, ""),
  login: (email: string, password: string) => call<{ token: string; user: Account["user"]; workspaces: WorkspaceInfo[] }>("POST", "/auth/login", { email, password }, ""),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
  me: () => call<{ user: Account["user"]; workspaces: WorkspaceInfo[] }>("GET", "/me"),
  create: (name: string, data: Workspace) => call<{ id: string; version: number; role: Role }>("POST", "/workspaces", { name, data }),
  open: (id: string) => call<WorkspaceInfo & { data: Workspace }>("GET", `/workspaces/${id}`),
  rename: (id: string, name: string) => call<{ ok: true }>("PATCH", `/workspaces/${id}`, { name }),
  push: (id: string, client: string, ops: Op[]) => call<{ version: number }>("POST", `/workspaces/${id}/ops`, { client, ops }),
  changes: (id: string, since: number) =>
    call<{ version: number; changes?: { version: number; client: string; op: Op }[]; data?: Workspace }>("GET", `/workspaces/${id}/changes?since=${since}`),
  members: (id: string) => call<{ members: { id: string; email: string; name: string; role: Role }[] }>("GET", `/workspaces/${id}/members`),
  invite: (id: string, role: "editor" | "viewer") => call<{ token: string; role: Role }>("POST", `/workspaces/${id}/invites`, { role }),
  accept: (token: string) => call<{ workspaceId: string }>("POST", `/invites/${token}`),
  setRole: (id: string, userId: string, role: "editor" | "viewer") => call<{ ok: true }>("PATCH", `/workspaces/${id}/members/${userId}`, { role }),
  remove: (id: string, userId: string) => call<{ ok: true }>("DELETE", `/workspaces/${id}/members/${userId}`),
};

/** Open a shared workspace on this device (its copy replaces what is shown). */
export async function openWorkspace(id: string) {
  const ws = await cloud.open(id);
  const link: CloudLink = { id: ws.id, name: ws.name, version: ws.version, role: ws.role };
  useStore.getState().takeCloudCopy(link, ws.data);
  return link;
}

/** Put the tables on this device into a new shared workspace and link to it. */
export async function uploadWorkspace(name: string) {
  const { ws } = useStore.getState();
  const created = await cloud.create(name, ws);
  useStore.setState({ cloud: { id: created.id, name, version: created.version, role: created.role }, pending: [] });
}

let running = false;

/** One round: send what's waiting, then fetch what others changed. */
export async function syncOnce() {
  const state = useStore.getState();
  const { account, cloud: link, clientId } = state;
  if (!account || !link || running) return;
  running = true;
  try {
    // A copy that went out of step (a change that didn't apply) is reloaded whole.
    if (link.version < 0) {
      await openWorkspace(link.id);
      useStore.setState({ sync: "idle" });
      return;
    }
    const pending = useStore.getState().pending;
    if (pending.length) {
      useStore.setState({ sync: "saving" });
      const batch = pending.slice(0, 200);
      try {
        await cloud.push(link.id, clientId, batch);
        useStore.setState((s) => ({ pending: s.pending.slice(batch.length) }));
      } catch (e) {
        if (e instanceof CloudError && e.status === 409 && e.data) {
          // Someone changed the same thing first: show the shared version.
          const d = e.data as { version: number; data: Workspace };
          useStore.getState().takeCloudCopy({ ...link, version: d.version }, d.data);
          useStore.getState().showToast(conflictText(useStore.getState().settings.locale), false);
          useStore.setState({ sync: "idle" });
          return;
        }
        throw e;
      }
    }
    // Bring in everything since the last version this device has, skipping its own changes.
    const since = useStore.getState().cloud?.version ?? link.version;
    const res = await cloud.changes(link.id, since);
    const current = useStore.getState().cloud;
    if (!current || current.id !== link.id) return;
    if (res.data) {
      if (!useStore.getState().pending.length) useStore.getState().takeCloudCopy({ ...current, version: res.version }, res.data);
    } else {
      const theirs = (res.changes ?? []).filter((c) => c.client !== clientId).map((c) => c.op);
      useStore.getState().applyRemote(theirs, res.version);
    }
    useStore.setState({ sync: "idle" });
  } catch (e) {
    if (e instanceof CloudError && e.status === 401) {
      // Signed out elsewhere (or the session expired): keep the tables, stop syncing.
      useStore.setState({ account: null, sync: "off" });
    } else {
      useStore.setState({ sync: e instanceof CloudError && e.code === "offline" ? "offline" : "error" });
    }
  } finally {
    running = false;
  }
}

/** Keep syncing while the app is open: soon after a change, every few seconds, and on coming back online. */
export function useCloudSync() {
  const account = useStore((s) => s.account);
  const link = useStore((s) => s.cloud);
  const pending = useStore((s) => s.pending.length);
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated || !account || !link) {
      useStore.setState({ sync: "off" });
      return;
    }
    void syncOnce();
    const id = setInterval(() => void syncOnce(), 8000);
    const wake = () => void syncOnce();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [hydrated, account?.token, link?.id]);
  // A change made here goes out within a second.
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => void syncOnce(), 700);
    return () => clearTimeout(id);
  }, [pending]);
}

const CONFLICT: Record<string, string> = {
  ru: "Кто-то изменил то же самое раньше — показываем общую версию.",
  uk: "Хтось змінив те саме раніше — показуємо спільну версію.",
  en: "Someone changed the same thing first — showing the shared version.",
  de: "Jemand hat dasselbe zuerst geändert — die gemeinsame Version wird angezeigt.",
  es: "Alguien cambió lo mismo antes: mostramos la versión compartida.",
};
const conflictText = (l: string) => CONFLICT[l] ?? CONFLICT.en;

/** Keep today's exchange rates for the workspace currency (refreshed twice a day, when online). */
export function useExchangeRates() {
  const currency = useStore((s) => s.settings.currency);
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    const have = useStore.getState().exchange;
    if (have && have.base === currency && Date.now() - have.fetched < 12 * 3600_000) return;
    fetch(`${API}/api/rates?base=${currency}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { base: string; date: string; source: string; rates: Record<string, number> } | null) => {
        if (r?.rates && r.base === currency) useStore.setState({ exchange: { ...r, fetched: Date.now() } });
      })
      .catch(() => {
        /* offline: amounts in another currency are refused with a clear message */
      });
  }, [hydrated, currency]);
}
