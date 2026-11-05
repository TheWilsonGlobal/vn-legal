import { useState, useEffect } from "react";
import type {
  AdminStats,
  Activity,
  VectorStoreStatus,
  AppConfig,
} from "../types/index.ts";

export function useAdminData() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [vectorStoreStatus, setVectorStoreStatus] =
    useState<VectorStoreStatus | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [showConfigSavedModal, setShowConfigSavedModal] = useState(false);
  const [tempVectorStoreType, setTempVectorStoreType] =
    useState<string>("congraph");
  const [tempClientGraphMode, setTempClientGraphMode] =
    useState<string>("query");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/admin/stats");
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error("Error fetching stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVectorStoreStatus = async () => {
    try {
      const response = await fetch("/api/admin/vector-store/status");
      const data = await response.json();
      setVectorStoreStatus(data);
    } catch (err) {
      console.error("Error fetching vector store status:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const response = await fetch("/api/admin/config");
      const data = await response.json();
      setConfig(data);
      setTempVectorStoreType(data.vectorStoreType || "congraph");
      setTempClientGraphMode(data.clientGraphMode || "query");
    } catch (err) {
      console.error("Error fetching config:", err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientGraphMode: tempClientGraphMode }),
      });
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              clientGraphMode: tempClientGraphMode as "query" | "explorer",
            }
          : null,
      );
      setShowConfigSavedModal(true);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchActivities = async () => {
    try {
      const response = await fetch("/api/admin/activity?limit=50");
      const data = await response.json();
      setActivities(data.activities || []);
    } catch (err) {
      console.error("Error fetching activities:", err);
    }
  };

  const handleDownloadActivityJSON = (activity: Activity) => {
    try {
      const json = activity.details || activity;
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pipeline-${activity.id || "consult"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download JSON:", e);
    }
  };

  const handleOpenActivityJSON = (activity: Activity) => {
    try {
      const json = activity.details || activity;
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      console.error("Failed to open JSON:", e);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadLoading(true);
    setUploadMessage("Đang xử lý tệp...");

    try {
      const reader = new FileReader();
      reader.onload = async (e: ProgressEvent<FileReader>) => {
        try {
          const content = JSON.parse(e.target?.result as string);
          const response = await fetch("/api/admin/knowledge/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              content: content,
            }),
          });

          const data = await response.json();
          if (response.ok) {
            setUploadMessage(`Thành công: ${data.message}`);
            fetchStats();
            fetchActivities();
            fetchVectorStoreStatus();
          } else {
            setUploadMessage(`Lỗi: ${data.error}`);
          }
        } catch {
          setUploadMessage("Lỗi: Định dạng JSON không hợp lệ");
        } finally {
          setUploadLoading(false);
        }
      };
      reader.readAsText(file);
    } catch {
      setUploadMessage("Lỗi khi đọc tệp");
      setUploadLoading(false);
    }
  };

  const handleRebuildVector = async () => {
    if (
      !confirm(
        "Bạn có chắc chắn muốn xây dựng lại toàn bộ Vector Index? Thao tác này có thể mất vài phút.",
      )
    )
      return;

    setUploadLoading(true);
    setUploadMessage("Đang xây dựng lại Vector Index...");

    try {
      const response = await fetch("/api/admin/rebuild-vector", {
        method: "POST",
      });
      const data = await response.json();

      if (response.ok) {
        setUploadMessage(
          "Thành công: Quá trình xây dựng lại đã bắt đầu trong nền",
        );
        fetchStats();
        fetchActivities();
      } else {
        setUploadMessage(`Lỗi: ${data.error}`);
      }
    } catch {
      setUploadMessage("Lỗi kết nối khi xây dựng lại chỉ mục");
    } finally {
      setUploadLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchActivities();
    fetchVectorStoreStatus();
    fetchConfig();
    const interval = setInterval(() => {
      fetchStats();
      fetchActivities();
      fetchVectorStoreStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return {
    stats,
    loading,
    activities,
    vectorStoreStatus,
    config,
    showConfigSavedModal,
    setShowConfigSavedModal,
    tempVectorStoreType,
    setTempVectorStoreType,
    tempClientGraphMode,
    setTempClientGraphMode,
    uploadLoading,
    uploadMessage,
    fetchStats,
    fetchActivities,
    fetchVectorStoreStatus,
    fetchConfig,
    handleSaveConfig,
    handleDownloadActivityJSON,
    handleOpenActivityJSON,
    handleFileUpload,
    handleRebuildVector,
  };
}
