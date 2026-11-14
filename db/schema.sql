-- =====================================================================
--  NEU Events – Lược đồ cơ sở dữ liệu (SQLite)
--  Thời gian lưu dạng chuỗi 'YYYY-MM-DD HH:MM:SS' theo giờ máy chủ.
-- =====================================================================

-- Đơn vị (khoa, viện, phòng ban, CLB)
CREATE TABLE IF NOT EXISTS units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  short_name  TEXT
);

-- Loại sự kiện
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  color  TEXT
);

-- Người dùng: sinh viên / ban tổ chức / văn phòng đoàn / phòng truyền thông / quản trị hệ thống
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,            -- MSSV hoặc mã cán bộ
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('student','organizer','doan','media','sysadmin')),
  unit_id        INTEGER REFERENCES units(id),
  class_name     TEXT,                            -- lớp (sinh viên)
  position       TEXT,                            -- chức vụ (cán bộ)
  phone          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  failed_logins  INTEGER NOT NULL DEFAULT 0,      -- số lần nhập sai mật khẩu liên tiếp
  locked_until   TEXT,                            -- tạm khóa đăng nhập đến thời điểm này
  created_at     TEXT NOT NULL
);

-- Phòng / địa điểm do Văn phòng Đoàn quản lý
CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,               -- mã phòng, ví dụ A2-B101
  name        TEXT NOT NULL,                      -- tên hiển thị: 'Phòng B101, nhà A2'
  building    TEXT,                               -- nhà / khu vực
  capacity    INTEGER NOT NULL DEFAULT 50,        -- sức chứa tối đa
  equipment   TEXT,                               -- trang thiết bị
  note        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,         -- 0 = tạm ngưng sử dụng (sửa chữa...)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Sự kiện
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,            -- mã hồ sơ, ví dụ NEU-AI-2026
  title          TEXT NOT NULL,
  slogan         TEXT,
  summary        TEXT,                            -- mô tả ngắn
  description    TEXT,                            -- giới thiệu chi tiết
  benefits       TEXT,                            -- quyền lợi khi tham gia (mỗi dòng 1 ý)
  preparation    TEXT,                            -- chuẩn bị trước khi tham gia
  category_id    INTEGER REFERENCES categories(id),
  unit_id        INTEGER REFERENCES units(id),    -- đơn vị tổ chức
  created_by     INTEGER REFERENCES users(id),
  room_id        INTEGER REFERENCES rooms(id),    -- phòng đăng ký sử dụng (NULL = địa điểm ngoài danh mục phòng)
  location       TEXT,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  reg_deadline   TEXT NOT NULL,
  capacity       INTEGER NOT NULL DEFAULT 100,
  fee            TEXT DEFAULT 'Miễn phí',
  budget         INTEGER DEFAULT 0,
  contact_name   TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  cover_image    TEXT,                            -- đường dẫn /uploads/...
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','pending','approved','rejected','cancelled')),
  -- Phê duyệt 2 bên: sự kiện chỉ được công khai khi cả Văn phòng Đoàn và Phòng Truyền thông chấp thuận
  doan_status    TEXT CHECK (doan_status IN ('pending','approved','rejected')),
  doan_by        INTEGER REFERENCES users(id),
  doan_at        TEXT,
  doan_note      TEXT,
  doan_checks    TEXT,                            -- JSON: tiêu chí Văn phòng Đoàn đã kiểm tra
  media_status   TEXT CHECK (media_status IN ('pending','approved','rejected')),
  media_by       INTEGER REFERENCES users(id),
  media_at       TEXT,
  media_note     TEXT,
  media_checks   TEXT,                            -- JSON: tiêu chí Phòng Truyền thông đã kiểm tra
  submitted_at   TEXT,
  reviewed_at    TEXT,
  reviewed_by    INTEGER REFERENCES users(id),
  review_note    TEXT,
  review_checks  TEXT,                            -- JSON: tiêu chí đã kiểm tra
  cancel_reason  TEXT,
  level          TEXT NOT NULL DEFAULT 'khoa' CHECK (level IN ('truong','khoa','clb')), -- cấp chương trình
  points         INTEGER NOT NULL DEFAULT 0,      -- điểm hoạt động (điểm Đoàn) khi hoàn thành
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Chương trình (agenda) của sự kiện
CREATE TABLE IF NOT EXISTS event_agenda (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time_label   TEXT NOT NULL,                     -- '08:00 – 08:30'
  title        TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- File đính kèm hồ sơ
CREATE TABLE IF NOT EXISTS event_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime           TEXT,
  size           INTEGER,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'plan'     -- plan: kế hoạch tổ chức | room: giấy đăng ký phòng
);

-- Đăng ký tham gia + kết quả điểm danh
CREATE TABLE IF NOT EXISTS registrations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  code           TEXT NOT NULL UNIQUE,            -- mã đăng ký, ví dụ NEU-AI-0123
  status         TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','cancelled')),
  registered_at  TEXT NOT NULL,
  cancelled_at   TEXT,
  attendance     TEXT NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending','present','absent')),
  checked_in_at  TEXT,
  check_method   TEXT,                            -- code | qr | manual
  checked_out_at TEXT,                            -- thời điểm check-out (hoàn thành)
  checkout_method TEXT,                           -- code | qr | manual
  points_awarded INTEGER,                         -- điểm hoạt động đã được duyệt
  contact_email  TEXT,                            -- thông tin liên hệ sinh viên nhập khi đăng ký
  contact_phone  TEXT,
  UNIQUE (event_id, user_id)
);

-- Phiên điểm danh do ban tổ chức mở
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'checkin' CHECK (kind IN ('checkin','checkout')),
  opened_by   INTEGER REFERENCES users(id),
  opened_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  closed_at   TEXT
);

-- Đánh giá sau sự kiện
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0,        -- đánh giá ẩn danh
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (event_id, user_id)
);

-- Thông báo trong hệ thống
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Lịch sử thao tác (audit log)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER,
  detail       TEXT,
  reason       TEXT,
  created_at   TEXT NOT NULL
);

-- Mã đặt lại mật khẩu
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

-- Ấn phẩm truyền thông (banner, poster, bài đăng...) BTC gửi Phòng Truyền thông duyệt
CREATE TABLE IF NOT EXISTS media_assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('banner','poster','standee','post','video','other')),
  title          TEXT NOT NULL,
  channel        TEXT,                            -- kênh đăng tải: Fanpage, website, màn hình LED...
  description    TEXT,                            -- nội dung bài đăng / ghi chú
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime           TEXT,
  size           INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by   INTEGER REFERENCES users(id),
  submitted_at   TEXT NOT NULL,
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TEXT,
  review_note    TEXT
);

-- Điều chỉnh điểm Đoàn thủ công (Văn phòng Đoàn cộng / trừ điểm ngoài sự kiện)
CREATE TABLE IF NOT EXISTS point_adjustments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points      INTEGER NOT NULL,                   -- dương: cộng điểm, âm: trừ điểm
  reason      TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- Danh sách hoàn thành BTC gửi Văn phòng Đoàn để duyệt điểm hoạt động
CREATE TABLE IF NOT EXISTS point_submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  submitted_by  INTEGER REFERENCES users(id),
  submitted_at  TEXT NOT NULL,
  member_count  INTEGER NOT NULL DEFAULT 0,
  points        INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT
);

-- Cấu hình hệ thống (Quản trị hệ thống thiết lập)
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_events_status   ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start    ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_reg_event       ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_user        ON registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_entity    ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_event  ON attendance_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_events_room     ON events(room_id, start_at);
CREATE INDEX IF NOT EXISTS idx_assets_event    ON media_assets(event_id, status);
CREATE INDEX IF NOT EXISTS idx_adjust_user     ON point_adjustments(user_id);
