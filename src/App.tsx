import { AppShell } from "./app/AppShell";

export function App() {
  return <AppShell session={{ status: "locked" }} />;
}
