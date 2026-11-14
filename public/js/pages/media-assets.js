// Trang Ấn phẩm truyền thông
//   • Ban tổ chức: gửi banner / poster / standee / bài đăng / video của sự kiện, theo dõi kết quả, gửi bản chỉnh sửa
//   • Phòng Truyền thông: duyệt hoặc từ chối (bắt buộc lý do) trước khi ấn phẩm được đăng tải
(async function () {
  const { api, esc, icon, fmtDate, fmtDateTime, fmtNum, fmtSize, toast, modal, askReason } = App;
  let user;
  try { ({ user } = await App.init({ page: 'assets', roles: ['organizer', 'media'] })); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const isMedia = user.role === 'media';
  const stat = (label, val, sub, ic) => `<div class="stat"><div class="stat-top">${label} ${icon(ic)}</div><strong>${val}</strong><small>${sub}</small></div>`;
  const ST = { pending: ['Chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], rejected: ['Từ chối', 'red'] };
  let KINDS = {}, items = [], status = App.param('status') ?? (isMedia && !App.param('id') ? 'pending' : ''), selected = Number(App.param('id')) || null;

  $('pageTitle').textContent = isMedia ? 'Duyệt ấn phẩm truyền thông' : 'Ấn phẩm truyền thông';
  $('crumb').textContent = $('pageTitle').textContent;
  $('pageSub').textContent = isMedia
    ? 'Banner, poster, standee, bài đăng và video do Ban tổ chức gửi. Ấn phẩm chỉ được đăng tải sau khi Phòng Truyền thông duyệt.'
    : 'Gửi banner, poster, bài đăng... của sự kiện để Phòng Truyền thông duyệt. Ấn phẩm đã duyệt hiển thị trên trang chi tiết sự kiện.';
  if (!isMedia) { $('addBtn').hidden = false; $('addBtn').innerHTML = `${icon('upload')}Gửi ấn phẩm mới`; }
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.st === status));

  // Ấn phẩm nộp kèm hồ sơ chưa qua Văn phòng Đoàn → chưa đến lượt Phòng Truyền thông
  const waitingDoan = (a) => a.status === 'pending' && !a.reviewable;
  const stTag = (a) => waitingDoan(a) ? '<span class="st gray">Chờ VP Đoàn (bước 1)</span>' : `<span class="st ${ST[a.status][1]}">${ST[a.status][0]}</span>`;
  const fileUrl = (a, dl) => `/api/media/assets/${a.id}/file${dl ? '?download=1' : ''}`;
  const isImg = (a) => /^image\//.test(a.mime || '') || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.stored_name || '');
  const thumb = (a) => isImg(a) ? `<div class="th" style="background-image:url('${fileUrl(a)}')"></div>` : `<div class="th">${icon(a.kind === 'video' ? 'activity' : 'file')}</div>`;

  async function load() {
    const p = new URLSearchParams({ status, q: $('kw').value.trim(), kind: $('kind').value });
    let d;
    try { d = await api(`/api/media/assets?${p}`); } catch (err) { $('list').innerHTML = App.emptyState('Không tải được dữ liệu', err.message); return; }
    if (!Object.keys(KINDS).length) { KINDS = d.kinds; $('kind').innerHTML += Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); }
    items = d.items; const c = d.counts || {};
    $('stats').innerHTML = stat('Chờ duyệt', fmtNum(c.pending || 0), isMedia ? `Đến lượt Truyền thông • ${fmtNum(c.waiting_doan || 0)} đang chờ VP Đoàn` : 'Trong hồ sơ chờ duyệt', 'clock') +
      stat('Đã duyệt', fmtNum(c.approved || 0), `${fmtNum(c.approved_month || 0)} trong tháng này`, 'check') +
      stat('Bị từ chối', fmtNum(c.rejected || 0), isMedia ? 'Đã gửi lý do cho Ban tổ chức' : 'Cần chỉnh sửa và gửi lại', 'alert') +
      stat('Tổng ấn phẩm', fmtNum(c.total || 0), isMedia ? 'Toàn trường' : 'Của đơn vị', 'image');
    $('list').innerHTML = items.length ? items.map((a) => `<button class="as-item ${a.id === selected ? 'sel' : ''}" data-id="${a.id}">
        ${thumb(a)}
        <div><b>${esc(a.title)}</b><small>${esc(KINDS[a.kind] || a.kind)} • ${esc(a.event_title)}</small>
        ${stTag(a)} <small style="display:inline">${esc(a.unit_short || '')} • ${fmtDate(a.submitted_at)}</small></div>
      </button>`).join('') : App.emptyState('Chưa có ấn phẩm', isMedia ? 'Không có ấn phẩm phù hợp bộ lọc.' : 'Bấm "Gửi ấn phẩm mới" để gửi banner, poster của sự kiện.', 'image');
    document.querySelectorAll('.as-item').forEach((b) => b.addEventListener('click', () => { selected = Number(b.dataset.id); history.replaceState(null, '', `?id=${selected}`); show(); }));
    if (!selected || !items.find((a) => a.id === selected)) selected = (items.find((a) => a.status === 'pending' && a.reviewable) || items[0] || {}).id || null;
    show();
  }

  function show() {
    document.querySelectorAll('.as-item').forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === selected));
    const a = items.find((x) => x.id === selected);
    if (!a) { $('detail').innerHTML = `<div class="hint">Chọn một ấn phẩm để xem chi tiết.</div>`; return; }
    const preview = isImg(a) ? `<img src="${fileUrl(a)}" alt="${esc(a.title)}">`
      : /video/.test(a.mime || '') ? `<video src="${fileUrl(a)}" controls></video>`
        : /pdf/.test(a.mime || '') ? `<iframe src="${fileUrl(a)}" title="${esc(a.title)}"></iframe>` : App.emptyState('Không xem trước được', 'Tải file về để xem.', 'file');
    const note = waitingDoan(a) ? `<div class="as-note gray"><b>Chưa đến lượt duyệt:</b> ấn phẩm nộp kèm hồ sơ sự kiện đang chờ Văn phòng Đoàn duyệt kế hoạch và cấp điểm (bước 1). ${isMedia ? 'Phòng Truyền thông duyệt sau khi bước 1 hoàn tất.' : ''}</div>`
      : a.status === 'rejected' ? `<div class="as-note red"><b>Lý do từ chối:</b> ${esc(a.review_note || '')}</div>`
      : a.status === 'approved' ? `<div class="as-note green"><b>Đã duyệt</b>${a.review_note ? ': ' + esc(a.review_note) : ' – được phép đăng tải.'}</div>` : '';
    const actions = isMedia
      ? (a.status === 'pending' && a.reviewable ? `<button class="btn-outline" id="rejBtn">${icon('x')}Từ chối</button><button class="btn-primary" id="okBtn">${icon('check')}Duyệt ấn phẩm</button>` : '')
      : (a.status !== 'approved' ? `<button class="btn-outline" id="delBtn">${icon('trash')}Xóa</button>` : '') +
        (a.status === 'rejected' ? `<button class="btn-primary" id="resendBtn">${icon('upload')}Gửi bản chỉnh sửa</button>` : '');
    $('detail').innerHTML = `
      <div class="card-head"><div><h3>${esc(a.title)}</h3><div class="hint">${esc(KINDS[a.kind] || a.kind)} • <a class="link" href="/event-detail.html?id=${a.event_id}">${esc(a.event_title)}</a></div></div>
        ${stTag(a)}</div>
      <div class="as-preview">${preview}</div>
      <dl class="as-meta">
        <div><dt>Đơn vị gửi</dt><dd>${esc(a.unit_short || '')}${a.submitter_name && !a.submitter_name.includes(a.unit_short || '§') && a.submitter_name.length < 40 ? ` • ${esc(a.submitter_name)}` : ''}</dd></div>
        <div><dt>Thời gian gửi</dt><dd>${fmtDateTime(a.submitted_at)}</dd></div>
        <div><dt>Kênh đăng tải dự kiến</dt><dd>${esc(a.channel || '—')}</dd></div>
        <div><dt>File</dt><dd>${esc(a.original_name)} • ${fmtSize(a.size || 0)} • <a class="link" href="${fileUrl(a, true)}">Tải về</a></dd></div>
        <div><dt>Sự kiện diễn ra</dt><dd>${fmtDateTime(a.start_at)}</dd></div>
        <div><dt>Người duyệt</dt><dd>${a.reviewer_name ? `${esc(a.reviewer_name)} • ${fmtDateTime(a.reviewed_at)}` : '—'}</dd></div>
      </dl>
      ${a.description ? `<div class="as-note gray"><b>Nội dung / ghi chú:</b> ${esc(a.description)}</div>` : ''}
      ${note}
      ${actions ? `<div class="as-actions">${actions}</div>` : ''}
      <h4 class="as-hist-title">Lịch sử duyệt</h4><div class="as-hist" id="asHist"><div class="hint">Đang tải…</div></div>`;
    loadHistory(a);
    if ($('okBtn')) $('okBtn').onclick = async () => {
      const ok = await modal({ title: 'Duyệt ấn phẩm?', desc: `"${esc(a.title)}" sẽ được phép đăng tải và hiển thị trên trang sự kiện.`, okText: 'Duyệt',
        html: '<label class="label">Nhận xét (không bắt buộc)</label><textarea class="inp" id="m-note"></textarea>',
        onOk: (root) => api(`/api/media/assets/${a.id}/approve`, { method: 'POST', body: { note: root.querySelector('#m-note').value.trim() } }) });
      if (ok) { toast('Đã duyệt ấn phẩm.', 'ok'); load(); }
    };
    if ($('rejBtn')) $('rejBtn').onclick = async () => {
      const note = await askReason('Từ chối ấn phẩm', 'Ban tổ chức sẽ nhận lý do để chỉnh sửa và gửi lại.', { okText: 'Từ chối', danger: true, min: 10, placeholder: 'VD: Logo NEU sai tỷ lệ, thiếu thông tin thời gian...' });
      if (!note) return;
      try { await api(`/api/media/assets/${a.id}/reject`, { method: 'POST', body: { note } }); toast('Đã từ chối ấn phẩm.', 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
    };
    if ($('delBtn')) $('delBtn').onclick = async () => {
      if (!(await App.confirmBox('Xóa ấn phẩm?', `"${esc(a.title)}" sẽ bị xóa khỏi hệ thống.`, 'Xóa', true))) return;
      try { await api(`/api/media/assets/${a.id}`, { method: 'DELETE' }); toast('Đã xóa ấn phẩm.', 'ok'); selected = null; load(); } catch (err) { toast(err.message, 'err'); }
    };
    if ($('resendBtn')) $('resendBtn').onclick = () => submitForm({ event_id: a.event_id, kind: a.kind, title: a.title, channel: a.channel });
  }

  // Lịch sử duyệt ấn phẩm (các lần gửi / duyệt / từ chối, kể cả bản trước khi chỉnh sửa)
  async function loadHistory(a) {
    let items = [];
    try { ({ items } = await api(`/api/media/assets/${a.id}/history`)); } catch { /* bỏ qua */ }
    if (!$('asHist')) return;
    const LBL = { submit: ['Gửi duyệt', ''], approved: ['Đã duyệt', 'green'], rejected: ['Từ chối', 'red'] };
    $('asHist').innerHTML = items.length ? items.map((h) => `<div class="as-h ${LBL[h.kind][1]}"><i></i><div>
        <b>${LBL[h.kind][0]}${h.version ? ` • ${esc(h.version)}${h.current ? ' (bản đang xem)' : ''}` : ''}</b>
        <small>${esc(h.actor || 'Hệ thống')} • ${fmtDateTime(h.at)}${h.file ? ` • ${esc(h.file)}` : ''}</small>${h.note ? `<p>${esc(h.note)}</p>` : ''}</div></div>`).join('')
      : '<div class="hint">Chưa có lịch sử duyệt.</div>';
  }

  // BTC gửi ấn phẩm mới
  async function submitForm(pre = {}) {
    let evs;
    try { ({ events: evs } = await api('/api/media/events')); } catch (err) { toast(err.message, 'err'); return; }
    if (!evs.length) { toast('Đơn vị chưa có sự kiện sắp diễn ra để gửi ấn phẩm.', 'err'); return; }
    const ST_EV = { draft: 'nháp', pending: 'chờ duyệt', approved: 'đã duyệt', rejected: 'bị từ chối' };
    const ok = await modal({
      title: pre.title ? 'Gửi bản chỉnh sửa' : 'Gửi ấn phẩm truyền thông', wide: true, okText: 'Gửi duyệt',
      desc: 'Ảnh JPG/PNG/WEBP, PDF hoặc video MP4, tối đa 20 MB. Phòng Truyền thông sẽ nhận thông báo.',
      html: `<div class="f-grid">
        <div class="full"><label class="label">Sự kiện <span class="req">*</span></label><select class="inp" id="fEv" style="width:100%;height:38px">${evs.map((e) => `<option value="${e.id}" ${e.id === pre.event_id ? 'selected' : ''}>${esc(e.title)} (${fmtDate(e.start_at)} • ${ST_EV[e.status] || e.status})</option>`).join('')}</select></div>
        <div><label class="label">Loại ấn phẩm <span class="req">*</span></label><select class="inp" id="fKind" style="width:100%;height:38px">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === pre.kind ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div><label class="label">Kênh đăng tải dự kiến</label><input class="inp" id="fCh" value="${esc(pre.channel || '')}" placeholder="Fanpage, màn hình LED..." style="width:100%;height:38px"></div>
        <div class="full"><label class="label">Tên ấn phẩm <span class="req">*</span></label><input class="inp" id="fTitle" value="${esc(pre.title || '')}" style="width:100%;height:38px"></div>
        <div class="full"><label class="label">Nội dung bài đăng / ghi chú</label><textarea class="inp" id="fDesc"></textarea></div>
        <div class="full"><label class="label">File ấn phẩm <span class="req">*</span></label><input type="file" id="fFile" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4"></div>
      </div>`,
      onOk: async (root) => {
        const fd = new FormData();
        fd.append('event_id', root.querySelector('#fEv').value); fd.append('kind', root.querySelector('#fKind').value);
        fd.append('title', root.querySelector('#fTitle').value); fd.append('channel', root.querySelector('#fCh').value);
        fd.append('description', root.querySelector('#fDesc').value);
        const f = root.querySelector('#fFile').files[0]; if (f) fd.append('file', f);
        return api('/api/media/assets', { method: 'POST', form: fd });
      },
    });
    if (ok) { toast('Đã gửi ấn phẩm – chờ Phòng Truyền thông duyệt.', 'ok'); selected = ok.id; status = ''; document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.st === '')); load(); }
  }

  $('addBtn').onclick = () => submitForm();
  document.querySelectorAll('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab.active').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); status = t.dataset.st; selected = null; load();
  }));
  let tm;
  $('kw').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 300); });
  $('kind').addEventListener('change', load);
  load();
})();
