import { signInWithGoogle, signOut } from "../../api/auth";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  role: string;
}

interface HeaderProps {
  user?: AdminUser | null;
  onRefreshAuth?: () => void;
}

export function Header({ user, onRefreshAuth }: HeaderProps) {
  const handleLogout = async () => {
    try {
      await signOut();
      if (onRefreshAuth) onRefreshAuth();
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  return (
    <header className="top-header">
      <div className="header-search">
        <i className="fas fa-search"></i>
        <input type="text" placeholder="Tìm kiếm tài liệu, điều luật..." />
      </div>
      <div className="header-actions">
        {user ? (
          <div className="user-profile" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img
              src={
                user.picture ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=0D8ABC&color=fff`
              }
              alt={user.name}
              style={{ width: "32px", height: "32px", borderRadius: "50%" }}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600, fontSize: "13px" }}>{user.name}</span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>{user.role}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                marginLeft: "8px",
                padding: "4px 8px",
                fontSize: "12px",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => signInWithGoogle().catch(console.error)}
            style={{
              padding: "6px 14px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Đăng nhập Google
          </button>
        )}
      </div>
    </header>
  );
}
