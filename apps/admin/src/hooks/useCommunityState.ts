import { useState } from "react";
import type { Community } from "../types/index.ts";

export function useCommunityState(onActivityLogged?: () => void) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(
    null,
  );
  const [showAddCommunityModal, setShowAddCommunityModal] = useState(false);
  const [newCommunity, setNewCommunity] = useState<Community>({
    id: "",
    community_id: "",
    level: 1,
    title: "",
    summary: "",
    findings: [""],
    rating: 10,
    parent_id: "",
    article_count: 0,
    principles: "",
  });
  const [communityUploadLoading, setCommunityUploadLoading] = useState(false);

  const fetchCommunities = async () => {
    setCommunitiesLoading(true);
    try {
      const response = await fetch("/api/admin/communities");
      const data = await response.json();
      setCommunities(data.communities || []);
    } catch (err) {
      console.error("Error fetching communities:", err);
    } finally {
      setCommunitiesLoading(false);
    }
  };

  const handleAddCommunity = async () => {
    if (
      !newCommunity.community_id ||
      !newCommunity.title ||
      !newCommunity.summary
    ) {
      alert(
        "Vui lòng điền đầy đủ các thông tin bắt buộc (ID, Tiêu đề, Tóm tắt)",
      );
      return;
    }

    setCommunityUploadLoading(true);

    try {
      const response = await fetch("/api/admin/community/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCommunity,
          findings: newCommunity.findings.filter(
            (f: string | { explanation: string }) =>
              typeof f === "string" ? f.trim() !== "" : true,
          ),
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setShowAddCommunityModal(false);
        fetchCommunities();
        onActivityLogged?.();
        setNewCommunity({
          id: "",
          community_id: "",
          level: 1,
          title: "",
          summary: "",
          findings: [""],
          rating: 10,
          parent_id: "",
          article_count: 0,
          principles: "",
        });
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } catch {
      console.error("Failed to add community");
      alert("Lỗi kết nối khi thêm cộng đồng");
    } finally {
      setCommunityUploadLoading(false);
    }
  };

  return {
    communities,
    communitiesLoading,
    selectedCommunity,
    setSelectedCommunity,
    showAddCommunityModal,
    setShowAddCommunityModal,
    newCommunity,
    setNewCommunity,
    communityUploadLoading,
    fetchCommunities,
    handleAddCommunity,
  };
}
