/// <reference types="vite/client" />
import type { ComponentType } from "react";
import type { ViewId, ViewProps } from "../types/views";

/**
 * Nav entries (Vietnamese labels, plan §7). Order = sidebar order.
 */
export const VIEWS: readonly { id: ViewId; label: string; icon: string }[] = [
  { id: "assistant", label: "Trợ lý", icon: "💬" },
  { id: "sessions", label: "Quản lý phiên", icon: "🗂️" },
  { id: "traces", label: "Vết thực thi", icon: "🛡️" },
  { id: "settings", label: "Cài đặt", icon: "⚙️" },
];

/**
 * View discovery. A view is registered by creating exactly this file, whose
 * default export is a React component taking `ViewProps` (types/views.ts):
 *
 *   src/views/assistant/AssistantView.tsx
 *   src/views/sessions/SessionManagerView.tsx
 *   src/views/traces/ExecutionTracesView.tsx
 *   src/views/settings/SettingsView.tsx
 *
 * No edit to App.tsx or this file is needed. Other files in those folders
 * (TurnView.tsx, ...) are ignored because only the exact path above is read.
 */
const FILE_FOR_VIEW: Record<ViewId, string> = {
  assistant: "../views/assistant/AssistantView.tsx",
  sessions: "../views/sessions/SessionManagerView.tsx",
  traces: "../views/traces/ExecutionTracesView.tsx",
  settings: "../views/settings/SettingsView.tsx",
};

const modules = import.meta.glob<{ default?: unknown }>(
  [
    "../views/assistant/AssistantView.tsx",
    "../views/sessions/SessionManagerView.tsx",
    "../views/traces/ExecutionTracesView.tsx",
    "../views/settings/SettingsView.tsx",
  ],
  { eager: true },
);

/** Functions plus memo/forwardRef/lazy exports (objects with $$typeof). */
function isComponent(value: unknown): boolean {
  if (typeof value === "function") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    typeof (value as { $$typeof: unknown }).$$typeof === "symbol"
  );
}

export type ViewEntry =
  | { status: "ready"; Component: ComponentType<ViewProps> }
  | { status: "missing"; file: string }
  | { status: "invalid"; file: string };

export function resolveView(id: ViewId): ViewEntry {
  const file = FILE_FOR_VIEW[id];
  const mod = modules[file];
  if (!mod) return { status: "missing", file };
  if (!isComponent(mod.default)) return { status: "invalid", file };
  return {
    status: "ready",
    Component: mod.default as ComponentType<ViewProps>,
  };
}
