// Trang Điểm danh: sinh viên tự điểm danh (mã / QR) • BTC quản lý phiên, theo dõi, sửa thủ công, xuất Excel
(async function () {
  const { api, esc, icon, fmtDate, fmtTime, fmtDateTime, fmtNum, toast, modal, askReason, initials } = App;
  let user;
  try { ({ user } = await App.init({ page: 'attendance', roles: ['student', 'organizer'] })); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const qs = new URLSearchParams(location.search);
  let eventId = Number(qs.get('event')) || null;
  const qrCode = qs.get('code');

  const setBanner = ({ label, title, meta, chip, canSwitch }) => {
    $('evLabel').textContent = label; $('evTitle').textContent = title || ''; $('evMeta').textContent = meta || '';
    $('evChip').hidden = !chip; if (chip) $('evChip').textContent = chip;
    $('switchBtn').hidden = !canSwitch;
  };
  const range = (e) => `${fmtDate(e.start_at)} • ${fmtTime(e.start_at)}–${fmtTime(e.end_at)} • ${e.location}`;

  // =====================================================================
  //  SINH VIÊN
  // =====================================================================
  async function student() {
    $('noteText').textContent = 'Sinh viên check-in khi đến và check-out khi kết thúc sự kiện bằng mã do ban tổ chức cung cấp hoặc quét mã QR tại địa điểm. Chỉ được check-out sau khi đã được ghi nhận check-in. Sinh viên hoàn thành cả hai bước mới được ghi nhận điểm hoạt động.';
    let d;
    try { d = await api('/api/me/attendance'); } catch (err) { $('panels').innerHTML = `<div class="card">${App.emptyState('Không tải được dữ liệu', err.message)}</div>`; return; }
    const cur = d.current;
    let ev = cur.find((x) => x.event_id === eventId) || cur.find((x) => x.attendance_open) || cur[0] || null;
    if (!ev) {
      setBanner({ label: 'Không có sự kiện cần điểm danh', title: 'Hiện chưa có phiên điểm danh dành cho bạn', meta: d.next ? `Sự kiện sắp tới: ${d.next.title} • ${fmtDateTime(d.next.start_at)}` : 'Hãy đăng ký sự kiện để tham gia.' });
      $('panels').className = 'panels';
      $('panels').innerHTML = `<div class="col"><section class="card"><h3>Sinh viên • Check-in / Check-out</h3><div class="hint">${esc(user.full_name)} • MSSV ${esc(user.code)}</div>
          <div class="status-box gray">${icon('clock', 'class="ring"')}<strong>Chưa có sự kiện</strong><small>Điểm danh mở trong giờ diễn ra sự kiện bạn đã đăng ký</small></div>
          <a class="btn-primary block" href="/registered.html">${icon('ticket')}Xem sự kiện đã đăng ký</a></section>${recentCard(d.recent)}</div>
        <section class="card"><h3>Lịch điểm danh của bạn</h3><div class="hint">Sự kiện đang hoặc sắp diễn ra trong 60 phút tới</div>${App.emptyState('Không có sự kiện nào', 'Sự kiện bạn đăng ký sẽ xuất hiện tại đây khi đến giờ.')}</section>`;
      return;
    }
    eventId = ev.event_id;
    const s = ev.session;
    const kind = s ? s.kind : null;
    const kindLabel = kind === 'checkout' ? 'check-out' : 'check-in';
    setBanner({
      label: `${{ ongoing: 'Sự kiện đang diễn ra', upcoming: 'Sắp diễn ra', ended: 'Sự kiện đã kết thúc' }[ev.phase] || ''} • ${ev.event_code}`, title: ev.title, meta: range(ev),
      chip: s && s.valid ? `Đang mở ${kindLabel}` : (s ? 'Mã đã hết hiệu lực' : 'Chưa mở điểm danh'), canSwitch: cur.length > 1,
    });
    $('switchBtn').onclick = (e) => { e.preventDefault(); pickStudentEvent(cur); };

    const how = (m) => ({ qr: 'Quét QR', manual: 'BTC cập nhật', code: 'Nhập mã' }[m] || 'Nhập mã');
    const checkedIn = ev.attendance === 'present';
    const done = checkedIn && ev.checked_out_at;
    let box;
    if (done) box = `<div class="status-box green">${icon('check', 'class="ring"')}<strong>Hoàn thành</strong><small>Check-in ${fmtTime(ev.checked_in_at)} • Check-out ${fmtTime(ev.checked_out_at)}${ev.points_awarded != null ? ` • +${ev.points_awarded} điểm HĐ` : ''}</small></div>`;
    else if (checkedIn) box = `<div class="status-box green">${icon('check', 'class="ring"')}<strong>Đã check-in</strong><small>Ghi nhận lúc ${fmtTime(ev.checked_in_at)} • ${how(ev.check_method)}. Nhớ check-out khi kết thúc.</small></div>`;
    else if (ev.attendance === 'absent') box = `<div class="status-box red">${icon('xcircle', 'class="ring"')}<strong>Vắng mặt</strong><small>Phiên check-in đã đóng</small></div>`;
    else box = `<div class="status-box">${icon('clock', 'class="ring"')}<strong>Chưa check-in</strong><small>Mã đăng ký: ${esc(ev.code)}</small></div>`;

    // Bước tiếp theo của sinh viên: check-in (chưa ghi nhận) hoặc check-out (đã check-in, phiên check-out đang mở)
    const step = ev.attendance === 'pending' ? 'checkin' : (checkedIn && !done ? 'checkout' : null);
    const canSubmit = step && (!s || s.kind === step);
    let form;
    if (step === 'checkout' && (!s || s.kind !== 'checkout')) {
      form = '<p class="desc">Ban tổ chức sẽ mở phiên <b>check-out</b> khi chương trình kết thúc. Bạn nhập mã hoặc quét QR check-out để hoàn thành sự kiện.</p>';
    } else if (canSubmit) {
      const label = step === 'checkout' ? 'check-out' : 'check-in';
      form = `
      <p class="desc">Quét mã QR hoặc nhập mã ${label} đang trình chiếu tại địa điểm. Mã <b>tự đổi mỗi 10 giây</b> – ảnh chụp hay link được gửi lại sẽ không dùng được.</p>
      <div id="ciAlert"></div>
      <label class="label" for="code">Mã ${label}</label>
      <div class="input">
        <input id="code" type="text" maxlength="6" placeholder="Mã 6 ký tự đang trình chiếu" autocomplete="off" style="text-transform:uppercase" value="${esc(qrCode || '')}">
        ${icon('key')}
      </div>
      <button class="btn-primary block" id="checkBtn">${icon('check')}Xác nhận ${label}</button>
      <a href="#" class="link-btn" id="qrHelp">${icon('scan')}Hoặc quét mã QR tại sự kiện</a>`;
    } else {
      form = `<p class="desc">${done ? 'Bạn đã hoàn thành sự kiện. Điểm Đoàn được cộng sau khi Văn phòng Đoàn duyệt danh sách do ban tổ chức gửi.' : 'Nếu có sai sót, vui lòng liên hệ ban tổ chức để được cập nhật thủ công.'}</p>
      ${checkedIn ? `<a class="btn-primary block" href="/reviews.html?event=${ev.event_id}">${icon('chat')}Đánh giá sự kiện</a>` : ''}`;
    }

    const tip = s ? `<div class="tip">${icon('info')}<div><strong>Khung giờ ${kindLabel}</strong><p>${fmtTime(s.opened_at)}–${fmtTime(s.expires_at)}, ngày ${fmtDate(s.opened_at)}. Cần có mặt tại ${esc(ev.location)}.</p></div></div>`
      : `<div class="tip">${icon('info')}<div><strong>Khung giờ điểm danh</strong><p>Ban tổ chức mở check-in trong giờ diễn ra (${fmtTime(ev.start_at)}–${fmtTime(ev.end_at)}) và mở check-out khi chương trình kết thúc.</p></div></div>`;

    $('panels').className = 'panels';
    $('panels').innerHTML = `
      <div class="col">
        <section class="card">
          <h3>Sinh viên • Check-in / Check-out</h3>
          <div class="hint">${esc(user.full_name)} • MSSV ${esc(user.code)}</div>
          <div style="margin-top:14px"><span class="tag">Đã đăng ký</span></div>
          ${box}${form}${tip}
        </section>
        ${recentCard(d.recent)}
      </div>
      <section class="card">
        <h3>Lịch điểm danh của bạn</h3>
        <div class="hint">Sự kiện đang diễn ra, sắp diễn ra trong 60 phút tới hoặc đang mở check-out</div>
        <div class="my-list">${cur.map((x) => `<div class="my-item ${x.event_id === eventId ? 'sel' : ''}">
            <div><b>${esc(x.title)}</b><small>${fmtTime(x.start_at)}–${fmtTime(x.end_at)} • ${esc(x.location)} • ${esc(x.code)}</small></div>
            <div style="display:flex;gap:8px;align-items:center">${x.attendance === 'present' ? (x.checked_out_at ? '<span class="tag green">Hoàn thành</span>' : '<span class="tag green">Đã check-in</span>') : x.attendance === 'absent' ? '<span class="tag red">Vắng mặt</span>' : x.session && x.session.valid ? '<span class="tag amber">Đang mở</span>' : '<span class="tag gray">Chưa mở</span>'}
            ${x.event_id !== eventId ? `<a class="link" href="?event=${x.event_id}">Chọn</a>` : ''}</div></div>`).join('')}</div>
        <p class="fine">Mỗi sinh viên check-in và check-out một lần cho mỗi sự kiện. Thay đổi thủ công do ban tổ chức thực hiện và được lưu lịch sử.</p>
      </section>`;

    if (canSubmit && $('checkBtn')) {
      const submit = async (method) => {
        const code = $('code').value.trim();
        if (!code) { $('ciAlert').innerHTML = '<div class="alert err">Vui lòng nhập mã.</div>'; return; }
        $('checkBtn').disabled = true;
        try {
          const r = await api('/api/attendance/checkin', { method: 'POST', body: { event_id: ev.event_id, code, method } });
          toast(r.kind === 'checkout' ? 'Check-out thành công – bạn đã hoàn thành sự kiện!' : 'Check-in thành công!', 'ok');
          history.replaceState(null, '', `?event=${ev.event_id}`);
          student();
        } catch (err) {
          $('ciAlert').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; $('checkBtn').disabled = false;
          if (method === 'qr') { $('code').value = ''; history.replaceState(null, '', `?event=${ev.event_id}`); } // mã QR cũ → bỏ khỏi link
        }
      };
      $('checkBtn').onclick = () => submit(qrCode && $('code').value.trim().toUpperCase() === qrCode.toUpperCase() ? 'qr' : 'code');
      $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('checkBtn').click(); });
      $('qrHelp').onclick = (e) => { e.preventDefault(); modal({ title: 'Quét mã QR tại sự kiện', desc: 'Mở camera điện thoại và quét mã QR do ban tổ chức trình chiếu. Liên kết sẽ mở trang này và tự xác nhận — hệ thống tự nhận biết đang là phiên check-in hay check-out.<br><br>Mã QR <b>đổi mỗi 10 giây</b>: hãy quét trực tiếp tại sự kiện; nếu báo hết hạn, quét lại mã mới trên màn hình.<br><br>Điện thoại cần kết nối cùng mạng Wi-Fi với máy chủ khi chạy trên localhost.', hideOk: true, cancelText: 'Đã hiểu' }); };
      if (qrCode && s && s.valid) submit('qr'); // mở từ QR → tự xác nhận
    }
  }

  function recentCard(r) {
    return `<section class="card"><h3>Lần tham dự gần nhất</h3>${r
      ? `<div class="recent-title">${esc(r.title)}</div><span class="tag green">${r.checked_out_at ? 'Hoàn thành' : 'Đã check-in'}</span><p class="recent-meta">Check-in ${fmtTime(r.checked_in_at)}${r.checked_out_at ? ` • check-out ${fmtTime(r.checked_out_at)}` : ''} • ${fmtDate(r.checked_in_at)}. Đã ghi nhận vào lịch sử hoạt động.</p>`
      : '<p class="recent-empty">Bạn chưa có lượt tham dự nào được ghi nhận.</p>'}</section>`;
  }

  function pickStudentEvent(list) {
    modal({ title: 'Đổi sự kiện', hideOk: true, cancelText: 'Đóng',
      html: `<div class="my-list">${list.map((x) => `<a class="my-item" href="?event=${x.event_id}"><div><b>${esc(x.title)}</b><small>${fmtTime(x.start_at)}–${fmtTime(x.end_at)} • ${esc(x.location)}</small></div>${icon('arrow')}</a>`).join('')}</div>` });
  }

  // =====================================================================
  //  BAN TỔ CHỨC / QUẢN LÝ
  // =====================================================================
  let events = [], state = { q: '', status: '', page: 1 }, timer = null;

  async function organizer() {
    $('noteText').textContent = 'Ban tổ chức mở phiên check-in khi bắt đầu và phiên check-out khi kết thúc, trình chiếu mã/QR và theo dõi danh sách. Đóng phiên check-in: sinh viên chưa check-in được ghi nhận vắng mặt. Sinh viên có đủ check-in và check-out là hoàn thành – danh sách này được gửi Văn phòng Đoàn để duyệt cộng điểm Đoàn.';
    try { ({ events } = await api('/api/attendance/events')); } catch (err) { $('panels').innerHTML = `<div class="card">${App.emptyState('Không tải được dữ liệu', err.message)}</div>`; return; }
    if (!events.length) {
      setBanner({ label: 'Chưa có sự kiện', title: 'Đơn vị chưa có sự kiện đã được duyệt', meta: 'Tạo và gửi duyệt sự kiện trong mục Quản lý sự kiện.' });
      $('panels').className = 'panels single'; $('panels').innerHTML = `<div class="card">${App.emptyState('Không có sự kiện để điểm danh', '', 'scan')}<div style="text-align:center"><a class="btn-primary" href="/manage-events.html">Quản lý sự kiện</a></div></div>`;
      return;
    }
    if (!events.find((e) => e.id === eventId)) eventId = events[0].id;
    $('switchBtn').onclick = (e) => { e.preventDefault(); pickOrganizerEvent(); };
    $('panels').className = 'panels single';
    await renderOrganizer();
    timer = setInterval(() => { if (!document.hidden && !document.querySelector('.modal-back')) renderOrganizer(true); }, 15000);
  }

  const STATE = { pending: ['Chưa check-in', 'amber'], checked_in: ['Đã check-in', ''], completed: ['Hoàn thành', 'green'], absent: ['Vắng mặt', 'red'] };
  const HOW = { qr: 'Quét QR', code: 'Nhập mã', manual: 'BTC cập nhật' };

  async function renderOrganizer(silent = false) {
    let d;
    const p = new URLSearchParams({ q: state.q, status: state.status, page: state.page, size: 10 });
    try { d = await api(`/api/attendance/${eventId}?${p}`); } catch (err) { if (!silent) toast(err.message, 'err'); return; }
    const ev = d.event, s = d.session;
    const kindLabel = s && s.kind === 'checkout' ? 'check-out' : 'check-in';
    setBanner({
      label: `${{ ongoing: 'Sự kiện đang diễn ra', upcoming: 'Sự kiện sắp diễn ra', ended: 'Sự kiện đã kết thúc' }[ev.phase]} • ${ev.code}`,
      title: ev.title, meta: range(ev), chip: s ? (s.valid ? `Đang mở ${kindLabel}` : 'Mã đã hết hiệu lực') : (ev.phase === 'ended' ? 'Đã kết thúc' : 'Chưa mở phiên'), canSwitch: events.length > 1,
    });
    history.replaceState(null, '', `?event=${ev.id}`);

    const openBtns = [
      !s && d.can_open_checkin ? `<button class="btn-primary" id="openIn">${icon('scan')}Mở check-in</button>` : '',
      (!s || s.kind === 'checkin') && d.can_open_checkout ? `<button class="${s ? 'btn-outline' : 'btn-primary'}" id="openOut">${icon('logout')}${s ? 'Chuyển sang check-out' : 'Mở check-out'}</button>` : '',
    ].join('');
    const sessionHtml = s ? `
      <div class="session">
        <div class="session-left">
          <div class="qr" id="qrBox" title="Phóng to mã QR để trình chiếu">${d.qr ? `<img data-qr-img src="${d.qr}" alt="Mã QR điểm danh">` : icon('qr', 'stroke-width="1.6"')}</div>
          <div>
            <span class="session-kind ${s.kind === 'checkout' ? 'out' : ''}">Phiên ${kindLabel}</span>
            <small>Mã ${kindLabel} động</small>
            <strong data-qr-code>${s.valid ? esc(s.code) : '——'}</strong>
            ${s.valid ? `<div class="qr-timer"><i data-qr-bar></i></div><span><b data-qr-count>${Math.ceil(s.remaining_ms / 1000)}</b> giây nữa đổi mã • Phiên hiệu lực tới ${fmtTime(s.expires_at)}</span>`
              : `<span>Đã hết hiệu lực lúc ${fmtTime(s.expires_at)}</span>`}
          </div>
        </div>
        <div class="session-actions">
          ${s.valid ? `<button class="btn-outline" id="presentBtn">${icon('qr')}Trình chiếu QR</button>` : ''}
          ${openBtns}
          <button class="btn-outline" id="closeBtn">Đóng phiên</button>
        </div>
      </div>` : `
      <div class="session off">
        <div class="session-left">
          <div class="qr">${icon('qr', 'stroke-width="1.6"')}</div>
          <div>
            <small>Phiên điểm danh</small>
            <strong style="font-size:18px">${d.last_session ? `Phiên ${d.last_session.kind === 'checkout' ? 'check-out' : 'check-in'} đã đóng lúc ${fmtTime(d.last_session.closed_at)} ${fmtDate(d.last_session.closed_at)}` : 'Chưa mở phiên'}</strong>
            <span>${openBtns ? 'Mở check-in khi sinh viên đến, mở check-out khi chương trình kết thúc.' : 'Đã hết thời gian mở phiên – vẫn có thể cập nhật thủ công kèm lý do.'}</span>
          </div>
        </div>
        <div class="session-actions">${openBtns}</div>
      </div>`;

    const rows = d.rows.length ? d.rows.map((r) => `<tr>
        <td class="tbl-name"><b>${esc(r.full_name)}</b><small>${esc(r.class_name || '')}</small></td>
        <td>${esc(r.student_code)}</td>
        <td><span class="tag ${STATE[r.state][1]}">${STATE[r.state][0]}</span>${r.points_awarded != null ? `<small class="cell-sub">+${r.points_awarded} điểm HĐ</small>` : ''}</td>
        <td>${r.checked_in_at ? `${fmtTime(r.checked_in_at)}<small class="cell-sub">${HOW[r.check_method] || ''}</small>` : '—'}</td>
        <td>${r.checked_out_at ? `${fmtTime(r.checked_out_at)}<small class="cell-sub">${HOW[r.checkout_method] || ''}</small>` : '—'}</td>
        <td>${r.points_awarded != null ? '<span class="cell-sub">Đã duyệt điểm</span>' : `<a class="link" data-mark="${r.id}" data-name="${esc(r.full_name)}" data-state="${r.state}">Cập nhật</a>`}</td>
      </tr>`).join('') : `<tr><td colspan="6">${App.emptyState('Không có sinh viên phù hợp', '', 'users')}</td></tr>`;

    const pages = Math.max(1, Math.ceil(d.total / d.size));
    const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.total, d.page * d.size);
    const focusSearch = document.activeElement && document.activeElement.id === 'q';

    // Gửi danh sách hoàn thành để Văn phòng Đoàn duyệt điểm Đoàn
    const sub = d.submission;
    const SUB = { pending: ['Đang chờ Văn phòng Đoàn duyệt', 'amber'], approved: ['Đã duyệt điểm', 'green'], rejected: ['Bị từ chối – cần gửi lại', 'red'] };
    let pointsHtml = '';
    if (ev.phase === 'ended') {
      const canSend = ev.points > 0 && d.stats.completed > 0 && (!sub || sub.status === 'rejected');
      pointsHtml = `<div class="points-box"><div>
          <b>Điểm hoạt động: ${ev.points} điểm/sinh viên • ${fmtNum(d.stats.completed)} sinh viên hoàn thành</b>
          <p>${sub ? `<span class="tag ${SUB[sub.status][1]}">${SUB[sub.status][0]}</span> Gửi lúc ${fmtDateTime(sub.submitted_at)}${sub.review_note ? ` • Phản hồi: ${esc(sub.review_note)}` : ''}${sub.status === 'approved' ? ` • ${fmtNum(sub.member_count)} sinh viên đã được cộng điểm` : ''}`
            : 'Sau khi rà soát, gửi danh sách sinh viên hoàn thành (check-in + check-out) để Văn phòng Đoàn duyệt cộng điểm Đoàn.'}</p>
        </div>${canSend ? `<button class="btn-primary" id="sendPoints">${icon('send')}${sub ? 'Gửi lại danh sách' : 'Gửi danh sách nhận điểm'}</button>` : ''}</div>`;
    }

    $('panels').innerHTML = `
      <section class="card">
        <div class="card-head">
          <div><h3>Ban tổ chức • Danh sách đăng ký & điểm danh</h3><div class="hint">${esc(App.displayOf(user).name)} • ${esc(App.LEVEL[ev.level] || '')} • ${ev.points} điểm hoạt động</div></div>
          <span class="tag green">Cập nhật ${fmtTime(d.updated_at)}</span>
        </div>
        <div class="mini-stats">
          <div class="mini"><strong>${fmtNum(d.stats.registered)}</strong><small>Đã đăng ký</small></div>
          <div class="mini"><strong>${fmtNum(d.stats.present)}</strong><small>Đã check-in</small></div>
          <div class="mini"><strong>${fmtNum(d.stats.completed)}</strong><small>Hoàn thành (check-in + check-out)</small></div>
          <div class="mini"><strong>${fmtNum(d.stats.pending + d.stats.absent)}</strong><small>${d.stats.absent ? `Chưa check-in / vắng (${fmtNum(d.stats.absent)} vắng)` : 'Chưa check-in'}</small></div>
        </div>
        ${sessionHtml}
        ${pointsHtml}
        <div class="filters">
          <div class="search"><input type="text" id="q" placeholder="Tìm MSSV hoặc họ tên" value="${esc(state.q)}">${icon('search')}</div>
          <select class="select" id="st" aria-label="Trạng thái">
            <option value="">Tất cả người đăng ký</option>
            ${Object.entries(STATE).map(([k, v]) => `<option value="${k}" ${state.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"></colgroup>
            <thead><tr><th>Sinh viên</th><th>MSSV</th><th>Trạng thái</th><th>Check-in</th><th>Check-out</th><th>Thao tác</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="table-foot">
          <span>Hiển thị ${from}–${to} / ${fmtNum(d.total)} sinh viên</span>
          <div class="right">
            <div class="pager"><button id="prev" ${d.page <= 1 ? 'disabled' : ''}>‹</button><span>Trang ${d.page}/${pages}</span><button id="next" ${d.page >= pages ? 'disabled' : ''}>›</button></div>
            <div class="export-group">
              <button class="btn-outline" id="exportAll">${icon('download')}Danh sách đăng ký</button>
              <button class="btn-outline" id="exportDone">${icon('download')}Danh sách hoàn thành</button>
            </div>
            <a class="btn-outline" href="/event-detail.html?id=${ev.id}">Chi tiết sự kiện</a>
          </div>
        </div>
        <p class="fine">Mã QR và mã nhập tay tự đổi mỗi ${s ? s.rotate_seconds : 10} giây – ảnh chụp hoặc link QR gửi cho người không có mặt sẽ hết hạn, sinh viên phải quét mã đang trình chiếu tại sự kiện. Danh sách đăng ký dùng để đối chiếu khi check-in. Danh sách hoàn thành gồm sinh viên có đủ check-in và check-out – dùng để nộp nhận điểm Đoàn, quyền lợi. Thay đổi thủ công cần có lý do và được lưu lịch sử. Danh sách tự làm mới mỗi 15 giây.</p>
      </section>`;

    // ----- Sự kiện -----
    let t;
    $('q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.page = 1; renderOrganizer(); }, 300); });
    if (focusSearch) { const i = $('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    $('st').onchange = (e) => { state.status = e.target.value; state.page = 1; renderOrganizer(); };
    $('prev').onclick = () => { state.page--; renderOrganizer(); };
    $('next').onclick = () => { state.page++; renderOrganizer(); };
    $('exportAll').onclick = () => App.download(`/api/attendance/${ev.id}/export?type=all`);
    $('exportDone').onclick = () => App.download(`/api/attendance/${ev.id}/export?type=completed`);
    if ($('openIn')) $('openIn').onclick = () => openSession(ev, 'checkin');
    if ($('openOut')) $('openOut').onclick = () => openSession(ev, 'checkout');
    if ($('closeBtn')) $('closeBtn').onclick = async () => {
      const desc = s.kind === 'checkout'
        ? 'Sinh viên chưa check-out sẽ không được tính là hoàn thành. Bạn có thể mở lại phiên check-out hoặc cập nhật thủ công sau đó.'
        : `${fmtNum(d.stats.pending)} sinh viên chưa check-in sẽ được ghi nhận <b>vắng mặt</b>. Bạn vẫn có thể sửa thủ công sau đó (kèm lý do).`;
      if (!(await App.confirmBox(`Đóng phiên ${kindLabel}?`, desc, 'Đóng phiên', true))) return;
      try { const r = await api(`/api/attendance/${ev.id}/close`, { method: 'POST' }); toast(r.kind === 'checkout' ? 'Đã đóng phiên check-out.' : `Đã đóng phiên check-in. ${r.absent} sinh viên được ghi nhận vắng mặt.`, 'ok'); renderOrganizer(); }
      catch (err) { toast(err.message, 'err'); }
    };
    if ($('sendPoints')) $('sendPoints').onclick = async () => {
      const v = await modal({
        title: 'Gửi danh sách nhận điểm hoạt động', okText: 'Gửi danh sách',
        desc: `<b>${fmtNum(d.stats.completed)}</b> sinh viên hoàn thành sự kiện sẽ được gửi tới Văn phòng Đoàn để duyệt cộng <b>${ev.points} điểm</b>/sinh viên.`,
        html: '<label class="label">Ghi chú gửi Văn phòng Đoàn (không bắt buộc)</label><textarea class="inp" id="m-note" placeholder="VD: Danh sách đã đối chiếu với biên bản điểm danh giấy"></textarea>',
        onOk: async (root) => api(`/api/attendance/${ev.id}/submit-points`, { method: 'POST', body: { note: root.querySelector('#m-note').value } }),
      });
      if (v) { toast('Đã gửi danh sách – chờ Văn phòng Đoàn duyệt.', 'ok'); renderOrganizer(); }
    };
    const present = () => {
      if (!qrState.qr) return;
      modal({ title: `Mã QR ${kindLabel} – ${ev.title}`, hideOk: true, cancelText: 'Đóng', wide: true,
        html: `<div class="qr-big"><img data-qr-img src="${qrState.qr}" alt="QR"><strong data-qr-code>${esc(qrState.code)}</strong>
          <div class="qr-timer big"><i data-qr-bar></i></div>
          <span class="hint">Mã đổi sau <b data-qr-count>${Math.ceil(Math.max(0, qrState.nextAt - Date.now()) / 1000)}</b> giây • Phiên ${kindLabel} hiệu lực tới ${fmtTime(s.expires_at)}</span>
          <span class="hint">Quét bằng camera điện thoại (cùng mạng Wi-Fi) • Không chụp lại gửi cho người khác – mã sẽ hết hạn</span></div>` });
      tickQr();
    };
    if ($('qrBox') && s && s.valid) $('qrBox').onclick = present;
    if ($('presentBtn')) $('presentBtn').onclick = present;
    startQr(ev.id, s && s.valid ? { code: s.code, qr: d.qr, remaining_ms: s.remaining_ms, rotate_seconds: s.rotate_seconds } : null);
    document.querySelectorAll('[data-mark]').forEach((a) => a.addEventListener('click', () => markManual(ev, a.dataset)));
  }

  // ----- Mã QR động: tự lấy mã mới mỗi khi hết chu kỳ (mặc định 10 giây), cập nhật cả khung nhỏ và cửa sổ trình chiếu -----
  const qrState = { eventId: null, code: '', qr: '', nextAt: 0, period: 10, fetchT: null, tickT: null };
  function stopQr() { clearTimeout(qrState.fetchT); clearInterval(qrState.tickT); qrState.eventId = null; }
  function tickQr() {
    const left = Math.max(0, qrState.nextAt - Date.now());
    document.querySelectorAll('[data-qr-count]').forEach((el) => { el.textContent = Math.ceil(left / 1000); });
    document.querySelectorAll('[data-qr-bar]').forEach((el) => { el.style.width = `${(left / (qrState.period * 1000)) * 100}%`; });
  }
  function applyQr(v) {
    Object.assign(qrState, { code: v.code, qr: v.qr, period: v.rotate_seconds || 10, nextAt: Date.now() + v.remaining_ms });
    document.querySelectorAll('[data-qr-img]').forEach((el) => { el.src = v.qr; });
    document.querySelectorAll('[data-qr-code]').forEach((el) => { el.textContent = v.code; });
    tickQr();
    clearTimeout(qrState.fetchT);
    qrState.fetchT = setTimeout(fetchQr, Math.max(300, v.remaining_ms + 150));
  }
  async function fetchQr() {
    const id = qrState.eventId;
    if (!id) return;
    try {
      const r = await api(`/api/attendance/${id}/qr`);
      if (id !== qrState.eventId) return;
      if (!r.session || !r.qr) { stopQr(); renderOrganizer(true); return; } // phiên đã đóng / hết hạn
      applyQr({ ...r.session, qr: r.qr });
    } catch { qrState.fetchT = setTimeout(fetchQr, 2000); } // lỗi mạng tạm thời → thử lại
  }
  function startQr(id, first) {
    stopQr();
    if (!first || !first.qr) return;
    qrState.eventId = id;
    applyQr(first);
    qrState.tickT = setInterval(tickQr, 250);
  }

  async function openSession(ev, kind, renew = false) {
    const label = kind === 'checkout' ? 'check-out' : 'check-in';
    const v = await modal({
      title: `Mở phiên ${label}`, okText: 'Mở phiên',
      desc: (kind === 'checkout' ? 'Sinh viên đã check-in sẽ nhận thông báo để check-out. Phiên check-in đang mở (nếu có) sẽ được đóng nhưng không ghi vắng.'
          : 'Sinh viên đã đăng ký sẽ nhận thông báo.') + ' Mã QR và mã nhập tay <b>tự đổi mỗi 10 giây</b>, sinh viên phải quét mã đang trình chiếu tại địa điểm.',
      html: `<label class="label">Thời gian hiệu lực</label>
        <select class="select" id="m-min" style="width:100%"><option value="15">15 phút</option><option value="30">30 phút</option><option value="45" selected>45 phút</option><option value="60">60 phút</option><option value="120">120 phút</option><option value="600">Tối đa cho phép</option></select>`,
      onOk: async (root) => api(`/api/attendance/${ev.id}/open`, { method: 'POST', body: { kind, minutes: root.querySelector('#m-min').value } }),
    });
    if (v) { toast(`Đã mở phiên ${label} (mã QR động) – hiệu lực tới ${fmtTime(v.expires_at)}.`, 'ok'); renderOrganizer(); }
  }

  async function markManual(ev, ds) {
    const v = await modal({
      title: 'Cập nhật điểm danh thủ công', okText: 'Lưu thay đổi',
      desc: `Sinh viên: <b>${esc(ds.name)}</b>. Thay đổi được lưu vào lịch sử kèm lý do và gửi thông báo tới sinh viên.`,
      html: `<label class="label">Trạng thái mới</label>
        <select class="select" id="m-att" style="width:100%">
          ${Object.entries(STATE).filter(([k]) => k !== ds.state).map(([k, v2]) => `<option value="${k}">${v2[0]}</option>`).join('')}
        </select>
        <label class="label">Lý do <span class="req">*</span></label>
        <textarea class="inp" id="m-reason" placeholder="VD: Sinh viên có mặt nhưng điện thoại hết pin, BTC xác nhận trực tiếp"></textarea>`,
      onOk: async (root) => api(`/api/attendance/${ev.id}/mark`, { method: 'POST', body: { registration_id: Number(ds.mark), state: root.querySelector('#m-att').value, reason: root.querySelector('#m-reason').value } }),
    });
    if (v) { toast('Đã cập nhật điểm danh.', 'ok'); renderOrganizer(); }
  }

  function pickOrganizerEvent() {
    const L = { ongoing: ['Đang diễn ra', 'green'], upcoming: ['Sắp diễn ra', ''], ended: ['Đã kết thúc', 'gray'] };
    modal({ title: 'Đổi sự kiện', hideOk: true, cancelText: 'Đóng', wide: true,
      html: `<div class="my-list">${events.map((e) => `<a class="my-item ${e.id === eventId ? 'sel' : ''}" href="#" data-ev="${e.id}"><div><b>${esc(e.title)}</b><small>${fmtDateTime(e.start_at)} • ${fmtNum(e.registered_count)} đăng ký • ${fmtNum(e.completed_count)} hoàn thành</small></div><span class="tag ${L[e.phase][1]}">${L[e.phase][0]}</span></a>`).join('')}</div>` })
      .then(() => {});
    document.querySelectorAll('[data-ev]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); eventId = Number(a.dataset.ev); state = { q: '', status: '', page: 1 };
      document.querySelector('.modal-back [data-x]').click(); renderOrganizer();
    }));
  }

  if (user.role === 'student') student(); else organizer();
})();
