// Phân hệ Văn phòng Đoàn – quản lý điểm Đoàn:
//  - Duyệt danh sách sinh viên hoàn thành do BTC gửi để cộng điểm Đoàn
//  - Tra cứu điểm Đoàn từng sinh viên, lịch sử điểm, cộng / trừ điểm thủ công, xuất Excel
//  - Quản lý tài khoản đơn vị (Ban tổ chức): cấp tài khoản, đổi email, đặt lại mật khẩu, khóa / mở khóa
//  - Xem nhật ký thao tác của hệ thống
// (Duyệt sự kiện: routes/moderation.js • Quản lý phòng: routes/rooms.js)
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { q } = require('../db/database');
const { now, notify, audit, wrap, fail, termRange, termOf, termLabel, isNeuEmail } = require('../lib/util');
const { getEvent } = require('../lib/events');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('doan'));

// ===================== DUYỆT DANH SÁCH ĐIỂM ĐOÀN =====================
router.get('/points', wrap((req, res) => {
  const { status = '' } = req.query;
  const where = status ? 'WHERE p.status = ?' : '';
  const items = q.all(`SELECT p.*, e.title, e.code, e.start_at, e.end_at, e.level, un.short_name AS unit_short, un.name AS unit_name,
                              s.full_name AS submitter_name, rv.full_name AS reviewer_name
                       FROM point_submissions p JOIN events e ON e.id = p.event_id LEFT JOIN units un ON un.id = e.unit_id
                       LEFT JOIN users s ON s.id = p.submitted_by LEFT JOIN users rv ON rv.id = p.reviewed_by
                       ${where} ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.submitted_at DESC`, ...(status ? [status] : []));
  const counts = q.get(`SELECT SUM(status='pending') pending, SUM(status='approved') approved, SUM(status='rejected') rejected,
                               SUM(CASE WHEN status='approved' THEN member_count * points ELSE 0 END) total_points FROM point_submissions`);
  res.json({ items, counts });
}));

router.get('/points/:eventId', wrap((req, res) => {
  const ev = getEvent(Number(req.params.eventId));
  if (!ev) fail(404, 'Không tìm thấy sự kiện.');
  const submission = q.get('SELECT * FROM point_submissions WHERE event_id = ?', ev.id);
  if (!submission) fail(404, 'Sự kiện chưa gửi danh sách.');
  const members = q.all(`SELECT r.code, r.checked_in_at, r.checked_out_at, r.points_awarded, u.full_name, u.code AS student_code, u.class_name
                         FROM registrations r JOIN users u ON u.id = r.user_id
                         WHERE r.event_id = ? AND r.status = 'registered' AND r.attendance = 'present' AND r.checked_out_at IS NOT NULL
                         ORDER BY u.full_name`, ev.id);
  res.json({ event: ev, submission, members });
}));

router.post('/points/:eventId/:decision', wrap((req, res) => {
  const approve = req.params.decision === 'approve';
  if (!['approve', 'reject'].includes(req.params.decision)) fail(404, 'Không hỗ trợ thao tác này.');
  const ev = getEvent(Number(req.params.eventId));
  if (!ev) fail(404, 'Không tìm thấy sự kiện.');
  const sub = q.get('SELECT * FROM point_submissions WHERE event_id = ?', ev.id);
  if (!sub || sub.status !== 'pending') fail(400, 'Danh sách không ở trạng thái chờ duyệt.');
  const note = String(req.body?.note || '').trim();
  if (!approve && note.length < 10) fail(400, 'Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự).');
  const at = now();
  const n = q.tx(() => {
    let count = 0;
    if (approve) {
      const members = q.all(`SELECT id, user_id FROM registrations WHERE event_id = ? AND status = 'registered' AND attendance = 'present' AND checked_out_at IS NOT NULL`, ev.id);
      for (const m of members) {
        q.run('UPDATE registrations SET points_awarded = ? WHERE id = ?', sub.points, m.id);
        notify(m.user_id, { type: 'points', title: 'Đã cộng điểm Đoàn', body: `Văn phòng Đoàn đã cộng ${sub.points} điểm Đoàn từ "${ev.title}".`, link: '/registered.html' });
      }
      count = members.length;
    }
    q.run('UPDATE point_submissions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, member_count = CASE WHEN ? THEN ? ELSE member_count END WHERE id = ?',
      approve ? 'approved' : 'rejected', req.user.id, at, note || null, approve ? 1 : 0, count, sub.id);
    audit(req.user.id, approve ? 'points.approve' : 'points.reject', 'event', ev.id,
      approve ? `Duyệt điểm Đoàn: ${count} sinh viên × ${sub.points} điểm` : 'Từ chối danh sách điểm Đoàn', note);
    for (const o of q.all("SELECT id FROM users WHERE role = 'organizer' AND unit_id = ?", ev.unit_id)) {
      notify(o.id, approve
        ? { type: 'points', title: 'Danh sách đã được duyệt điểm', body: `"${ev.title}": ${count} sinh viên được cộng ${sub.points} điểm.`, link: `/attendance.html?event=${ev.id}` }
        : { type: 'points', title: 'Danh sách điểm bị từ chối', body: `"${ev.title}" cần bổ sung: ${note}`, link: `/attendance.html?event=${ev.id}` });
    }
    return count;
  });
  res.json({ ok: true, count: n });
}));

// ===================== ĐIỂM ĐOÀN TỪNG SINH VIÊN =====================
// Điểm Đoàn = điểm được duyệt từ sự kiện (registrations.points_awarded) + điều chỉnh thủ công (point_adjustments)
function termCond(term, col) {
  const r = term && term !== 'all' ? termRange(term) : null;
  return r ? { sql: ` AND substr(${col},1,10) BETWEEN ? AND ?`, params: [r.from, r.to] } : { sql: '', params: [] };
}

function studentRows({ term = '', kw = '', klass = '', sort = 'points' }) {
  const te = termCond(term, 'e.start_at'); const ta = termCond(term, 'a.created_at');
  const where = ["u.role = 'student'"]; const params = [];
  if (kw) { where.push('(u.code LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (klass) { where.push('u.class_name = ?'); params.push(klass); }
  const order = { points: 'total DESC, u.full_name', name: 'u.full_name', code: 'u.code', activities: 'activities DESC, total DESC' }[sort] || 'total DESC, u.full_name';
  return q.all(`SELECT u.id, u.code, u.full_name, u.class_name, u.email, u.is_active,
        COALESCE((SELECT SUM(r.points_awarded) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = u.id AND r.points_awarded IS NOT NULL${te.sql}), 0) AS event_points,
        (SELECT COUNT(*) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = u.id AND r.points_awarded IS NOT NULL${te.sql}) AS activities,
        COALESCE((SELECT SUM(a.points) FROM point_adjustments a WHERE a.user_id = u.id${ta.sql}), 0) AS adjust_points,
        (SELECT COUNT(*) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = u.id AND r.status = 'registered' AND r.attendance = 'present' AND r.checked_out_at IS NOT NULL
           AND r.points_awarded IS NULL AND e.points > 0${te.sql}) AS waiting
      FROM users u WHERE ${where.join(' AND ')}`, ...te.params, ...te.params, ...ta.params, ...te.params, ...params)
    .map((r) => ({ ...r, total: r.event_points + r.adjust_points }))
    .sort((a, b) => (sort === 'name' ? a.full_name.localeCompare(b.full_name, 'vi') : sort === 'code' ? a.code.localeCompare(b.code)
      : sort === 'activities' ? b.activities - a.activities || b.total - a.total : b.total - a.total || a.full_name.localeCompare(b.full_name, 'vi')));
}

router.get('/students', wrap((req, res) => {
  const { term = termOf(now()).key, q: kw = '', class: klass = '', sort = 'points' } = req.query;
  const rows = studentRows({ term, kw: String(kw).trim(), klass, sort });
  const all = kw || klass ? studentRows({ term }) : rows;
  const stats = {
    students: all.length,
    with_points: all.filter((r) => r.total > 0).length,
    total_points: all.reduce((s, r) => s + r.total, 0),
    adjustments: all.reduce((s, r) => s + r.adjust_points, 0),
    waiting: all.reduce((s, r) => s + r.waiting, 0),
  };
  stats.avg = stats.students ? Math.round((stats.total_points / stats.students) * 10) / 10 : 0;
  const classes = q.all("SELECT DISTINCT class_name FROM users WHERE role = 'student' AND class_name IS NOT NULL ORDER BY class_name").map((r) => r.class_name);
  res.json({ students: rows.slice(0, 500), stats, classes, term, term_label: term === 'all' ? 'Tất cả học kỳ' : termLabel(term).label });
}));

// Lịch sử điểm Đoàn của 1 sinh viên (mọi học kỳ)
router.get('/students/:id', wrap((req, res) => {
  const u = q.get("SELECT id, code, full_name, class_name, email, phone, is_active FROM users WHERE id = ? AND role = 'student'", Number(req.params.id));
  if (!u) fail(404, 'Không tìm thấy sinh viên.');
  const fromEvents = q.all(`SELECT 'event' AS source, r.points_awarded AS points, e.start_at AS at, e.title, e.code AS ref, e.level, e.id AS event_id,
        un.short_name AS unit_short, ps.reviewed_at AS approved_at, rv.full_name AS by_name
      FROM registrations r JOIN events e ON e.id = r.event_id LEFT JOIN units un ON un.id = e.unit_id
      LEFT JOIN point_submissions ps ON ps.event_id = e.id LEFT JOIN users rv ON rv.id = ps.reviewed_by
      WHERE r.user_id = ? AND r.points_awarded IS NOT NULL`, u.id);
  const fromAdjust = q.all(`SELECT 'manual' AS source, a.id AS adj_id, a.points, a.created_at AS at, a.reason AS title, NULL AS ref, NULL AS level, NULL AS event_id,
        NULL AS unit_short, a.created_at AS approved_at, cu.full_name AS by_name
      FROM point_adjustments a LEFT JOIN users cu ON cu.id = a.created_by WHERE a.user_id = ?`, u.id);
  // Hoạt động đã hoàn thành nhưng chưa được duyệt điểm
  const waiting = q.all(`SELECT e.id AS event_id, e.title, e.code AS ref, e.start_at AS at, e.points, un.short_name AS unit_short,
        (SELECT status FROM point_submissions p WHERE p.event_id = e.id) AS submission
      FROM registrations r JOIN events e ON e.id = r.event_id LEFT JOIN units un ON un.id = e.unit_id
      WHERE r.user_id = ? AND r.status = 'registered' AND r.attendance = 'present' AND r.checked_out_at IS NOT NULL AND r.points_awarded IS NULL AND e.points > 0
      ORDER BY e.start_at DESC`, u.id);
  const history = [...fromEvents, ...fromAdjust].map((h) => ({ ...h, term: termOf(h.at) })).sort((a, b) => b.at.localeCompare(a.at));
  const byTerm = new Map();
  for (const h of history) {
    const t = byTerm.get(h.term.key) || { key: h.term.key, label: h.term.label, event_points: 0, adjust_points: 0, activities: 0 };
    if (h.source === 'event') { t.event_points += h.points; t.activities += 1; } else t.adjust_points += h.points;
    byTerm.set(h.term.key, t);
  }
  const terms = [...byTerm.values()].sort((a, b) => b.key.localeCompare(a.key)).map((t) => ({ ...t, total: t.event_points + t.adjust_points }));
  res.json({ student: u, history, terms, waiting, total: history.reduce((s, h) => s + h.points, 0) });
}));

// Cộng / trừ điểm Đoàn thủ công (bắt buộc lý do)
router.post('/students/:id/adjust', wrap((req, res) => {
  const u = q.get("SELECT id, code, full_name FROM users WHERE id = ? AND role = 'student'", Number(req.params.id));
  if (!u) fail(404, 'Không tìm thấy sinh viên.');
  const points = parseInt(req.body?.points, 10);
  const reason = String(req.body?.reason || '').trim();
  if (!points || points < -20 || points > 20) fail(400, 'Số điểm điều chỉnh phải khác 0 và trong khoảng -20 đến 20.');
  if (reason.length < 10) fail(400, 'Vui lòng nhập lý do / căn cứ điều chỉnh (tối thiểu 10 ký tự).');
  const id = q.tx(() => {
    const newId = q.run('INSERT INTO point_adjustments (user_id, points, reason, created_by, created_at) VALUES (?,?,?,?,?)', u.id, points, reason, req.user.id, now()).id;
    audit(req.user.id, 'points.adjust', 'user', u.id, `${points > 0 ? 'Cộng' : 'Trừ'} ${Math.abs(points)} điểm Đoàn cho ${u.full_name} (${u.code})`, reason);
    notify(u.id, { type: 'points', title: points > 0 ? 'Bạn được cộng điểm Đoàn' : 'Điểm Đoàn bị trừ', body: `Văn phòng Đoàn ${points > 0 ? 'cộng' : 'trừ'} ${Math.abs(points)} điểm: ${reason}`, link: '/registered.html' });
    return newId;
  });
  res.status(201).json({ ok: true, id });
}));

// Xuất bảng điểm Đoàn ra Excel
router.get('/students-export', wrap(async (req, res) => {
  const { term = termOf(now()).key, q: kw = '', class: klass = '' } = req.query;
  const rows = studentRows({ term, kw: String(kw).trim(), klass, sort: 'code' });
  const label = term === 'all' ? 'Tất cả học kỳ' : termLabel(term).label;
  const wb = new ExcelJS.Workbook(); wb.creator = 'NEUeventvs1';
  const ws = wb.addWorksheet('Điểm Đoàn');
  ws.addRow(['BẢNG ĐIỂM ĐOÀN SINH VIÊN – VĂN PHÒNG ĐOÀN TRƯỜNG']).font = { bold: true, size: 14, color: { argb: 'FF0F2A5C' } };
  ws.addRow([`${label}${klass ? ' • Lớp ' + klass : ''} • Xuất lúc ${now()}`]); ws.addRow([]);
  const head = ws.addRow(['STT', 'MSSV', 'Họ và tên', 'Lớp', 'Số hoạt động', 'Điểm sự kiện', 'Điều chỉnh', 'Tổng điểm Đoàn']);
  head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1451A8' } }; });
  rows.forEach((r, i) => ws.addRow([i + 1, r.code, r.full_name, r.class_name || '', r.activities, r.event_points, r.adjust_points, r.total]));
  ws.columns = [{ width: 6 }, { width: 12 }, { width: 28 }, { width: 24 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 16 }];
  ws.autoFilter = { from: 'A4', to: 'H4' };
  audit(req.user.id, 'points.export', 'report', null, `Xuất bảng điểm Đoàn (${label}, ${rows.length} sinh viên)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="diem-doan-${term}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// ===================== TÀI KHOẢN ĐƠN VỊ (BAN TỔ CHỨC) =====================
// Mật khẩu tạm 8 ký tự. Môi trường demo không có máy chủ email nên mật khẩu được hiển thị một lần cho Văn phòng Đoàn chuyển cho đơn vị.
const tempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(8), (b) => chars[b % chars.length]).join('');
};
const emailTaken = (email, exceptId = 0) => q.get('SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?', email, exceptId);
function nextUnitCode() {
  // Mã tài khoản đơn vị theo dạng CBxxx (tiếp nối mã đã có)
  const row = q.get("SELECT code FROM users WHERE code LIKE 'CB%' AND substr(code, 3) GLOB '[0-9]*' ORDER BY CAST(substr(code, 3) AS INTEGER) DESC LIMIT 1");
  return `CB${String(row ? Number(row.code.slice(2)) + 1 : 1).padStart(3, '0')}`;
}

router.get('/accounts', wrap((req, res) => {
  const { kw = '', status = '' } = req.query;
  const at = now();
  const where = ["u.role = 'organizer'"]; const params = [];
  if (status === 'active') where.push('u.is_active = 1');
  if (status === 'disabled') where.push('u.is_active = 0');
  if (kw.trim()) {
    const k = `%${kw.trim().toLowerCase()}%`;
    where.push("(lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(u.code) LIKE ? OR lower(IFNULL(un.short_name,'')) LIKE ?)"); params.push(k, k, k, k);
  }
  const rows = q.all(`SELECT u.id, u.code, u.email, u.full_name, u.phone, u.is_active, u.locked_until, u.created_at, u.unit_id,
                             un.name AS unit_name, un.short_name AS unit_short,
                             (SELECT COUNT(*) FROM events e WHERE e.unit_id = u.unit_id AND e.status <> 'draft') AS event_count,
                             (SELECT MAX(created_at) FROM audit_logs a WHERE a.actor_id = u.id AND a.action = 'auth.login') AS last_login
                      FROM users u LEFT JOIN units un ON un.id = u.unit_id WHERE ${where.join(' AND ')} ORDER BY u.is_active DESC, u.full_name`, ...params)
    .map((u) => ({ ...u, temp_locked: !!(u.locked_until && u.locked_until > at) }));
  const counts = q.get("SELECT COUNT(*) total, SUM(is_active = 1) active, SUM(is_active = 0) disabled FROM users WHERE role = 'organizer'");
  const units = q.all('SELECT id, name, short_name FROM units ORDER BY name');
  res.json({ rows, counts, units });
}));

// Cấp tài khoản Ban tổ chức (email bắt buộc đuôi @neu.edu.vn, chưa tồn tại)
router.post('/accounts', wrap((req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!isNeuEmail(email)) fail(400, 'Email tài khoản đơn vị phải có đuôi @neu.edu.vn.');
  if (emailTaken(email)) fail(409, 'Email đã được dùng bởi tài khoản khác, vui lòng nhập email khác.');
  const password = tempPassword();
  const at = now();
  const out = q.tx(() => {
    let unitId = Number(b.unit_id) || null;
    if (!unitId) {
      const name = String(b.unit_name || '').trim();
      const short = String(b.unit_short || '').trim() || name;
      if (name.length < 3) fail(400, 'Vui lòng chọn đơn vị hoặc nhập tên đơn vị mới.');
      if (q.get('SELECT 1 FROM units WHERE lower(name) = lower(?)', name)) fail(409, 'Đơn vị đã tồn tại, hãy chọn trong danh sách.');
      unitId = q.run('INSERT INTO units (name, short_name) VALUES (?,?)', name, short).id;
    }
    const unit = q.get('SELECT * FROM units WHERE id = ?', unitId);
    if (!unit) fail(404, 'Không tìm thấy đơn vị.');
    const code = nextUnitCode();
    const uid = q.run(`INSERT INTO users (code,email,password_hash,full_name,role,unit_id,phone,created_at) VALUES (?,?,?,?,'organizer',?,?,?)`,
      code, email, bcrypt.hashSync(password, 8), unit.name, unitId, String(b.phone || '').trim() || null, at).id;
    audit(req.user.id, 'account.create', 'user', uid, `Văn phòng Đoàn cấp tài khoản Ban tổ chức: ${unit.name} (${email}, mã ${code})`);
    notify(uid, { type: 'account', title: 'Tài khoản Ban tổ chức đã được cấp', body: 'Văn phòng Đoàn đã cấp tài khoản cho đơn vị. Hãy đổi mật khẩu tại Hồ sơ cá nhân.', link: '/profile.html' });
    return { id: uid, code, unit: unit.name };
  });
  res.json({ ok: true, ...out, email, password });
}));

// Đổi email đăng nhập • đặt lại mật khẩu • khóa / mở khóa (chỉ áp dụng cho tài khoản Ban tổ chức)
router.put('/accounts/:id', wrap((req, res) => {
  const u = q.get("SELECT * FROM users WHERE id = ? AND role = 'organizer'", Number(req.params.id));
  if (!u) fail(404, 'Không tìm thấy tài khoản Ban tổ chức.');
  const b = req.body || {};
  let password = null, action = 'account.update', detail = '';
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!isNeuEmail(email)) fail(400, 'Email tài khoản đơn vị phải có đuôi @neu.edu.vn.');
    if (emailTaken(email, u.id)) fail(409, 'Email đã được dùng bởi tài khoản khác, vui lòng nhập email khác.');
    if (email === u.email) fail(400, 'Email mới trùng email hiện tại.');
    q.run('UPDATE users SET email = ? WHERE id = ?', email, u.id);
    detail = `đổi email đăng nhập ${u.email} → ${email}`;
    notify(u.id, { type: 'account', title: 'Email đăng nhập đã thay đổi', body: `Email đăng nhập mới của đơn vị: ${email}.`, link: '/profile.html' });
  } else if (b.action === 'reset_password') {
    password = tempPassword();
    q.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', bcrypt.hashSync(password, 8), u.id);
    detail = 'đặt lại mật khẩu';
  } else if (b.action === 'lock' || b.action === 'unlock') {
    const active = b.action === 'unlock' ? 1 : 0;
    if (!!u.is_active === !!active) fail(400, active ? 'Tài khoản đang hoạt động.' : 'Tài khoản đã bị khóa.');
    q.run('UPDATE users SET is_active = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', active, u.id);
    action = active ? 'account.enable' : 'account.disable';
    detail = active ? 'mở khóa tài khoản' : 'khóa tài khoản';
  } else fail(400, 'Không có thay đổi.');
  audit(req.user.id, action, 'user', u.id, `Văn phòng Đoàn cập nhật tài khoản ${u.full_name} (${u.code}): ${detail}`, String(b.reason || '').trim());
  res.json({ ok: true, password, email: b.email !== undefined ? String(b.email).trim().toLowerCase() : u.email });
}));

// ===================== NHẬT KÝ THAO TÁC =====================
const LOG_GROUP = {
  event: "a.action LIKE 'event.%' OR a.action LIKE 'moderation.%' OR a.action LIKE 'asset.%'",
  attendance: "a.action LIKE 'attendance.%' OR a.action LIKE 'registration.%'",
  points: "a.action LIKE 'points.%'",
  account: "a.action LIKE 'account.%' OR a.action LIKE 'auth.%' OR a.action LIKE 'profile.%'",
};
router.get('/logs', wrap((req, res) => {
  const size = Math.min(100, Math.max(10, Number(req.query.size) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = ['1=1']; const params = [];
  if (LOG_GROUP[req.query.group]) where.push(`(${LOG_GROUP[req.query.group]})`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { where.push('a.created_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { where.push('a.created_at <= ?'); params.push(`${req.query.to} 23:59:59`); }
  if (String(req.query.kw || '').trim()) {
    const k = `%${String(req.query.kw).trim().toLowerCase()}%`;
    where.push("(lower(IFNULL(a.detail,'')) LIKE ? OR lower(IFNULL(u.full_name,'')) LIKE ? OR lower(IFNULL(u.code,'')) LIKE ?)"); params.push(k, k, k);
  }
  const base = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(' AND ')}`;
  const total = q.get(`SELECT COUNT(*) n ${base}`, ...params).n;
  const rows = q.all(`SELECT a.id, a.action, a.detail, a.reason, a.created_at, u.full_name AS actor_name, u.code AS actor_code, u.role AS actor_role
                      ${base} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
  res.json({ rows, total, page, size });
}));

module.exports = router;
