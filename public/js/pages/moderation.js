// Trang Duyệt sự kiện – dùng chung cho Văn phòng Đoàn và Phòng Truyền thông. Quy trình tuần tự:
// BTC nộp kế hoạch + ấn phẩm → (1) Văn phòng Đoàn duyệt & cấp điểm Đoàn → (2) Phòng Truyền thông duyệt ấn phẩm → công khai.
(async function () {
  const { api, esc, icon, fmtDate, fmtTime, fmtDateTime, fmtRange, fmtNum, fmtMoney, fmtSize, nl2br, toast, confirmBox, coverOf, approvalHtml, LEVEL } = App;
  let user;
  try { ({ user } = await App.init({ page: 'moderation', roles: ['doan', 'media'] })); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const side = user.role;
  const SIDE = App.SIDE;
  let items = [], checks = [], selected = Number(App.param('id')) || null;
  let filter = App.param('status') || (selected ? '' : 'mine'); // mở từ thông báo (?id=) → hiện tất cả để không mất hồ sơ
  $('status').value = filter;

  $('pageTitle').textContent = side === 'doan' ? 'Duyệt sự kiện – Văn phòng Đoàn' : 'Duyệt sự kiện – Phòng Truyền thông';
  $('pageSub').textContent = side === 'doan'
    ? 'Bước 1: duyệt kế hoạch tổ chức, phòng/địa điểm và cấp điểm Đoàn. Sau đó hồ sơ chuyển sang Phòng Truyền thông duyệt ấn phẩm.'
    : 'Bước 2: duyệt ấn phẩm truyền thông của các hồ sơ đã được Văn phòng Đoàn duyệt. Duyệt xong, sự kiện được công khai cho sinh viên.';
  $('optOther').textContent = side === 'doan' ? 'Đã duyệt – chờ Phòng Truyền thông (bước 2)' : 'Chưa đến lượt – đang chờ Văn phòng Đoàn (bước 1)';
  // Hồ sơ đang đến lượt bộ phận mình
  const myTurn = (e) => e.status === 'pending' && (side === 'doan' ? e.doan_status === 'pending' : e.doan_status === 'approved' && e.media_status === 'pending');

  const TAG = { pending: ['Chờ duyệt', 'amber'], approved: ['Đã công khai', 'green'], rejected: ['Đã từ chối', 'red'], cancelled: ['Đã hủy', 'gray'] };
  const tagHtml = (s) => `<span class="tag ${TAG[s][1]}">${TAG[s][0]}</span>`;
  // Nhãn trong danh sách: với hồ sơ chờ duyệt, nêu rõ đang chờ ai
  const listTag = (e) => {
    if (e.status !== 'pending') return tagHtml(e.status);
    if (myTurn(e)) return '<span class="tag amber">Chờ bạn duyệt</span>';
    return `<span class="tag">${e.doan_status === 'pending' ? 'Đang ở bước 1 – VP Đoàn' : 'Đang ở bước 2 – Truyền thông'}</span>`;
  };

  async function loadList() {
    const p = new URLSearchParams({ q: $('search').value.trim(), status: $('status').value });
    let d;
    try { d = await api(`/api/moderation?${p}`); } catch (err) { $('list').innerHTML = App.emptyState('Lỗi', err.message); return; }
    items = d.events; checks = d.checks;
    $('sPending').textContent = d.stats.mine || 0;
    $('sPendingSub').textContent = side === 'doan' ? `${d.stats.waiting_other || 0} hồ sơ đã duyệt, đang chờ Phòng Truyền thông` : `${d.stats.waiting_other || 0} hồ sơ đang ở bước Văn phòng Đoàn`;
    $('sApproved').textContent = d.stats.approved_month || 0; $('sApprovedSub').textContent = `Trong tháng ${d.month} • tổng ${d.stats.approved_total || 0}`;
    $('sRejected').textContent = d.stats.rejected || 0;
    $('sRejectedSub').textContent = `${d.stats.rejected_mine || 0} hồ sơ do ${d.side_name} từ chối`;
    if (!selected || !items.find((e) => e.id === selected)) selected = (items.find(myTurn) || items[0] || {}).id || null;
    renderList();
    if (selected) loadDetail(selected); else $('detailCol').innerHTML = `<section class="card">${App.emptyState('Không có hồ sơ', filter === 'mine' ? 'Không còn hồ sơ nào chờ bộ phận bạn duyệt.' : 'Không tìm thấy hồ sơ phù hợp bộ lọc.', 'filetext')}</section>`;
  }

  function renderList() {
    $('list').innerHTML = items.length ? items.map((e) => `
      <button class="item ${e.id === selected ? 'selected' : ''}" data-id="${e.id}">
        <span class="item-title">${esc(e.title)}</span>
        <span class="item-sub">${esc(e.unit_short || e.unit_name)} • ${esc(e.code)}</span>
        <span class="item-foot">${listTag(e)}<span>${fmtDate(e.status === 'pending' ? e.submitted_at : (e.reviewed_at || e.submitted_at))}</span></span>
        ${e.status === 'pending' ? `<span style="display:block;margin-top:8px">${approvalHtml(e, { compact: true })}</span>` : ''}
      </button>`).join('') : App.emptyState('Không có hồ sơ', '', 'filetext');
    document.querySelectorAll('#list .item').forEach((i) => i.addEventListener('click', () => {
      selected = Number(i.dataset.id); history.replaceState(null, '', `?id=${selected}`);
      document.querySelectorAll('#list .item.selected').forEach((s) => s.classList.remove('selected'));
      i.classList.add('selected'); loadDetail(selected);
    }));
  }

  const ASSET_ST = { pending: ['Chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], rejected: ['Từ chối', 'red'] };
  const KIND = { banner: 'Banner', poster: 'Poster', standee: 'Standee', post: 'Bài đăng', video: 'Video', other: 'Ấn phẩm khác' };

  const isImg = (a) => /^image\//.test(a.mime || '') || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.stored_name || '');
  // Ấn phẩm nộp kèm hồ sơ: Truyền thông xem dạng lưới có ảnh xem trước; VP Đoàn xem danh sách tham khảo
  function assetBlock(ev, big) {
    const assets = ev.assets || [];
    if (!assets.length) return `<h4 class="section-title">Ấn phẩm truyền thông (0)</h4><p class="copy" style="margin-top:8px">Hồ sơ chưa có ấn phẩm truyền thông.</p>`;
    if (!big) return `<h4 class="section-title">Ấn phẩm truyền thông nộp kèm (${assets.length})</h4>
      <div class="mini-assets">${assets.map((a) => `<div class="mini-asset"><span>${icon(a.kind === 'video' ? 'activity' : 'image')} ${esc(KIND[a.kind])}: ${esc(a.title)}</span>
        <span style="display:flex;gap:8px;align-items:center"><span class="st ${ASSET_ST[a.status][1]}">${ASSET_ST[a.status][0]}</span><a class="link" href="/api/media/assets/${a.id}/file" target="_blank" rel="noopener">Xem</a></span></div>`).join('')}</div>
      <p class="fine">Ấn phẩm do Phòng Truyền thông duyệt ở bước 2.</p>`;
    return `<h4 class="section-title">Ấn phẩm truyền thông cần duyệt (${assets.length})</h4>
      <div class="asset-grid">${assets.map((a) => `<a class="asset-card" href="/api/media/assets/${a.id}/file" target="_blank" rel="noopener">
        <div class="asset-thumb" ${isImg(a) ? `style="background-image:url('/api/media/assets/${a.id}/file')"` : ''}>${isImg(a) ? '' : icon('file')}</div>
        <div class="asset-body"><b>${esc(a.title)}</b><small>${esc(KIND[a.kind])}${a.channel ? ' • ' + esc(a.channel) : ''}</small>
        <span><span class="st ${ASSET_ST[a.status][1]}">${ASSET_ST[a.status][0]}</span></span>${a.review_note && a.status === 'rejected' ? `<small>${esc(a.review_note)}</small>` : ''}</div></a>`).join('')}</div>`;
  }

  // Khối riêng của từng bộ phận: VP Đoàn – phòng & ấn phẩm tham khảo; Truyền thông – ấn phẩm cần duyệt
  function sideBlock(ev) {
    if (side === 'doan') {
      const room = ev.room_id
        ? `<b>${esc(ev.room_name)}</b> (${esc(ev.room_code)}) • sức chứa ${fmtNum(ev.room_capacity)} chỗ • quy mô sự kiện ${fmtNum(ev.capacity)} người`
        : `<b>Địa điểm ngoài danh mục phòng:</b> ${esc(ev.location)} – kiểm tra thủ công.`;
      const over = ev.room_id && ev.capacity > ev.room_capacity;
      const conflict = ev.room_conflicts && ev.room_conflicts.length;
      const cls = over || conflict ? 'warn' : ev.room_id ? 'ok' : '';
      return `<h4 class="section-title">Phòng / địa điểm</h4>
        <div class="room-box ${cls}">${room}
          ${over ? '<br>⚠ Quy mô vượt sức chứa phòng.' : ''}
          ${conflict ? `<br>⚠ Trùng lịch phòng với: ${ev.room_conflicts.map((c) => `"${esc(c.title)}" (${fmtTime(c.start_at)}–${fmtTime(c.end_at)} ${fmtDate(c.start_at)})`).join('; ')}` : ''}
          ${ev.room_id && !over && !conflict ? '<br>Phòng trống trong khung giờ tổ chức.' : ''}
        </div>${assetBlock(ev, false)}`;
    }
    return assetBlock(ev, true);
  }

  async function loadDetail(id) {
    $('detailCol').innerHTML = `<section class="card">${App.loadingHtml}</section>`;
    let ev, logs;
    try { [{ event: ev }, { logs }] = await Promise.all([api(`/api/events/${id}`), api(`/api/events/${id}/history`).catch(() => ({ logs: [] }))]); }
    catch (err) { $('detailCol').innerHTML = `<section class="card">${App.emptyState('Không tải được hồ sơ', err.message)}</section>`; return; }
    const mine = myTurn(ev);
    const myChecks = new Set(ev[`${side}_checks`] || []);

    const files = `<h4 class="section-title">Kế hoạch tổ chức & tài liệu (${ev.files.length})</h4>` + (ev.files.length ? `<div class="files">${ev.files.map((f) => `<div class="file"><div>${icon('file')}<span>${esc(f.original_name)} • ${fmtSize(f.size)}</span></div><a href="/api/events/files/${f.id}/download" aria-label="Tải xuống">${icon('download')}</a></div>`).join('')}</div>`
      : '<p class="copy" style="margin-top:12px">Hồ sơ không có file kế hoạch đính kèm.</p>');

    const checkHtml = checks.map((c) => mine
      ? `<button class="check" data-check="${esc(c)}">${icon('check', 'stroke-width="2.2"')}${esc(c)}</button>`
      : `<span class="check ${myChecks.has(c) ? '' : 'off'}">${icon('check', 'stroke-width="2.2"')}${esc(c)}</span>`).join('');

    // Văn phòng Đoàn xác nhận cấp chương trình & điểm Đoàn khi chấp thuận
    const doanFields = side === 'doan' ? `
        <div class="dec-grid" style="margin-top:6px">
          <div><label class="label" for="dLevel">Cấp chương trình</label>
            <select id="dLevel">${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${ev.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div><label class="label" for="dPoints">Cấp điểm Đoàn (khi sinh viên hoàn thành)</label>
            <input class="inp" id="dPoints" type="number" min="0" max="20" value="${ev.points}"></div>
        </div>` : '';

    const decision = mine ? `
      <section class="card">
        <h3>${side === 'doan' ? 'Bước 1 – Văn phòng Đoàn duyệt & cấp điểm Đoàn' : 'Bước 2 – Phòng Truyền thông duyệt ấn phẩm'}</h3>
        <div class="hint">Người thực hiện: ${esc(user.full_name)} • ${esc(user.position || SIDE[side])}</div>
        ${approvalHtml(ev)}
        <div id="decAlert" style="margin-top:12px"></div>
        ${doanFields}
        <label class="label" for="comment">Nhận xét / lý do từ chối (bắt buộc khi từ chối)</label>
        <textarea id="comment" placeholder="Nhập nhận xét cho ban tổ chức..."></textarea>
        <div class="actions">
          <button class="btn-primary" id="approveBtn">${icon('tick', 'stroke-width="2"')}${side === 'doan' ? 'Duyệt & cấp điểm Đoàn' : 'Duyệt ấn phẩm & công khai sự kiện'}</button>
          <button class="btn-danger" id="rejectBtn">${icon('x', 'stroke-width="2"')}Từ chối hồ sơ</button>
        </div>
        <p class="fine">${side === 'doan' ? 'Sau khi duyệt và cấp điểm, hồ sơ chuyển sang Phòng Truyền thông duyệt ấn phẩm (bước 2). Sự kiện chưa hiển thị với sinh viên.' : 'Duyệt sẽ duyệt các ấn phẩm đang chờ của hồ sơ và công khai sự kiện, sinh viên có thể xem và đăng ký ngay.'} Từ chối sẽ trả hồ sơ về Ban tổ chức kèm lý do.</p>
      </section>` : `
      <section class="card">
        <h3>Tiến độ phê duyệt</h3>
        <div class="hint">${ev.status === 'approved' ? `Đã công khai lúc ${fmtDateTime(ev.reviewed_at)}` : ev.status === 'rejected' ? `Hồ sơ bị từ chối lúc ${fmtDateTime(ev.reviewed_at)}, chờ Ban tổ chức bổ sung` : ev.status === 'cancelled' ? 'Sự kiện đã bị Ban tổ chức hủy' : ev.doan_status === 'pending' ? 'Chưa đến lượt Phòng Truyền thông – hồ sơ đang chờ Văn phòng Đoàn duyệt (bước 1)' : 'Văn phòng Đoàn đã duyệt – hồ sơ đang chờ Phòng Truyền thông duyệt ấn phẩm (bước 2)'}</div>
        ${approvalHtml(ev)}
        ${ev.status === 'cancelled' ? `<div class="decision-note red"><b>Lý do hủy:</b> ${esc(ev.cancel_reason || '')}</div>` : ''}
        ${ev.status === 'approved' ? `<div class="actions"><a class="btn-primary" href="/event-detail.html?id=${ev.id}">${icon('eye')}Xem trang công khai</a></div>` : ''}
      </section>`;

    const LOGC = { 'event.approve': 'green', 'event.publish': 'green', 'event.reject': 'red', 'event.cancel': 'red', 'event.create': 'gray', 'asset.approve': 'green', 'asset.reject': 'red' };
    const evLogs = logs.filter((l) => l.entity_type === 'event' && /^(event|asset)\./.test(l.action));
    const history = `<section class="card"><h3>Lịch sử hồ sơ</h3><div class="hint">Mọi thao tác trên hồ sơ được ghi lại</div>
      <div class="timeline">${evLogs.length ? evLogs.map((l) => `<div class="tl ${LOGC[l.action] || ''}"><i></i><div><b>${esc(l.detail)}</b><small>${esc(l.actor_name || 'Hệ thống')} • ${fmtDateTime(l.created_at)}</small>${l.reason ? `<p>${esc(l.reason)}</p>` : ''}</div></div>`).join('') : '<div class="hint">Chưa có lịch sử.</div>'}</div></section>`;

    $('detailCol').innerHTML = `
      <section class="card">
        <div class="detail-head">
          <div>
            <h3>${esc(ev.title)}</h3>
            <div class="hint">Mã hồ sơ: ${esc(ev.code)} • Gửi ngày ${fmtDate(ev.submitted_at)}, ${fmtTime(ev.submitted_at)}</div>
          </div>
          ${tagHtml(ev.status)}
        </div>
        <div class="cover" style="--cover-image:url('${coverOf(ev)}')"></div>
        <dl class="meta">
          <div><dt>Đơn vị tổ chức</dt><dd class="big">${esc(ev.unit_name)}</dd></div>
          <div><dt>Loại sự kiện / Quy mô</dt><dd>${esc(ev.category_name)} • ${fmtNum(ev.capacity)} sinh viên • ${esc(ev.fee || 'Miễn phí')}</dd></div>
          <div><dt>Thời gian tổ chức</dt><dd class="big">${fmtRange(ev.start_at, ev.end_at)}</dd></div>
          <div><dt>Kinh phí dự kiến</dt><dd class="big">${fmtMoney(ev.budget)}</dd></div>
          <div><dt>Địa điểm</dt><dd>${esc(ev.location)}${ev.room_code ? ` <span class="st navy">${esc(ev.room_code)}</span>` : ''}</dd></div>
          <div><dt>Cấp chương trình / điểm Đoàn</dt><dd>${esc(LEVEL[ev.level] || '')} • ${ev.points} điểm</dd></div>
          <div><dt>Người phụ trách</dt><dd>${esc(ev.contact_name || '—')}${ev.contact_phone ? ` • ${esc(ev.contact_phone)}` : ''}</dd></div>
          <div><dt>Hạn đăng ký</dt><dd>${fmtDateTime(ev.reg_deadline)}</dd></div>
        </dl>
        <h4 class="section-title">Nội dung cần duyệt</h4>
        ${ev.slogan ? `<p class="copy"><b>${esc(ev.slogan)}</b></p>` : ''}
        <p class="copy">${nl2br(ev.summary)}</p>
        <p class="copy">${nl2br(ev.description)}</p>
        ${ev.benefits ? `<p class="copy"><b>Quyền lợi:</b> ${esc(ev.benefits.split('\n').join(' • '))}</p>` : ''}
        ${ev.preparation ? `<p class="copy"><b>Yêu cầu tham dự:</b> ${esc(ev.preparation.split('\n').join(' • '))}</p>` : ''}
        <div class="agenda-mini">${ev.agenda.map((a) => `<div><b>${esc(a.time_label)}</b>${esc(a.title)}</div>`).join('')}</div>
        ${files}
        ${sideBlock(ev)}
        <h4 class="section-title">Tiêu chí của ${SIDE[side]}</h4>
        <div class="checks">${checkHtml}</div>
      </section>
      ${decision}
      ${history}`;

    if (mine) {
      document.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
      const getChecks = () => [...document.querySelectorAll('[data-check].on')].map((b) => b.dataset.check);
      const decide = async (approve) => {
        const note = $('comment').value.trim();
        $('decAlert').innerHTML = '';
        if (!approve && note.length < 10) { $('decAlert').innerHTML = '<div class="alert err">Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự) để ban tổ chức bổ sung.</div>'; $('comment').focus(); return; }
        if (approve && getChecks().length < checks.length && !(await confirmBox('Chưa đủ tiêu chí', 'Một số tiêu chí chưa được đánh dấu. Vẫn duyệt hồ sơ?', 'Vẫn duyệt'))) return;
        if (!approve && !(await confirmBox('Từ chối hồ sơ?', 'Hồ sơ sẽ được trả về Ban tổ chức kèm lý do để bổ sung; khi nộp lại, hồ sơ bắt đầu lại từ bước 1 (Văn phòng Đoàn).', 'Từ chối', true))) return;
        const body = { note, checks: getChecks() };
        if (side === 'doan') { body.level = $('dLevel').value; body.points = $('dPoints').value; }
        try {
          const r = await api(`/api/moderation/${ev.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body });
          toast(!approve ? 'Đã từ chối hồ sơ và gửi lý do tới ban tổ chức.' : r.published ? 'Đã duyệt ấn phẩm – sự kiện đã được công khai.' : 'Đã duyệt & cấp điểm Đoàn – hồ sơ chuyển sang Phòng Truyền thông.', 'ok');
          loadList();
        } catch (err) { $('decAlert').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      };
      $('approveBtn').onclick = () => decide(true);
      $('rejectBtn').onclick = () => decide(false);
    }
  }

  let t;
  $('search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadList, 300); });
  $('status').addEventListener('change', () => { filter = $('status').value; selected = null; loadList(); });
  loadList();
})();
