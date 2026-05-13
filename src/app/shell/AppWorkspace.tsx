import type { ReactNode } from "react";
import { getModuleById } from "../state/appNavigation";
import { ModulePlaceholder } from "./ModulePlaceholder";
import type { AppModuleId } from "./navigation";

export function AppWorkspace({
  accountsContent,
  activeModuleId,
  assetsContent,
  settingsContent,
}: {
  accountsContent: ReactNode;
  activeModuleId: AppModuleId;
  assetsContent: ReactNode;
  settingsContent: ReactNode;
}) {
  if (activeModuleId === "accounts") return <>{accountsContent}</>;
  if (activeModuleId === "assets") return <>{assetsContent}</>;
  if (activeModuleId === "settings") return <>{settingsContent}</>;

  return <ModulePlaceholder module={getModuleById(activeModuleId)} />;
}
