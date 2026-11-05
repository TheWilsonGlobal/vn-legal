import { useState, useEffect } from "react";

export function useLlmMonitor(activeView: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [llmStatus, setLlmStatus] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [llmLog, setLlmLog] = useState<any>(null);
  const [diagPrompt, setDiagPrompt] = useState(
    "Kiểm tra kết nối LLM. Trả lời ngắn gọn: 'Kết nối OK'.",
  );
  const [diagResponse, setDiagResponse] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagDuration, setDiagDuration] = useState<number | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Endpoint editor states
  const [endpointDraft, setEndpointDraft] = useState("");
  const [endpointEditing, setEndpointEditing] = useState(false);
  const [endpointSaving, setEndpointSaving] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointNotice, setEndpointNotice] = useState<string | null>(null);

  const fetchLlmDetails = async () => {
    try {
      const statusRes = await fetch("/api/admin/llm/status");
      const statusData = await statusRes.json();
      setLlmStatus(statusData);

      const logRes = await fetch("/api/admin/llm/last-prompt");
      const logData = await logRes.json();
      setLlmLog(logData);
    } catch (err) {
      console.error("Failed to fetch LLM details:", err);
    }
  };

  const handleSaveEndpoint = async () => {
    setEndpointSaving(true);
    setEndpointError(null);
    setEndpointNotice(null);
    try {
      const res = await fetch("/api/admin/llm/endpoint", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl: endpointDraft }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setEndpointError(data.error || "Không cập nhật được endpoint.");
        return;
      }
      setEndpointNotice(data.message);
      setEndpointEditing(false);
      await fetchLlmDetails();
    } catch (err) {
      setEndpointError((err as Error).message || String(err));
    } finally {
      setEndpointSaving(false);
    }
  };

  useEffect(() => {
    if (activeView === "llm") {
      fetchLlmDetails();
      // Pause polling while the endpoint is being edited so a refresh can't
      // clobber what is being typed.
      if (endpointEditing) return;
      const interval = setInterval(fetchLlmDetails, 5000);
      return () => clearInterval(interval);
    }
  }, [activeView, endpointEditing]);

  const handleRunDiagnostic = async () => {
    setDiagLoading(true);
    setDiagResponse(null);
    setDiagDuration(null);
    setDiagError(null);
    try {
      const res = await fetch("/api/admin/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: diagPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        setDiagResponse(data.response);
        setDiagDuration(data.duration_ms);
        fetchLlmDetails(); // Refresh logs
      } else {
        setDiagError(data.error || "Lỗi không xác định");
      }
    } catch (err) {
      setDiagError((err as Error).message || String(err));
    } finally {
      setDiagLoading(false);
    }
  };

  return {
    llmStatus,
    llmLog,
    diagPrompt,
    setDiagPrompt,
    diagResponse,
    diagLoading,
    diagDuration,
    diagError,
    endpointDraft,
    setEndpointDraft,
    endpointEditing,
    setEndpointEditing,
    endpointSaving,
    endpointError,
    setEndpointError,
    endpointNotice,
    setEndpointNotice,
    fetchLlmDetails,
    handleSaveEndpoint,
    handleRunDiagnostic,
  };
}
