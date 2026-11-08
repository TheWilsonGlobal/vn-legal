import type { AgentInfo, ConsultContext } from "./agent";

/** Ids of the five workbench views; also the folder name under src/views/. */
export type ViewId =
  | "assistant"
  | "sessions"
  | "traces"
  | "settings";

/** State of the C9 request, shared by the topbar, sidebar and Settings view. */
export type InfoState =
  | { status: "loading" }
  | { status: "ready"; info: AgentInfo }
  | { status: "error"; message: string };

/**
 * Props App passes to EVERY view. A view file must
 * `export default function XxxView(props: ViewProps)`; unused props are fine.
 *
 * - active: true while this view is the visible one. All registered views stay
 *   mounted (hidden) so Assistant keeps its in-flight stream when the user
 *   switches tabs; do not poll or fetch repeatedly while `active` is false.
 * - sessionId / setSessionId: the selected session (null = none yet; the
 *   server creates one on the first C1 call (`session` event) or via C3).
 * - lastContext / setLastContext: retrieval context of the latest `done`
 *   event. Assistant calls setLastContext; Knowledge Explorer reads it.
 * - traceSessionFilter / setTraceSessionFilter: session_id Execution Traces
 *   is filtered on (set by Session Manager "Xem vết" via openTraces()).
 * - openTraces(id): sets the trace filter and navigates to "traces".
 * - openSession(id): sets sessionId and navigates to "assistant".
 * - navigate: switch the active view.
 * - info: C9 state. A failure arrives as `{status:"error"}`; views must show it.
 * - refreshInfo: re-fetch C9 (e.g. after a run, to refresh the status dot).
 */
export interface ViewProps {
  active: boolean;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  lastContext: ConsultContext | null;
  setLastContext: (ctx: ConsultContext | null) => void;
  traceSessionFilter: string | null;
  setTraceSessionFilter: (id: string | null) => void;
  openTraces: (sessionId: string | null) => void;
  openSession: (sessionId: string) => void;
  navigate: (view: ViewId) => void;
  info: InfoState;
  refreshInfo: () => void;
  setHierarchyControls?: (
    controls: {
      expandAll: () => void;
      collapseAll: () => void;
      turnCount: number;
    } | null,
  ) => void;
  refreshSessions?: () => void;
}
