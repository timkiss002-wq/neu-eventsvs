// Ấn phẩm truyền thông của sự kiện (banner, poster, standee, bài đăng, video...)
//   • Ban tổ chức: gửi ấn phẩm của đơn vị mình, xóa ấn phẩm chưa duyệt / bị từ chối, gửi bản mới
//   • Phòng Truyền thông: duyệt hoặc từ chối (bắt buộc lý do) trước khi ấn phẩm được đăng tải
// Ấn phẩm đã duyệt hiển thị công khai ở trang chi tiết sự kiện.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { q } = require('../db/database');
const { now, notify, audit, wrap, fail } = require('../lib/util');
const { getEvent, canManage, isReviewer } = require('../lib/events');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
// Khách được xem ấn phẩm đã duyệt của sự kiện công khai (ảnh banner, poster ở trang chi tiết); thao tác khác cần đăng nhập
router.use((req, res, next) => (!req.user && req.method === 'GET' && /^\/assets\/\d+\/file$/.test(req.path) ? next() : requireAuth(req, res, next)));

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.mp4'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `asset-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.includes(path.extname(file.originalname).toLowerCase())),
}).single('file');
const withUpload = (req, res, next) => upload(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File vượt quá 20 MB.' : `Lỗi tải file: ${err.message}` });
});

// Ấn phẩm được Phòng Truyền thông xử lý khi: sự kiện đã công khai (ấn phẩm bổ sung),
// hoặc hồ sơ đang ở bước 3 (Văn phòng Đoàn đã duyệt). Ấn phẩm nộp kèm hồ sơ chưa qua VP Đoàn thì chưa đến lượt.
const REVIEWABLE = "(e.status = 'approved' OR (e.status = 'pending' AND e.doan_status = 'approved'))";

const KINDS = { banner: 'Banner', poster: 'Poster', standee: 'Standee', post: 'Bài đăng mạng xã hội', video: 'Video', other: 'Ấn phẩm khác' };
const SELECT = `SELECT a.*, e.title AS event_title, e.code AS event_code, e.status AS event_status, e.doan_status, e.start_at, e.end_at, e.unit_id,
                       CASE WHEN ${REVIEWABLE} THEN 1 ELSE 0 END AS reviewable,
                       un.short_name AS unit_short, su.full_name AS submitter_name, rv.full_name AS reviewer_name
                FROM media_assets a JOIN events e ON e.id = a.event_id LEFT JOIN units un ON un.id = e.unit_id
                LEFT JOIN users su ON su.id = a.submitted_by LEFT JOIN users rv ON rv.id = a.reviewed_by`;

// Danh sách ấn phẩm: BTC – của đơn vị mình; Phòng Truyền thông / Văn phòng Đoàn – toàn trường
router.get('/assets', requireRole('organizer', 'media', 'doan'), wrap((req, res) => {
  const { status = '', q: kw = '', event = '', kind = '' } = req.query;
  const scope = []; const sp = [];
  if (req.user.role === 'organizer') { scope.push('(e.unit_id = ? OR e.created_by = ?)'); sp.push(req.user.unit_id, req.user.id); }
  const where = [...scope]; const params = [...sp];
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (kind) { where.push('a.kind = ?'); params.push(kind); }
  if (event) { where.push('a.event_id = ?'); params.push(Number(event)); }
  if (kw) { where.push('(a.title LIKE ? OR e.title LIKE ? OR e.code LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const items = q.all(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, COALESCE(a.reviewed_at, a.submitted_at) DESC`, ...params);
  const month = now().slice(0, 7);
  const counts = q.get(`SELECT COUNT(*) total, SUM(a.status='pending' AND ${req.user.role === 'organizer' ? '1' : REVIEWABLE}) pending, SUM(a.status='pending' AND NOT ${REVIEWABLE}) waiting_doan, SUM(a.status='approved') approved, SUM(a.status='rejected') rejected,
                               SUM(a.status='approved' AND substr(a.reviewed_at,1,7) = ?) approved_month
                        FROM media_assets a JOIN events e ON e.id = a.event_id ${scope.length ? 'WHERE ' + scope.join(' AND ') : ''}`, month, ...sp);
  res.json({ items, counts, kinds: KINDS });
}));

// Sự kiện BTC có thể gửi ấn phẩm: chưa hủy, chưa kết thúc
router.get('/events', requireRole('organizer'), wrap((req, res) => {
  const items = q.all(`SELECT id, title, code, status, start_at FROM events
                       WHERE (unit_id = ? OR created_by = ?) AND status IN ('draft','pending','approved','rejected') AND end_at >= ?
                       ORDER BY start_at`, req.user.unit_id, req.user.id, now());
  res.json({ events: items });
}));

router.post('/assets', requireRole('organizer'), withUpload, wrap((req, res) => {
  const f = req.file;
  const drop = () => { if (f) fs.rm(f.path, { force: true }, () => {}); };
  try {
    const ev = getEvent(Number(req.body.event_id));
    if (!ev) fail(404, 'Chọn sự kiện của ấn phẩm.');
    if (!canManage(req.user, ev)) fail(403, 'Bạn chỉ gửi được ấn phẩm cho sự kiện của đơn vị mình.');
    if (ev.status === 'cancelled' || ev.end_at < now()) fail(400, 'Sự kiện đã kết thúc hoặc đã hủy.');
    const kind = KINDS[req.body.kind] ? req.body.kind : null;
    const title = String(req.body.title || '').trim();
    if (!kind) fail(400, 'Chọn loại ấn phẩm.');
    if (title.length < 3) fail(400, 'Nhập tên ấn phẩm (tối thiểu 3 ký tự).');
    if (!f) fail(400, 'Chọn file ấn phẩm (ảnh JPG/PNG/WEBP, PDF hoặc video MP4, tối đa 20 MB).');
    const at = now();
    const id = q.tx(() => {
      const newId = q.run(`INSERT INTO media_assets (event_id,kind,title,channel,description,original_name,stored_name,mime,size,status,submitted_by,submitted_at)
                           VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`, ev.id, kind, title.slice(0, 200), String(req.body.channel || '').trim().slice(0, 200),
      String(req.body.description || '').trim().slice(0, 2000), f.originalname, f.filename, f.mimetype, f.size, req.user.id, at).id;
      audit(req.user.id, 'asset.submit', 'event', ev.id, `Gửi duyệt ấn phẩm: ${KINDS[kind]} "${title}"`);
      // Ấn phẩm bổ sung cho sự kiện đã công khai / hồ sơ đã qua VP Đoàn → báo ngay; ấn phẩm nộp kèm hồ sơ → báo khi VP Đoàn duyệt xong
      const ready = ev.status === 'approved' || (ev.status === 'pending' && ev.doan_status === 'approved');
      for (const m of ready ? q.all("SELECT id FROM users WHERE role = 'media' AND is_active = 1") : []) {
        notify(m.id, { type: 'media', title: 'Ấn phẩm mới chờ duyệt', body: `${KINDS[kind]} "${title}" – sự kiện "${ev.title}" (${req.user.unit_short || req.user.full_name}).`, link: `/media-assets.html?id=${newId}` });
      }
      return newId;
    });
    res.status(201).json({ ok: true, id });
  } catch (e) { drop(); throw e; }
}));

router.delete('/assets/:id', requireRole('organizer'), wrap((req, res) => {
  const a = q.get(`${SELECT} WHERE a.id = ?`, Number(req.params.id));
  if (!a) fail(404, 'Không tìm thấy ấn phẩm.');
  if (!canManage(req.user, getEvent(a.event_id))) fail(403, 'Bạn không có quyền với ấn phẩm này.');
  if (a.status === 'approved') fail(400, 'Ấn phẩm đã được duyệt, không thể xóa.');
  q.run('DELETE FROM media_assets WHERE id = ?', a.id);
  fs.rm(path.join(UPLOAD_DIR, a.stored_name), { force: true }, () => {});
  audit(req.user.id, 'asset.delete', 'event', a.event_id, `Xóa ấn phẩm "${a.title}"`);
  res.json({ ok: true });
}));

router.post('/assets/:id/:decision', requireRole('media'), wrap((req, res) => {
  const approve = req.params.decision === 'approve';
  if (!['approve', 'reject'].includes(req.params.decision)) fail(404, 'Không hỗ trợ thao tác này.');
  const a = q.get(`${SELECT} WHERE a.id = ?`, Number(req.params.id));
  if (!a) fail(404, 'Không tìm thấy ấn phẩm.');
  if (a.status !== 'pending') fail(400, 'Ấn phẩm không ở trạng thái chờ duyệt.');
  if (!a.reviewable) fail(400, 'Ấn phẩm thuộc hồ sơ chưa được Văn phòng Đoàn duyệt – Phòng Truyền thông duyệt sau bước của Văn phòng Đoàn.');
  const note = String(req.body?.note || '').trim();
  if (!approve && note.length < 10) fail(400, 'Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự) để ban tổ chức chỉnh sửa.');
  q.tx(() => {
    q.run('UPDATE media_assets SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?', approve ? 'approved' : 'rejected', req.user.id, now(), note || null, a.id);
    audit(req.user.id, approve ? 'asset.approve' : 'asset.reject', 'event', a.event_id, `${approve ? 'Duyệt' : 'Từ chối'} ấn phẩm: ${KINDS[a.kind]} "${a.title}"`, note);
    for (const o of q.all("SELECT id FROM users WHERE role = 'organizer' AND unit_id = ?", a.unit_id)) {
      notify(o.id, approve
        ? { type: 'media', title: 'Ấn phẩm đã được duyệt', body: `${KINDS[a.kind]} "${a.title}" (${a.event_title}) đã được Phòng Truyền thông duyệt, có thể đăng tải.${note ? ' Nhận xét: ' + note : ''}`, link: `/media-assets.html?id=${a.id}` }
        : { type: 'media', title: 'Ấn phẩm bị từ chối', body: `${KINDS[a.kind]} "${a.title}" cần chỉnh sửa: ${note}`, link: `/media-assets.html?id=${a.id}` });
    }
  });
  res.json({ ok: true });
}));

// Lịch sử duyệt ấn phẩm: mọi phiên bản cùng tên của sự kiện (bản bị từ chối → bản chỉnh sửa gửi lại), mỗi bản gồm lần gửi và kết quả duyệt
router.get('/assets/:id/history', requireRole('organizer', 'media', 'doan'), wrap((req, res) => {
  const a = q.get(`${SELECT} WHERE a.id = ?`, Number(req.params.id));
  if (!a) fail(404, 'Không tìm thấy ấn phẩm.');
  if (req.user.role === 'organizer' && !canManage(req.user, getEvent(a.event_id))) fail(403, 'Bạn không có quyền với ấn phẩm này.');
  const versions = q.all(`${SELECT} WHERE a.event_id = ? AND lower(a.title) = lower(?) ORDER BY a.submitted_at, a.id`, a.event_id, a.title);
  const items = [];
  versions.forEach((v, i) => {
    const label = versions.length > 1 ? `Bản ${i + 1}` : '';
    items.push({ at: v.submitted_at, kind: 'submit', actor: v.submitter_name || v.unit_short, version: label, current: v.id === a.id, file: v.original_name });
    if (v.reviewed_at) items.push({ at: v.reviewed_at, kind: v.status, actor: v.reviewer_name, note: v.review_note, version: label, current: v.id === a.id });
  });
  items.sort((x, y) => y.at.localeCompare(x.at));
  res.json({ items });
}));

// Xem / tải file ấn phẩm (BTC của sự kiện, bộ phận duyệt; người khác chỉ xem ấn phẩm đã duyệt của sự kiện công khai)
router.get('/assets/:id/file', wrap((req, res) => {
  const a = q.get('SELECT * FROM media_assets WHERE id = ?', Number(req.params.id));
  if (!a) fail(404, 'Không tìm thấy ấn phẩm.');
  const ev = getEvent(a.event_id);
  const insider = canManage(req.user, ev) || isReviewer(req.user);
  if (!insider && !(a.status === 'approved' && ['approved', 'cancelled'].includes(ev.status))) fail(403, 'Bạn không có quyền xem ấn phẩm này.');
  const file = path.join(UPLOAD_DIR, a.stored_name);
  if (!fs.existsSync(file)) fail(404, 'File ấn phẩm không còn trên máy chủ.');
  if (req.query.download === '1') return res.download(file, a.original_name);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
}));

module.exports = router;
