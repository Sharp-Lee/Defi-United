import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderScreen(ui: ReactElement) {
  return render(ui);
}
