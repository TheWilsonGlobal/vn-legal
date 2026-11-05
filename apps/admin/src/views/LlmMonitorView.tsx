import { LlmOverviewCards } from "../components/llm/LlmOverviewCards.tsx";
import { LlmPromptLogsPanel } from "../components/llm/LlmPromptLogsPanel.tsx";
import { LlmDiagnosticPanel } from "../components/llm/LlmDiagnosticPanel.tsx";

interface LlmMonitorViewProps {
  fetchLlmDetails: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmStatus: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmLog: any;
  endpointEditing: boolean;
  setEndpointEditing: (editing: boolean) => void;
  endpointDraft: string;
  setEndpointDraft: (draft: string) => void;
  endpointSaving: boolean;
  handleSaveEndpoint: () => Promise<void>;
  endpointError: string | null;
  setEndpointError: (error: string | null) => void;
  endpointNotice: string | null;
  setEndpointNotice: (notice: string | null) => void;
  diagPrompt: string;
  setDiagPrompt: (prompt: string) => void;
  diagLoading: boolean;
  handleRunDiagnostic: () => Promise<void>;
  diagResponse: string | null;
  diagDuration: number | null;
  diagError: string | null;
}

export function LlmMonitorView({
  fetchLlmDetails,
  llmStatus,
  llmLog,
  endpointEditing,
  setEndpointEditing,
  endpointDraft,
  setEndpointDraft,
  endpointSaving,
  handleSaveEndpoint,
  endpointError,
  setEndpointError,
  endpointNotice,
  setEndpointNotice,
  diagPrompt,
  setDiagPrompt,
  diagLoading,
  handleRunDiagnostic,
  diagResponse,
  diagDuration,
  diagError,
}: LlmMonitorViewProps) {
  return (
    <div className="view-section" key="llm">
      <div className="view-header">
        <h2>Giám sát mô hình ngôn ngữ lớn (LLM Monitor)</h2>
        <button className="btn-primary" onClick={fetchLlmDetails}>
          <i className="fas fa-sync-alt"></i> Tải lại
        </button>
      </div>

      <LlmOverviewCards
        llmStatus={llmStatus}
        endpointEditing={endpointEditing}
        setEndpointEditing={setEndpointEditing}
        endpointDraft={endpointDraft}
        setEndpointDraft={setEndpointDraft}
        endpointSaving={endpointSaving}
        handleSaveEndpoint={handleSaveEndpoint}
        endpointError={endpointError}
        setEndpointError={setEndpointError}
        endpointNotice={endpointNotice}
        setEndpointNotice={setEndpointNotice}
      />

      <div
        className="grid-2-1"
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "20px",
          marginTop: "20px",
        }}
      >
        <LlmPromptLogsPanel llmLog={llmLog} />
        <LlmDiagnosticPanel
          diagPrompt={diagPrompt}
          setDiagPrompt={setDiagPrompt}
          diagLoading={diagLoading}
          handleRunDiagnostic={handleRunDiagnostic}
          diagResponse={diagResponse}
          diagDuration={diagDuration}
          diagError={diagError}
        />
      </div>
    </div>
  );
}
