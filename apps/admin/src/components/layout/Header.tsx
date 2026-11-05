export function Header() {
  return (
    <header className="top-header">
      <div className="header-search">
        <i className="fas fa-search"></i>
        <input type="text" placeholder="Tìm kiếm tài liệu, điều luật..." />
      </div>
      <div className="header-actions">
        <button className="btn-icon">
          <i className="fas fa-bell"></i>
        </button>
        <div className="user-profile">
          <img
            src="https://ui-avatars.com/api/?name=Admin&background=0D8ABC&color=fff"
            alt="User"
          />
          <span>Quản trị viên</span>
        </div>
      </div>
    </header>
  );
}
