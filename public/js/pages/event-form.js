// Trang Tạo / sửa hồ sơ sự kiện (Ban tổ chức) – chọn phòng do Văn phòng Đoàn quản lý
(async function () {
  const { api, esc, icon, fmtSize, fmtDateTime, toast, toInput } = App;
  let user;
  try { ({ user } = await App.init({ page: 'manage', roles: ['organizer'] })); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const form = $('form');
  const F = (n) => form.elements[n];
  const id = Number(App.param('id')) || null;
  const removeFiles = new Set();

  const [meta, { rooms }] = await Promise.all([api('/api/meta'), api('/api/rooms')]);
  F('room_id').innerHTML = '<option value="">— Chọn phòng —</option>' + rooms.map((r) => `<option value="${r.id}">${esc(r.name)} (${r.capacity} chỗ)</option>`).join('') +
    '<option value="other">Địa điểm khác (ngoài trời, ngoài trường...)</option>';
  const roomChanged = () => {
    const v = F('room_id').value; const r = rooms.find((x) => String(x.id) === v);
    $('locWrap').hidden = v !== 'other';
    $('roomHint').textContent = r ? `${r.code} • sức chứa ${r.capacity} người${r.equipment ? ' • ' + r.equipment : ''}` : v === 'other' ? 'Văn phòng Đoàn sẽ kiểm tra thủ công địa điểm ngoài danh mục phòng.' : 'Phòng do Văn phòng Đoàn quản lý; hệ thống kiểm tra sức chứa và trùng lịch.';
  };
  F('room_id').addEventListener('change', roomChanged);
  F('category_id').innerHTML = '<option value="">— Chọn loại —</option>' + meta.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  F('unit_id').innerHTML = meta.units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  F('unit_id').value = user.unit_id || '';
  F('unit_id').disabled = true;
  F('level').innerHTML = meta.levels.map((l) => `<option value="${l.key}">${esc(l.name)} (mặc định ${l.points} điểm)</option>`).join('');
  F('level').value = 'khoa';
  F('level').addEventListener('change', () => { const l = meta.levels.find((x) => x.key === F('level').value); if (l) F('points').value = l.points; });

  // ----- Chương trình (agenda) -----
  function addAgenda(a = {}) {
    const row = document.createElement('div'); row.className = 'ag-row';
    row.innerHTML = `<input class="inp" placeholder="08:00 – 08:30" value="${esc(a.time_label || '')}" data-k="time_label">
      <input class="inp" placeholder="Nội dung" value="${esc(a.title || '')}" data-k="title">
      <input class="inp" placeholder="Ghi chú (không bắt buộc)" value="${esc(a.description || '')}" data-k="description">
      <button type="button" aria-label="Xóa mốc">${icon('trash')}</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('agenda').appendChild(row);
  }
  $('addAgenda').onclick = () => addAgenda();
  const agendaData = () => [...document.querySelectorAll('.ag-row')].map((r) => Object.fromEntries([...r.querySelectorAll('input')].map((i) => [i.dataset.k, i.value.trim()]))).filter((a) => a.title);

  // ----- Ấn phẩm truyền thông nộp kèm hồ sơ -----
  const KIND = { banner: 'Banner', poster: 'Poster', standee: 'Standee', post: 'Bài đăng mạng xã hội', video: 'Video', other: 'Ấn phẩm khác' };
  const AST = { pending: ['Chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], rejected: ['Bị từ chối', 'red'] };
  let existingAssets = [];
  function addAssetRow() {
    const row = document.createElement('div'); row.className = 'as-row';
    row.innerHTML = `<select class="inp" data-k="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input class="inp" data-k="title" placeholder="Tên ấn phẩm, VD: Banner chính">
      <input type="file" data-k="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4">
      <button type="button" aria-label="Bỏ ấn phẩm">${icon('trash')}</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('assetRows').appendChild(row);
  }
  $('addAsset').onclick = addAssetRow;
  const newAssets = () => [...document.querySelectorAll('.as-row')].map((r) => ({
    kind: r.querySelector('[data-k=kind]').value, title: r.querySelector('[data-k=title]').value.trim(), file: r.querySelector('[data-k=file]').files[0],
  })).filter((a) => a.file || a.title);
  function renderExistingAssets() {
    $('existingAssets').innerHTML = existingAssets.map((a) => `<div class="ex-asset"><span>${icon('image', 'style="width:13px;height:13px;display:inline;vertical-align:-2px"')} ${esc(KIND[a.kind])}: <a class="link" href="/api/media/assets/${a.id}/file" target="_blank" rel="noopener">${esc(a.title)}</a>
        ${a.status === 'rejected' && a.review_note ? `<br><small style="color:#c23a3a">${esc(a.review_note)}</small>` : ''}</span>
      <span style="display:flex;gap:8px;align-items:center;flex:none"><span class="st ${AST[a.status][1]}">${AST[a.status][0]}</span>${a.status !== 'approved' ? `<a class="link danger" data-rma="${a.id}">Xóa</a>` : ''}</span></div>`).join('');
    document.querySelectorAll('[data-rma]').forEach((x) => x.onclick = async () => {
      try { await api(`/api/media/assets/${x.dataset.rma}`, { method: 'DELETE' }); existingAssets = existingAssets.filter((a) => a.id !== Number(x.dataset.rma)); renderExistingAssets(); toast('Đã xóa ấn phẩm.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    });
  }

  // ----- Ảnh bìa xem trước -----
  const setCover = (url) => { $('coverPrev').style.backgroundImage = url ? `url('${url}')` : ''; };
  $('cover').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setCover(URL.createObjectURL(f)); });

  // ----- Tự điền giờ kết thúc (+2 giờ) và hạn đăng ký (23:59 hôm trước) khi chọn giờ bắt đầu -----
  const p2 = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  F('start_at').addEventListener('change', () => {
    if (!F('start_at').value) return;
    const s0 = new Date(F('start_at').value);
    if (!F('end_at').value) { const e = new Date(s0); e.setHours(e.getHours() + 2); F('end_at').value = local(e); }
    if (!F('reg_deadline').value) { const r = new Date(s0); r.setDate(r.getDate() - 1); r.setHours(23, 59, 0, 0); F('reg_deadline').value = local(r); }
  });

  // ----- Nạp hồ sơ khi sửa -----
  if (id) {
    let ev;
    try { ({ event: ev } = await api(`/api/events/${id}`)); } catch (err) { document.querySelector('.container').innerHTML = `<div class="card">${App.emptyState('Không tìm thấy hồ sơ', err.message)}</div>`; return; }
    if (!ev.can_manage) { document.querySelector('.container').innerHTML = `<div class="card">${App.emptyState('Bạn không có quyền sửa hồ sơ này', '', 'lock')}</div>`; return; }
    if (!['draft', 'rejected'].includes(ev.status)) {
      document.querySelector('.container').innerHTML = `<div class="card">${App.emptyState('Hồ sơ không thể chỉnh sửa', 'Chỉ sửa được hồ sơ ở trạng thái Nháp hoặc Bị từ chối. Hồ sơ đang chờ duyệt có thể rút về nháp ở trang Quản lý sự kiện.', 'lock')}<div style="text-align:center"><a class="btn-primary" href="/manage-events.html">Về Quản lý sự kiện</a></div></div>`;
      return;
    }
    document.title = `Sửa: ${ev.title} – NEU Events`;
    $('heading').textContent = 'Chỉnh sửa hồ sơ sự kiện'; $('crumb').textContent = ev.code;
    for (const k of ['title', 'slogan', 'summary', 'description', 'benefits', 'preparation', 'location', 'capacity', 'fee', 'budget', 'contact_name', 'contact_phone', 'contact_email', 'category_id', 'unit_id', 'level', 'points']) if (F(k)) F(k).value = ev[k] ?? '';
    for (const k of ['start_at', 'end_at', 'reg_deadline']) F(k).value = toInput(ev[k]);
    F('room_id').value = ev.room_id && rooms.find((r) => r.id === ev.room_id) ? String(ev.room_id) : 'other'; roomChanged();
    ev.agenda.forEach(addAgenda);
    if (ev.cover_image) setCover(ev.cover_image);
    const fileRow = (f) => `<div class="ex-file" data-f="${f.id}" data-kind="${f.kind || 'plan'}"><span>${icon('file', 'style="width:13px;height:13px;display:inline;vertical-align:-2px"')} ${esc(f.original_name)} • ${fmtSize(f.size)}</span><a class="link danger" data-rm="${f.id}">Xóa</a></div>`;
    $('existingFiles').innerHTML = ev.files.filter((f) => f.kind !== 'room').map(fileRow).join('');
    $('existingRoomFiles').innerHTML = ev.files.filter((f) => f.kind === 'room').map(fileRow).join('');
    document.querySelectorAll('[data-rm]').forEach((a) => a.addEventListener('click', () => {
      const fid = Number(a.dataset.rm); const row = a.closest('.ex-file');
      if (removeFiles.has(fid)) { removeFiles.delete(fid); row.classList.remove('rm'); a.textContent = 'Xóa'; } else { removeFiles.add(fid); row.classList.add('rm'); a.textContent = 'Hoàn tác'; }
    }));
    existingAssets = ev.assets || []; renderExistingAssets();
    if (!existingAssets.some((a) => a.status !== 'rejected')) addAssetRow();
    if (App.param('msg')) $('formAlert').innerHTML = `<div class="alert err">${esc(App.param('msg'))}</div>`;
    if (ev.status === 'rejected') $('rejectBox').innerHTML = `<div class="alert err"><b>Hồ sơ bị từ chối</b> (${esc(ev.reviewer_name || '')} • ${fmtDateTime(ev.reviewed_at)}): ${esc(ev.review_note || '')}<br>Vui lòng bổ sung theo góp ý rồi bấm “Lưu & gửi duyệt”.</div>`;
    $('submitBtn').textContent = ev.status === 'rejected' ? 'Lưu & nộp lại' : 'Lưu & nộp hồ sơ';
  } else {
    F('contact_name').value = user.full_name; F('contact_phone').value = user.phone || ''; F('contact_email').value = user.email || '';
    addAssetRow();
    [['08:00 – 08:30', 'Check-in & khai mạc'], ['08:30 – 10:30', 'Nội dung chính'], ['10:30 – 11:00', 'Hỏi đáp & bế mạc']].forEach(([t, n]) => addAgenda({ time_label: t, title: n }));
  }

  // ----- Kiểm tra phía client (máy chủ cũng kiểm tra lại) -----
  function validate() {
    const errs = [];
    form.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid'));
    const need = (k, msg) => { if (!String(F(k).value).trim()) { F(k).classList.add('invalid'); errs.push(msg); } };
    need('title', 'Tên sự kiện'); need('category_id', 'Loại sự kiện'); need('start_at', 'Thời gian bắt đầu'); need('end_at', 'Thời gian kết thúc');
    need('reg_deadline', 'Hạn đăng ký'); need('room_id', 'Phòng / địa điểm'); if (F('room_id').value === 'other') need('location', 'Địa điểm khác'); need('capacity', 'Số lượng'); need('contact_name', 'Người phụ trách');
    if (errs.length) return `Vui lòng nhập: ${errs.join(', ')}.`;
    if (F('end_at').value <= F('start_at').value) { F('end_at').classList.add('invalid'); return 'Thời gian kết thúc phải sau thời gian bắt đầu.'; }
    if (F('reg_deadline').value > F('start_at').value) { F('reg_deadline').classList.add('invalid'); return 'Hạn đăng ký phải trước khi sự kiện bắt đầu.'; }
    if (newAssets().some((a) => !a.file || a.title.length < 3)) return 'Mỗi ấn phẩm cần có tên (tối thiểu 3 ký tự) và file.';
    return null;
  }
  // Điều kiện nộp: có kế hoạch tổ chức + giấy đăng ký phòng + ít nhất 1 ấn phẩm (máy chủ kiểm tra lại)
  function readyToSubmit() {
    const miss = [];
    const kept = (kind) => [...document.querySelectorAll(`.ex-file[data-kind="${kind}"]`)].filter((r) => !removeFiles.has(Number(r.dataset.f))).length;
    if (kept('plan') + $('files').files.length < 1) miss.push('file kế hoạch tổ chức');
    if (kept('room') + $('roomFiles').files.length < 1) miss.push('giấy đăng ký phòng');
    if (existingAssets.filter((a) => a.status !== 'rejected').length + newAssets().length < 1) miss.push('ít nhất một ấn phẩm truyền thông');
    return miss.length ? `Để nộp hồ sơ cần có ${miss.length > 1 ? `${miss.slice(0, -1).join(', ')} và ${miss[miss.length - 1]}` : miss[0]}. Bạn có thể bấm “Lưu nháp” để lưu tạm.` : null;
  }

  async function save(submit) {
    $('formAlert').innerHTML = '';
    const err = validate();
    if (err) { $('formAlert').innerHTML = `<div class="alert err">${esc(err)}</div>`; return; }
    const notReady = submit && readyToSubmit();
    if (notReady) { $('formAlert').innerHTML = `<div class="alert err">${esc(notReady)}</div>`; return; }
    const fd = new FormData();
    for (const k of ['title', 'slogan', 'summary', 'description', 'benefits', 'preparation', 'location', 'capacity', 'fee', 'budget', 'contact_name', 'contact_phone', 'contact_email', 'category_id', 'unit_id', 'level', 'points', 'start_at', 'end_at', 'reg_deadline']) fd.append(k, F(k).value);
    fd.set('room_id', F('room_id').value === 'other' ? '' : F('room_id').value);
    fd.append('agenda', JSON.stringify(agendaData()));
    fd.append('remove_files', JSON.stringify([...removeFiles]));
    fd.append('submit', '0'); // lưu trước, tải ấn phẩm, rồi mới nộp
    if ($('cover').files[0]) fd.append('cover', $('cover').files[0]);
    for (const f of $('files').files) fd.append('files', f);
    for (const f of $('roomFiles').files) fd.append('room_files', f);
    [$('submitBtn'), $('draftBtn')].forEach((b) => { b.disabled = true; });
    let savedId = id, saved = false;
    try {
      // 1. Lưu hồ sơ (nháp)
      const r = await api(id ? `/api/events/${id}` : '/api/events', { method: id ? 'PUT' : 'POST', form: fd });
      savedId = r.id; saved = true;
      // 2. Tải các ấn phẩm nộp kèm
      for (const a of newAssets()) {
        const af = new FormData();
        af.append('event_id', savedId); af.append('kind', a.kind); af.append('title', a.title); af.append('file', a.file);
        await api('/api/media/assets', { method: 'POST', form: af });
      }
      // 3. Nộp hồ sơ → Văn phòng Đoàn
      if (submit) await api(`/api/events/${savedId}/submit`, { method: 'POST' });
      toast(submit ? 'Đã nộp hồ sơ – chờ Văn phòng Đoàn duyệt kế hoạch và cấp điểm.' : 'Đã lưu bản nháp.', 'ok');
      setTimeout(() => { location.href = submit ? '/manage-events.html?status=pending' : `/event-form.html?id=${savedId}`; }, 600);
    } catch (e) {
      // Hồ sơ đã được lưu nhưng bước sau lỗi → mở lại hồ sơ để tránh tạo trùng
      if (saved) { location.href = `/event-form.html?id=${savedId}&msg=${encodeURIComponent(e.message)}`; return; }
      $('formAlert').innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
      [$('submitBtn'), $('draftBtn')].forEach((b) => { b.disabled = false; });
    }
  }
  $('submitBtn').onclick = () => save(true);
  $('draftBtn').onclick = () => save(false);
})();
