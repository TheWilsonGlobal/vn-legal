import type React from "react";
import type { Community } from "../types/index.ts";
import { CommunityDetailModal } from "../components/modals/CommunityDetailModal.tsx";
import { AddCommunityModal } from "../components/modals/AddCommunityModal.tsx";

interface CommunityViewProps {
  communities: Community[];
  communitiesLoading: boolean;
  selectedCommunity: Community | null;
  setSelectedCommunity: (comm: Community | null) => void;
  showAddCommunityModal: boolean;
  setShowAddCommunityModal: (show: boolean) => void;
  newCommunity: Community;
  setNewCommunity: React.Dispatch<React.SetStateAction<Community>>;
  handleAddCommunity: () => Promise<void>;
  uploadLoading: boolean;
  fetchCommunities: () => Promise<void>;
}

export function CommunityView({
  communities,
  communitiesLoading,
  selectedCommunity,
  setSelectedCommunity,
  showAddCommunityModal,
  setShowAddCommunityModal,
  newCommunity,
  setNewCommunity,
  handleAddCommunity,
  uploadLoading,
  fetchCommunities,
}: CommunityViewProps) {
  return (
    <div className="view-section" key="community">
      <div className="view-header">
        <h2>Quản lý Community Reports (Global Search)</h2>
        <div className="header-actions">
          <button className="btn-secondary" onClick={fetchCommunities}>
            <i className="fas fa-sync-alt"></i> Tải lại
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowAddCommunityModal(true)}
          >
            <i className="fas fa-plus-circle"></i> Thêm mới
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon purple">
            <i className="fas fa-users-viewfinder"></i>
          </div>
          <div className="stat-info">
            <h3>Tổng số Community</h3>
            <div className="value">{communities.length}</div>
            <span>Hierarchy Level 0 & 1</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">
            <i className="fas fa-star"></i>
          </div>
          <div className="stat-info">
            <h3>Rating trung bình</h3>
            <div className="value">
              {(
                communities.reduce((acc, curr) => acc + (curr.rating || 0), 0) /
                (communities.length || 1)
              ).toFixed(1)}
              /10
            </div>
            <span>Chất lượng tóm tắt (Thang 10)</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "24px" }}>
        <div className="card-header">
          <h2>Danh sách báo cáo cộng đồng</h2>
        </div>
        <div className="card-body">
          {communitiesLoading ? (
            <div className="loading-placeholder">
              <div className="spinner"></div>
              <p>Đang tải dữ liệu cộng đồng...</p>
            </div>
          ) : (
            <div className="community-grid">
              {communities.map((comm) => (
                <div key={comm.id} className="community-card">
                  <div className="community-card-header">
                    <span
                      className={`level-badge ${comm.level === 0 ? "part" : "chapter"}`}
                    >
                      {comm.level === 0 ? "PHẦN" : "CHƯƠNG"}
                    </span>
                    <div className="rating">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <i
                          key={i}
                          className={`fas fa-star ${i < comm.rating ? "active" : ""}`}
                        ></i>
                      ))}
                    </div>
                  </div>
                  <h3>{comm.title}</h3>
                  <p className="summary">{comm.summary}</p>
                  <div className="community-footer">
                    <span className="id-text">{comm.id}</span>
                    <button
                      className="btn-text"
                      onClick={() => setSelectedCommunity(comm)}
                    >
                      Chi tiết <i className="fas fa-arrow-right"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CommunityDetailModal
        selectedCommunity={selectedCommunity}
        onClose={() => setSelectedCommunity(null)}
      />

      <AddCommunityModal
        show={showAddCommunityModal}
        onClose={() => setShowAddCommunityModal(false)}
        newCommunity={newCommunity}
        setNewCommunity={setNewCommunity}
        handleAddCommunity={handleAddCommunity}
        uploadLoading={uploadLoading}
      />
    </div>
  );
}
