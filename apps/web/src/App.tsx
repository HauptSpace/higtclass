import { setRegion } from "@sumira/core";
import { useEffect, useState } from "react";
import { AccountDialog, ShareDialog, useInviteLink } from "./components/Account.tsx";
import { ForYouView, useRulesSync } from "./components/ForYou.tsx";
import { useCloudSync, useExchangeRates } from "./cloud.ts";
import { ImportDialog } from "./components/ImportDialog.tsx";
import { NewTableDialog } from "./components/NewTableDialog.tsx";
import { ReportDialog, ReportView } from "./components/Reports.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Sidebar, Wordmark } from "./components/Sidebar.tsx";
import { TableView } from "./components/TableView.tsx";
import { Toast } from "./components/Toast.tsx";
import { useT } from "./i18n/index.ts";
import { isTyping } from "./lib.ts";
import { useActiveTable, useStore, type AppSettings } from "./store.ts";

/** Black or white text on top of a given accent colour. */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

function useAppearance(settings: AppSettings) {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && mq.matches);
      root.dataset.theme = dark ? "dark" : "light";
      if (settings.accent) {
        root.style.setProperty("--accent", settings.accent);
        root.style.setProperty("--on-accent", readableOn(settings.accent));
      } else {
        root.style.removeProperty("--accent");
        root.style.removeProperty("--on-accent");
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme, settings.accent]);

  useEffect(() => {
    document.documentElement.lang = settings.locale;
  }, [settings.locale]);
}

export function App() {
  const t = useT();
  const table = useActiveTable();
  const settings = useStore((s) => s.settings);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const [newTable, setNewTable] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newReport, setNewReport] = useState(false);
  const report = useStore((s) => s.ws.reports?.find((r) => r.id === s.activeReportId) ?? null);
  const page = useStore((s) => s.page);
  const hydrated = useStore((s) => s.hydrated);
  // Formats follow the browser's region (en-GB → 30/10/2026); set before rendering anything.
  setRegion(settings.region);
  useRulesSync();
  useCloudSync();
  useExchangeRates();
  const [signIn, setSignIn] = useState(false);
  const [share, setShare] = useState(false);
  useInviteLink(() => setSignIn(true));
  const sidebarProps = {
    onSignIn: () => {
      setDrawer(false);
      setSignIn(true);
    },
    onShare: () => {
      setDrawer(false);
      setShare(true);
    },
    onNewTable: () => {
      setDrawer(false);
      setNewTable(true);
    },
    onImport: () => {
      setDrawer(false);
      setImporting(true);
    },
    onNewReport: () => {
      setDrawer(false);
      setNewReport(true);
    },
  };
  const [drawer, setDrawer] = useState(false);
  useAppearance(settings);

  // Ctrl/Cmd+Z everywhere except while typing (the field's own undo wins there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Nothing until saved data is read: no flash of the welcome screen for returning people.
  if (!hydrated) return <div className="h-dvh bg-paper" aria-busy="true" />;

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-64 shrink-0 md:block">
        <Sidebar {...sidebarProps} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <Sidebar {...sidebarProps} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4 md:hidden">
          <Wordmark className="text-2xl" />
          <button type="button" className="rounded-lg px-2 py-1 text-2xl" onClick={() => setDrawer(true)} aria-label={t("common.menu")}>
            ☰
          </button>
        </div>
        {page === "foryou" ? (
          <ForYouView />
        ) : report ? (
          <ReportView key={report.id} report={report} />
        ) : table ? (
          <TableView key={table.id} table={table} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-10 md:py-14">
              <Onboarding />
            </div>
          </div>
        )}
      </main>

      <NewTableDialog open={newTable} onClose={() => setNewTable(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <ReportDialog open={newReport} onClose={() => setNewReport(false)} reportId={null} />
      <AccountDialog open={signIn} onClose={() => setSignIn(false)} />
      <ShareDialog open={share} onClose={() => setShare(false)} />
      <Toast />
    </div>
  );
}
