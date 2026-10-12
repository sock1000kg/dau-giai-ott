export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#main" aria-label="Giải đấu OTT - trang chủ">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OTT Arena</span>
        </a>
        <span className="header-label">NỀN TẢNG GIẢI ĐẤU</span>
      </header>

      <main id="main" className="welcome-panel">
        <div className="eyebrow"><span aria-hidden="true" /> HỆ THỐNG GIẢI ĐẤU OTT</div>
        <h1>Giải đấu OTT</h1>
        <p className="welcome-copy">
          Nền tảng quản lý đội thi và trình chiếu các trận đấu bot.
        </p>
        <div className="panel-divider" />
        <p className="shell-note">Giao diện nền đã sẵn sàng.</p>
      </main>

      <footer className="app-footer">
        <span>OTT Arena</span>
        <span>Giao diện local</span>
      </footer>
    </div>
  );
}
