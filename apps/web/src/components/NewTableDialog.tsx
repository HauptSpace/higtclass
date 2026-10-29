import { useT } from "../i18n/index.ts";
import { Onboarding } from "./Onboarding.tsx";
import { Dialog } from "./ui.tsx";

export function NewTableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("newTable.title")} wide>
      <Onboarding compact onDone={onClose} />
    </Dialog>
  );
}
