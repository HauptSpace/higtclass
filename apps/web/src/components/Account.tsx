import { useEffect, useState } from "react";
import { cloud, CloudError, openWorkspace, uploadWorkspace, type WorkspaceInfo } from "../cloud.ts";
import { useT } from "../i18n/index.ts";
import { useStore, type Role } from "../store.ts";
import { Button, Chips, Dialog, inputClass, Label } from "./ui.tsx";

// Signing in turns "saved on this device" into "on all your devices", and
// lets you share a workspace with people as editors or viewers.

const INVITE = /[#&]invite=([\w-]+)/;

/** An invite link opened in the browser: "…/#invite=abc". */
export function pendingInvite(): string | null {
  return location.hash.match(INVITE)?.[1] ?? null;
}

function clearInvite() {
  history.replaceState(null, "", location.pathname + location.search);
}

async function joinInvite(token: string) {
  const { workspaceId } = await cloud.accept(token);
  clearInvite();
  await openWorkspace(workspaceId);
}

export function AccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const hasTables = useStore((s) => s.ws.tables.length > 0);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed in, with tables both here and in the cloud: which to keep?
  const [choice, setChoice] = useState<WorkspaceInfo[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setChoice(null);
  }, [open]);

  const finish = async (list: WorkspaceInfo[]) => {
    const invite = pendingInvite();
    if (invite) {
      await joinInvite(invite);
      return onClose();
    }
    if (!list.length) {
      await uploadWorkspace(t("cloud.defaultName"));
      return onClose();
    }
    if (!hasTables) {
      await openWorkspace(list[0].id);
      return onClose();
    }
    setChoice(list);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = mode === "login" ? await cloud.login(email, password) : await cloud.register(email, password, name);
      useStore.setState({ account: { token: res.token, user: res.user } });
      await finish(res.workspaces);
    } catch (e) {
      setError(e instanceof CloudError ? e.code : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={choice ? t("cloud.choiceTitle") : t("cloud.title")}>
      {choice ? (
        <div className="space-y-3">
          <p className="text-ink-2">{t("cloud.choiceHint")}</p>
          <Button
            variant="primary"
            className="w-full"
            onClick={async () => {
              await uploadWorkspace(t("cloud.defaultName"));
              onClose();
            }}
          >
            {t("cloud.keepHere")}
          </Button>
          {choice.map((w) => (
            <Button
              key={w.id}
              variant="outline"
              className="w-full"
              onClick={async () => {
                await openWorkspace(w.id);
                onClose();
              }}
            >
              {t("cloud.openThere", { name: w.name })}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-ink-2">{pendingInvite() ? t("cloud.inviteHint") : t("cloud.hint")}</p>
          <Chips value={mode} options={["register", "login"]} label={(m) => t(`cloud.${m}`)} onPick={setMode} />
          {mode === "register" && (
            <Label text={t("cloud.name")}>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Label>
          )}
          <Label text={t("cloud.email")}>
            <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Label>
          <Label text={t("cloud.password")} hint={mode === "register" ? t("cloud.passwordHint") : undefined}>
            <input
              className={inputClass}
              type="password"
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </Label>
          {error && (
            <p role="alert" className="font-semibold text-late">
              {t(`cloud.err.${error}` as "cloud.err.error")}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password}>
            {busy ? "…" : t(`cloud.${mode}`)}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

const SYNC_TEXT = { off: "cloud.sync.off", idle: "cloud.sync.idle", saving: "cloud.sync.saving", offline: "cloud.sync.offline", error: "cloud.sync.error" } as const;

/** Bottom of the sidebar: who you are, whether everything is saved, sharing. */
export function AccountBox({ onSignIn, onShare }: { onSignIn: () => void; onShare: () => void }) {
  const t = useT();
  const account = useStore((s) => s.account);
  const link = useStore((s) => s.cloud);
  const sync = useStore((s) => s.sync);
  const pending = useStore((s) => s.pending.length);
  const [list, setList] = useState<WorkspaceInfo[] | null>(null);

  if (!account) {
    return (
      <div className="space-y-2 px-2">
        <p className="text-xs text-rail-dim">{t("sidebar.saved")}</p>
        <button type="button" onClick={onSignIn} className="w-full rounded-xl bg-white px-3 py-2 text-sm font-bold text-black hover:opacity-90">
          {t("cloud.cta")}
        </button>
      </div>
    );
  }
  const state = sync === "idle" && pending ? "saving" : sync;
  return (
    <div className="space-y-2 px-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${state === "idle" ? "bg-paid" : state === "saving" ? "bg-wait" : state === "off" ? "bg-rail-dim" : "bg-late"}`}
          aria-hidden="true"
        />
        <span className="text-rail-dim">{t(SYNC_TEXT[state])}</span>
      </div>
      <button
        type="button"
        className="w-full truncate text-left font-semibold text-rail-text hover:underline"
        onClick={async () => setList(list ? null : (await cloud.me().catch(() => ({ workspaces: [] as WorkspaceInfo[] }))).workspaces)}
        aria-expanded={!!list}
      >
        {link?.name ?? "—"} <span className="text-rail-dim">· {account.user.email}</span>
      </button>
      {list && (
        <ul className="space-y-0.5 rounded-lg border border-white/15 p-1">
          {list.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={`w-full truncate rounded px-2 py-1 text-left hover:bg-white/10 ${w.id === link?.id ? "font-bold" : ""}`}
                onClick={async () => {
                  setList(null);
                  if (w.id !== link?.id) await openWorkspace(w.id);
                }}
              >
                {w.name} <span className="text-rail-dim">· {t(`cloud.role.${w.role}`)}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-rail-dim hover:bg-white/10 hover:text-rail-text"
              onClick={() => {
                cloud.logout().catch(() => undefined);
                useStore.setState({ account: null, cloud: null, pending: [], sync: "off" });
                setList(null);
              }}
            >
              {t("cloud.logout")}
            </button>
          </li>
        </ul>
      )}
      {link && link.role === "owner" && (
        <button type="button" onClick={onShare} className="w-full rounded-xl border border-white/30 px-3 py-1.5 font-bold text-rail-text hover:bg-white/10">
          {t("cloud.share")}
        </button>
      )}
    </div>
  );
}

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const link = useStore((s) => s.cloud);
  const me = useStore((s) => s.account?.user.id);
  const showToast = useStore((s) => s.showToast);
  const [members, setMembers] = useState<{ id: string; email: string; name: string; role: Role }[]>([]);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [url, setUrl] = useState("");

  const load = async () => {
    if (link) setMembers((await cloud.members(link.id).catch(() => ({ members: [] }))).members);
  };
  useEffect(() => {
    if (!open) return;
    setUrl("");
    void load();
  }, [open, link?.id]);

  if (!link) return null;
  return (
    <Dialog open={open} onClose={onClose} title={t("cloud.share")}>
      <div className="space-y-5">
        <p className="text-ink-2">{t("cloud.shareHint")}</p>
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("cloud.inviteAs")}</div>
          <Chips value={role} options={["editor", "viewer"]} label={(r) => t(`cloud.role.${r}`)} onPick={(r) => (setRole(r), setUrl(""))} />
        </div>
        {url ? (
          <div className="flex gap-2">
            <input className={`${inputClass} text-sm`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="primary"
              onClick={async () => {
                await navigator.clipboard?.writeText(url).catch(() => undefined);
                showToast(t("cloud.copied"), false);
              }}
            >
              {t("cloud.copy")}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              const res = await cloud.invite(link.id, role);
              setUrl(`${location.origin}${location.pathname}#invite=${res.token}`);
            }}
          >
            {t("cloud.makeLink")}
          </Button>
        )}
        <section className="border-t-2 border-rule pt-3">
          <h3 className="font-extrabold">{t("cloud.members")}</h3>
          <ul className="mt-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line py-2">
                <span className="min-w-0 truncate">
                  <b>{m.name || m.email}</b> {m.name && <span className="text-sm text-ink-2">{m.email}</span>}
                </span>
                {m.role === "owner" || m.id === me ? (
                  <span className="text-sm text-ink-2">{t(`cloud.role.${m.role}`)}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <select
                      className="rounded-lg border-2 border-line bg-paper px-2 py-1 text-sm"
                      value={m.role}
                      onChange={async (e) => {
                        await cloud.setRole(link.id, m.id, e.target.value as "editor" | "viewer");
                        void load();
                      }}
                    >
                      <option value="editor">{t("cloud.role.editor")}</option>
                      <option value="viewer">{t("cloud.role.viewer")}</option>
                    </select>
                    <button
                      type="button"
                      className="text-sm font-semibold text-late"
                      onClick={async () => {
                        await cloud.remove(link.id, m.id);
                        void load();
                      }}
                    >
                      {t("cloud.removeMember")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

/** Opening an invite link: join right away when signed in, else ask to sign in first. */
export function useInviteLink(onNeedSignIn: () => void) {
  const account = useStore((s) => s.account);
  const hydrated = useStore((s) => s.hydrated);
  const showToast = useStore((s) => s.showToast);
  const t = useT();
  useEffect(() => {
    if (!hydrated) return;
    const token = pendingInvite();
    if (!token) return;
    if (!account) return onNeedSignIn();
    joinInvite(token)
      .then(() => showToast(t("cloud.joined"), false))
      .catch(() => {
        clearInvite();
        showToast(t("cloud.err.invite_expired"), false);
      });
  }, [hydrated, account?.token]);
}
