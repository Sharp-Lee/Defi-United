import type { ReactNode } from "react";
import { getModuleById } from "../state/appNavigation";
import { ModulePlaceholder } from "./ModulePlaceholder";
import type { AppModuleId } from "./navigation";

export function AppWorkspace({
  accountsContent,
  activeModuleId,
  assetsContent,
  queueContent,
  settingsContent,
}: {
  accountsContent: ReactNode;
  activeModuleId: AppModuleId;
  assetsContent: ReactNode;
  queueContent: ReactNode;
  settingsContent: ReactNode;
}) {
  if (activeModuleId === "accounts") return <>{accountsContent}</>;
  if (activeModuleId === "assets") return <>{assetsContent}</>;
  if (activeModuleId === "queueHistory") return <>{queueContent}</>;
  if (activeModuleId === "settings") return <>{settingsContent}</>;

  return <ModulePlaceholder module={getModuleById(activeModuleId)} />;
}
