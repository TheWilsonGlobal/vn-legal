import type { Community } from "../../types/index.ts";

interface AddCommunityModalProps {
  show: boolean;
  onClose: () => void;
  newCommunity: Community;
  setNewCommunity: React.Dispatch<React.SetStateAction<Community>>;
  handleAddCommunity: () => Promise<void>;
  uploadLoading: boolean;
}

export function AddCommunityModal({
  show,
  onClose,
  newCommunity,
  setNewCommunity,
  handleAddCommunity,
  uploadLoading,
}: AddCommunityModalProps) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content admin-modal glass-card animate-zoom"
        style={{ maxWidth: "700px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Thêm mới Community Report</h2>
          <button className="btn-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body scrollable">
          <div className="form-grid">
            <div className="form-group">
              <label>Community ID (VD: chapter_1)</label>
              <input
                type="text"
                value={newCommunity.community_id}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    community_id: e.target.value,
                  })
                }
                placeholder="ID này nên trùng với ID Chương nếu là Level 1"
              />
            </div>
            <div className="form-group">
              <label>Cấp độ (Level)</label>
              <select
                value={newCommunity.level}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    level: parseInt(e.target.value),
                  })
                }
              >
                <option value={0}>Level 0 (Phần)</option>
                <option value={1}>Level 1 (Chương)</option>
              </select>
            </div>
            <div className="form-group full-width">
              <label>Tiêu đề</label>
              <input
                type="text"
                value={newCommunity.title}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    title: e.target.value,
                  })
                }
                placeholder="Tiêu đề báo cáo cộng đồng"
              />
            </div>
            <div className="form-group full-width">
              <label>Tóm tắt (Summary)</label>
              <textarea
                rows={4}
                value={newCommunity.summary}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    summary: e.target.value,
                  })
                }
                placeholder="Nội dung tóm tắt chính của cộng đồng này..."
              />
            </div>
            <div className="form-group">
              <label>Parent ID (VD: part_1)</label>
              <input
                type="text"
                value={newCommunity.parent_id || ""}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    parent_id: e.target.value,
                  })
                }
              />
            </div>
            <div className="form-group">
              <label>Đánh giá (Rating 0-10)</label>
              <input
                type="number"
                min="0"
                max="10"
                value={newCommunity.rating}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    rating: parseFloat(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-group full-width">
              <label>Nguyên tắc cốt lõi (Core Principles)</label>
              <textarea
                rows={2}
                value={newCommunity.principles || ""}
                onChange={(e) =>
                  setNewCommunity({
                    ...newCommunity,
                    principles: e.target.value,
                  })
                }
              />
            </div>
            <div className="form-group full-width">
              <label>Các phát hiện (Findings)</label>
              {newCommunity.findings.map((finding: unknown, idx: number) => {
                const findingVal =
                  typeof finding === "string"
                    ? finding
                    : (finding as { explanation: string })?.explanation || "";
                return (
                  <div
                    key={idx}
                    className="dynamic-input-row"
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <input
                      type="text"
                      value={findingVal}
                      onChange={(e) => {
                        const newFindings = [...newCommunity.findings];
                        newFindings[idx] = e.target.value;
                        setNewCommunity({
                          ...newCommunity,
                          findings: newFindings,
                        });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-icon danger"
                      onClick={() => {
                        const newFindings = newCommunity.findings.filter(
                          (_: unknown, i: number) => i !== idx,
                        );
                        setNewCommunity({
                          ...newCommunity,
                          findings: newFindings,
                        });
                      }}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                );
              })}
              <button
                className="btn-text"
                onClick={() =>
                  setNewCommunity({
                    ...newCommunity,
                    findings: [...newCommunity.findings, ""],
                  })
                }
              >
                <i className="fas fa-plus"></i> Thêm phát hiện
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn-primary"
            onClick={handleAddCommunity}
            disabled={uploadLoading}
          >
            {uploadLoading ? (
              <>
                <div className="spinner-small"></div> Đang xử lý...
              </>
            ) : (
              "Thêm cộng đồng"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
