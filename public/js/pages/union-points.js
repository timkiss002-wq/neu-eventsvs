// Trang Điểm Đoàn sinh viên (Văn phòng Đoàn): tra cứu điểm theo học kỳ, lịch sử điểm, cộng / trừ điểm, xuất Excel
(async function () {
  const { api, esc, icon, fmtDate, fmtDateTime, fmtNum, toast, modal, LEVEL } = App;
  let term;
  try { ({ term } = await App.init({ page: 'union', roles: ['doan'] })); } catch { return; }
  const $ = (s) => document.getElementById(s);
  const stat = (label, val, sub, ic) => `<div class="stat"><div class="stat-top">${label} ${icon(ic)}</div><strong>${val}</strong><small>${sub}</small></div>`;
  const signed = (n) => `<span class="pts ${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${n}</span>`;

  $('term').innerHTML = `<option value="all">Tất cả học kỳ</option>` + App.terms.map((t) => `<option value="${t.key}" ${t.key === term.key ? 'selected' : ''}>${esc(t.short)}</option>`).join('');
  $('exportBtn').innerHTML = `${icon('download')}Xuất bảng điểm Excel`;
  let classesLoaded = false, data = [], page = 1;
  const SIZE = 15;

  const params = () => new URLSearchParams({ term: $('term').value, q: $('kw').value.trim(), class: $('cls').value, sort: $('sort').value });

  async function load() {
    let d;
    try { d = await api(`/api/doan/students?${params()}`); }
    catch (err) { $('rows').innerHTML = `<tr><td colspan="7">${App.emptyState('Không tải được dữ liệu', err.message)}</td></tr>`; return; }
    const s = d.stats;
    $('stats').innerHTML = stat('Sinh viên', fmtNum(s.students), d.term_label, 'users') +
      stat('Đã có điểm Đoàn', fmtNum(s.with_points), `${s.students ? Math.round((s.with_points / s.students) * 100) : 0}% sinh viên`, 'award') +
      stat('Tổng điểm đã cộng', fmtNum(s.total_points), `Trung bình ${String(s.avg).replace('.', ',')} điểm/sinh viên • điều chỉnh ${s.adjustments > 0 ? '+' : ''}${fmtNum(s.adjustments)}`, 'gift') +
      stat('Lượt chờ duyệt điểm', fmtNum(s.waiting), 'Đã hoàn thành, chưa được cộng điểm', 'clock');
    if (!classesLoaded) { $('cls').innerHTML += d.classes.map((c) => `<option>${esc(c)}</option>`).join(''); classesLoaded = true; }
    data = d.students; page = 1;
    $('foot').textContent = `${fmtNum(d.students.length)} sinh viên • ${d.term_label}. Điểm Đoàn = điểm được duyệt từ sự kiện + điều chỉnh của Văn phòng Đoàn. Bấm vào dòng để xem lịch sử.`;
    render();
  }

  function render() {
    const pages = Math.max(1, Math.ceil(data.length / SIZE));
    const rows = data.slice((page - 1) * SIZE, page * SIZE);
    $('rows').innerHTML = rows.length ? rows.map((r) => `<tr class="up-row" data-id="${r.id}">
        <td>${esc(r.code)}</td>
        <td><span class="cell-title">${esc(r.full_name)}</span><span class="cell-sub">${esc(r.class_name || '')}</span></td>
        <td>${fmtNum(r.activities)}${r.waiting ? `<span class="cell-sub">+${r.waiting} chờ duyệt</span>` : ''}</td>
        <td>${fmtNum(r.event_points)}</td>
        <td>${r.adjust_points ? signed(r.adjust_points) : '<span class="cell-sub">—</span>'}</td>
        <td><span class="pts">${fmtNum(r.total)}</span></td>
        <td><div class="cell-actions"><a class="link" data-hist="${r.id}">Lịch sử</a><a class="link" data-adj="${r.id}">Cộng / trừ</a></div></td>
      </tr>`).join('') : `<tr><td colspan="7">${App.emptyState('Không tìm thấy sinh viên', 'Thử từ khóa hoặc bộ lọc khác.', 'users')}</td></tr>`;
    // Phân trang
    const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    $('pager').innerHTML = pages > 1 ? `<button data-pg="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>${nums.map((n) => `<button data-pg="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button data-pg="${page + 1}" ${page === pages ? 'disabled' : ''}>›</button>` : '';
    document.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => { page = Number(b.dataset.pg); render(); });
    const byId = new Map(data.map((r) => [String(r.id), r]));
    document.querySelectorAll('[data-adj]').forEach((a) => a.addEventListener('click', (e) => { e.stopPropagation(); adjust(byId.get(a.dataset.adj)); }));
    document.querySelectorAll('.up-row').forEach((tr) => tr.addEventListener('click', () => historyOf(Number(tr.dataset.id))));
  }

  // Lịch sử điểm Đoàn của 1 sinh viên
  async function historyOf(id) {
    let d;
    try { d = await api(`/api/doan/students/${id}`); } catch (err) { toast(err.message, 'err'); return; }
    const st = d.student;
    const html = `
      <div class="term-chips">${d.terms.length ? d.terms.map((t) => `<div class="term-chip"><b>${fmtNum(t.total)}</b>${esc(t.label)}<br><small>${t.activities} hoạt động${t.adjust_points ? ` • điều chỉnh ${t.adjust_points > 0 ? '+' : ''}${t.adjust_points}` : ''}</small></div>`).join('') : '<div class="hint">Chưa có điểm Đoàn.</div>'}</div>
      <h4 class="label" style="margin-top:16px">Lịch sử điểm (${d.history.length})</h4>
      <div class="hist">${d.history.length ? d.history.map((h) => `<div class="hist-item"><div>
          <b>${esc(h.title)}</b>
          <small>${h.source === 'event' ? `Sự kiện ${esc(h.ref)} • ${esc(h.unit_short || '')} • ${esc(LEVEL[h.level] || '')} • ${fmtDate(h.at)}` : `Điều chỉnh thủ công • ${fmtDateTime(h.at)}`}${h.by_name ? ` • ${h.source === 'event' ? 'duyệt bởi' : 'bởi'} ${esc(h.by_name)}` : ''} • ${esc(h.term.label)}</small>
        </div>${signed(h.points)}</div>`).join('') : '<div class="hint">Chưa có lịch sử điểm.</div>'}</div>
      ${d.waiting.length ? `<h4 class="label" style="margin-top:16px">Hoàn thành, chờ cộng điểm (${d.waiting.length})</h4>
        <div class="hist">${d.waiting.map((w) => `<div class="hist-item"><div><b>${esc(w.title)}</b><small>${esc(w.unit_short || '')} • ${fmtDate(w.at)} • ${w.submission === 'pending' ? 'BTC đã gửi danh sách, chờ duyệt' : w.submission === 'rejected' ? 'Danh sách bị từ chối, chờ BTC gửi lại' : 'BTC chưa gửi danh sách'}</small></div><span class="st amber">+${w.points}</span></div>`).join('')}</div>` : ''}`;
    const r = await modal({ title: `${st.full_name} – ${st.code}`, desc: `${esc(st.class_name || '')} • Tổng điểm Đoàn tích lũy: <b>${fmtNum(d.total)}</b>`, html, wide: true, okText: 'Cộng / trừ điểm', cancelText: 'Đóng', onOk: () => 'adjust' });
    if (r === 'adjust') adjust({ id: st.id, code: st.code, full_name: st.full_name });
  }

  // Cộng / trừ điểm thủ công
  async function adjust(s) {
    if (!s) return;
    const ok = await modal({
      title: 'Cộng / trừ điểm Đoàn', desc: `Sinh viên <b>${esc(s.full_name)}</b> (${esc(s.code)}). Sinh viên sẽ nhận thông báo kèm lý do.`,
      html: `<div class="f-grid">
          <div><label class="label">Hình thức</label><select class="inp" id="aType" style="width:100%;height:38px"><option value="1">Cộng điểm</option><option value="-1">Trừ điểm</option></select></div>
          <div><label class="label">Số điểm <span class="req">*</span></label><input class="inp" id="aPts" type="number" min="1" max="20" value="1" style="width:100%;height:38px"></div>
          <div class="full"><label class="label">Lý do / căn cứ <span class="req">*</span></label><textarea class="inp" id="aReason" placeholder="VD: Tham gia đội tình nguyện tiếp sức mùa thi (QĐ số .../QĐ-ĐTN)"></textarea></div>
        </div>`,
      okText: 'Lưu điều chỉnh',
      onOk: async (root) => {
        const pts = Number(root.querySelector('#aPts').value) * Number(root.querySelector('#aType').value);
        return api(`/api/doan/students/${s.id}/adjust`, { method: 'POST', body: { points: pts, reason: root.querySelector('#aReason').value.trim() } });
      },
    });
    if (ok) { toast('Đã lưu điều chỉnh điểm Đoàn.', 'ok'); load(); }
  }

  $('exportBtn').onclick = () => App.download(`/api/doan/students-export?${params()}`);
  let t;
  $('kw').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  ['cls', 'term', 'sort'].forEach((k) => $(k).addEventListener('change', load));
  load();
})();
