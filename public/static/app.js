/* Legal Metrology Compliance Checker — SPA frontend */
/* global axios, Chart, dayjs */

const API = '/api/v1';
let TOKEN = localStorage.getItem('lmpc_token') || null;
let USER = JSON.parse(localStorage.getItem('lmpc_user') || 'null');
let chartRefs = [];

const http = axios.create({ baseURL: API });
http.interceptors.request.use(cfg => {
  if (TOKEN) cfg.headers.Authorization = `Bearer ${TOKEN}`;
  return cfg;
});
http.interceptors.response.use(r => r, err => {
  if (err.response && err.response.status === 401 && TOKEN) { logout(); }
  return Promise.reject(err);
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function errMsg(e) { return e?.response?.data?.error || e.message || 'Request failed'; }
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm ${kind === 'error' ? 'bg-red-600' : kind === 'success' ? 'bg-green-600' : 'bg-slate-800'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

const STATUS_BADGE = {
  compliant:     'bg-green-100 text-green-800 border-green-300',
  non_compliant: 'bg-red-100 text-red-800 border-red-300',
  needs_review:  'bg-amber-100 text-amber-800 border-amber-300',
  not_applicable:'bg-slate-100 text-slate-500 border-slate-200',
  exempt:        'bg-blue-100 text-blue-800 border-blue-300',
  open:          'bg-blue-100 text-blue-800 border-blue-300',
  under_review:  'bg-amber-100 text-amber-800 border-amber-300',
  closed:        'bg-slate-200 text-slate-700 border-slate-300',
  disputed:      'bg-purple-100 text-purple-800 border-purple-300',
  uploaded:      'bg-slate-100 text-slate-600 border-slate-200',
  extracting:    'bg-amber-100 text-amber-800 border-amber-300',
  evaluated:     'bg-green-100 text-green-800 border-green-300',
  error:         'bg-red-100 text-red-800 border-red-300',
  pending:       'bg-amber-100 text-amber-800 border-amber-300',
  resolved:      'bg-green-100 text-green-800 border-green-300'
};
function badge(status) {
  const cls = STATUS_BADGE[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}">${esc(String(status || '—').replace(/_/g, ' '))}</span>`;
}
function severityBadge(sev) {
  const m = { major: 'bg-red-600 text-white', minor: 'bg-amber-500 text-white', info: 'bg-slate-400 text-white' };
  return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${m[sev] || m.info}">${esc(sev)}</span>`;
}
function fmtDate(d) { return d ? dayjs(d).format('DD MMM YYYY, HH:mm') : '—'; }

/* ───────────────────────── Router ───────────────────────── */

function navigate(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);

function destroyCharts() { chartRefs.forEach(c => c.destroy()); chartRefs = []; }

async function render() {
  destroyCharts();
  if (typeof stopCamera === 'function' && cameraStream) stopCamera(); // release camera on navigation
  const app = document.getElementById('app');
  if (!TOKEN || !USER) { renderLogin(app); return; }
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, ...rest] = hash.split('/').filter(Boolean);
  app.innerHTML = layoutShell();
  const main = document.getElementById('main-content');
  try {
    if (path === 'dashboard') await pageDashboard(main);
    else if (path === 'cases' && rest[0]) await pageCaseDetail(main, rest[0]);
    else if (path === 'cases') await pageCases(main);
    else if (path === 'scan' && rest[0]) await pageScanDetail(main, rest[0]);
    else if (path === 'newscan') await pageNewScan(main, rest[0] || null);
    else if (path === 'repository') await pageRepository(main);
    else if (path === 'product' && rest[0]) await pageProduct(main, rest[0]);
    else if (path === 'reports') await pageReports(main);
    else if (path === 'report' && rest[0]) await pageReportView(main, rest[0]);
    else if (path === 'reviews') await pageReviews(main);
    else if (path === 'rulepacks') await pageRulePacks(main);
    else if (path === 'audit') await pageAudit(main);
    else await pageDashboard(main);
  } catch (e) {
    main.innerHTML = `<div class="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">${esc(errMsg(e))}</div>`;
  }
  highlightNav(path);
}

function highlightNav(path) {
  document.querySelectorAll('[data-nav]').forEach(el => {
    const active = el.getAttribute('data-nav') === path;
    el.classList.toggle('bg-gov-700', active);
    el.classList.toggle('text-white', active);
    el.classList.toggle('text-slate-300', !active);
  });
}

function layoutShell() {
  const role = USER.role;
  const navItems = [
    ['dashboard', 'fa-gauge-high', 'Dashboard', true],
    ['cases', 'fa-folder-open', 'Cases', true],
    ['newscan', 'fa-camera', 'New Scan', true],
    ['repository', 'fa-boxes-stacked', 'Product Repository', true],
    ['reports', 'fa-file-shield', 'Reports', true],
    ['reviews', 'fa-user-check', 'Review Queue', ['officer','controller','director','admin'].includes(role)],
    ['rulepacks', 'fa-scale-balanced', 'Rule Packs', true],
    ['audit', 'fa-clock-rotate-left', 'Audit Log', ['controller','director','admin'].includes(role)]
  ];
  return `
  <div class="min-h-screen flex flex-col">
    <header id="top-header" class="bg-gov-900 text-white shadow-lg no-print">
      <div class="h-1 flex"><div class="flex-1 bg-saffron"></div><div class="flex-1 bg-white"></div><div class="flex-1 bg-indiagreen"></div></div>
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <i class="fas fa-scale-balanced text-2xl text-saffron"></i>
          <div>
            <h1 class="font-bold text-lg leading-tight">Legal Metrology Compliance Checker</h1>
            <p class="text-xs text-slate-300">Packaged Commodities Rules, 2011 · Dept. of Consumer Affairs</p>
          </div>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <div class="text-right hidden sm:block">
            <div class="font-semibold">${esc(USER.full_name)}</div>
            <div class="text-xs text-slate-300 uppercase">${esc(USER.role)} · ${esc(USER.region_id)}</div>
          </div>
          <button onclick="logout()" class="px-3 py-1.5 bg-gov-700 hover:bg-gov-600 rounded-lg text-xs font-semibold"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
        </div>
      </div>
      <nav class="bg-gov-800">
        <div class="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          ${navItems.filter(n => n[3]).map(([id, icon, label]) =>
            `<a href="#/${id}" data-nav="${id}" class="px-3 py-2 text-sm font-medium text-slate-300 hover:text-white whitespace-nowrap rounded-t-md"><i class="fas ${icon} mr-1.5"></i>${label}</a>`
          ).join('')}
        </div>
      </nav>
    </header>
    <main id="main-content" class="flex-1 max-w-7xl w-full mx-auto px-4 py-6"></main>
    <footer class="text-center text-xs text-slate-400 py-4 no-print">Decision-support system — every non-compliance verdict is a recommendation for review by an authorised Legal Metrology Officer; it does not constitute a legal determination.</footer>
  </div>`;
}

/* ───────────────────────── Login ───────────────────────── */

function renderLogin(app) {
  app.innerHTML = `
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-gov-900 via-gov-800 to-slate-900 p-4">
    <section id="login-card" class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
      <div class="h-1.5 flex"><div class="flex-1 bg-saffron"></div><div class="flex-1 bg-slate-100"></div><div class="flex-1 bg-indiagreen"></div></div>
      <div class="p-8">
        <div class="text-center mb-6">
          <i class="fas fa-scale-balanced text-4xl text-gov-700 mb-3"></i>
          <h1 class="text-xl font-bold text-slate-800">Legal Metrology Compliance Checker</h1>
          <p class="text-sm text-slate-500 mt-1">Packaged Commodities Rules, 2011</p>
        </div>
        <form id="login-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input id="login-username" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-gov-600 focus:outline-none" placeholder="officer" autocomplete="username">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input id="login-password" type="password" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-gov-600 focus:outline-none" placeholder="••••••••" autocomplete="current-password">
          </div>
          <button class="w-full bg-gov-700 hover:bg-gov-600 text-white font-semibold py-2.5 rounded-lg"><i class="fas fa-right-to-bracket mr-2"></i>Sign in</button>
          <p id="login-error" class="text-sm text-red-600 hidden"></p>
        </form>
        <div class="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
          <p class="font-semibold mb-1"><i class="fas fa-circle-info mr-1"></i>Demo accounts (username / password)</p>
          <ul class="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <li><b>officer</b> / officer123</li>
            <li><b>controller</b> / controller123</li>
            <li><b>admin</b> / admin123</li>
            <li><b>consumer</b> / consumer123</li>
          </ul>
        </div>
      </div>
    </section>
  </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    try {
      const { data } = await http.post('/auth/login', {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value
      });
      TOKEN = data.token; USER = data.user;
      localStorage.setItem('lmpc_token', TOKEN);
      localStorage.setItem('lmpc_user', JSON.stringify(USER));
      navigate('#/dashboard'); render();
    } catch (err) {
      errEl.textContent = errMsg(err); errEl.classList.remove('hidden');
    }
  });
}

function logout() {
  if (TOKEN) http.post('/auth/logout').catch(() => {});
  TOKEN = null; USER = null;
  localStorage.removeItem('lmpc_token'); localStorage.removeItem('lmpc_user');
  render();
}
window.logout = logout;

/* ───────────────────────── Dashboard ───────────────────────── */

async function pageDashboard(main) {
  const { data } = await http.get('/dashboard/stats');
  const evalMap = {};
  (data.evaluations_by_status || []).forEach(r => evalMap[r.overall_status] = r.n);
  const caseTotal = (data.cases_by_status || []).reduce((a, r) => a + r.n, 0);
  main.innerHTML = `
  <section id="dashboard-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-4"><i class="fas fa-gauge-high text-gov-700 mr-2"></i>Enforcement Dashboard</h2>
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" id="stat-cards">
      ${statCard('fa-folder-open', 'Cases', caseTotal, 'text-gov-700')}
      ${statCard('fa-camera', 'Scans', data.total_scans, 'text-indigo-600')}
      ${statCard('fa-triangle-exclamation', 'Non-compliant', evalMap.non_compliant || 0, 'text-red-600')}
      ${statCard('fa-user-check', 'Pending reviews', data.pending_reviews, 'text-amber-600')}
      ${statCard('fa-file-shield', 'Reports issued', data.total_reports, 'text-green-700')}
    </div>
    <div class="grid md:grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-xl shadow p-4">
        <h3 class="font-semibold text-slate-700 mb-2">Evaluation outcomes</h3>
        <div class="h-56"><canvas id="chart-outcomes"></canvas></div>
      </div>
      <div class="bg-white rounded-xl shadow p-4">
        <h3 class="font-semibold text-slate-700 mb-2">Most-violated clauses (Rules, 2011)</h3>
        <div class="h-56"><canvas id="chart-clauses"></canvas></div>
      </div>
    </div>
    <div class="bg-white rounded-xl shadow p-4">
      <h3 class="font-semibold text-slate-700 mb-3">Activity by region</h3>
      <table class="w-full text-sm">
        <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">Region</th><th>Scans</th><th>Violations</th></tr></thead>
        <tbody>${(data.by_region || []).map(r => `<tr class="border-b border-slate-100"><td class="py-2 font-medium">${esc(r.region_id)}</td><td>${r.scans}</td><td class="${r.violations > 0 ? 'text-red-600 font-semibold' : ''}">${r.violations || 0}</td></tr>`).join('') || '<tr><td colspan="3" class="py-4 text-slate-400 text-center">No scans yet — create a case and upload a package photo.</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;

  const oc = document.getElementById('chart-outcomes');
  chartRefs.push(new Chart(oc, {
    type: 'doughnut',
    data: {
      labels: ['Compliant', 'Non-compliant', 'Needs review', 'Exempt'],
      datasets: [{ data: [evalMap.compliant || 0, evalMap.non_compliant || 0, evalMap.needs_review || 0, evalMap.exempt || 0],
        backgroundColor: ['#16a34a', '#dc2626', '#f59e0b', '#3b82f6'] }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  }));
  const cc = document.getElementById('chart-clauses');
  const tv = data.top_violations || [];
  chartRefs.push(new Chart(cc, {
    type: 'bar',
    data: { labels: tv.map(v => 'Rule ' + v.clause), datasets: [{ label: 'Violations', data: tv.map(v => v.count), backgroundColor: '#1d4ed8' }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
  }));
}
function statCard(icon, label, value, color) {
  return `<div class="bg-white rounded-xl shadow p-4">
    <div class="flex items-center gap-3"><i class="fas ${icon} text-xl ${color}"></i>
    <div><div class="text-2xl font-bold text-slate-800">${value ?? 0}</div><div class="text-xs text-slate-500">${label}</div></div></div></div>`;
}

/* ───────────────────────── Cases ───────────────────────── */

async function pageCases(main) {
  const { data } = await http.get('/cases');
  main.innerHTML = `
  <section id="cases-page">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold text-slate-800"><i class="fas fa-folder-open text-gov-700 mr-2"></i>Cases</h2>
      <button onclick="showNewCaseForm()" class="bg-gov-700 hover:bg-gov-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-plus mr-1"></i>New Case</button>
    </div>
    <div id="new-case-form" class="hidden bg-white rounded-xl shadow p-5 mb-4">
      <h3 class="font-semibold text-slate-700 mb-3">Create case</h3>
      <div class="grid md:grid-cols-2 gap-3">
        <input id="case-title" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Title (e.g. Market inspection — Crawford Market)">
        <select id="case-type" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="inspection">Inspection</option>
          <option value="consumer_complaint">Consumer complaint</option>
          <option value="self_check">E-commerce / self-check</option>
        </select>
        <input id="case-location" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Location (city / market)">
        <input id="case-premises" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Premises (shop / warehouse name)">
      </div>
      <div class="mt-3 flex gap-2">
        <button onclick="createCase()" class="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">Create</button>
        <button onclick="document.getElementById('new-case-form').classList.add('hidden')" class="bg-slate-200 px-4 py-2 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500"><tr>
          <th class="px-4 py-3">Case</th><th>Type</th><th>Region</th><th>Scans</th><th>Violations</th><th>Status</th><th>Created</th>
        </tr></thead>
        <tbody>
        ${(data.cases || []).map(cs => `
          <tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="navigate('#/cases/${cs.case_id}')">
            <td class="px-4 py-3 font-medium text-gov-700">${esc(cs.title || cs.case_id.slice(0, 18))}</td>
            <td>${esc((cs.case_type || '').replace(/_/g, ' '))}</td>
            <td>${esc(cs.region_id)}</td>
            <td>${cs.scan_count}</td>
            <td class="${cs.violation_count > 0 ? 'text-red-600 font-semibold' : ''}">${cs.violation_count}</td>
            <td>${badge(cs.status)}</td>
            <td class="text-slate-500">${fmtDate(cs.created_at)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">No cases yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </section>`;
}
window.showNewCaseForm = () => document.getElementById('new-case-form').classList.remove('hidden');
window.createCase = async () => {
  try {
    const { data } = await http.post('/cases', {
      title: document.getElementById('case-title').value,
      case_type: document.getElementById('case-type').value,
      location: document.getElementById('case-location').value,
      premises: document.getElementById('case-premises').value
    });
    toast('Case created', 'success');
    navigate(`#/cases/${data.case_id}`);
  } catch (e) { toast(errMsg(e), 'error'); }
};
window.navigate = navigate;

async function pageCaseDetail(main, caseId) {
  const { data } = await http.get(`/cases/${caseId}`);
  const cs = data.case;
  const canEdit = ['officer','controller','director','admin'].includes(USER.role);
  main.innerHTML = `
  <section id="case-detail-page">
    <a href="#/cases" class="text-sm text-gov-700 hover:underline"><i class="fas fa-arrow-left mr-1"></i>All cases</a>
    <div class="bg-white rounded-xl shadow p-5 mt-2 mb-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-slate-800">${esc(cs.title || 'Case')} </h2>
          <p class="text-xs text-slate-500 mt-1 font-mono">${esc(cs.case_id)}</p>
          <p class="text-sm text-slate-600 mt-2">
            <i class="fas fa-tag mr-1"></i>${esc((cs.case_type || '').replace(/_/g,' '))} &nbsp;·&nbsp;
            <i class="fas fa-location-dot mr-1"></i>${esc(cs.location || '—')} ${cs.premises ? '· ' + esc(cs.premises) : ''} &nbsp;·&nbsp;
            <i class="fas fa-map mr-1"></i>${esc(cs.region_id)}
          </p>
        </div>
        <div class="flex items-center gap-2">
          ${badge(cs.status)}
          ${canEdit ? `<select id="case-status-sel" class="border border-slate-300 rounded-lg px-2 py-1 text-xs" onchange="updateCaseStatus('${cs.case_id}', this.value, ${cs.version})">
            <option value="">change status…</option>
            <option value="open">open</option><option value="under_review">under review</option>
            <option value="closed">closed</option><option value="disputed">disputed</option>
          </select>` : ''}
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-slate-700 text-lg">Scans (${data.scans.length})</h3>
      <a href="#/newscan/${cs.case_id}" class="bg-gov-700 hover:bg-gov-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-camera mr-1"></i>New Scan</a>
    </div>
    <div class="grid md:grid-cols-2 gap-3">
      ${data.scans.map(s => `
        <article class="bg-white rounded-xl shadow p-4 hover:shadow-md cursor-pointer" onclick="navigate('#/scan/${s.scan_id}')">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs text-slate-400">${esc(s.scan_id.slice(0, 22))}…</span>
            <div class="flex gap-1">${badge(s.status)}${s.overall_status ? badge(s.overall_status) : ''}</div>
          </div>
          <div class="mt-2 text-sm text-slate-600">
            <i class="fas fa-box mr-1"></i>${esc(s.package_type)} package
            ${s.declared_category ? '· ' + esc(s.declared_category) : ''}
            · ${JSON.parse(s.image_refs).length} image(s)
          </div>
          <div class="text-xs text-slate-400 mt-1">${fmtDate(s.captured_at)}</div>
        </article>`).join('') || '<p class="text-slate-400 col-span-2 text-center py-6">No scans yet — capture a package label to begin compliance checking.</p>'}
    </div>
  </section>`;
}
window.updateCaseStatus = async (caseId, status, version) => {
  if (!status) return;
  try { await http.patch(`/cases/${caseId}`, { status, version }); toast('Case updated', 'success'); render(); }
  catch (e) { toast(errMsg(e), 'error'); }
};

/* ───────────────────────── New scan ───────────────────────── */

async function pageNewScan(main, presetCaseId) {
  const { data } = await http.get('/cases');
  const openCases = (data.cases || []).filter(c => c.status !== 'closed');
  main.innerHTML = `
  <section id="new-scan-page" class="max-w-3xl mx-auto">
    <h2 class="text-2xl font-bold text-slate-800 mb-4"><i class="fas fa-camera text-gov-700 mr-2"></i>New Package Scan</h2>
    <div class="bg-white rounded-xl shadow p-6 space-y-4">
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">Case</label>
        <select id="scan-case" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${openCases.map(c => `<option value="${c.case_id}" ${c.case_id === presetCaseId ? 'selected' : ''}>${esc(c.title || c.case_id)} (${esc(c.region_id)})</option>`).join('')}
        </select>
        ${openCases.length === 0 ? '<p class="text-xs text-red-600 mt-1">No open case — create one under Cases first.</p>' : ''}
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">Package label photo(s) <span class="text-slate-400">(up to 4, max 8 MB each)</span></label>
        <div class="flex rounded-lg overflow-hidden border border-slate-300 mb-3" role="tablist">
          <button id="tab-camera" onclick="switchCaptureTab('camera')" class="flex-1 py-2.5 text-sm font-semibold bg-gov-700 text-white"><i class="fas fa-camera mr-1"></i>Camera</button>
          <button id="tab-upload" onclick="switchCaptureTab('upload')" class="flex-1 py-2.5 text-sm font-semibold bg-slate-100 text-slate-600"><i class="fas fa-upload mr-1"></i>Upload File</button>
        </div>

        <!-- Camera panel (GPay-style viewfinder) -->
        <div id="capture-camera-panel">
          <div id="camera-viewport" class="relative bg-black rounded-xl overflow-hidden" style="aspect-ratio:3/4;max-height:60vh">
            <video id="camera-video" autoplay playsinline muted class="absolute inset-0 w-full h-full object-cover"></video>
            <!-- Scan-frame overlay -->
            <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div class="relative" style="width:78%;height:62%">
                <div class="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
                <div class="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
                <div class="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
                <div class="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg"></div>
                <div id="camera-scanline" class="absolute left-2 right-2 h-0.5 bg-emerald-400/90 rounded-full shadow-[0_0_12px_rgba(52,211,153,0.9)]"></div>
              </div>
            </div>
            <p class="absolute top-3 inset-x-0 text-center text-white/90 text-xs font-medium drop-shadow pointer-events-none">Align the package label inside the frame</p>
            <!-- Camera state overlays -->
            <div id="camera-off" class="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-3 text-slate-300">
              <i class="fas fa-camera text-4xl"></i>
              <p class="text-sm px-6 text-center">Start the camera to capture the label live — like scanning a QR code</p>
              <button onclick="startCamera()" class="bg-white text-slate-900 font-semibold text-sm px-5 py-2.5 rounded-full"><i class="fas fa-video mr-2"></i>Start Camera</button>
              <p id="camera-error" class="hidden text-xs text-red-400 px-6 text-center"></p>
            </div>
            <!-- Shutter bar -->
            <div id="camera-controls" class="hidden absolute bottom-0 inset-x-0 pb-4 pt-8 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-center gap-8">
              <button onclick="stopCamera()" title="Close camera" class="w-11 h-11 rounded-full bg-white/20 text-white backdrop-blur flex items-center justify-center"><i class="fas fa-xmark"></i></button>
              <button id="shutter-btn" onclick="captureFrame()" title="Capture" class="w-16 h-16 rounded-full bg-white border-4 border-white/40 shadow-lg active:scale-90 transition-transform flex items-center justify-center">
                <span class="w-12 h-12 rounded-full bg-white border-2 border-slate-300 block"></span>
              </button>
              <button onclick="flipCamera()" title="Flip camera" class="w-11 h-11 rounded-full bg-white/20 text-white backdrop-blur flex items-center justify-center"><i class="fas fa-camera-rotate"></i></button>
            </div>
            <div id="camera-flash" class="hidden absolute inset-0 bg-white"></div>
          </div>
          <p class="text-xs text-slate-500 mt-2"><i class="fas fa-lightbulb text-amber-500 mr-1"></i>Tip: capture the principal display panel first, then the back panel (consumer care, mfg details).</p>
        </div>

        <!-- Upload panel -->
        <div id="capture-upload-panel" class="hidden">
          <input id="scan-images" type="file" accept="image/*" multiple class="w-full border border-dashed border-slate-400 rounded-lg px-3 py-6 text-sm bg-slate-50">
        </div>

        <!-- Shared shot tray -->
        <div id="scan-previews" class="flex gap-2 mt-3 flex-wrap"></div>
      </div>
      <div class="grid md:grid-cols-3 gap-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Package type</label>
          <select id="scan-package-type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="retail">Retail (Chapter II)</option>
            <option value="wholesale">Wholesale (Rule 24)</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Category <span class="text-slate-400">(optional)</span></label>
          <select id="scan-category" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— unspecified —</option>
            <option value="food">Food</option><option value="beverages">Beverages</option>
            <option value="cosmetics">Cosmetics</option><option value="pharma">Pharma</option>
            <option value="electronics">Electronics</option><option value="textile">Textile</option>
            <option value="household">Household</option>
            <option value="fast_food_restaurant">Fast food (restaurant) — exempt</option>
            <option value="scheduled_drug_formulation">Scheduled drug formulation — exempt</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Container</label>
          <select id="scan-container" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="printed">Printed label</option>
            <option value="blown_formed_moulded">Blown / formed / moulded</option>
          </select>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">PDP area (cm²) <span class="text-slate-400">for Rule 7 font check</span></label>
          <input id="scan-pdp-area" type="number" min="1" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 150">
        </div>
        <div class="flex items-end pb-2">
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input id="scan-scale-ref" type="checkbox" class="w-4 h-4">
            Scale reference (ruler card) in frame
          </label>
        </div>
      </div>
      <p class="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2"><i class="fas fa-circle-info mr-1"></i>Without a scale reference, Rule 7 font-height checks route to manual review — the system never auto-fails font size from an uncalibrated photo.</p>
      <button id="scan-submit" onclick="submitScan()" class="w-full bg-gov-700 hover:bg-gov-600 text-white font-semibold py-3 rounded-lg disabled:opacity-50" ${openCases.length === 0 ? 'disabled' : ''}>
        <i class="fas fa-magnifying-glass-chart mr-2"></i>Upload &amp; Run Compliance Check
      </button>
      <div id="scan-progress" class="hidden">
        <div class="flex items-center gap-3 text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <i class="fas fa-spinner fa-spin text-gov-700"></i><span id="scan-progress-text">Uploading evidence…</span>
        </div>
      </div>
    </div>
  </section>`;
  capturedShots = [];
  document.getElementById('scan-images').addEventListener('change', (e) => {
    for (const f of [...e.target.files]) {
      if (capturedShots.length >= 4) { toast('Maximum 4 photos', 'error'); break; }
      capturedShots.push(f);
    }
    e.target.value = '';
    renderShotTray();
  });
}

/* ── Camera capture (GPay-style) ── */
let capturedShots = [];      // File objects (from camera or upload)
let cameraStream = null;
let cameraFacing = 'environment';

function renderShotTray() {
  const box = document.getElementById('scan-previews');
  if (!box) return;
  box.innerHTML = capturedShots.map((f, i) => `
    <div class="relative">
      <img src="${URL.createObjectURL(f)}" class="h-20 w-20 object-cover rounded-lg border-2 border-emerald-400">
      <button onclick="removeShot(${i})" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center shadow"><i class="fas fa-xmark"></i></button>
      <span class="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[10px] px-1 rounded">${i + 1}</span>
    </div>`).join('');
  if (capturedShots.length) {
    box.insertAdjacentHTML('beforeend', `<span class="self-center text-xs text-slate-500">${capturedShots.length}/4 photo${capturedShots.length > 1 ? 's' : ''}</span>`);
  }
}
window.removeShot = (i) => { capturedShots.splice(i, 1); renderShotTray(); };

window.switchCaptureTab = (tab) => {
  const cam = document.getElementById('capture-camera-panel');
  const up = document.getElementById('capture-upload-panel');
  const tCam = document.getElementById('tab-camera');
  const tUp = document.getElementById('tab-upload');
  const active = 'flex-1 py-2.5 text-sm font-semibold bg-gov-700 text-white';
  const idle = 'flex-1 py-2.5 text-sm font-semibold bg-slate-100 text-slate-600';
  if (tab === 'camera') { cam.classList.remove('hidden'); up.classList.add('hidden'); tCam.className = active; tUp.className = idle; }
  else { up.classList.remove('hidden'); cam.classList.add('hidden'); tUp.className = active; tCam.className = idle; stopCamera(); }
};

window.startCamera = async () => {
  const errEl = document.getElementById('camera-error');
  errEl.classList.add('hidden');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    errEl.textContent = 'Camera not supported in this browser — use the Upload File tab instead.';
    errEl.classList.remove('hidden'); return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    document.getElementById('camera-video').srcObject = cameraStream;
    document.getElementById('camera-off').classList.add('hidden');
    document.getElementById('camera-controls').classList.remove('hidden');
  } catch (e) {
    errEl.textContent = e.name === 'NotAllowedError'
      ? 'Camera permission denied — allow camera access in browser settings, or use Upload File.'
      : 'Could not open camera (' + e.name + ') — use the Upload File tab instead.';
    errEl.classList.remove('hidden');
  }
};

window.stopCamera = () => {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  const off = document.getElementById('camera-off');
  const ctl = document.getElementById('camera-controls');
  if (off) off.classList.remove('hidden');
  if (ctl) ctl.classList.add('hidden');
};

window.flipCamera = async () => {
  cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
};

window.captureFrame = () => {
  if (capturedShots.length >= 4) { toast('Maximum 4 photos — remove one to retake', 'error'); return; }
  const video = document.getElementById('camera-video');
  if (!video || !video.videoWidth) { toast('Camera not ready yet', 'error'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // shutter flash feedback
  const flash = document.getElementById('camera-flash');
  flash.classList.remove('hidden');
  setTimeout(() => flash.classList.add('hidden'), 120);
  if (navigator.vibrate) navigator.vibrate(40);
  canvas.toBlob((blob) => {
    if (!blob) { toast('Capture failed — try again', 'error'); return; }
    capturedShots.push(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    renderShotTray();
    toast(`Photo ${capturedShots.length} captured`, 'success');
  }, 'image/jpeg', 0.92);
};

window.submitScan = async () => {
  const files = capturedShots;
  if (!files.length) { toast('Capture or upload at least one label photo', 'error'); return; }
  stopCamera();
  const caseId = document.getElementById('scan-case').value;
  const btn = document.getElementById('scan-submit');
  const prog = document.getElementById('scan-progress');
  const progText = document.getElementById('scan-progress-text');
  btn.disabled = true; prog.classList.remove('hidden');
  try {
    const fd = new FormData();
    fd.append('capture_id', crypto.randomUUID());
    fd.append('package_type', document.getElementById('scan-package-type').value);
    fd.append('declared_category', document.getElementById('scan-category').value);
    fd.append('container_type', document.getElementById('scan-container').value);
    fd.append('pdp_area_cm2', document.getElementById('scan-pdp-area').value);
    fd.append('scale_reference', document.getElementById('scan-scale-ref').checked ? 'true' : 'false');
    fd.append('device_class', files.some(f => f.name.startsWith('capture-')) ? 'web_camera' : 'web');
    [...files].slice(0, 4).forEach(f => fd.append('images', f));
    progText.textContent = 'Uploading evidence to secure storage…';
    const up = await http.post(`/cases/${caseId}/scans`, fd);
    progText.textContent = 'Running OCR/VLM extraction and rule evaluation (may take ~30–60 s)…';
    await http.post(`/scans/${up.data.scan_id}/process`, {}, { timeout: 180000 });
    toast('Compliance check complete', 'success');
    navigate(`#/scan/${up.data.scan_id}`);
  } catch (e) {
    toast(errMsg(e), 'error');
    btn.disabled = false; prog.classList.add('hidden');
  }
};

/* ───────────────────────── Scan detail (verdicts) ───────────────────────── */

async function pageScanDetail(main, scanId) {
  const { data } = await http.get(`/scans/${scanId}`);
  const { scan, extraction, evaluation } = data;
  const fields = extraction ? extraction.fields.filter(f => f.present) : [];
  main.innerHTML = `
  <section id="scan-detail-page">
    <a href="#/cases/${scan.case_id}" class="text-sm text-gov-700 hover:underline"><i class="fas fa-arrow-left mr-1"></i>Back to case</a>
    <div class="flex flex-wrap items-center justify-between gap-3 mt-2 mb-4">
      <div>
        <h2 class="text-xl font-bold text-slate-800">Scan Result ${evaluation ? badge(evaluation.overall_status) : badge(scan.status)}</h2>
        <p class="text-xs text-slate-500 font-mono mt-1">${esc(scan.scan_id)}</p>
      </div>
      <div class="flex gap-2">
        ${scan.status !== 'evaluated' ? `<button onclick="reprocessScan('${scan.scan_id}')" class="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-rotate mr-1"></i>Run / Retry Check</button>` : ''}
        ${evaluation ? `<button onclick="generateReport('${scan.scan_id}')" class="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-file-shield mr-1"></i>Generate Report</button>` : ''}
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-4">
      <div class="space-y-4">
        <div class="bg-white rounded-xl shadow p-4">
          <h3 class="font-semibold text-slate-700 mb-2"><i class="fas fa-image mr-1"></i>Evidence</h3>
          <div class="space-y-2">
            ${scan.image_refs.map((k, i) => `
              <img src="/api/v1/evidence/${encodeURIComponent(k).replace(/%2F/g, '/')}" data-evidence-key="${esc(k)}" class="w-full rounded-lg border border-slate-200 evidence-img" alt="evidence ${i + 1}">
              <p class="text-[10px] text-slate-400 font-mono break-all">SHA-256: ${esc((scan.image_hashes[i] || '').slice(0, 32))}…</p>`).join('')}
          </div>
          <div class="mt-3 text-xs text-slate-500 space-y-1">
            <p><i class="fas fa-box mr-1"></i>${esc(scan.package_type)} package ${scan.declared_category ? '· ' + esc(scan.declared_category) : ''}</p>
            <p><i class="fas fa-ruler mr-1"></i>PDP area: ${scan.pdp_area_cm2 || '—'} cm² · Scale ref: ${scan.scale_reference ? 'yes' : 'no'} · ${esc(scan.container_type)}</p>
            <p><i class="fas fa-clock mr-1"></i>${fmtDate(scan.captured_at)}</p>
          </div>
        </div>
        ${extraction ? `
        <div class="bg-white rounded-xl shadow p-4">
          <h3 class="font-semibold text-slate-700 mb-2"><i class="fas fa-text-slash mr-1"></i>Extracted declarations <span class="text-xs font-normal text-slate-400">(${esc(extraction.model_name)})</span></h3>
          <dl class="space-y-2 text-sm">
            ${fields.map(f => `
              <div class="border-b border-slate-100 pb-1.5">
                <dt class="text-xs font-semibold text-slate-500 uppercase">${esc(f.field.replace(/_/g, ' '))}
                  <span class="ml-1 font-normal normal-case ${f.confidence >= 0.75 ? 'text-green-600' : 'text-amber-600'}">${Math.round(f.confidence * 100)}%</span></dt>
                <dd class="text-slate-800">${esc(f.value)}</dd>
              </div>`).join('') || '<p class="text-slate-400">No fields extracted.</p>'}
          </dl>
          ${Object.entries(extraction.quality_flags || {}).filter(([, v]) => v).length ? `
            <div class="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
              <b>Quality flags:</b> ${Object.entries(extraction.quality_flags).filter(([, v]) => v).map(([k]) => esc(k)).join(', ')}
            </div>` : ''}
        </div>` : ''}
      </div>

      <div class="lg:col-span-2">
        ${evaluation ? renderVerdicts(evaluation) : `
          <div class="bg-white rounded-xl shadow p-8 text-center text-slate-400">
            <i class="fas fa-hourglass-half text-3xl mb-3"></i>
            <p>Not evaluated yet. ${scan.status === 'error' ? '<span class="text-red-500">Last run failed — retry.</span>' : ''}</p>
          </div>`}
      </div>
    </div>
  </section>`;
}

function renderVerdicts(evaluation) {
  const s = evaluation.summary || {};
  const applicable = evaluation.verdicts.filter(v => v.status !== 'not_applicable');
  const na = evaluation.verdicts.filter(v => v.status === 'not_applicable');
  return `
  <div class="bg-white rounded-xl shadow p-5">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h3 class="font-semibold text-slate-700 text-lg"><i class="fas fa-scale-balanced mr-1"></i>Rule-wise Verdicts</h3>
      <div class="flex gap-2 text-xs">
        <span class="px-2 py-1 bg-green-100 text-green-800 rounded-full font-semibold">${s.compliant || 0} compliant</span>
        <span class="px-2 py-1 bg-red-100 text-red-800 rounded-full font-semibold">${s.non_compliant || 0} violations</span>
        <span class="px-2 py-1 bg-amber-100 text-amber-800 rounded-full font-semibold">${s.needs_review || 0} for review</span>
      </div>
    </div>
    <div class="space-y-3">
      ${applicable.map(v => `
        <article class="border rounded-lg p-3 ${v.status === 'non_compliant' ? 'border-red-300 bg-red-50' : v.status === 'needs_review' ? 'border-amber-300 bg-amber-50' : v.status === 'exempt' ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="font-semibold text-sm text-slate-800">
              <span class="font-mono text-xs bg-slate-800 text-white px-1.5 py-0.5 rounded mr-1">Rule ${esc(v.clause)}</span>
              ${esc(v.title)}
            </div>
            <div class="flex gap-1 items-center">${v.status === 'non_compliant' ? severityBadge(v.severity) : ''}${badge(v.status)}</div>
          </div>
          <p class="text-xs text-slate-600 mt-1.5">${esc(v.message)}</p>
          ${(v.evidence || []).filter(e => e.value).length ? `
            <details class="mt-1.5"><summary class="text-[11px] text-slate-400 cursor-pointer">evidence fields</summary>
            <ul class="text-[11px] text-slate-500 mt-1 space-y-0.5">
              ${v.evidence.filter(e => e.value).map(e => `<li><b>${esc(e.field)}</b>: "${esc(e.value)}" (${Math.round(e.confidence * 100)}%)</li>`).join('')}
            </ul></details>` : ''}
        </article>`).join('')}
      ${na.length ? `<details class="text-xs text-slate-400"><summary class="cursor-pointer">${na.length} not-applicable rule(s)</summary>
        <ul class="mt-1 space-y-0.5">${na.map(v => `<li>Rule ${esc(v.clause)} — ${esc(v.title)}</li>`).join('')}</ul></details>` : ''}
    </div>
  </div>`;
}

window.reprocessScan = async (scanId) => {
  toast('Running compliance check…');
  try { await http.post(`/scans/${scanId}/process`, {}, { timeout: 180000 }); toast('Done', 'success'); render(); }
  catch (e) { toast(errMsg(e), 'error'); }
};
window.generateReport = async (scanId) => {
  try {
    const { data } = await http.post(`/scans/${scanId}/report`);
    navigate(`#/report/${data.report_id}`);
  } catch (e) { toast(errMsg(e), 'error'); }
};

/* ───────────────────────── Reports ───────────────────────── */

async function pageReports(main) {
  const { data } = await http.get('/reports');
  main.innerHTML = `
  <section id="reports-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-4"><i class="fas fa-file-shield text-gov-700 mr-2"></i>Compliance Reports</h2>
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500"><tr>
          <th class="px-4 py-3">Report No.</th><th>Case</th><th>Region</th><th>Outcome</th><th>Generated</th><th></th>
        </tr></thead>
        <tbody>
        ${(data.reports || []).map(r => `
          <tr class="border-t border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-3 font-mono text-xs font-semibold text-gov-700">${esc(r.report_no)}</td>
            <td>${esc(r.case_title || r.case_id.slice(0, 16))}</td>
            <td>${esc(r.region_id)}</td>
            <td>${badge(r.overall_status)}</td>
            <td class="text-slate-500">${fmtDate(r.generated_at)}</td>
            <td class="pr-4 text-right"><a href="#/report/${r.report_id}" class="text-gov-700 hover:underline font-semibold text-xs">View <i class="fas fa-chevron-right"></i></a></td>
          </tr>`).join('') || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No reports generated yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </section>`;
}

async function pageReportView(main, reportId) {
  const { data } = await http.get(`/reports/${reportId}/data`);
  const { report, case: cs, scan, evaluation, extraction, rule_pack, officer } = data;
  const s = evaluation.summary || {};
  const violations = evaluation.verdicts.filter(v => v.status === 'non_compliant');
  const reviews = evaluation.verdicts.filter(v => v.status === 'needs_review');
  const fields = (extraction?.fields || []).filter(f => f.present);
  main.innerHTML = `
  <section id="report-view-page">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4 no-print">
      <a href="#/reports" class="text-sm text-gov-700 hover:underline"><i class="fas fa-arrow-left mr-1"></i>All reports</a>
      <div class="flex gap-2">
        <button onclick="window.print()" class="bg-gov-700 hover:bg-gov-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-file-pdf mr-1"></i>Print / Save as PDF</button>
        <button onclick="exportReportDoc()" class="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-file-word mr-1"></i>Export DOC (editable)</button>
      </div>
    </div>

    <div id="report-document" class="bg-white shadow-lg rounded-xl p-8 max-w-4xl mx-auto print-area">
      <header class="border-b-4 border-gov-800 pb-4 mb-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Government of India — Legal Metrology (Decision-Support)</p>
            <h1 class="text-2xl font-bold text-slate-900 mt-1">Compliance Verification Report</h1>
            <p class="text-sm text-slate-600">Under the Legal Metrology (Packaged Commodities) Rules, 2011</p>
          </div>
          <div class="text-right text-sm">
            <p class="font-mono font-bold text-gov-800">${esc(report.report_no)}</p>
            <p class="text-slate-500">${fmtDate(report.generated_at)}</p>
            <p class="mt-1">${badge(evaluation.overall_status)}</p>
          </div>
        </div>
      </header>

      <div class="grid md:grid-cols-2 gap-4 text-sm mb-5">
        <div class="border border-slate-200 rounded-lg p-3">
          <h3 class="font-bold text-slate-700 text-xs uppercase mb-2">Case particulars</h3>
          <p><b>Case:</b> ${esc(cs?.title || cs?.case_id || '—')}</p>
          <p><b>Type:</b> ${esc((cs?.case_type || '').replace(/_/g, ' '))}</p>
          <p><b>Location:</b> ${esc(cs?.location || '—')} ${cs?.premises ? '· ' + esc(cs.premises) : ''}</p>
          <p><b>Region:</b> ${esc(cs?.region_id || '—')}</p>
          <p><b>Officer:</b> ${esc(officer?.full_name || '—')}</p>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <h3 class="font-bold text-slate-700 text-xs uppercase mb-2">Scan & provenance</h3>
          <p><b>Scan ID:</b> <span class="font-mono text-xs">${esc(scan.scan_id)}</span></p>
          <p><b>Captured:</b> ${fmtDate(scan.captured_at)}</p>
          <p><b>Package:</b> ${esc(scan.package_type)} ${scan.declared_category ? '(' + esc(scan.declared_category) + ')' : ''}</p>
          <p><b>Rule pack:</b> ${esc(rule_pack?.version || '—')}</p>
          <p><b>Extraction model:</b> ${esc(extraction?.model_name || '—')} ${esc(extraction?.model_version || '')}</p>
        </div>
      </div>

      <div class="mb-5">
        <h3 class="font-bold text-slate-800 mb-2">1. Summary of findings</h3>
        <table class="w-full text-sm border border-slate-300">
          <tr class="bg-slate-50">
            <td class="border border-slate-300 px-3 py-2 font-semibold">Rules evaluated</td><td class="border border-slate-300 px-3 py-2">${(s.total || 0) - (s.not_applicable || 0)} applicable (${s.not_applicable || 0} not applicable)</td>
          </tr>
          <tr><td class="border border-slate-300 px-3 py-2 font-semibold">Compliant</td><td class="border border-slate-300 px-3 py-2 text-green-700 font-semibold">${s.compliant || 0}</td></tr>
          <tr><td class="border border-slate-300 px-3 py-2 font-semibold">Non-compliant</td><td class="border border-slate-300 px-3 py-2 text-red-700 font-semibold">${s.non_compliant || 0} (${s.major_violations || 0} major, ${s.minor_violations || 0} minor)</td></tr>
          <tr><td class="border border-slate-300 px-3 py-2 font-semibold">Requires manual verification</td><td class="border border-slate-300 px-3 py-2 text-amber-700 font-semibold">${s.needs_review || 0}</td></tr>
        </table>
      </div>

      ${violations.length ? `
      <div class="mb-5">
        <h3 class="font-bold text-slate-800 mb-2">2. Violations observed</h3>
        ${violations.map((v, i) => `
          <div class="border border-red-200 bg-red-50 rounded-lg p-3 mb-2 text-sm">
            <p class="font-semibold text-red-800">${i + 1}. Rule ${esc(v.clause)} — ${esc(v.title)} ${severityBadge(v.severity)}</p>
            <p class="text-slate-700 mt-1">${esc(v.message)}</p>
          </div>`).join('')}
      </div>` : '<div class="mb-5"><h3 class="font-bold text-slate-800 mb-2">2. Violations observed</h3><p class="text-sm text-green-700">No violations detected among auto-verifiable declarations.</p></div>'}

      ${reviews.length ? `
      <div class="mb-5">
        <h3 class="font-bold text-slate-800 mb-2">3. Items requiring officer verification</h3>
        ${reviews.map((v, i) => `
          <div class="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-2 text-sm">
            <p class="font-semibold text-amber-800">${i + 1}. Rule ${esc(v.clause)} — ${esc(v.title)}</p>
            <p class="text-slate-700 mt-1">${esc(v.message)}</p>
          </div>`).join('')}
      </div>` : ''}

      <div class="mb-5">
        <h3 class="font-bold text-slate-800 mb-2">${reviews.length ? '4' : '3'}. Declarations as extracted from label</h3>
        <table class="w-full text-sm border border-slate-300">
          <thead><tr class="bg-slate-50">
            <th class="border border-slate-300 px-3 py-2 text-left">Declaration</th>
            <th class="border border-slate-300 px-3 py-2 text-left">Value on label</th>
            <th class="border border-slate-300 px-3 py-2 text-left">OCR confidence</th>
          </tr></thead>
          <tbody>
            ${fields.map(f => `<tr>
              <td class="border border-slate-300 px-3 py-1.5 font-medium">${esc(f.field.replace(/_/g, ' '))}</td>
              <td class="border border-slate-300 px-3 py-1.5">${esc(f.value)}</td>
              <td class="border border-slate-300 px-3 py-1.5">${Math.round(f.confidence * 100)}%</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="mb-5">
        <h3 class="font-bold text-slate-800 mb-2">Evidence integrity</h3>
        <p class="text-xs text-slate-600 font-mono break-all">Image SHA-256: ${(scan.image_hashes || []).map(h => esc(h)).join('; ')}</p>
        <p class="text-xs text-slate-600 font-mono break-all mt-1">Report content hash: ${esc(report.content_hash)}</p>
      </div>

      <footer class="border-t border-slate-300 pt-3 text-[11px] text-slate-500">
        <p><b>Disclaimer:</b> This is a machine-assisted decision-support report generated against rule pack ${esc(rule_pack?.version || '')}. Every non-compliance finding is a recommendation requiring confirmation by an authorised Legal Metrology Officer under the Legal Metrology Act, 2009; it does not itself constitute a legal determination, seizure order or penalty. Physical net-quantity verification per Rule 19 is outside the scope of image-based checking.</p>
      </footer>
    </div>
  </section>`;
  window.__reportData = data;
}

window.exportReportDoc = () => {
  const el = document.getElementById('report-document');
  if (!el) return;
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Compliance Report</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;font-size:10pt}h1{font-size:16pt}h3{font-size:12pt}</style>
</head><body>${el.innerHTML}</body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const rn = (window.__reportData?.report?.report_no || 'report').replace(/[\/\\]/g, '-');
  a.download = `${rn}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ───────────────────────── Repository ───────────────────────── */

async function pageRepository(main) {
  main.innerHTML = `
  <section id="repository-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-4"><i class="fas fa-boxes-stacked text-gov-700 mr-2"></i>Product Repository</h2>
    <div class="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-3">
      <input id="repo-q" class="flex-1 min-w-52 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Search brand or product name…">
      <select id="repo-status" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <option value="">Any status</option>
        <option value="compliant">Compliant</option>
        <option value="non_compliant">Non-compliant</option>
        <option value="needs_review">Needs review</option>
      </select>
      <button onclick="searchRepo()" class="bg-gov-700 hover:bg-gov-600 text-white px-5 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-magnifying-glass mr-1"></i>Search</button>
    </div>
    <div id="repo-results"></div>
  </section>`;
  document.getElementById('repo-q').addEventListener('keydown', e => { if (e.key === 'Enter') searchRepo(); });
  await searchRepo();
}
window.searchRepo = async () => {
  const q = document.getElementById('repo-q').value;
  const status = document.getElementById('repo-status').value;
  const { data } = await http.get('/repository/search', { params: { q, status } });
  document.getElementById('repo-results').innerHTML = `
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500"><tr>
          <th class="px-4 py-3">Product</th><th>Brand</th><th>Category</th><th>Scans</th><th>Latest status</th><th>Last scanned</th>
        </tr></thead>
        <tbody>
        ${(data.products || []).map(p => `
          <tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="navigate('#/product/${p.product_id}')">
            <td class="px-4 py-3 font-medium text-gov-700">${esc(p.name)}</td>
            <td>${esc(p.brand || '—')}</td>
            <td>${esc(p.category || '—')}</td>
            <td>${p.scan_count}</td>
            <td>${p.latest_status ? badge(p.latest_status) : '—'}</td>
            <td class="text-slate-500">${fmtDate(p.last_scanned)}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No products in repository yet — products are auto-registered when scans are processed.</td></tr>'}
        </tbody>
      </table>
    </div>`;
};

async function pageProduct(main, productId) {
  const { data } = await http.get(`/repository/products/${productId}`);
  const p = data.product;
  main.innerHTML = `
  <section id="product-page">
    <a href="#/repository" class="text-sm text-gov-700 hover:underline"><i class="fas fa-arrow-left mr-1"></i>Repository</a>
    <div class="bg-white rounded-xl shadow p-5 mt-2 mb-4">
      <h2 class="text-xl font-bold text-slate-800">${esc(p.name)}</h2>
      <p class="text-sm text-slate-500">${esc(p.brand || 'Unknown brand')} ${p.category ? '· ' + esc(p.category) : ''}</p>
    </div>
    <h3 class="font-semibold text-slate-700 mb-2">Compliance history (${data.history.length} scan${data.history.length === 1 ? '' : 's'})</h3>
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Scanned</th><th>Region</th><th>Outcome</th><th></th></tr></thead>
        <tbody>${data.history.map(h => `
          <tr class="border-t border-slate-100">
            <td class="px-4 py-3">${fmtDate(h.captured_at)}</td>
            <td>${esc(h.region_id)}</td>
            <td>${h.overall_status ? badge(h.overall_status) : '—'}</td>
            <td class="pr-4 text-right"><a href="#/scan/${h.scan_id}" class="text-gov-700 hover:underline text-xs font-semibold">View scan</a></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

/* ───────────────────────── Review queue ───────────────────────── */

async function pageReviews(main) {
  const { data } = await http.get('/reviews');
  main.innerHTML = `
  <section id="reviews-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-1"><i class="fas fa-user-check text-gov-700 mr-2"></i>Officer Review Queue</h2>
    <p class="text-sm text-slate-500 mb-4">Low-confidence or indeterminate findings route here instead of auto-issuing violations (human-in-the-loop safeguard).</p>
    <div class="space-y-3">
      ${(data.reviews || []).map(r => `
        <article class="bg-white rounded-xl shadow p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-sm text-slate-800">Scan <a href="#/scan/${r.scan_id}" class="text-gov-700 font-mono text-xs hover:underline">${esc(r.scan_id.slice(0, 24))}…</a></p>
            <p class="text-xs text-slate-500 mt-1">${esc(r.package_type)} package · ${esc(r.region_id)} · overall ${badge(r.overall_status)} · queued ${fmtDate(r.created_at)}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="resolveReview('${r.review_id}', 'verified_compliant')" class="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Verified compliant</button>
            <button onclick="resolveReview('${r.review_id}', 'violation_confirmed')" class="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Violation confirmed</button>
            <button onclick="resolveReview('${r.review_id}', 'recapture_requested')" class="bg-slate-500 hover:bg-slate-400 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Request recapture</button>
          </div>
        </article>`).join('') || '<div class="bg-white rounded-xl shadow p-8 text-center text-slate-400"><i class="fas fa-mug-hot text-3xl mb-3"></i><p>Review queue is empty.</p></div>'}
    </div>
  </section>`;
}
window.resolveReview = async (id, resolution) => {
  try { await http.post(`/reviews/${id}/resolve`, { resolution }); toast('Review resolved', 'success'); render(); }
  catch (e) { toast(errMsg(e), 'error'); }
};

/* ───────────────────────── Rule packs ───────────────────────── */

async function pageRulePacks(main) {
  const { data } = await http.get('/rulepacks');
  main.innerHTML = `
  <section id="rulepacks-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-1"><i class="fas fa-scale-balanced text-gov-700 mr-2"></i>Rule Packs</h2>
    <p class="text-sm text-slate-500 mb-4">Rules are versioned data, not code — the pack effective on the scan date is applied (bitemporal evaluation). Amendments publish as new packs without a software release.</p>
    <div class="space-y-3" id="rulepack-list">
      ${(data.rule_packs || []).map(rp => `
        <article class="bg-white rounded-xl shadow p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 cursor-pointer" onclick="toggleRulePack('${rp.rule_pack_id}')">
            <div>
              <p class="font-semibold text-slate-800">${esc(rp.version)}</p>
              <p class="text-xs text-slate-500">${esc(rp.title)}</p>
            </div>
            <div class="text-xs text-slate-500 text-right">
              <p>Effective: <b>${esc(rp.effective_from)}</b> → ${esc(rp.effective_to || 'current')}</p>
              <p>Published ${fmtDate(rp.published_at)}</p>
            </div>
          </div>
          <div id="rp-body-${rp.rule_pack_id}" class="hidden mt-3"></div>
        </article>`).join('')}
    </div>
  </section>`;
}
window.toggleRulePack = async (id) => {
  const body = document.getElementById(`rp-body-${id}`);
  if (!body.classList.contains('hidden')) { body.classList.add('hidden'); return; }
  if (!body.dataset.loaded) {
    const { data } = await http.get(`/rulepacks/${id}`);
    body.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-xs border border-slate-200">
      <thead class="bg-slate-50"><tr>
        <th class="border border-slate-200 px-2 py-1.5 text-left">Clause</th>
        <th class="border border-slate-200 px-2 py-1.5 text-left">Requirement</th>
        <th class="border border-slate-200 px-2 py-1.5 text-left">Applies to</th>
        <th class="border border-slate-200 px-2 py-1.5 text-left">Checks</th>
        <th class="border border-slate-200 px-2 py-1.5 text-left">Severity</th>
      </tr></thead><tbody>
      ${data.rules.map(r => `<tr>
        <td class="border border-slate-200 px-2 py-1.5 font-mono font-semibold whitespace-nowrap">${esc(r.clause)}</td>
        <td class="border border-slate-200 px-2 py-1.5">${esc(r.title)}</td>
        <td class="border border-slate-200 px-2 py-1.5">${esc((r.applies_to?.package_type || []).join(', '))}</td>
        <td class="border border-slate-200 px-2 py-1.5 text-slate-500">${r.checks.map(c => esc(c.type)).join(', ')}${r.requires_scale_reference ? ' <span class="text-amber-600">(needs scale ref)</span>' : ''}</td>
        <td class="border border-slate-200 px-2 py-1.5">${severityBadge(r.on_fail?.severity || 'info')}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
    body.dataset.loaded = '1';
  }
  body.classList.remove('hidden');
};

/* ───────────────────────── Audit log ───────────────────────── */

async function pageAudit(main) {
  const { data } = await http.get('/audit');
  main.innerHTML = `
  <section id="audit-page">
    <h2 class="text-2xl font-bold text-slate-800 mb-4"><i class="fas fa-clock-rotate-left text-gov-700 mr-2"></i>Audit Log <span class="text-sm font-normal text-slate-400">(append-only)</span></h2>
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500"><tr>
          <th class="px-4 py-3">When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th>
        </tr></thead>
        <tbody>${(data.audit || []).map(a => `
          <tr class="border-t border-slate-100">
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">${fmtDate(a.created_at)}</td>
            <td>${esc(a.username || 'system')}</td>
            <td class="font-mono text-xs">${esc(a.action)}</td>
            <td class="font-mono text-xs text-slate-400">${esc(a.entity || '')} ${esc((a.entity_id || '').slice(0, 20))}</td>
            <td class="text-xs text-slate-500">${esc(a.detail || '')}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

/* ─────────────────── Evidence image auth loader ─────────────────── */
// <img> tags can't send the Bearer token; fetch evidence as blobs post-render.
new MutationObserver(() => {
  document.querySelectorAll('img.evidence-img:not([data-loaded])').forEach(async (img) => {
    img.dataset.loaded = '1';
    const key = img.dataset.evidenceKey;
    try {
      const resp = await http.get(`/evidence/${key}`, { responseType: 'blob' });
      img.src = URL.createObjectURL(resp.data);
    } catch { img.alt = 'evidence unavailable'; }
  });
}).observe(document.getElementById('app'), { childList: true, subtree: true });

/* ───────────────────────── Init ───────────────────────── */
render();
