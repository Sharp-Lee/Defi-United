import { StatusBadge } from "../../shared/ui/StatusBadge";
import type { AppModuleId } from "./navigation";
import { appModules } from "./navigation";

export function AppNavigation({
  activeModuleId,
  onSelectModule,
}: {
  activeModuleId: AppModuleId;
  onSelectModule(moduleId: AppModuleId): void;
}) {
  return (
    <aside className="pwa-panel app-navigation" aria-label="钱包工作台侧栏">
      <div className="app-navigation-brand">
        <strong>DeFi United</strong>
        <span>PWA 控制台</span>
      </div>

      <nav className="pwa-nav" aria-label="钱包工作台主导航">
        {appModules.map((module) => (
          <div key={module.id} className="app-nav-entry">
            <button
              type="button"
              className={module.id === activeModuleId ? "pwa-nav-item pwa-nav-item-active" : "pwa-nav-item"}
              aria-current={module.id === activeModuleId ? "page" : undefined}
              onClick={() => onSelectModule(module.id)}
            >
              <span>{module.label}</span>
            </button>
            <StatusBadge tone={module.status === "ready" ? "success" : "neutral"}>
              {module.status === "ready" ? "可用" : "规划"}
            </StatusBadge>
          </div>
        ))}
      </nav>
    </aside>
  );
}
