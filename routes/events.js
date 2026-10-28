// Sự kiện: danh sách công khai, chi tiết, đăng ký/hủy, và quản lý hồ sơ của ban tổ chức
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { q } = require('../db/database');
const { now, normTime, notify, audit, wrap, fail, termOf, termRange } = require('../lib/util');
const { EVENT_SELECT, decorate, getEvent, canManage, mustManage, canView, finalizeEndedEvents, activeSession, isReviewer, roomConflicts } = require('../lib/events');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---------- Upload ----------
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'cover') return cb(null, ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext));
    cb(null, ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.zip'].includes(ext));
  },
}).fields([{ name: 'cover', maxCount: 1 }, { name: 'files', maxCount: 5 }]);

const withUpload = (req, res, next) => upload(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File vượt quá 10 MB.' : `Lỗi tải file: ${err.message}`;
  res.status(400).json({ error: msg });
});

// ---------- Tiện ích ----------
function slugCode(title) {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .split(/[^A-Za-z0-9]+/).filter((w) => w.length > 1).slice(0, 3).map((w) => w[0]).join('').toUpperCase() || 'EVT';
  const year = new Date().getFullYear();
  let code = `NEU-${base}-${year}`, i = 2;
  while (q.get('SELECT 1 FROM events WHERE code = ?', code)) code = `NEU-${base}${i++}-${year}`;
  return code;
}

function regCode(ev) {
  const prefix = ev.code.split('-').slice(0, 2).join('-');
  let code;
  do code = `${prefix}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  while (q.get('SELECT 1 FROM registrations WHERE code = ?', code));
  return code;
}

function myRegistration(userId, eventId) {
  return q.get('SELECT id, code, status, registered_at, cancelled_at, attendance, checked_in_at, check_method, checked_out_at, points_awarded FROM registrations WHERE user_id = ? AND event_id = ?', userId, eventId) || null;
}

function eventExtras(ev, user) {
  const agenda = q.all('SELECT id, time_label, title, description FROM event_agenda WHERE event_id = ? ORDER BY sort_order, id', ev.id);
  const files = q.all('SELECT id, original_name, mime, size, uploaded_at FROM event_files WHERE event_id = ? ORDER BY id', ev.id);
  const session = activeSession(ev.id);
  // Ấn phẩm truyền thông: BTC & bộ phận duyệt thấy tất cả; người xem khác chỉ thấy ấn phẩm đã được duyệt
  const insider = canManage(user, ev) || isReviewer(user);
  const assets = q.all(`SELECT id, kind, title, channel, description, original_name, stored_name, mime, size, status, submitted_at, reviewed_at, review_note
                        FROM media_assets WHERE event_id = ? ${insider ? '' : "AND status = 'approved'"} ORDER BY id`, ev.id);
  const room_conflicts = insider && ev.room_id && ['draft', 'pending', 'rejected'].includes(ev.status) ? roomConflicts(ev.room_id, ev.start_at, ev.end_at, ev.id) : [];
  return {
    ...ev, agenda, files, assets, room_conflicts,
    my_registration: user.role === 'student' ? myRegistration(user.id, ev.id) : null,
    my_review: user.role === 'student' ? (q.get('SELECT rating, comment, is_anonymous, created_at FROM reviews WHERE user_id = ? AND event_id = ?', user.id, ev.id) || null) : null,
    can_manage: canManage(user, ev),
    attendance_open: !!(session && session.expires_at >= now()),
  };
}

// Lọc theo học kỳ chọn ở thanh trên cùng. Học kỳ hiện tại: hiển thị cả sự kiện sắp tới của học kỳ sau.
function termFilter(term, where, params) {
  if (!term || term === 'all') return;
  const r = termRange(term); if (!r) return;
  where.push('substr(e.start_at,1,10) >= ?'); params.push(r.from);
  if (term !== termOf(now()).key) { where.push('substr(e.start_at,1,10) <= ?'); params.push(r.to); }
}

// ========== DANH SÁCH CÔNG KHAI ==========
// GET /api/events?q=&category=&unit=&phase=upcoming|ongoing|ended|open&sort=
router.get('/', wrap((req, res) => {
  finalizeEndedEvents();
  const { q: kw = '', category = '', unit = '', phase = '', sort = 'soonest', term = '' } = req.query;
  const where = ["e.status = 'approved'"]; const params = [];
  termFilter(term, where, params);
  if (kw) { where.push('(e.title LIKE ? OR e.code LIKE ? OR e.summary LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (category) { where.push('e.category_id = ?'); params.push(Number(category)); }
  if (unit) { where.push('e.unit_id = ?'); params.push(Number(unit)); }
  const at = now();
  if (phase === 'upcoming') { where.push('e.start_at > ?'); params.push(at); }
  if (phase === 'ongoing') { where.push('e.start_at <= ? AND e.end_at >= ?'); params.push(at, at); }
  if (phase === 'ended') { where.push('e.end_at < ?'); params.push(at); }
  if (phase === 'open') { where.push('e.reg_deadline > ? AND e.end_at > ?'); params.push(at, at); }
  const order = phase === 'ended' || sort === 'latest' ? 'e.start_at DESC' : 'e.start_at ASC';
  let rows = q.all(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params).map((e) => decorate(e, at));
  if (phase === 'open') rows = rows.filter((e) => e.registration_open);
  if (!phase) { // mặc định: sắp/đang diễn ra trước, đã kết thúc sau
    rows.sort((a, b) => (a.phase === 'ended') - (b.phase === 'ended') || (a.phase === 'ended' ? b.start_at.localeCompare(a.start_at) : a.start_at.localeCompare(b.start_at)));
  }
  if (req.user.role === 'student') {
    const mine = new Map(q.all('SELECT event_id, status, attendance FROM registrations WHERE user_id = ?', req.user.id).map((r) => [r.event_id, r]));
    rows = rows.map((e) => ({ ...e, my_registration: mine.get(e.id) || null }));
  }
  res.json({ events: rows.map(({ description, preparation, benefits, review_note, ...rest }) => rest) });
}));

// ========== DANH SÁCH QUẢN LÝ (BTC / Quản lý) ==========
router.get('/manage/list', requireRole('organizer'), wrap((req, res) => {
  finalizeEndedEvents();
  const { q: kw = '', status = '', term = '' } = req.query;
  const where = []; const params = [];
  if (req.user.role === 'organizer') { where.push('(e.unit_id = ? OR e.created_by = ?)'); params.push(req.user.unit_id, req.user.id); }
  termFilter(term, where, params);
  if (kw) { where.push('(e.title LIKE ? OR e.code LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`); }
  const base = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const all = q.all(`${EVENT_SELECT} ${base} ORDER BY e.updated_at DESC`, ...params).map((e) => decorate(e));
  const counts = { all: all.length };
  for (const e of all) counts[e.status] = (counts[e.status] || 0) + 1;
  const list = status ? all.filter((e) => e.status === status || e.phase === status) : all;
  res.json({ events: list, counts });
}));

// ========== CHI TIẾT ==========
router.get('/:id', wrap((req, res) => {
  finalizeEndedEvents();
  const ev = getEvent(Number(req.params.id));
  if (!ev || !canView(req.user, ev)) fail(404, 'Không tìm thấy sự kiện hoặc sự kiện chưa được công khai.');
  res.json({ event: eventExtras(ev, req.user) });
}));

// Lịch sử thao tác của sự kiện (BTC của sự kiện / Văn phòng Đoàn / Phòng Truyền thông)
router.get('/:id/history', wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!(isReviewer(req.user) && ev && ev.status !== 'draft')) mustManage(req.user, ev);
  const logs = q.all(`SELECT a.*, u.full_name AS actor_name, u.role AS actor_role FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
                      WHERE (a.entity_type = 'event' AND a.entity_id = ?)
                         OR (a.entity_type = 'registration' AND a.entity_id IN (SELECT id FROM registrations WHERE event_id = ?))
                      ORDER BY a.id DESC LIMIT 100`, ev.id, ev.id);
  res.json({ logs });
}));

// ========== ĐĂNG KÝ / HỦY ĐĂNG KÝ (sinh viên) ==========
router.post('/:id/register', requireRole('student'), wrap((req, res) => {
  const result = q.tx(() => {
    const ev = getEvent(Number(req.params.id));
    if (!ev || ev.status !== 'approved') fail(404, 'Sự kiện không tồn tại hoặc chưa mở đăng ký.');
    const at = now();
    if (at >= ev.reg_deadline) fail(400, 'Đã hết hạn đăng ký sự kiện này.');
    if (at >= ev.end_at) fail(400, 'Sự kiện đã kết thúc.');
    const existing = myRegistration(req.user.id, ev.id);
    if (existing && existing.status === 'registered') fail(409, 'Bạn đã đăng ký sự kiện này.');
    if (ev.registered_count >= ev.capacity) fail(409, 'Sự kiện đã đủ số lượng đăng ký.');
    let regId, code;
    if (existing) {
      regId = existing.id; code = existing.code;
      q.run(`UPDATE registrations SET status='registered', registered_at=?, cancelled_at=NULL, attendance='pending', checked_in_at=NULL, check_method=NULL WHERE id=?`, at, regId);
    } else {
      code = regCode(ev);
      regId = q.run('INSERT INTO registrations (event_id,user_id,code,status,registered_at) VALUES (?,?,?,?,?)', ev.id, req.user.id, code, 'registered', at).id;
    }
    audit(req.user.id, 'registration.create', 'registration', regId, `Đăng ký "${ev.title}"`);
    notify(req.user.id, { type: 'registration', title: 'Đăng ký thành công', body: `Bạn đã đăng ký "${ev.title}". Mã đăng ký: ${code}.`, link: `/event-detail.html?id=${ev.id}` });
    return { code };
  });
  res.json({ ok: true, ...result });
}));

router.post('/:id/unregister', requireRole('student'), wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!ev) fail(404, 'Không tìm thấy sự kiện.');
  const reg = myRegistration(req.user.id, ev.id);
  if (!reg || reg.status !== 'registered') fail(400, 'Bạn chưa đăng ký sự kiện này.');
  const at = now();
  if (at >= ev.reg_deadline || at >= ev.start_at) fail(400, 'Đã quá hạn hủy đăng ký (chỉ được hủy trước hạn đăng ký).');
  q.run(`UPDATE registrations SET status='cancelled', cancelled_at=? WHERE id=?`, at, reg.id);
  audit(req.user.id, 'registration.cancel', 'registration', reg.id, `Hủy đăng ký "${ev.title}"`);
  res.json({ ok: true });
}));

// ========== TẠO / SỬA HỒ SƠ (BTC, quản lý) ==========
function readEventBody(body, user) {
  const s = (k) => (body[k] == null ? '' : String(body[k]).trim());
  const e = {
    title: s('title'), slogan: s('slogan'), summary: s('summary'), description: s('description'),
    benefits: s('benefits'), preparation: s('preparation'), location: s('location'),
    room_id: Number(body.room_id) || null,
    category_id: Number(body.category_id) || null,
    start_at: normTime(body.start_at), end_at: normTime(body.end_at), reg_deadline: normTime(body.reg_deadline),
    capacity: parseInt(body.capacity, 10), fee: s('fee') || 'Miễn phí', budget: parseInt(String(body.budget || '0').replace(/\D/g, ''), 10) || 0,
    contact_name: s('contact_name'), contact_phone: s('contact_phone'), contact_email: s('contact_email'),
    unit_id: user.unit_id,
    level: ['truong', 'khoa', 'clb'].includes(body.level) ? body.level : 'khoa',
    points: Math.max(0, Math.min(20, parseInt(body.points, 10) || 0)),
  };
  const errs = [];
  if (e.title.length < 5) errs.push('Tên sự kiện tối thiểu 5 ký tự');
  if (!e.category_id || !q.get('SELECT 1 FROM categories WHERE id = ?', e.category_id)) errs.push('Chọn loại sự kiện');
  if (!e.unit_id || !q.get('SELECT 1 FROM units WHERE id = ?', e.unit_id)) errs.push('Chọn đơn vị tổ chức');
  if (e.room_id) { // Đăng ký phòng do Văn phòng Đoàn quản lý → địa điểm lấy theo tên phòng
    const room = q.get('SELECT * FROM rooms WHERE id = ?', e.room_id);
    if (!room || !room.is_active) errs.push('Phòng đã chọn không tồn tại hoặc đang tạm ngưng sử dụng');
    else {
      e.location = room.name;
      if (e.capacity > room.capacity) errs.push(`Quy mô vượt sức chứa ${room.name} (${room.capacity} chỗ)`);
    }
  }
  if (!e.location) errs.push('Chọn phòng hoặc nhập địa điểm');
  if (!e.start_at || !e.end_at) errs.push('Nhập thời gian bắt đầu và kết thúc');
  else if (e.end_at <= e.start_at) errs.push('Thời gian kết thúc phải sau thời gian bắt đầu');
  if (!e.reg_deadline) errs.push('Nhập hạn đăng ký');
  else if (e.start_at && e.reg_deadline > e.start_at) errs.push('Hạn đăng ký phải trước khi sự kiện bắt đầu');
  if (!(e.capacity > 0)) errs.push('Số lượng tối đa phải lớn hơn 0');
  if (!e.contact_name) errs.push('Nhập người phụ trách');
  if (errs.length) fail(400, errs.join('; ') + '.');
  let agenda = [];
  try { agenda = JSON.parse(body.agenda || '[]'); } catch { fail(400, 'Chương trình sự kiện không hợp lệ.'); }
  agenda = agenda.filter((a) => a && String(a.title || '').trim()).map((a, i) => ({
    time_label: String(a.time_label || '').trim().slice(0, 40) || '—', title: String(a.title).trim().slice(0, 200), description: String(a.description || '').trim().slice(0, 500), sort_order: i,
  }));
  return { e, agenda };
}

// Phòng trùng lịch với sự kiện khác đã được duyệt → không cho lưu
function checkRoom(e, excludeId = 0) {
  const c = roomConflicts(e.room_id, e.start_at, e.end_at, excludeId);
  if (c.length) fail(409, `${e.location} đã được sử dụng cho "${c[0].title}" (${c[0].unit_short || ''}) từ ${c[0].start_at.slice(11, 16)} đến ${c[0].end_at.slice(11, 16)} ngày ${c[0].start_at.slice(8, 10)}/${c[0].start_at.slice(5, 7)}. Vui lòng chọn phòng hoặc thời gian khác.`);
}

// Gửi duyệt: cả hai bộ phận bắt đầu lại từ trạng thái "chờ duyệt"
function resetApproval(id, submit) {
  q.run(`UPDATE events SET doan_status=?, doan_by=NULL, doan_at=NULL, doan_note=NULL, doan_checks=NULL,
         media_status=?, media_by=NULL, media_at=NULL, media_note=NULL, media_checks=NULL WHERE id=?`,
  submit ? 'pending' : null, submit ? 'pending' : null, id);
}

function saveUploads(req, eventId) {
  const files = req.files || {};
  if (files.cover && files.cover[0]) {
    const old = q.get('SELECT cover_image FROM events WHERE id = ?', eventId)?.cover_image;
    if (old) fs.rm(path.join(UPLOAD_DIR, path.basename(old)), { force: true }, () => {});
    q.run('UPDATE events SET cover_image = ? WHERE id = ?', `/uploads/${files.cover[0].filename}`, eventId);
  }
  for (const f of files.files || []) {
    q.run('INSERT INTO event_files (event_id,original_name,stored_name,mime,size,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?)',
      eventId, f.originalname, f.filename, f.mimetype, f.size, req.user.id, now());
  }
}

function removeFiles(ids, eventId) {
  for (const id of ids) {
    const f = q.get('SELECT * FROM event_files WHERE id = ? AND event_id = ?', Number(id), eventId);
    if (!f) continue;
    fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
    q.run('DELETE FROM event_files WHERE id = ?', f.id);
  }
}

// Điều kiện nộp hồ sơ: có kế hoạch tổ chức (file đính kèm) và ít nhất một ấn phẩm truyền thông chưa bị từ chối
function mustBeReady(eventId) {
  const miss = [];
  if (!q.get('SELECT 1 FROM event_files WHERE event_id = ?', eventId)) miss.push('kế hoạch tổ chức (file PDF/Word đính kèm)');
  if (!q.get("SELECT 1 FROM media_assets WHERE event_id = ? AND status <> 'rejected'", eventId)) miss.push('ít nhất một ấn phẩm truyền thông (banner, poster...)');
  if (miss.length) fail(400, `Hồ sơ chưa đủ để nộp – cần ${miss.join(' và ')}. Hồ sơ đã được lưu nháp.`);
}

// Bước 1 → 2: thông báo cho Văn phòng Đoàn trường khi có hồ sơ mới
function notifyAdminsSubmitted(ev, user) {
  for (const a of q.all("SELECT id FROM users WHERE role = 'doan' AND is_active = 1")) {
    notify(a.id, { type: 'moderation', title: 'Hồ sơ mới chờ duyệt', body: `"${ev.title}" – ${user.unit_short || user.full_name} vừa gửi duyệt.`, link: `/moderation.html?id=${ev.id}` });
  }
}

router.post('/', requireRole('organizer'), withUpload, wrap((req, res) => {
  const { e, agenda } = readEventBody(req.body, req.user);
  checkRoom(e);
  const submit = req.body.submit === '1';
  const at = now();
  const id = q.tx(() => {
    const newId = q.run(`INSERT INTO events (code,title,slogan,summary,description,benefits,preparation,category_id,unit_id,created_by,room_id,location,
        start_at,end_at,reg_deadline,capacity,fee,budget,contact_name,contact_phone,contact_email,level,points,status,submitted_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      slugCode(e.title), e.title, e.slogan, e.summary, e.description, e.benefits, e.preparation, e.category_id, e.unit_id, req.user.id, e.room_id, e.location,
      e.start_at, e.end_at, e.reg_deadline, e.capacity, e.fee, e.budget, e.contact_name, e.contact_phone, e.contact_email, e.level, e.points,
      submit ? 'pending' : 'draft', submit ? at : null, at, at).id;
    agenda.forEach((a) => q.run('INSERT INTO event_agenda (event_id,time_label,title,description,sort_order) VALUES (?,?,?,?,?)', newId, a.time_label, a.title, a.description, a.sort_order));
    saveUploads(req, newId);
    if (submit) mustBeReady(newId);
    resetApproval(newId, submit);
    audit(req.user.id, 'event.create', 'event', newId, 'Tạo hồ sơ sự kiện');
    if (submit) audit(req.user.id, 'event.submit', 'event', newId, 'Gửi hồ sơ kiểm duyệt');
    return newId;
  });
  if (submit) notifyAdminsSubmitted(getEvent(id), req.user);
  res.status(201).json({ ok: true, id });
}));

router.put('/:id', requireRole('organizer'), withUpload, wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  mustManage(req.user, ev);
  if (!['draft', 'rejected'].includes(ev.status)) fail(400, 'Chỉ sửa được hồ sơ ở trạng thái Nháp hoặc Bị từ chối.');
  const { e, agenda } = readEventBody(req.body, req.user);
  e.unit_id = ev.unit_id;
  checkRoom(e, ev.id);
  const submit = req.body.submit === '1';
  const at = now();
  q.tx(() => {
    q.run(`UPDATE events SET title=?,slogan=?,summary=?,description=?,benefits=?,preparation=?,category_id=?,unit_id=?,room_id=?,location=?,start_at=?,end_at=?,
           reg_deadline=?,capacity=?,fee=?,budget=?,contact_name=?,contact_phone=?,contact_email=?,level=?,points=?,updated_at=?,
           status=?, submitted_at=COALESCE(?, submitted_at) WHERE id=?`,
      e.title, e.slogan, e.summary, e.description, e.benefits, e.preparation, e.category_id, e.unit_id, e.room_id, e.location, e.start_at, e.end_at,
      e.reg_deadline, e.capacity, e.fee, e.budget, e.contact_name, e.contact_phone, e.contact_email, e.level, e.points, at,
      submit ? 'pending' : ev.status, submit ? at : null, ev.id);
    q.run('DELETE FROM event_agenda WHERE event_id = ?', ev.id);
    agenda.forEach((a) => q.run('INSERT INTO event_agenda (event_id,time_label,title,description,sort_order) VALUES (?,?,?,?,?)', ev.id, a.time_label, a.title, a.description, a.sort_order));
    let rm = []; try { rm = JSON.parse(req.body.remove_files || '[]'); } catch { /* bỏ qua */ }
    removeFiles(rm, ev.id);
    saveUploads(req, ev.id);
    if (submit) { mustBeReady(ev.id); resetApproval(ev.id, true); }
    audit(req.user.id, 'event.update', 'event', ev.id, 'Cập nhật hồ sơ sự kiện');
    if (submit) audit(req.user.id, 'event.submit', 'event', ev.id, ev.status === 'rejected' ? 'Gửi duyệt lại sau khi bổ sung' : 'Gửi hồ sơ kiểm duyệt');
  });
  if (submit) notifyAdminsSubmitted(getEvent(ev.id), req.user);
  res.json({ ok: true, id: ev.id });
}));

router.post('/:id/submit', requireRole('organizer'), wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  mustManage(req.user, ev);
  if (!['draft', 'rejected'].includes(ev.status)) fail(400, 'Hồ sơ này không ở trạng thái có thể gửi duyệt.');
  if (ev.start_at <= now()) fail(400, 'Thời gian bắt đầu đã qua, vui lòng cập nhật lịch trước khi gửi duyệt.');
  checkRoom({ room_id: ev.room_id, start_at: ev.start_at, end_at: ev.end_at, location: ev.location }, ev.id);
  mustBeReady(ev.id);
  q.tx(() => {
    q.run("UPDATE events SET status='pending', submitted_at=?, updated_at=? WHERE id=?", now(), now(), ev.id);
    resetApproval(ev.id, true);
  });
  audit(req.user.id, 'event.submit', 'event', ev.id, ev.status === 'rejected' ? 'Gửi duyệt lại sau khi bổ sung' : 'Gửi hồ sơ kiểm duyệt');
  notifyAdminsSubmitted(ev, req.user);
  res.json({ ok: true });
}));

router.post('/:id/withdraw', requireRole('organizer'), wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  mustManage(req.user, ev);
  if (ev.status !== 'pending') fail(400, 'Chỉ rút được hồ sơ đang chờ duyệt.');
  q.run("UPDATE events SET status='draft', updated_at=? WHERE id=?", now(), ev.id);
  resetApproval(ev.id, false);
  audit(req.user.id, 'event.withdraw', 'event', ev.id, 'Rút hồ sơ về nháp để chỉnh sửa');
  res.json({ ok: true });
}));

router.post('/:id/cancel', requireRole('organizer'), wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  mustManage(req.user, ev);
  const reason = String(req.body?.reason || '').trim();
  if (ev.status !== 'approved') fail(400, 'Chỉ hủy được sự kiện đã được duyệt.');
  if (ev.end_at < now()) fail(400, 'Sự kiện đã kết thúc, không thể hủy.');
  if (reason.length < 5) fail(400, 'Vui lòng nhập lý do hủy (tối thiểu 5 ký tự).');
  const regs = q.all("SELECT user_id FROM registrations WHERE event_id = ? AND status = 'registered'", ev.id);
  q.tx(() => {
    q.run("UPDATE events SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?", reason, now(), ev.id);
    q.run('UPDATE attendance_sessions SET closed_at = ? WHERE event_id = ? AND closed_at IS NULL', now(), ev.id);
    audit(req.user.id, 'event.cancel', 'event', ev.id, 'Hủy sự kiện', reason);
    for (const r of regs) notify(r.user_id, { type: 'event', title: 'Sự kiện đã bị hủy', body: `"${ev.title}" đã bị hủy: ${reason}`, link: `/event-detail.html?id=${ev.id}` });
  });
  res.json({ ok: true, notified: regs.length });
}));

router.delete('/:id', requireRole('organizer'), wrap((req, res) => {
  const ev = getEvent(Number(req.params.id));
  mustManage(req.user, ev);
  if (ev.status !== 'draft') fail(400, 'Chỉ xóa được hồ sơ nháp.');
  const files = q.all('SELECT stored_name FROM event_files WHERE event_id = ? UNION ALL SELECT stored_name FROM media_assets WHERE event_id = ?', ev.id, ev.id);
  q.tx(() => {
    q.run('DELETE FROM events WHERE id = ?', ev.id);
    audit(req.user.id, 'event.delete', 'event', ev.id, `Xóa hồ sơ nháp "${ev.title}"`);
  });
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  if (ev.cover_image) fs.rm(path.join(UPLOAD_DIR, path.basename(ev.cover_image)), { force: true }, () => {});
  res.json({ ok: true });
}));

// ========== FILE ĐÍNH KÈM ==========
router.get('/files/:fileId/download', wrap((req, res) => {
  const f = q.get('SELECT * FROM event_files WHERE id = ?', Number(req.params.fileId));
  if (!f) fail(404, 'Không tìm thấy file.');
  const ev = getEvent(f.event_id);
  if (!canView(req.user, ev)) fail(403, 'Bạn không có quyền tải file này.');
  res.download(path.join(UPLOAD_DIR, f.stored_name), f.original_name);
}));

module.exports = router;
