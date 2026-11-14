// Trang Nhật ký thao tác (Văn phòng Đoàn): tra cứu lịch sử thao tác trên hệ thống
(async function () {
  const { api, esc, fmtNum, fmtDateTime, ROLE } = App;
  try { await App.init({ page: 'activitylog', roles: ['doan'] }); } catch { return; }
  const $ = (s) => document.getElementById(s);
  let page = 1;

  async function load() {
    const qs = new URLSearchParams({ page, kw: $('kw').value.trim(), group: $('fGroup').value, from: $('fFrom').value, to: $('fTo').value });
    let d;
    try { d = await api(`/api/doan/logs?${qs}`); } catch (err) { $('rows').innerHTML = `<tr><td colspan="3">${App.emptyState('Không tải được dữ liệu', err.message)}</td></tr>`; return; }
    $('rows').innerHTML = d.rows.length ? d.rows.map((r) => `<tr>
        <td>${fmtDateTime(r.created_at)}</td>
        <td><b class="cell-title">${esc(r.actor_name || 'Hệ thống')}</b><span class="cell-sub">${esc([ROLE[r.actor_role], r.actor_code].filter(Boolean).join(' • '))}</span></td>
        <td>${esc(r.detail || r.action)}${r.reason ? `<span class="cell-sub">Lý do: ${esc(r.reason)}</span>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="3">${App.emptyState('Không có thao tác phù hợp', '', 'history')}</td></tr>`;
    const from = (d.page - 1) * d.size + 1;
    $('count').textContent = d.total ? `Hiển thị ${from}–${from + d.rows.length - 1} / ${fmtNum(d.total)} thao tác` : '';
    const pages = Math.ceil(d.total / d.size);
    $('pager').innerHTML = pages > 1 ? `<button ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}">‹</button>` +
      Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
        .map((p, i, arr) => `${i && p - arr[i - 1] > 1 ? '<span>…</span>' : ''}<button class="${p === page ? 'on' : ''}" data-p="${p}">${p}</button>`).join('') +
      `<button ${page >= pages ? 'disabled' : ''} data-p="${page + 1}">›</button>` : '';
    $('pager').querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { page = Number(b.dataset.p); load(); }; });
  }

  let t;
  $('kw').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  for (const id of ['fGroup', 'fFrom', 'fTo']) $(id).onchange = () => { page = 1; load(); };
  load();
})();
