import type { ReactNode } from "react";
import type { AppSessionSummary } from "../state/appSession";
import { AppNavigation } from "./AppNavigation";
import { AppPreviewRail } from "./AppPreviewRail";
import { AppTopBar } from "./AppTopBar";
import { AppWorkspace } from "./AppWorkspace";
import type { AppModuleId } from "./navigation";

export function AppShell({
  accountsContent,
  activeModuleId,
  assetsContent,
  onSelectModule,
  sessionSummary,
  settingsContent,
}: {
  accountsContent: ReactNode;
  activeModuleId: AppModuleId;
  assetsContent: ReactNode;
  onSelectModule(moduleId: AppModuleId): void;
  sessionSummary: AppSessionSummary;
  settingsContent: ReactNode;
}) {
  return (
    <main className="pwa-shell app-shell">
      <AppNavigation activeModuleId={activeModuleId} onSelectModule={onSelectModule} />
      <section className="app-shell-workbench pwa-panel" aria-label="主工作区">
        <AppTopBar sessionSummary={sessionSummary} />
        <AppWorkspace
          accountsContent={accountsContent}
          activeModuleId={activeModuleId}
          assetsContent={assetsContent}
          settingsContent={settingsContent}
        />
      </section>
      <AppPreviewRail />
    </main>
  );
}
