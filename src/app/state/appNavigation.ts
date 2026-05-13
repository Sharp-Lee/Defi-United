import { appModules, type AppModuleDefinition, type AppModuleId } from "../shell/navigation";

export function getDefaultModuleId(): AppModuleId {
  return "dashboard";
}

export function getModuleById(id: string): AppModuleDefinition {
  return appModules.find((module) => module.id === id) ?? appModules[0];
}
