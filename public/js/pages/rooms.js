// Trang Quản lý phòng (Văn phòng Đoàn): danh mục phòng, thêm / sửa / tạm ngưng, lịch sử dụng phòng
(async function () {
  const { api, esc, icon, fmtDate, fmtTime, fmtNum, toast, modal, askReason, weekday } = App;
  try { await App.init({ page: 'rooms', roles: ['doan'] }); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const stat = (label, val, sub, ic) => `<div class="stat"><div class="stat-top">${label} ${icon(ic)}</div><strong>${val}</strong><small>${sub}</small></div>`;
  $('addBtn').innerHTML = `${icon('plus')}Thêm phòng`;
  $('schFrom').value = new Date().toISOString().slice(0, 10);
  let rooms = [];

  async function load() {
    let d;
    try { d = await api('/api/rooms?all=1'); } catch (err) { $('rows').innerHTML = `<tr><td colspan="5">${App.emptyState('Không tải được dữ liệu', err.message)}</td></tr>`; return; }
    rooms = d.rooms; const s = d.stats;
    const busy = rooms.filter((r) => r.in_use).length;
    $('stats').innerHTML = stat('Tổng số phòng', fmtNum(s.total), `${fmtNum(s.active)} đang sử dụng • ${fmtNum(s.inactive)} tạm ngưng`, 'door') +
      stat('Tổng sức chứa', fmtNum(s.seats), 'Chỗ ngồi của các phòng đang hoạt động', 'users') +
      stat('Đang diễn ra sự kiện', fmtNum(busy), 'Phòng có sự kiện ở thời điểm hiện tại', 'activity') +
      stat('Lượt đăng ký chờ duyệt', fmtNum(rooms.reduce((n, r) => n + r.pending, 0)), 'Hồ sơ sự kiện đang chờ duyệt', 'clock');
    $('rows').innerHTML = rooms.map((r) => `<tr class="${r.is_active ? '' : 'rm-off'}">
        <td><span class="cell-title">${esc(r.name)}</span><span class="cell-sub">${esc(r.code)} • ${esc(r.building || '')}${r.equipment ? ' • ' + esc(r.equipment) : ''}</span>${!r.is_active && r.note ? `<span class="cell-sub" style="color:#c23a3a">${esc(r.note)}</span>` : ''}</td>
        <td>${fmtNum(r.capacity)}</td>
        <td>${r.upcoming} sắp tới<span class="cell-sub">${r.pending} chờ duyệt • ${r.total_events} đã tổ chức</span></td>
        <td>${!r.is_active ? '<span class="st gray">Tạm ngưng</span>' : r.in_use ? '<span class="st green">Đang sử dụng</span>' : '<span class="st">Sẵn sàng</span>'}</td>
        <td><div class="cell-actions"><a class="link" data-edit="${r.id}">Sửa</a><a class="link ${r.is_active ? 'danger' : ''}" data-tog="${r.id}">${r.is_active ? 'Tạm ngưng' : 'Mở lại'}</a></div></td>
      </tr>`).join('');
    const cur = $('schRoom').value;
    $('schRoom').innerHTML = '<option value="">Tất cả phòng</option>' + rooms.map((r) => `<option value="${r.id}" ${String(r.id) === cur ? 'selected' : ''}>${esc(r.code)} – ${esc(r.name)}</option>`).join('');
    document.querySelectorAll('[data-edit]').forEach((a) => a.onclick = () => edit(rooms.find((r) => r.id === Number(a.dataset.edit))));
    document.querySelectorAll('[data-tog]').forEach((a) => a.onclick = () => toggle(rooms.find((r) => r.id === Number(a.dataset.tog))));
    schedule();
  }

  async function schedule() {
    const p = new URLSearchParams({ from: $('schFrom').value, room: $('schRoom').value });
    let d;
    try { d = await api(`/api/rooms/schedule?${p}`); } catch (err) { $('sched').innerHTML = App.emptyState('Không tải được lịch', err.message); return; }
    $('sched').innerHTML = d.items.length ? d.items.map((e) => `<a class="sched-item" href="${e.status === 'pending' ? `/moderation.html?id=${e.id}` : `/event-detail.html?id=${e.id}`}">
        <div class="d">${fmtDate(e.start_at).slice(0, 5)}<small>${weekday(e.start_at)}</small></div>
        <div><b>${esc(e.title)}</b><small>${esc(e.room_code)} • ${fmtTime(e.start_at)}–${fmtTime(e.end_at)} • ${esc(e.unit_short || '')} • ${fmtNum(e.capacity)} người</small>
          <div style="margin-top:6px">${e.status === 'approved' ? '<span class="st green">Đã duyệt</span>' : `<span class="st amber">Chờ duyệt</span> ${App.approvalHtml(e, { compact: true })}`}</div></div>
      </a>`).join('') : App.emptyState('Không có lịch sử dụng', 'Chưa có sự kiện đăng ký phòng trong khoảng này.', 'calendar');
  }

  function form(r = {}) {
    return `<div class="f-grid">
      <div><label class="label">Mã phòng <span class="req">*</span></label><input class="inp" id="rCode" value="${esc(r.code || '')}" placeholder="VD: A2-B101" style="width:100%;height:38px"></div>
      <div><label class="label">Sức chứa (người) <span class="req">*</span></label><input class="inp" id="rCap" type="number" min="1" value="${r.capacity || ''}" style="width:100%;height:38px"></div>
      <div class="full"><label class="label">Tên hiển thị <span class="req">*</span></label><input class="inp" id="rName" value="${esc(r.name || '')}" placeholder="VD: Phòng B101, nhà A2" style="width:100%;height:38px"></div>
      <div class="full"><label class="label">Nhà / khu vực</label><input class="inp" id="rBuild" value="${esc(r.building || '')}" placeholder="VD: Nhà A2" style="width:100%;height:38px"></div>
      <div class="full"><label class="label">Trang thiết bị</label><textarea class="inp" id="rEq" placeholder="Máy chiếu, âm thanh, wifi...">${esc(r.equipment || '')}</textarea></div>
    </div>`;
  }
  const read = (root) => ({ code: root.querySelector('#rCode').value, name: root.querySelector('#rName').value, capacity: root.querySelector('#rCap').value,
    building: root.querySelector('#rBuild').value, equipment: root.querySelector('#rEq').value });

  async function edit(r) {
    const ok = await modal({ title: r ? `Sửa phòng ${r.code}` : 'Thêm phòng mới', html: form(r), okText: r ? 'Lưu thay đổi' : 'Thêm phòng', wide: true,
      onOk: (root) => api(r ? `/api/rooms/${r.id}` : '/api/rooms', { method: r ? 'PUT' : 'POST', body: { ...read(root), note: r ? r.note : '' } }) });
    if (ok) { toast(r ? 'Đã cập nhật phòng.' : 'Đã thêm phòng.', 'ok'); load(); }
  }

  async function toggle(r) {
    let reason = '';
    if (r.is_active) {
      reason = await askReason(`Tạm ngưng ${r.name}?`, 'Phòng tạm ngưng sẽ không hiển thị khi Ban tổ chức tạo sự kiện.', { okText: 'Tạm ngưng', danger: true, min: 5, placeholder: 'VD: Sửa chữa hệ thống điều hòa' });
      if (!reason) return;
    }
    try { await api(`/api/rooms/${r.id}/toggle`, { method: 'POST', body: { reason } }); toast(r.is_active ? 'Đã tạm ngưng phòng.' : 'Đã mở lại phòng.', 'ok'); load(); }
    catch (err) { toast(err.message, 'err'); }
  }

  $('addBtn').onclick = () => edit(null);
  $('schRoom').addEventListener('change', schedule);
  $('schFrom').addEventListener('change', schedule);
  load();
})();
