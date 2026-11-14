// Truy vấn & quy tắc nghiệp vụ dùng chung cho sự kiện
const crypto = require('crypto');
const { q } = require('../db/database');
const { now, phaseOf, fail } = require('./util');

// Câu SELECT chuẩn kèm tên đơn vị, loại và số liệu đăng ký/tham dự
const EVENT_SELECT = `
  SELECT e.*, c.name AS category_name, c.color AS category_color,
         un.name AS unit_name, un.short_name AS unit_short,
         cu.full_name AS creator_name,
         rv.full_name AS reviewer_name, rvu.short_name AS reviewer_unit,
         rm.code AS room_code, rm.name AS room_name, rm.capacity AS room_capacity,
         dv.full_name AS doan_name, md.full_name AS media_name,
         (SELECT COUNT(*) FROM media_assets a WHERE a.event_id = e.id) AS asset_count,
         (SELECT COUNT(*) FROM media_assets a WHERE a.event_id = e.id AND a.status = 'pending') AS asset_pending,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') AS registered_count,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered' AND r.attendance = 'present') AS present_count,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered' AND r.attendance = 'absent') AS absent_count,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered' AND r.attendance = 'present' AND r.checked_out_at IS NOT NULL) AS completed_count,
         (SELECT status FROM point_submissions p WHERE p.event_id = e.id) AS points_status,
         (SELECT ROUND(AVG(rating), 2) FROM reviews v WHERE v.event_id = e.id) AS avg_rating,
         (SELECT COUNT(*) FROM reviews v WHERE v.event_id = e.id) AS review_count
  FROM events e
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN units un ON un.id = e.unit_id
  LEFT JOIN users cu ON cu.id = e.created_by
  LEFT JOIN users rv ON rv.id = e.reviewed_by
  LEFT JOIN units rvu ON rvu.id = rv.unit_id
  LEFT JOIN rooms rm ON rm.id = e.room_id
  LEFT JOIN users dv ON dv.id = e.doan_by
  LEFT JOIN users md ON md.id = e.media_by`;

function decorate(ev, at = now()) {
  if (!ev) return ev;
  const e = { ...ev };
  e.phase = phaseOf(e, at);
  e.seats_left = Math.max(0, e.capacity - e.registered_count);
  e.registration_open = e.status === 'approved' && at < e.reg_deadline && at < e.end_at && e.seats_left > 0;
  e.review_checks = e.review_checks ? JSON.parse(e.review_checks) : [];
  e.doan_checks = e.doan_checks ? JSON.parse(e.doan_checks) : [];
  e.media_checks = e.media_checks ? JSON.parse(e.media_checks) : [];
  return e;
}

function getEvent(id) {
  return decorate(q.get(`${EVENT_SELECT} WHERE e.id = ?`, id));
}

// Hai bộ phận tham gia phê duyệt sự kiện
const REVIEWERS = ['doan', 'media'];
const isReviewer = (user) => !!user && REVIEWERS.includes(user.role);
const SIDE_NAME = { doan: 'Văn phòng Đoàn', media: 'Phòng Truyền thông' };

// Người dùng có quyền quản lý (sửa, điểm danh) sự kiện? – chỉ BTC của đơn vị tổ chức
function canManage(user, ev) {
  if (!user || !ev) return false;
  return user.role === 'organizer' && (ev.unit_id === user.unit_id || ev.created_by === user.id);
}

function mustManage(user, ev) {
  if (!ev) fail(404, 'Không tìm thấy sự kiện.');
  if (!canManage(user, ev)) fail(403, 'Bạn không có quyền quản lý sự kiện này.');
}

// Người dùng có được xem sự kiện? Sự kiện công khai = đã duyệt hoặc đã hủy
// Văn phòng Đoàn, Phòng Truyền thông xem được mọi hồ sơ đã gửi duyệt (trừ bản nháp)
function canView(user, ev) {
  if (!ev) return false;
  if (['approved', 'cancelled'].includes(ev.status)) return true;
  if (isReviewer(user) && ev.status !== 'draft') return true;
  return canManage(user, ev);
}

// Sự kiện khác đang dùng phòng trong cùng khung giờ (đã duyệt, hoặc đang chờ duyệt và Văn phòng Đoàn đã chấp thuận)
function roomConflicts(roomId, startAt, endAt, excludeId = 0) {
  if (!roomId) return [];
  return q.all(`SELECT e.id, e.title, e.code, e.start_at, e.end_at, e.status, un.short_name AS unit_short
                FROM events e LEFT JOIN units un ON un.id = e.unit_id
                WHERE e.room_id = ? AND e.id <> ? AND e.start_at < ? AND e.end_at > ?
                  AND (e.status = 'approved' OR (e.status = 'pending' AND e.doan_status = 'approved'))
                ORDER BY e.start_at`, roomId, excludeId, endAt, startAt);
}

// Khung giờ điểm danh lấy từ cấu hình hệ thống (phút)
const settings = require('./settings');
const checkoutGrace = () => settings.get('checkout_after_min');
const checkinLead = () => settings.get('checkin_before_min');

// Hoàn tất điểm danh cho sự kiện đã kết thúc: đóng phiên check-in còn mở, chuyển "chưa check-in" -> "vắng mặt";
// phiên check-out tự đóng khi hết hiệu lực
function finalizeEndedEvents() {
  const at = now();
  const ended = q.all(`SELECT id, end_at FROM events WHERE status = 'approved' AND end_at < ?
                       AND (EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.event_id = events.id AND s.closed_at IS NULL AND s.kind = 'checkin')
                            OR EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = events.id AND r.status='registered' AND r.attendance='pending'))`, at);
  for (const e of ended) closeAttendance(e.id, e.end_at);
  q.run("UPDATE attendance_sessions SET closed_at = expires_at WHERE closed_at IS NULL AND kind = 'checkout' AND expires_at < ?", at);
}

// Đóng phiên check-in: sinh viên chưa check-in được ghi nhận vắng mặt
function closeAttendance(eventId, closedAt = now()) {
  q.run("UPDATE attendance_sessions SET closed_at = ? WHERE event_id = ? AND closed_at IS NULL AND kind = 'checkin'", closedAt, eventId);
  return q.run(`UPDATE registrations SET attendance = 'absent' WHERE event_id = ? AND status = 'registered' AND attendance = 'pending'`, eventId).changes;
}

function activeSession(eventId) {
  return q.get('SELECT * FROM attendance_sessions WHERE event_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', eventId);
}

// ===== Mã điểm danh động (QR + mã nhập tay đổi sau mỗi QR_STEP giây) =====
// Mỗi phiên lưu một khóa bí mật (cột code, không bao giờ gửi cho sinh viên). Mã hiển thị = HMAC(khóa, id phiên + chỉ số khung 10 giây),
// nên ảnh chụp / link QR gửi cho người vắng mặt sẽ hết hạn sau vài giây.
const QR_STEP = 10;      // giây – chu kỳ đổi mã
const QR_GRACE = 1;      // chấp nhận thêm 1 khung liền trước (bù độ trễ quét + mạng), tức mã sống tối đa ~20 giây
const QR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function codeAt(s, step) {
  const h = crypto.createHmac('sha256', String(s.code)).update(`${s.id}:${step}`).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += QR_CHARS[h[i] % QR_CHARS.length];
  return out;
}
function rotatingCode(s, t = Date.now()) {
  const step = Math.floor(t / 1000 / QR_STEP);
  return { code: codeAt(s, step), step, rotate_seconds: QR_STEP, remaining_ms: (step + 1) * QR_STEP * 1000 - t };
}
function verifyRotating(s, input, t = Date.now()) {
  const code = String(input || '').trim().toUpperCase();
  const step = Math.floor(t / 1000 / QR_STEP);
  for (let k = 0; k <= QR_GRACE; k++) if (codeAt(s, step - k) === code) return true;
  return false;
}

module.exports = { QR_STEP, rotatingCode, verifyRotating, REVIEWERS, SIDE_NAME, isReviewer, roomConflicts, checkoutGrace, checkinLead, EVENT_SELECT, decorate, getEvent, canManage, mustManage, canView, finalizeEndedEvents, closeAttendance, activeSession };
