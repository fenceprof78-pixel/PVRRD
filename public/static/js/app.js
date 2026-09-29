const WARDS = ['ICU', 'General A', 'General B', 'Cardiology'];
const WARD_COLORS = ['#E84B6A', '#1B8C87', '#F4A01C', '#00B894'];

// ── API helpers ──
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function riskColor(r) {
  if (r >= 70) return 'var(--rose)';
  if (r >= 40) return 'var(--amber)';
  return 'var(--mint)';
}
function spo2Color(s) {
  if (s === null || s === undefined) return 'var(--muted)';
  if (s >= 95) return 'var(--mint)';
  if (s >= 92) return 'var(--amber)';
  return 'var(--rose)';
}
function statusBadge(p) {
  if (p.at_risk) return '<span class="badge risk">🔴 Critical</span>';
  if (p.risk_score >= 40) return '<span class="badge watch">🟡 Watch</span>';
  return '<span class="badge safe">🟢 Stable</span>';
}

function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'patients')  renderPatientTable();
  if (name === 'vitals')    renderVitalsPage();
  if (name === 'alerts')    renderAlerts();
}

function toast(msg, icon = '✓') {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.children[0].textContent = icon;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Dashboard ──
async function renderDashboard() {
  try {
    const s = await api('/dashboard/summary');
    document.getElementById('kpi-hr').textContent = s.avg_hr + ' BPM';
    document.getElementById('kpi-o2').textContent = s.o2_alert_rate + '%';
    document.getElementById('kpi-readmit').textContent = s.readmit_rate + '%';
    document.getElementById('kpi-risk').textContent = s.high_risk_count;

    const barEl = document.getElementById('ward-bar-chart');
    barEl.innerHTML = s.ward_bars.map((w, i) => `
      <div class="bar-row">
        <div class="bar-label">${w.ward}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.avg_risk}%;background:${WARD_COLORS[i]}"></div></div>
        <div class="bar-val">${w.avg_risk}</div>
      </div>`).join('');

    const heatEl = document.getElementById('heat-grid');
    heatEl.innerHTML = s.heat_map.map(h => {
      let bg, col, lbl;
      if (h.avg_risk >= 60)      { bg = '#FFE4EA'; col = '#C0183D'; lbl = 'High Risk'; }
      else if (h.avg_risk >= 35) { bg = '#FFF3D6'; col = '#A06200'; lbl = 'Watch'; }
      else                       { bg = '#DCF7EF'; col = '#007A5E'; lbl = 'Stable'; }
      return `
        <div class="heat-cell" style="background:${bg}">
          <div class="heat-subj" style="color:${col}">${h.ward}</div>
          <div class="heat-pct" style="color:${col}">${h.avg_risk}</div>
          <div class="heat-lbl" style="color:${col}">${lbl}</div>
        </div>`;
    }).join('');

    const legEl = document.getElementById('ward-dist-legend');
    legEl.innerHTML = s.ward_dist.map((w, i) => `
      <div class="donut-item"><div class="donut-dot" style="background:${WARD_COLORS[i]}"></div><span>${w.ward}: <strong>${w.count}</strong> patients</span></div>`).join('');

    const spo2El = document.getElementById('spo2-by-ward');
    spo2El.innerHTML = s.spo2_by_ward.map(w => `
      <div class="attend-row">
        <div class="attend-name">${w.ward}</div>
        <div class="attend-bar-wrap"><div class="attend-bar" style="width:${w.avg_spo2}%;background:${spo2Color(w.avg_spo2)}"></div></div>
        <div class="attend-pct" style="color:${spo2Color(w.avg_spo2)}">${w.avg_spo2}%</div>
      </div>`).join('');
  } catch (e) {
    toast('Could not load dashboard.', '⚠️');
  }
}

// ── Patients ──
async function addPatient() {
  const name = document.getElementById('inp-name').value.trim();
  const ward = document.getElementById('inp-ward').value;
  const age = parseInt(document.getElementById('inp-age').value);
  const prior = parseInt(document.getElementById('inp-prior').value) || 0;
  if (!name) return toast('Please enter a patient name.', '⚠️');
  if (isNaN(age) || age < 0 || age > 120) return toast('Enter a valid age (0–120).', '⚠️');
  try {
    await api('/patients', { method: 'POST', body: JSON.stringify({ name, ward, age, prior }) });
    document.getElementById('inp-name').value = '';
    document.getElementById('inp-age').value = '';
    document.getElementById('inp-prior').value = '';
    await renderPatientTable();
    await populateVitalsDropdown();
    toast(`${name} admitted successfully!`);
  } catch (e) {
    toast(e.message, '⚠️');
  }
}

let currentPatients = [];

async function renderPatientTable() {
  currentPatients = await api('/patients');
  const fw = document.getElementById('filter-ward').value;
  const fr = document.getElementById('filter-risk').value;

  let filtered = currentPatients.filter(p => {
    if (fw && p.ward !== fw) return false;
    if (fr === 'risk' && !p.at_risk) return false;
    if (fr === 'safe' && p.at_risk) return false;
    return true;
  });

  document.getElementById('patient-count-label').textContent = `${filtered.length} of ${currentPatients.length} patients`;

  const tbody = document.getElementById('patient-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">🔍</div><p>No patients match the current filters.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr class="${p.at_risk ? 'at-risk-row' : ''}">
      <td><strong>${p.name}</strong></td>
      <td>${p.ward}</td>
      <td>${p.age}</td>
      <td style="font-weight:700;color:${riskColor(p.risk_score)}">${p.risk_score}</td>
      <td style="font-weight:600;color:${spo2Color(p.latest_spo2)}">${p.latest_spo2 !== null ? p.latest_spo2 + '%' : '—'}</td>
      <td>${statusBadge(p)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openModal(${p.id})">View Profile</button>
        <button class="btn btn-danger btn-sm" style="margin-left:6px" onclick="removePatient(${p.id})">Discharge</button>
      </td>
    </tr>`).join('');
}

async function removePatient(id) {
  const p = currentPatients.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Discharge ${p.name}? This removes them from active monitoring.`)) return;
  try {
    await api(`/patients/${id}`, { method: 'DELETE' });
    await renderPatientTable();
    await populateVitalsDropdown();
    toast(`${p.name} discharged.`, '🛏️');
  } catch (e) {
    toast(e.message, '⚠️');
  }
}

async function populateVitalsDropdown() {
  const sel = document.getElementById('vitals-patient');
  if (!sel) return;
  const patients = await api('/patients');
  sel.innerHTML = patients.map(p => `<option value="${p.id}">${p.name} (${p.ward})</option>`).join('');
}

// ── Vitals ──
async function addVitals() {
  const pid = parseInt(document.getElementById('vitals-patient').value);
  const hr = parseInt(document.getElementById('vitals-hr').value);
  const spo2 = parseInt(document.getElementById('vitals-spo2').value);
  const bp = parseInt(document.getElementById('vitals-bp').value);
  if (isNaN(hr) || hr < 30 || hr > 220) return toast('Enter a valid heart rate (30–220).', '⚠️');
  if (isNaN(spo2) || spo2 < 50 || spo2 > 100) return toast('Enter a valid SpO2 (50–100).', '⚠️');
  if (isNaN(bp) || bp < 50 || bp > 250) return toast('Enter a valid systolic BP (50–250).', '⚠️');
  try {
    const result = await api('/vitals', { method: 'POST', body: JSON.stringify({ patient_id: pid, hr, spo2, bp }) });
    await renderVitalsTable();
    document.getElementById('vitals-hr').value = '';
    document.getElementById('vitals-spo2').value = '';
    document.getElementById('vitals-bp').value = '';
    const pname = document.querySelector(`#vitals-patient option[value="${pid}"]`)?.textContent || 'Patient';
    toast(`Vitals saved for ${pname}!`);
    if (result.critical) toast(`⚠️ Critical: ${pname}'s SpO2 is below threshold!`, '🚨');
  } catch (e) {
    toast(e.message, '⚠️');
  }
}

async function renderVitalsPage() {
  await populateVitalsDropdown();
  await renderVitalsTable();
}

async function renderVitalsTable() {
  const recent = await api('/vitals');
  const tbody = document.getElementById('vitals-tbody');
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">❤️</div><p>No vitals entered yet.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(v => {
    const statusTxt = v.spo2 < 92 ? '<span class="badge risk">🔴 Critical</span>' : v.hr > 100 ? '<span class="badge watch">🟡 Elevated</span>' : '<span class="badge safe">🟢 Normal</span>';
    return `
      <tr>
        <td><strong>${v.patient_name}</strong></td>
        <td style="font-weight:700">${v.hr} BPM</td>
        <td style="font-weight:700;color:${spo2Color(v.spo2)}">${v.spo2}%</td>
        <td>${v.bp} mmHg</td>
        <td>${statusTxt}</td>
        <td style="color:var(--muted)">${v.date}</td>
      </tr>`;
  }).join('');
}

// ── Alerts ──
async function renderAlerts() {
  const atRisk = await api('/alerts');
  const container = document.getElementById('risk-alerts-container');
  if (atRisk.length === 0) {
    container.innerHTML = '<div class="alert success"><div class="alert-icon">✅</div><div><strong>No critical alerts at this time.</strong> All monitored patients are within safe vitals and risk thresholds.</div></div>';
  } else {
    container.innerHTML = `<div class="alert danger"><div class="alert-icon">🚨</div><div><strong>${atRisk.length} patient${atRisk.length > 1 ? 's' : ''} require immediate clinical review.</strong> These patients have SpO2 below 92% or a readmission Risk Score of 70 or higher. Notify the attending physician.</div></div>`;
  }

  const tbody = document.getElementById('risk-tbody');
  if (!atRisk.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">🎉</div><p>No critical alerts at this time.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = atRisk.map(p => `
    <tr class="at-risk-row">
      <td><strong>${p.name}</strong></td>
      <td>${p.ward}</td>
      <td style="font-weight:700;color:${riskColor(p.risk_score)}">${p.risk_score}</td>
      <td style="font-weight:600;color:${spo2Color(p.latest_spo2)}">${p.latest_spo2 !== null ? p.latest_spo2 + '%' : '—'}</td>
      <td><span style="color:var(--rose);font-size:.82rem;font-weight:500">${p.reasons.join(' · ')}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="openModal(${p.id})">View Profile</button></td>
    </tr>`).join('');
}

// ── Modal ──
async function openModal(pid) {
  const p = await api(`/patients/${pid}/profile`);
  document.getElementById('modal-name').textContent = p.name;
  document.getElementById('modal-meta').textContent = `${p.ward} · Age ${p.age} · ${p.prior} prior admission(s)`;
  document.getElementById('modal-risk').textContent = p.risk_score;
  document.getElementById('modal-risk').style.color = riskColor(p.risk_score);
  document.getElementById('modal-hr-val').textContent = p.latest_hr ?? '—';
  document.getElementById('modal-spo2-val').textContent = p.latest_spo2 !== null ? p.latest_spo2 + '%' : '—';
  document.getElementById('modal-spo2-val').style.color = spo2Color(p.latest_spo2);

  const statusEl = document.getElementById('modal-status-val');
  statusEl.textContent = p.at_risk ? 'Critical' : p.risk_score >= 40 ? 'Watch' : 'Stable';
  statusEl.style.color = p.at_risk ? 'var(--rose)' : p.risk_score >= 40 ? 'var(--amber)' : 'var(--mint)';

  const subjEl = document.getElementById('modal-subjects');
  if (!p.history.length) {
    subjEl.innerHTML = '<div class="empty"><div class="empty-icon">❤️</div><p>No vitals recorded yet for this patient.</p></div>';
  } else {
    subjEl.innerHTML = p.history.map(h => {
      const c = spo2Color(h.spo2);
      return `
        <div class="modal-subject-row">
          <div class="msub-name">${h.date}</div>
          <div class="msub-bar-wrap"><div class="msub-bar" style="width:${h.spo2}%;background:${c}"></div></div>
          <div class="msub-score" style="color:${c}">HR ${h.hr} · SpO2 ${h.spo2}%</div>
        </div>`;
    }).join('');
  }

  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

// ── Init ──
document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
document.getElementById('btn-add-patient').addEventListener('click', addPatient);
document.getElementById('btn-add-vitals').addEventListener('click', addVitals);
document.getElementById('btn-close-modal').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
document.getElementById('filter-ward').addEventListener('change', renderPatientTable);
document.getElementById('filter-risk').addEventListener('change', renderPatientTable);

renderDashboard();
populateVitalsDropdown();

// Show any failed API call on screen instead of failing silently
window.addEventListener('unhandledrejection', (ev) => {
  const msg = (ev.reason && ev.reason.message) || 'Something went wrong';
  if (typeof toast === 'function') toast(msg, '⚠️');
  console.error(ev.reason);
});
