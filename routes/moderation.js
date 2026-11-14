// Duyệt hồ sơ sự kiện – quy trình TUẦN TỰ:
//   1. Ban tổ chức nộp kế hoạch (file đính kèm) + ấn phẩm truyền thông
//   2. Văn phòng Đoàn trường (doan): duyệt kế hoạch, phòng/địa điểm, xác nhận cấp chương trình & cấp điểm Đoàn
//   3. Phòng Truyền thông (media): duyệt ấn phẩm truyền thông của sự kiện (chỉ sau khi Văn phòng Đoàn đã duyệt)
//   4. Phòng Truyền thông duyệt xong → sự kiện được công khai, sinh viên mới nhìn thấy
// Bước nào từ chối → hồ sơ trả về Ban tổ chức; nộp lại thì bắt đầu lại từ bước 2.
const express = require('express');
const { q } = require('../db/database');
const { now, notify, audit, wrap, fail } = require('../lib/util');
const { EVENT_SELECT, decorate, getEvent, roomConflicts, SIDE_NAME } = require('../lib/events');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('doan', 'media'));

const CHECKS = {
  doan: ['Kế hoạch phù hợp định hướng Đoàn', 'Phòng/địa điểm phù hợp quy mô', 'Cấp chương trình & điểm Đoàn hợp lý', 'Đủ hồ sơ, kinh phí hợp lý'],
  media: ['Banner/ấn phẩm đạt chuẩn thiết kế', 'Nội dung truyền thông chính xác', 'Đúng nhận diện thương hiệu NEU'],
};
// Hồ sơ đang đến lượt bộ phận nào
const TURN = {
  doan: "e.status = 'pending' AND e.doan_status = 'pending'",
  media: "e.status = 'pending' AND e.doan_status = 'approved' AND e.media_status = 'pending'",
};
const TURN_PLAIN = { doan: TURN.doan.replace(/e\./g, ''), media: TURN.media.replace(/e\./g, '') };

router.get('/', wrap((req, res) => {
  const side = req.user.role;
  const { q: kw = '', status = '' } = req.query;
  const where = ["e.status IN ('pending','approved','rejected','cancelled')"]; const params = [];
  if (status === 'mine') where.push(TURN[side]);
  // VP Đoàn: đã duyệt, đang chờ Truyền thông • Truyền thông: chưa đến lượt (đang chờ VP Đoàn)
  else if (status === 'other') where.push(side === 'doan' ? TURN.media : TURN.doan);
  else if (status) { where.push('e.status = ?'); params.push(status); }
  if (kw) { where.push('(e.title LIKE ? OR e.code LIKE ? OR un.name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const rows = q.all(`${EVENT_SELECT} WHERE ${where.join(' AND ')}
                      ORDER BY CASE WHEN ${TURN[side]} THEN 0 WHEN e.status = 'pending' THEN 1 ELSE 2 END,
                               COALESCE(e.reviewed_at, e.submitted_at) DESC`, ...params)
    .map((e) => decorate(e));
  const at = now(); const month = at.slice(0, 7);
  const stats = q.get(`SELECT
      SUM(${TURN_PLAIN[side]}) mine,
      SUM(${side === 'doan' ? TURN_PLAIN.media : TURN_PLAIN.doan}) waiting_other,
      SUM(status IN ('approved','cancelled') AND substr(reviewed_at,1,7) = ?) approved_month,
      SUM(status IN ('approved','cancelled')) approved_total,
      SUM(status='rejected') rejected,
      SUM(status='rejected' AND ${side}_status='rejected') rejected_mine
    FROM events`, month);
  res.json({ events: rows, stats, side, side_name: SIDE_NAME[side],
    month: `${month.slice(5, 7)}/${month.slice(0, 4)}`, checks: CHECKS[side] });
}));

function decide(req, res, approve) {
  const side = req.user.role;
  const ev = getEvent(Number(req.params.id));
  if (!ev) fail(404, 'Không tìm thấy hồ sơ.');
  if (ev.status !== 'pending') fail(400, 'Hồ sơ không ở trạng thái chờ duyệt.');
  if (side === 'media' && ev.doan_status !== 'approved') fail(400, 'Hồ sơ cần được Văn phòng Đoàn trường duyệt và cấp điểm trước khi Phòng Truyền thông duyệt ấn phẩm.');
  if (ev[`${side}_status`] !== 'pending') fail(400, `${SIDE_NAME[side]} đã ra quyết định cho hồ sơ này.`);
  const note = String(req.body?.note || '').trim();
  const checks = Array.isArray(req.body?.checks) ? req.body.checks.filter((c) => CHECKS[side].includes(c)) : [];
  if (!approve && note.length < 10) fail(400, 'Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự) để ban tổ chức bổ sung.');
  if (approve && checks.length < CHECKS[side].length) fail(400, 'Hồ sơ chưa đạt đủ tiêu chí kiểm duyệt bắt buộc – đánh dấu đủ các tiêu chí hoặc từ chối hồ sơ kèm lý do.');
  if (approve && ev.start_at <= now()) fail(400, 'Thời gian tổ chức đã qua, không thể phê duyệt. Hãy từ chối để BTC cập nhật lịch.');

  // Văn phòng Đoàn: kiểm tra phòng và cấp điểm Đoàn (cấp chương trình + số điểm)
  let level = ev.level, points = ev.points;
  if (approve && side === 'doan') {
    if (ev.room_id) {
      if (ev.room_capacity && ev.capacity > ev.room_capacity) fail(400, `Quy mô ${ev.capacity} người vượt sức chứa ${ev.room_name} (${ev.room_capacity} chỗ). Hãy từ chối để BTC điều chỉnh.`);
      const c = roomConflicts(ev.room_id, ev.start_at, ev.end_at, ev.id);
      if (c.length) fail(409, `${ev.room_name} đã được dùng cho "${c[0].title}" (${c[0].start_at.slice(11, 16)}–${c[0].end_at.slice(11, 16)} ngày ${c[0].start_at.slice(8, 10)}/${c[0].start_at.slice(5, 7)}). Hãy từ chối để BTC đổi phòng hoặc thời gian.`);
    }
    if (['truong', 'khoa', 'clb'].includes(req.body?.level)) level = req.body.level;
    if (req.body?.points !== undefined && req.body.points !== '') {
      points = parseInt(req.body.points, 10);
      if (!(points >= 0 && points <= 20)) fail(400, 'Điểm Đoàn phải từ 0 đến 20.');
    }
  }
  // Phòng Truyền thông: duyệt ấn phẩm của sự kiện
  const pendingAssets = side === 'media' ? q.all("SELECT id, title FROM media_assets WHERE event_id = ? AND status = 'pending'", ev.id) : [];
  if (approve && side === 'media' && !pendingAssets.length && !q.get("SELECT 1 FROM media_assets WHERE event_id = ? AND status = 'approved'", ev.id)) {
    fail(400, 'Sự kiện chưa có ấn phẩm truyền thông nào để duyệt. Hãy từ chối để BTC bổ sung.');
  }

  const at = now();
  const published = approve && side === 'media';
  q.tx(() => {
    q.run(`UPDATE events SET ${side}_status=?, ${side}_by=?, ${side}_at=?, ${side}_note=?, ${side}_checks=?, level=?, points=?, updated_at=? WHERE id=?`,
      approve ? 'approved' : 'rejected', req.user.id, at, note || null, JSON.stringify(checks), level, points, at, ev.id);
    if (!approve) {
      q.run("UPDATE events SET status='rejected', reviewed_at=?, reviewed_by=?, review_note=? WHERE id=?", at, req.user.id, `${SIDE_NAME[side]}: ${note}`, ev.id);
    } else if (published) {
      q.run("UPDATE events SET status='approved', reviewed_at=?, reviewed_by=?, review_note=? WHERE id=?", at, req.user.id, note || ev.doan_note || null, ev.id);
    }
    // Quyết định của Phòng Truyền thông áp dụng cho các ấn phẩm đang chờ của sự kiện
    for (const a of pendingAssets) {
      q.run('UPDATE media_assets SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?', approve ? 'approved' : 'rejected', req.user.id, at, note || null, a.id);
      audit(req.user.id, approve ? 'asset.approve' : 'asset.reject', 'event', ev.id, `${approve ? 'Duyệt' : 'Từ chối'} ấn phẩm "${a.title}" (cùng hồ sơ)`, note);
    }
    const changed = side === 'doan' ? ` – cấp điểm Đoàn: ${level === 'truong' ? 'cấp Trường' : level === 'clb' ? 'cấp Chi đoàn/CLB' : 'cấp Khoa/Viện'}, ${points} điểm` : '';
    audit(req.user.id, approve ? 'event.approve' : 'event.reject', 'event', ev.id,
      approve ? `${SIDE_NAME[side]} duyệt${checks.length ? ' (' + checks.join(', ') + ')' : ''}${changed}` : `${SIDE_NAME[side]} từ chối hồ sơ`, note);
    if (published) audit(req.user.id, 'event.publish', 'event', ev.id, 'Phòng Truyền thông duyệt ấn phẩm – công khai sự kiện, mở đăng ký');

    const recipients = new Set([ev.created_by, ...q.all("SELECT id FROM users WHERE role='organizer' AND unit_id = ?", ev.unit_id).map((u) => u.id)]);
    for (const uid of recipients) {
      if (!uid) continue;
      notify(uid, !approve
        ? { type: 'moderation', title: `${SIDE_NAME[side]} từ chối hồ sơ`, body: `"${ev.title}" cần bổ sung: ${note}`, link: `/event-form.html?id=${ev.id}` }
        : published
          ? { type: 'moderation', title: 'Sự kiện đã được công khai', body: `"${ev.title}" đã được Phòng Truyền thông duyệt ấn phẩm; sự kiện được công khai và mở đăng ký.`, link: `/event-detail.html?id=${ev.id}` }
          : { type: 'moderation', title: 'Văn phòng Đoàn đã duyệt & cấp điểm', body: `"${ev.title}" được duyệt, ${points} điểm Đoàn. Hồ sơ chuyển sang Phòng Truyền thông duyệt ấn phẩm.${note ? ' Nhận xét: ' + note : ''}`, link: '/manage-events.html' });
    }
    // Bước tiếp theo: báo Phòng Truyền thông
    if (approve && side === 'doan') {
      for (const m of q.all("SELECT id FROM users WHERE role = 'media' AND is_active = 1")) {
        notify(m.id, { type: 'moderation', title: 'Hồ sơ chờ duyệt ấn phẩm', body: `"${ev.title}" (${ev.unit_short || ''}) đã được Văn phòng Đoàn duyệt, chờ Phòng Truyền thông duyệt ấn phẩm.`, link: `/moderation.html?id=${ev.id}` });
      }
    }
  });
  res.json({ ok: true, published });
}

router.post('/:id/approve', wrap((req, res) => decide(req, res, true)));
router.post('/:id/reject', wrap((req, res) => decide(req, res, false)));

module.exports = router;
