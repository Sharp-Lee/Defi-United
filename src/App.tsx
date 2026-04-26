import { AppShell } from "./app/AppShell";

export function App() {
  // The workbench shell is the active runtime entry. Older donor-flow modules in
  // src/components, src/state, and src/wallet are frozen legacy code until they
  // are migrated into the new shell or removed in later tasks.
  return <AppShell session={{ status: "locked" }} />;
}
