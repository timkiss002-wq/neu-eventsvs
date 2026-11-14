// Trang Tài khoản đơn vị (Văn phòng Đoàn): cấp tài khoản Ban tổ chức, đổi email đăng nhập,
// đặt lại mật khẩu, khóa / mở khóa tài khoản
(async function () {
  const { api, esc, icon, fmtNum, ago, toast, modal } = App;
  try { await App.init({ page: 'unitaccounts', roles: ['doan'] }); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const stat = (label, val, sub, ic) => `<div class="stat"><div class="stat-top">${label} ${icon(ic)}</div><strong>${val}</strong><small>${sub}</small></div>`;
  const NEU = /^[^\s@]+@([a-z0-9-]+\.)*neu\.edu\.vn$/i;
  $('addBtn').innerHTML = `${icon('plus')}Cấp tài khoản Ban tổ chức`;
  let data = { rows: [], units: [], counts: {} };

  const stateTag = (u) => (!u.is_active ? '<span class="st red">Đã khóa</span>'
    : u.temp_locked ? '<span class="st amber">Tạm khóa đăng nhập</span>' : '<span class="st green">Hoạt động</span>');

  async function load() {
    const qs = new URLSearchParams({ kw: $('kw').value.trim(), status: $('fStatus').value });
    try { data = await api(`/api/doan/accounts?${qs}`); } catch (err) { $('rows').innerHTML = `<tr><td colspan="5">${App.emptyState('Không tải được dữ liệu', err.message)}</td></tr>`; return; }
    const c = data.counts;
    const withAcc = new Set(data.rows.map((r) => r.unit_id));
    $('stats').innerHTML = stat('Tài khoản Ban tổ chức', fmtNum(c.total || 0), 'Mỗi tài khoản gắn với một đơn vị', 'building') +
      stat('Đang hoạt động', fmtNum(c.active || 0), 'Đăng nhập được vào hệ thống', 'check') +
      stat('Đã khóa', fmtNum(c.disabled || 0), 'Không thể đăng nhập', 'lock') +
      stat('Đơn vị', fmtNum(data.units.length), `${fmtNum(data.units.filter((u) => !withAcc.has(u.id)).length)} đơn vị chưa có tài khoản`, 'users');
    $('rows').innerHTML = data.rows.length ? data.rows.map((u) => `<tr>
        <td><b class="cell-title">${esc(u.unit_name || u.full_name)}</b><span class="cell-sub">${esc(u.unit_short || '')} • Mã ${esc(u.code)}</span></td>
        <td>${esc(u.email)}<span class="cell-sub">${u.last_login ? `Đăng nhập ${ago(u.last_login)}` : 'Chưa đăng nhập'}</span></td>
        <td style="white-space:nowrap">${fmtNum(u.event_count)} hồ sơ sự kiện<span class="cell-sub">Cấp ngày ${esc(u.created_at.slice(8, 10))}/${esc(u.created_at.slice(5, 7))}/${esc(u.created_at.slice(0, 4))}</span></td>
        <td>${stateTag(u)}</td>
        <td><div class="cell-actions">
          <a class="link" data-act="email" data-id="${u.id}">Đổi email</a>
          <a class="link" data-act="pw" data-id="${u.id}">Đặt lại mật khẩu</a>
          <a class="link ${u.is_active ? 'danger' : ''}" data-act="lock" data-id="${u.id}">${u.is_active ? 'Khóa' : 'Mở khóa'}</a>
        </div></td></tr>`).join('') : `<tr><td colspan="5">${App.emptyState('Không có tài khoản phù hợp', '', 'users')}</td></tr>`;
    document.querySelectorAll('#rows [data-act]').forEach((el) => el.addEventListener('click', () => act(el.dataset.act, data.rows.find((x) => x.id === Number(el.dataset.id)))));
  }

  // Hiển thị thông tin đăng nhập một lần (demo không gửi email)
  const showCredential = (title, email, password) => modal({
    title, hideOk: true, cancelText: 'Đã ghi lại',
    html: `<div class="alert ok" style="margin:0">Gửi thông tin dưới đây cho đơn vị. Mật khẩu chỉ hiển thị <b>một lần</b>; đơn vị nên đổi mật khẩu sau khi đăng nhập.</div>
      <div style="margin-top:14px;display:grid;grid-template-columns:130px 1fr;gap:8px;font-size:15px">
        <span>Email đăng nhập</span><b>${esc(email)}</b><span>Mật khẩu tạm</span><b style="font-family:monospace;font-size:17px;letter-spacing:1px">${esc(password)}</b></div>`,
  });

  async function act(action, u) {
    const who = `<b>${esc(u.unit_name || u.full_name)}</b> (${esc(u.code)})`;
    const put = (body) => api(`/api/doan/accounts/${u.id}`, { method: 'PUT', body });
    if (action === 'email') {
      const v = await modal({ title: 'Đổi email đăng nhập', desc: `${who}. Email mới phải có đuôi @neu.edu.vn và chưa được dùng.`, okText: 'Lưu',
        html: `<label class="label">Email mới <span class="req">*</span></label><input class="inp" id="m-email" value="${esc(u.email)}">`,
        onOk: (root) => {
          const email = root.querySelector('#m-email').value.trim();
          if (!NEU.test(email)) throw new Error('Email tài khoản đơn vị phải có đuôi @neu.edu.vn.');
          return put({ email });
        } });
      if (v) { toast('Đã đổi email đăng nhập.', 'ok'); load(); }
    }
    if (action === 'pw') {
      const v = await modal({ title: 'Đặt lại mật khẩu?', desc: `${who}. Hệ thống tạo mật khẩu tạm mới; mật khẩu cũ hết hiệu lực ngay.`, okText: 'Đặt lại mật khẩu',
        onOk: () => put({ action: 'reset_password' }) });
      if (v) { await showCredential('Đã đặt lại mật khẩu', v.email, v.password); load(); }
    }
    if (action === 'lock') {
      const v = await modal({ title: u.is_active ? 'Khóa tài khoản?' : 'Mở khóa tài khoản?', okText: u.is_active ? 'Khóa' : 'Mở khóa', danger: !!u.is_active,
        desc: u.is_active ? `${who} sẽ không thể đăng nhập cho tới khi được mở khóa. Hồ sơ sự kiện của đơn vị vẫn được giữ nguyên.` : `${who} sẽ đăng nhập lại được.`,
        html: '<label class="label">Lý do</label><textarea class="inp" id="m-reason" placeholder="VD: Đơn vị đổi người phụ trách"></textarea>',
        onOk: (root) => put({ action: u.is_active ? 'lock' : 'unlock', reason: root.querySelector('#m-reason').value }) });
      if (v) { toast(u.is_active ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.', 'ok'); load(); }
    }
  }

  $('addBtn').onclick = async () => {
    const v = await modal({ title: 'Cấp tài khoản Ban tổ chức', okText: 'Tạo tài khoản', wide: true,
      desc: 'Tài khoản mang tên đơn vị, đăng nhập bằng email @neu.edu.vn. Hệ thống tạo mật khẩu tạm.',
      html: `<label class="label">Đơn vị <span class="req">*</span></label>
        <select class="inp" id="m-unit"><option value="">— Đơn vị mới (nhập bên dưới) —</option>${data.units.map((un) => `<option value="${un.id}">${esc(un.name)}</option>`).join('')}</select>
        <div id="m-newunit" style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-top:10px">
          <input class="inp" id="m-uname" placeholder="Tên đơn vị mới, VD: CLB Tiếng Anh NEU"><input class="inp" id="m-ushort" placeholder="Tên viết tắt"></div>
        <label class="label" style="margin-top:12px">Email đăng nhập <span class="req">*</span></label><input class="inp" id="m-email" placeholder="VD: clbtienganh@neu.edu.vn">
        <label class="label" style="margin-top:12px">Số điện thoại liên hệ</label><input class="inp" id="m-phone" placeholder="Không bắt buộc">`,
      onOk: (root) => {
        const email = root.querySelector('#m-email').value.trim();
        if (!NEU.test(email)) throw new Error('Email tài khoản đơn vị phải có đuôi @neu.edu.vn.');
        return api('/api/doan/accounts', { method: 'POST', body: {
          unit_id: Number(root.querySelector('#m-unit').value) || null, unit_name: root.querySelector('#m-uname').value, unit_short: root.querySelector('#m-ushort').value,
          email, phone: root.querySelector('#m-phone').value } });
      } });
    if (v) { await showCredential(`Đã cấp tài khoản cho ${v.unit}`, v.email, v.password); load(); }
  };
  document.addEventListener('change', (e) => { if (e.target.id === 'm-unit') document.getElementById('m-newunit').hidden = !!e.target.value; });

  let t;
  $('kw').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  $('fStatus').onchange = load;
  load();
})();
