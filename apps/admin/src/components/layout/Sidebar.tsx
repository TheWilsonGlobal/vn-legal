interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  loading: boolean;
}

const navItems = [
  { id: "overview", icon: "fa-chart-line", label: "Tổng quan" },
  { id: "knowledge", icon: "fa-book-open", label: "Dữ liệu Tri thức" },
  { id: "community", icon: "fa-users-viewfinder", label: "Cộng đồng" },
  { id: "vector", icon: "fa-database", label: "Vector Store" },
  { id: "llm", icon: "fa-brain", label: "LLM Monitor" },
  { id: "activities", icon: "fa-history", label: "Nhật ký hoạt động" },
  { id: "settings", icon: "fa-cog", label: "Cấu hình" },
];

export function Sidebar({ activeView, setActiveView, loading }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="logo-container">
        <div className="logo-icon">
          <i className="fas fa-gavel"></i>
        </div>
        <div className="logo-text">
          <span className="logo-main">VinaLegal</span>
          <span className="logo-sub">Admin Dashboard</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              setActiveView(item.id);
            }}
          >
            <i className={`fas ${item.icon}`}></i>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="status-indicator">
          <span className="dot pulse"></span>
          <span>Hệ thống: {loading ? "Đang kiểm tra..." : "Trực tuyến"}</span>
        </div>
      </div>
    </aside>
  );
}
