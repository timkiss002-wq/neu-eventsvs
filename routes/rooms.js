// Quản lý phòng / địa điểm – Văn phòng Đoàn
//   • Danh mục phòng (thêm, sửa, tạm ngưng sử dụng)
//   • Lịch sử dụng phòng theo sự kiện (đã duyệt / đang chờ duyệt)
// Ban tổ chức chỉ xem danh sách phòng đang hoạt động và lịch phòng để chọn khi tạo hồ sơ.
const express = require('express');
const { q } = require('../db/database');
const { now, audit, wrap, fail } = require('../lib/util');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Danh sách phòng. ?all=1 (Văn phòng Đoàn) lấy cả phòng tạm ngưng kèm số liệu sử dụng
router.get('/', wrap((req, res) => {
  const all = req.query.all === '1' && req.user.role === 'doan';
  const at = now();
  const rooms = q.all(`SELECT r.*,
        (SELECT COUNT(*) FROM events e WHERE e.room_id = r.id AND e.status = 'approved' AND e.end_at >= ?) AS upcoming,
        (SELECT COUNT(*) FROM events e WHERE e.room_id = r.id AND e.status = 'pending') AS pending,
        (SELECT COUNT(*) FROM events e WHERE e.room_id = r.id AND e.status = 'approved' AND e.start_at <= ? AND e.end_at >= ?) AS in_use,
        (SELECT COUNT(*) FROM events e WHERE e.room_id = r.id AND e.status IN ('approved','cancelled')) AS total_events
      FROM rooms r ${all ? '' : 'WHERE r.is_active = 1'} ORDER BY r.is_active DESC, r.building, r.code`, at, at, at);
  const stats = all ? q.get(`SELECT COUNT(*) total, SUM(is_active) active, SUM(is_active = 0) inactive, COALESCE(SUM(CASE WHEN is_active = 1 THEN capacity END), 0) seats FROM rooms`) : null;
  res.json({ rooms, stats });
}));

// Lịch sử dụng phòng trong khoảng ngày: sự kiện đã duyệt + đang chờ duyệt có đăng ký phòng
router.get('/schedule', requireRole('doan', 'organizer'), wrap((req, res) => {
  const today = now().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const where = ["e.room_id IS NOT NULL", "e.status IN ('approved','pending')", 'substr(e.end_at,1,10) >= ?']; const params = [from];
  if (to) { where.push('substr(e.start_at,1,10) <= ?'); params.push(to); }
  if (req.query.room) { where.push('e.room_id = ?'); params.push(Number(req.query.room)); }
  const items = q.all(`SELECT e.id, e.title, e.code, e.start_at, e.end_at, e.status, e.doan_status, e.media_status, e.capacity,
                              r.id AS room_id, r.code AS room_code, r.name AS room_name, un.short_name AS unit_short
                       FROM events e JOIN rooms r ON r.id = e.room_id LEFT JOIN units un ON un.id = e.unit_id
                       WHERE ${where.join(' AND ')} ORDER BY e.start_at LIMIT 300`, ...params);
  res.json({ items, from, to });
}));

function readRoom(body) {
  const s = (k) => (body[k] == null ? '' : String(body[k]).trim());
  const r = { code: s('code').toUpperCase(), name: s('name'), building: s('building'), capacity: parseInt(body.capacity, 10), equipment: s('equipment'), note: s('note') };
  const errs = [];
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(r.code)) errs.push('Mã phòng 2–20 ký tự (chữ, số, dấu gạch ngang)');
  if (r.name.length < 3) errs.push('Nhập tên phòng');
  if (!(r.capacity > 0 && r.capacity <= 10000)) errs.push('Sức chứa phải từ 1 đến 10.000');
  if (errs.length) fail(400, errs.join('; ') + '.');
  return r;
}

router.post('/', requireRole('doan'), wrap((req, res) => {
  const r = readRoom(req.body || {});
  if (q.get('SELECT 1 FROM rooms WHERE code = ?', r.code)) fail(409, `Mã phòng ${r.code} đã tồn tại.`);
  const at = now();
  const id = q.run('INSERT INTO rooms (code,name,building,capacity,equipment,note,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
    r.code, r.name, r.building, r.capacity, r.equipment, r.note, at, at).id;
  audit(req.user.id, 'room.create', 'room', id, `Thêm phòng ${r.code} – ${r.name} (${r.capacity} chỗ)`);
  res.status(201).json({ ok: true, id });
}));

router.put('/:id', requireRole('doan'), wrap((req, res) => {
  const room = q.get('SELECT * FROM rooms WHERE id = ?', Number(req.params.id));
  if (!room) fail(404, 'Không tìm thấy phòng.');
  const r = readRoom(req.body || {});
  if (q.get('SELECT 1 FROM rooms WHERE code = ? AND id <> ?', r.code, room.id)) fail(409, `Mã phòng ${r.code} đã tồn tại.`);
  const big = q.get("SELECT title, capacity FROM events WHERE room_id = ? AND status IN ('approved','pending') AND end_at >= ? AND capacity > ? ORDER BY capacity DESC LIMIT 1", room.id, now(), r.capacity);
  if (big) fail(400, `Sự kiện "${big.title}" (${big.capacity} người) đang dùng phòng này – sức chứa mới không được nhỏ hơn quy mô sự kiện.`);
  q.tx(() => {
    q.run('UPDATE rooms SET code=?, name=?, building=?, capacity=?, equipment=?, note=?, updated_at=? WHERE id=?', r.code, r.name, r.building, r.capacity, r.equipment, r.note, now(), room.id);
    // Đổi tên phòng → cập nhật địa điểm của các sự kiện chưa diễn ra
    if (r.name !== room.name) q.run("UPDATE events SET location = ? WHERE room_id = ? AND end_at >= ?", r.name, room.id, now());
    audit(req.user.id, 'room.update', 'room', room.id, `Cập nhật phòng ${r.code} – ${r.name} (${r.capacity} chỗ)`);
  });
  res.json({ ok: true });
}));

// Tạm ngưng / mở lại phòng (không xóa để giữ lịch sử sự kiện)
router.post('/:id/toggle', requireRole('doan'), wrap((req, res) => {
  const room = q.get('SELECT * FROM rooms WHERE id = ?', Number(req.params.id));
  if (!room) fail(404, 'Không tìm thấy phòng.');
  const reason = String(req.body?.reason || '').trim();
  if (room.is_active) {
    if (reason.length < 5) fail(400, 'Vui lòng nhập lý do tạm ngưng (tối thiểu 5 ký tự).');
    const busy = q.get("SELECT title FROM events WHERE room_id = ? AND status IN ('approved','pending') AND end_at >= ? ORDER BY start_at LIMIT 1", room.id, now());
    if (busy) fail(400, `Phòng đang được đăng ký cho "${busy.title}". Hãy xử lý các sự kiện này trước khi tạm ngưng.`);
  }
  q.run('UPDATE rooms SET is_active = ?, note = ?, updated_at = ? WHERE id = ?', room.is_active ? 0 : 1, room.is_active ? reason : room.note, now(), room.id);
  audit(req.user.id, room.is_active ? 'room.disable' : 'room.enable', 'room', room.id, `${room.is_active ? 'Tạm ngưng' : 'Mở lại'} phòng ${room.code} – ${room.name}`, reason);
  res.json({ ok: true });
}));

module.exports = router;
