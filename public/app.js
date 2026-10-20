/**
 * Frontier AI Workspace — Client Application
 * Personal vs. Global Dashboards, Host Authorization, Calendar & Peer Performance Voting
 */

const state = {
  currentUser: null,
  members: [],
  tasks: [],
  personalData: null,
  calendarEvents: [],
  taskFilter: 'all',
  currentVotingSessionId: 1,
  votingSession: null,
  unlinkedBallotToken: null,
  tickets: [],
  auditEvents: [],
  auditSearchTerm: '',
  tasklets: [],
  taskletTab: 'received',
  dockedCallActive: false,
  dockedCallMuted: false,
  dockedCallCamOff: false
};

export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  toastMsg.textContent = message;
  toastIcon.innerHTML = isError
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4500);
}

function getInitials(name) {
  if (!name) return '??';
  const parts = name.split(' ');
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// -------------------------------------------------------------
// INITIALIZATION & AUTH STATE
// -------------------------------------------------------------
async function init() {
  setupNavigation();
  setupModals();
  setupPersonaDropdown();
  setupGlobalSearch();
  setupAuthScreen();

  // Check URL query parameters for OAuth callbacks and alerts
  const params = new URLSearchParams(window.location.search);
  const authAlert = document.getElementById('auth-alert');
  const authAlertText = document.getElementById('auth-alert-text');

  if (params.get('error') === 'oauth_not_configured') {
    authAlert?.classList.remove('hidden');
    if (authAlertText) {
      authAlertText.innerHTML = `<strong>GitHub OAuth Credentials Not Configured:</strong><br>
      To enable real GitHub sign-in, register an OAuth App in <a href="https://github.com/settings/developers" target="_blank" style="color:var(--google-blue); text-decoration:underline;">GitHub Developer Settings</a> with callback URL <code>http://localhost:3030/api/auth/github/callback</code> and set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in your <code>.env</code> file.<br><br>
      <em>Tip: Click the "Simulate OAuth Callback" buttons below to test the verified flow instantly!</em>`;
    }
  } else if (params.get('error') === 'unauthorized_allowlist') {
    const ghUser = params.get('gh_user') || 'Unknown';
    const ghId = params.get('gh_id') || 'Unknown';
    authAlert?.classList.remove('hidden');
    if (authAlertText) {
      authAlertText.innerHTML = `<strong>403 Access Denied (Strict Allowlist Policy):</strong><br>
      GitHub account <strong>@${ghUser}</strong> (Numeric ID: <code>${ghId}</code>) successfully authenticated with GitHub, but was <strong>REJECTED</strong>. Only the 8 authorized Frontier AI team members can enter this platform.`;
    }
  } else if (params.get('auth') === 'oauth_success') {
    showToast('Authenticated via GitHub OAuth 2.0!');
  }

  if (params.has('error') || params.has('auth')) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  await loadMembers();
  await loadCurrentAuth();

  if (state.currentUser) {
    showWorkspace();
    await loadTasks();
    await loadPersonalDashboard();
    await loadCalendarEvents();
    await loadVotingSession();
    await loadTickets();
    await loadAuditTrail();
    await loadTasklets();
    renderGlobalHub();
  } else {
    showAuthScreen();
  }

  setupEventListeners();
}

function showAuthScreen() {
  document.getElementById('auth-screen')?.classList.remove('hidden');
  document.getElementById('workspace-app')?.classList.add('hidden');
}

function showWorkspace() {
  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('workspace-app')?.classList.remove('hidden');
  applyRolePermissions();
}

// -------------------------------------------------------------
// NAVIGATION (SIMPLIFIED 4-MODULE RAIL)
// -------------------------------------------------------------
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
    });
  });

  // Task Segmented Tabs ("Assigned to Me" vs "All Tasks")
  const tabMine = document.getElementById('tab-tasks-mine');
  const tabAll = document.getElementById('tab-tasks-all');
  const containerMine = document.getElementById('container-tasks-mine');
  const containerAll = document.getElementById('container-tasks-all');

  const filterPills = document.getElementById('task-filter-pills');

  tabMine?.addEventListener('click', () => {
    tabMine.classList.add('active');
    tabAll?.classList.remove('active');
    containerMine?.classList.remove('hidden');
    containerAll?.classList.add('hidden');
    filterPills?.classList.add('hidden');
    loadPersonalDashboard();
  });

  tabAll?.addEventListener('click', () => {
    tabAll.classList.add('active');
    tabMine?.classList.remove('active');
    containerAll?.classList.remove('hidden');
    containerMine?.classList.add('hidden');
    filterPills?.classList.remove('hidden');
    renderKanbanBoard();
  });

  // Tasklets Segmented Tabs ("Received" vs "Sent")
  document.querySelectorAll('#tasklets-tab-group button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tasklets-tab-group button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.taskletTab = btn.dataset.taskletTab;
      renderTasklets();
    });
  });

  // Peer Review Template Tabs (Template 1 vs Template 2)
  document.querySelectorAll('#voting-template-tabs button').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#voting-template-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentVotingSessionId = parseInt(btn.dataset.templateId, 10);
      state.unlinkedBallotToken = sessionStorage.getItem('ballot_token_' + state.currentVotingSessionId) || null;
      await loadVotingSession();
    });
  });



  // Settings & Logs Subtabs
  document.querySelectorAll('#settings-subtabs .segmented-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      const isHost = state.currentUser && !!state.currentUser.is_host;
      if (!isHost && (subtab === 'permissions' || subtab === 'history' || subtab === 'snapshot')) {
        showToast('Team Lead Only: This administrative section is managed by the Team Lead.', true);
        return;
      }

      document.querySelectorAll('#settings-subtabs .segmented-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.settings-subpanel').forEach(p => p.classList.add('hidden'));
      const targetPanel = document.getElementById(`panel-settings-${subtab}`);
      targetPanel?.classList.remove('hidden');

      if (subtab === 'directory') renderTeamRoster();
      else if (subtab === 'permissions') loadTickets();
      else if (subtab === 'history') loadAuditTrail();
    });
  });

  // Call Room Quick Card Jump
  document.getElementById('card-call-room-quick')?.addEventListener('click', () => switchView('view-callroom'));

  // Deep links & jump buttons
  document.getElementById('btn-jump-to-calendar')?.addEventListener('click', () => switchView('view-callroom'));
  document.getElementById('btn-global-view-cal')?.addEventListener('click', () => switchView('view-callroom'));
  document.getElementById('btn-global-open-voting')?.addEventListener('click', () => switchView('view-voting'));
  document.getElementById('card-global-vote')?.addEventListener('click', () => switchView('view-voting'));
  document.getElementById('btn-jump-to-roster')?.addEventListener('click', () => {
    if (state.currentUser?.is_host) {
      switchView('view-settings');
    } else {
      switchView('view-peers');
    }
  });

  // Sidebar toggle button
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar?.classList.toggle('collapsed');
  });
}

function switchView(viewId) {
  // Graceful redirects from legacy view names
  if (viewId === 'view-personal') {
    viewId = 'view-tasks';
    document.getElementById('tab-tasks-mine')?.click();
  } else if (viewId === 'view-global') {
    viewId = 'view-tasks';
    document.getElementById('tab-tasks-all')?.click();
  } else if (viewId === 'view-calendar') {
    viewId = 'view-callroom';
  } else if (viewId === 'view-team') {
    viewId = state.currentUser?.is_host ? 'view-settings' : 'view-peers';
    document.querySelector('#settings-subtabs [data-subtab="directory"]')?.click();
  } else if (viewId === 'view-governance') {
    viewId = 'view-settings';
    document.querySelector('#settings-subtabs [data-subtab="permissions"]')?.click();
  } else if (viewId === 'view-audit') {
    viewId = 'view-settings';
    document.querySelector('#settings-subtabs [data-subtab="history"]')?.click();
  } else if (viewId === 'view-recovery') {
    viewId = 'view-settings';
    document.querySelector('#settings-subtabs [data-subtab="snapshot"]')?.click();
  }

  // Non-lead trying to view settings -> redirect to peers
  if (viewId === 'view-settings' && state.currentUser && !state.currentUser.is_host) {
    viewId = 'view-peers';
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  document.querySelectorAll('.workspace-view').forEach(view => {
    view.classList.toggle('active', view.id === viewId);
  });

  if (viewId === 'view-tasks') {
    loadPersonalDashboard();
    renderKanbanBoard();
    updateTaskKPIs();
    updateRoomStatusWidget();
  } else if (viewId === 'view-callroom') {
    loadCalendarEvents();
  } else if (viewId === 'view-voting') {
    loadVotingSession();
  } else if (viewId === 'view-peers') {
    loadMembers().then(renderTeamRoster);
    loadTasklets();
  } else if (viewId === 'view-settings') {
    loadMembers().then(renderTeamRoster);
  }
}

// -------------------------------------------------------------
// ACTUAL LOGIN UI & ROLE SEGMENTATION LOGIC
// -------------------------------------------------------------
function setupAuthScreen() {
  // Login Form Submission
  const formLogin = document.getElementById('form-login');
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    if (!identifier) return showToast('Please enter your username or ID', true);
    await submitLogin(identifier);
  });

  // Demo One-Click Pills in Login Screen
  document.querySelectorAll('.btn-demo-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await submitLogin(id);
    });
  });

  // Sign Out Button in Account Menu
  document.getElementById('btn-header-signout')?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      state.currentUser = null;
      document.getElementById('persona-dropdown-menu')?.classList.add('hidden');
      showToast('You have been signed out.');
      showAuthScreen();
    } catch (err) {
      showToast('Error signing out', true);
    }
  });
}

async function submitLogin(identifier) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Login rejected: account not on team roster', true);
      return;
    }

    state.currentUser = data.user;
    updateHeaderUserChip();
    populatePersonaDropdown();
    showToast(`Signed in as ${state.currentUser.name} (${state.currentUser.is_host ? 'Team Lead' : 'Team Member'}).`);
    showWorkspace();

    // Load data
    await loadTasks();
    await loadPersonalDashboard();
    await loadCalendarEvents();
    await loadVotingSession();
    await loadTickets();
    await loadTasklets();
    updateTaskKPIs();
    updateRoomStatusWidget();

    // Default view: Tasks
    switchView('view-tasks');
    if (state.currentUser.is_host) {
      document.getElementById('tab-tasks-all')?.click();
    } else {
      document.getElementById('tab-tasks-mine')?.click();
    }
  } catch (err) {
    showToast('Failed to sign in', true);
  }
}

function applyRolePermissions() {
  if (!state.currentUser) return;
  const isHost = !!state.currentUser.is_host;

  // Header branding and host indicator
  const hostPill = document.getElementById('header-host-indicator');
  const roleIndicator = document.getElementById('sidebar-role-indicator');
  const roleDesc = document.getElementById('sidebar-role-desc');
  const productTag = document.querySelector('.workspace-product-tag');

  // Sidebar Item 4: Peers (Members) vs Settings & Logs (Lead)
  const navItem4 = document.getElementById('nav-item-peers-settings');
  const navLabel4 = document.getElementById('nav-label-peers-settings');
  const navIcon4 = document.getElementById('nav-icon-peers-settings');
  const badgeTasklets = document.getElementById('badge-tasklets-count');

  if (isHost) {
    if (productTag) productTag.textContent = 'Team Workspace';
    if (hostPill) {
      hostPill.textContent = 'LEAD';
      hostPill.style.display = 'inline-block';
      hostPill.style.backgroundColor = 'var(--google-blue-container)';
      hostPill.style.color = 'var(--google-blue-text)';
    }
    if (roleIndicator) roleIndicator.textContent = 'Role: Team Lead';
    if (roleDesc) roleDesc.textContent = 'Lead access: allot tasks, trigger sync calls, review sessions.';

    if (navItem4) navItem4.dataset.view = 'view-settings';
    if (navLabel4) navLabel4.textContent = 'Settings & Logs';
    if (navIcon4) {
      navIcon4.innerHTML = `<svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    }
    if (badgeTasklets) badgeTasklets.style.display = 'none';
  } else {
    if (productTag) productTag.textContent = 'Student Workspace';
    if (hostPill) {
      hostPill.textContent = 'MEMBER';
      hostPill.style.display = 'inline-block';
      hostPill.style.backgroundColor = 'var(--bg-surface-elevated)';
      hostPill.style.color = 'var(--text-secondary)';
    }
    if (roleIndicator) roleIndicator.textContent = 'Role: Member';
    if (roleDesc) roleDesc.textContent = 'Member access: my tasks, call room, peer review, and peers.';

    if (navItem4) navItem4.dataset.view = 'view-peers';
    if (navLabel4) navLabel4.textContent = 'Peers';
    if (navIcon4) {
      navIcon4.innerHTML = `<svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
    }
    updateTaskletBadges();
  }

  // Authorator-only action buttons in the UI
  const allotBtn = document.getElementById('btn-open-task-modal');
  const hostAllotTrigger = document.getElementById('btn-host-allot-trigger');
  const schedCalBtn = document.getElementById('btn-open-calendar-modal');
  const closeVoteBtn = document.getElementById('btn-host-close-voting');
  const reopenVoteBtn = document.getElementById('btn-host-reopen-voting');

  if (!isHost) {
    if (allotBtn) allotBtn.style.display = 'none';
    if (hostAllotTrigger) hostAllotTrigger.style.display = 'none';
    if (schedCalBtn) schedCalBtn.style.display = 'none';
    if (closeVoteBtn) closeVoteBtn.style.display = 'none';
    if (reopenVoteBtn) reopenVoteBtn.style.display = 'none';
  } else {
    if (allotBtn) allotBtn.style.display = 'inline-flex';
    if (hostAllotTrigger) hostAllotTrigger.style.display = 'inline-flex';
    if (schedCalBtn) schedCalBtn.style.display = 'inline-flex';
  }
}

async function loadCurrentAuth() {
  try {
    const res = await fetch('/api/auth/current');
    const data = await res.json();
    state.currentUser = data.user;
    updateHeaderUserChip();
  } catch (err) {
    console.error('Failed to load current auth:', err);
  }
}

async function loadMembers() {
  try {
    const res = await fetch('/api/members');
    const data = await res.json();
    state.members = data.members;
    populatePersonaDropdown();
    populateSelects();
    renderTeamRoster();
  } catch (err) {
    console.error('Failed to load members:', err);
  }
}

function updateHeaderUserChip() {
  if (!state.currentUser) return;
  document.getElementById('header-user-avatar').textContent = getInitials(state.currentUser.name);
  document.getElementById('header-user-name').textContent = state.currentUser.name;
  document.getElementById('header-user-role').textContent = `${state.currentUser.role} (${state.currentUser.team_track})`;
  applyRolePermissions();
}

function setupPersonaDropdown() {
  const trigger = document.getElementById('user-chip-menu-trigger');
  const menu = document.getElementById('persona-dropdown-menu');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !trigger.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });

  document.getElementById('btn-simulate-mallory')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await loginAs(9999);
  });
}

function populatePersonaDropdown() {
  const container = document.getElementById('persona-list-items');
  if (!container) return;
  container.innerHTML = '';

  // Filter to strictly the 2 core demonstration roles
  const demoMembers = state.members.filter(m => m.id === 1 || m.id === 2);

  demoMembers.forEach(member => {
    const row = document.createElement('div');
    const isActive = state.currentUser && state.currentUser.id === member.id;
    row.className = `persona-option ${isActive ? 'active' : ''}`;
    row.innerHTML = `
      <div class="user-avatar">${getInitials(member.name)}</div>
      <div class="persona-info-wrap">
        <div class="persona-opt-name">${member.name} ${member.is_host ? '<span class="host-pill-tag">ADMIN</span>' : '<span class="nav-badge">NON-ADMIN</span>'}</div>
        <div class="persona-opt-sub">${member.role} • @${member.handle}</div>
      </div>
      ${isActive ? '<span class="persona-check">✓</span>' : ''}
    `;

    row.addEventListener('click', async () => {
      document.getElementById('persona-dropdown-menu').classList.add('hidden');
      await loginAs(member.handle);
    });

    container.appendChild(row);
  });
}

async function loginAs(identifier) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Access Denied: Account not in allowlist', true);
      return;
    }

    state.currentUser = data.user;
    state.unlinkedBallotToken = null;
    updateHeaderUserChip();
    populatePersonaDropdown();
    applyRolePermissions();
    showToast(`Signed in as ${state.currentUser.name} (${state.currentUser.role})`);

    // Switch to role-appropriate view
    switchView('view-tasks');
    if (state.currentUser.is_host) {
      document.getElementById('tab-tasks-all')?.click();
    } else {
      document.getElementById('tab-tasks-mine')?.click();
    }

    await loadTasks();
    await loadPersonalDashboard();
    await loadVotingSession();
    await loadCalendarEvents();
    await loadTickets();
    await loadTasklets();
    updateTaskKPIs();
    updateRoomStatusWidget();
  } catch (err) {
    showToast('Failed to switch persona', true);
  }
}

// -------------------------------------------------------------
// VIEW 1: TASKS ("ASSIGNED TO ME" & CHECKLIST)
// -------------------------------------------------------------
async function loadPersonalDashboard() {
  try {
    const res = await fetch('/api/dashboard/personal');
    const data = await res.json();
    state.personalData = data;
    renderPersonalDashboard();
  } catch (err) {
    console.error('Failed to load personal dashboard:', err);
  }
}

function renderPersonalDashboard() {
  const p = state.personalData;
  if (!p) return;

  const elGreeting = document.getElementById('personal-greeting-name');
  if (elGreeting) elGreeting.textContent = p.user.name;
  const hostTag = document.getElementById('personal-host-tag');
  if (hostTag) hostTag.textContent = p.user.is_host ? 'Team Lead' : 'Team Member';

  // Completion stats
  const stats = p.stats || {};
  const elComp = document.getElementById('personal-completion-rate');
  if (elComp) elComp.textContent = `${stats.completionRate || 0}%`;
  const elFill = document.getElementById('personal-tasks-fill');
  if (elFill) elFill.style.width = `${stats.completionRate || 0}%`;
  const elSub = document.getElementById('personal-tasks-subtext');
  if (elSub) elSub.textContent = `${stats.completed || 0} Completed · ${stats.inProgress || 0} In Progress · ${stats.todo || 0} To Do`;
  const elBadge = document.getElementById('badge-my-tasks-count');
  if (elBadge) elBadge.textContent = stats.total || 0;
  const elPill = document.getElementById('personal-task-count-pill');
  if (elPill) elPill.textContent = stats.total || 0;

  // Calendar stats
  const elEvCount = document.getElementById('personal-events-count');
  if (elEvCount) elEvCount.textContent = `${p.events?.length || 0} Events`;
  const elNextEv = document.getElementById('personal-next-event-text');
  if (elNextEv) {
    if (p.events && p.events.length > 0) {
      elNextEv.textContent = `Next: ${p.events[0].title} (${p.events[0].time_label})`;
    } else {
      elNextEv.textContent = 'No upcoming sync calls';
    }
  }

  // Voting Status
  const voteStatusText = document.getElementById('personal-vote-status-text');
  const voteStatusTag = document.getElementById('personal-ballot-status-tag');
  if (voteStatusText && voteStatusTag) {
    if (p.hasVoted) {
      voteStatusText.textContent = 'Submitted';
      voteStatusTag.className = 'kpi-tag tag-green';
      voteStatusTag.textContent = 'Completed';
    } else {
      voteStatusText.textContent = 'Pending Review';
      voteStatusTag.className = 'kpi-tag tag-amber';
      voteStatusTag.textContent = 'Action Needed';
    }
  }

  // Render My Allocated Tasks
  const taskList = document.getElementById('personal-allocated-tasks-list');
  if (taskList) {
    taskList.innerHTML = '';
    if (!p.tasks || p.tasks.length === 0) {
      taskList.innerHTML = '<div class="card"><p class="card-desc">No tasks currently assigned to you. Enjoy the breathing room or pick a task from the board!</p></div>';
    } else {
      p.tasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'compact-task-row';
        const hasDeliverable = !!task.deliverable_url;

        row.innerHTML = `
          <div>
            <div class="compact-task-title">${task.title}</div>
            <div class="compact-task-assignee">Target Date: <strong>${task.deadline || 'Flexible'}</strong> · Status: <strong>${task.status}</strong></div>
            ${hasDeliverable ? `<div style="margin-top:4px;"><a href="${task.deliverable_url}" target="_blank" class="deliverable-link">PR: ${task.deliverable_url}</a></div>` : ''}
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="track-badge track-${task.track}">${task.status.replace('_', ' ')}</span>
          </div>
        `;
        taskList.appendChild(row);
      });
    }
  }

  // Render Live Meeting Banner if any active live session
  const liveBanner = document.getElementById('personal-live-meeting-banner');
  if (liveBanner) {
    if (p.liveMeeting) {
      liveBanner.style.display = 'flex';
      const elLiveTitle = document.getElementById('live-meeting-title');
      if (elLiveTitle) elLiveTitle.textContent = p.liveMeeting.title;
      const slotDesc = p.liveMeeting.slot_name ? `${p.liveMeeting.slot_name} (${p.liveMeeting.slot_code || 'SLOT'})` : 'Secure Bridge';
      const elLiveMeta = document.getElementById('live-meeting-meta');
      if (elLiveMeta) elLiveMeta.textContent = `Hosted by Team Lead · ${slotDesc} · Scheduled for ${p.liveMeeting.time_label || 'Now'}`;
      
      const liveBtn = document.getElementById('btn-join-live-meeting');
      if (liveBtn) {
        liveBtn.onclick = () => {
          window.open(p.liveMeeting.join_url, 'FrontierMeetingWindow', 'width=1200,height=800,menubar=no,toolbar=no');
        };
      }

      const actionsContainer = document.getElementById('live-banner-actions');
      if (actionsContainer && state.currentUser && state.currentUser.is_host) {
        if (!document.getElementById('btn-end-live-meeting')) {
          const endBtn = document.createElement('button');
          endBtn.id = 'btn-end-live-meeting';
          endBtn.className = 'btn btn-outlined btn-cal-end';
          endBtn.style.marginLeft = '8px';
          endBtn.textContent = 'End Call';
          endBtn.onclick = async () => {
            try {
              const res = await fetch(`/api/calendar/${p.liveMeeting.id}/end`, { method: 'POST' });
              if (res.ok) {
                showToast('Meeting session ended.');
                await loadPersonalDashboard();
                await loadCalendarEvents();
              }
            } catch (err) {
              showToast('Failed to end meeting session.', true);
            }
          };
          actionsContainer.appendChild(endBtn);
        }
      } else {
        const endBtn = document.getElementById('btn-end-live-meeting');
        if (endBtn) endBtn.remove();
      }
    } else {
      liveBanner.style.display = 'none';
    }
  }

  // Render My Upcoming Calendar Pings
  const pingsList = document.getElementById('personal-calendar-pings-list');
  if (pingsList) {
    pingsList.innerHTML = '';
    if (!p.events || p.events.length === 0) {
      pingsList.innerHTML = '<div class="card"><p class="card-desc">No upcoming calendar syncs or deadlines.</p></div>';
    } else {
      p.events.forEach(ev => {
        const row = document.createElement('div');
        row.className = 'ping-card-row';
        const isMeeting = ev.event_type === 'MEETING' || ev.event_type === 'RETRO';
        const slotLabel = ev.slot_name || 'Call Room';

        let audienceLabel = 'Everyone';
        if (ev.target_audience === 'BACKEND') audienceLabel = 'Backend';
        else if (ev.target_audience === 'FRONTEND') audienceLabel = 'Frontend';
        else if (ev.target_audience && ev.target_audience.startsWith('[')) audienceLabel = 'Selected';
        else if (ev.assignee_name) audienceLabel = ev.assignee_name;

        row.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
              <span class="ping-title">${ev.title}</span>
              ${ev.is_live ? '<span class="live-pulse-badge" style="font-size:9.5px; padding:2px 6px;">LIVE NOW</span>' : ''}
            </div>
            <div class="ping-meta">${ev.event_date} · ${ev.time_label} · <span style="color:var(--google-blue);">${slotLabel}</span> · <span style="color:var(--text-muted);">For: ${audienceLabel}</span></div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${ev.join_url ? `<button class="meet-link-btn" onclick="openDockedCallById(${ev.id})">Join Call</button>` : `<span class="cal-type-badge cal-tag-${ev.event_type}">${ev.event_type}</span>`}
            ${state.currentUser && state.currentUser.is_host && isMeeting ? `
              ${ev.is_live ? `<button class="btn-cal-action btn-cal-end" onclick="endMeetingSession(${ev.id})">End</button>` : `<button class="btn-cal-action btn-cal-ping" onclick="pingMeetingSession(${ev.id})">Ping Now</button>`}
            ` : ''}
          </div>
        `;
        pingsList.appendChild(row);
      });
    }
  }

  // Populate deliverable modal task select
  if (p.tasks) populateDeliverableModalSelect(p.tasks);
}

// -------------------------------------------------------------
// MODULE 1 HELPERS: TASK KPIS & CALL ROOM STATUS
// -------------------------------------------------------------
function updateTaskKPIs() {
  if (!state.tasks) return;
  const todo = state.tasks.filter(t => t.status === 'TODO').length;
  const inProgress = state.tasks.filter(t => t.status === 'IN_PROGRESS').length;
  const done = state.tasks.filter(t => t.status === 'COMPLETED').length;

  const elTodo = document.getElementById('kpi-open-tasks');
  const elProg = document.getElementById('kpi-in-progress');
  const elDone = document.getElementById('kpi-done');
  if (elTodo) elTodo.textContent = todo;
  if (elProg) elProg.textContent = inProgress;
  if (elDone) elDone.textContent = done;

  const elBadge = document.getElementById('badge-tasks-count');
  if (elBadge) elBadge.textContent = state.tasks.length;
}

function updateRoomStatusWidget() {
  const liveEv = state.calendarEvents?.find(e => e.is_live);
  const scheduledEv = state.calendarEvents?.find(e => (e.event_type === 'MEETING' || e.event_type === 'RETRO') && !e.is_live);
  const dot = document.getElementById('room-status-dot');
  const sidebarCallDot = document.getElementById('badge-call-status');
  const statusText = document.getElementById('room-status-text');
  const subtitleText = document.getElementById('room-subtitle-text');
  const btnJoin = document.getElementById('btn-room-join-main');
  const btnToggle = document.getElementById('btn-toggle-instant-call');
  const quickBadge = document.getElementById('quick-call-room-status-badge');
  const isHost = state.currentUser && !!state.currentUser.is_host;

  // Hero card elements
  const heroCard = document.getElementById('call-room-hero-card');
  const heroDot = document.getElementById('room-hero-dot');
  const heroBadge = document.getElementById('room-hero-badge');
  const heroTitle = document.getElementById('room-hero-title');
  const heroDesc = document.getElementById('room-hero-desc');

  // Sidebar badge dot update & Nav Item State Color (Green if live, Yellow/Amber if scheduled, Blue if idle)
  const callNavItem = document.querySelector('.nav-item[data-view="view-callroom"]');
  if (callNavItem) {
    callNavItem.classList.remove('status-live', 'status-scheduled', 'status-idle');
    if (liveEv) {
      callNavItem.classList.add('status-live');
    } else if (scheduledEv) {
      callNavItem.classList.add('status-scheduled');
    } else {
      callNavItem.classList.add('status-idle');
    }
  }

  if (sidebarCallDot) {
    if (liveEv) {
      sidebarCallDot.className = 'room-status-dot pulse-green';
    } else if (scheduledEv) {
      sidebarCallDot.className = 'room-status-dot dot-scheduled';
    } else {
      sidebarCallDot.className = 'room-status-dot idle-gray';
    }
  }

  if (liveEv) {
    if (dot) dot.className = 'room-status-dot pulse-green';
    if (statusText) statusText.textContent = `Live: ${liveEv.title}`;
    if (subtitleText) subtitleText.textContent = `Call in progress · ${liveEv.time_label || 'Now'} · 1 sync call active`;

    if (heroDot) heroDot.className = 'room-status-dot pulse-green';
    if (heroBadge) {
      heroBadge.textContent = 'LIVE CALL';
      heroBadge.style.color = 'var(--google-green)';
    }
    if (heroTitle) heroTitle.textContent = liveEv.title;
    if (heroDesc) heroDesc.textContent = `${liveEv.description || 'Google Meet bridge live.'} Real-time attendance verified via server gateway.`;
    if (heroCard) heroCard.style.borderLeft = '3px solid var(--google-green)';

    if (btnJoin) {
      btnJoin.style.display = 'inline-flex';
      btnJoin.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 21 5 3"></polygon></svg> Join Google Meet ↗`;
      btnJoin.onclick = () => joinMeetingGateway(liveEv);
    }

    if (btnToggle) {
      if (isHost) {
        btnToggle.textContent = 'End Active Call';
        btnToggle.className = 'btn btn-outlined btn-cal-end';
        btnToggle.style.display = 'inline-flex';
        btnToggle.onclick = async () => {
          try {
            const res = await fetch(`/api/calendar/${liveEv.id}/end`, { method: 'POST' });
            if (res.ok) {
              showToast('Sync call concluded.');
              await loadCalendarEvents();
              await loadPersonalDashboard();
            }
          } catch (err) {
            showToast('Failed to end call', true);
          }
        };
      } else {
        btnToggle.style.display = 'none';
      }
    }
    if (quickBadge) {
      quickBadge.innerHTML = `<span class="room-status-dot pulse-green" style="display:inline-block; margin-right:4px; vertical-align:middle; width:8px; height:8px;"></span> Live Sync`;
    }
  } else if (scheduledEv) {
    if (dot) dot.className = 'room-status-dot dot-scheduled';
    if (statusText) statusText.textContent = `Scheduled: ${scheduledEv.title}`;
    if (subtitleText) subtitleText.textContent = `${scheduledEv.time_label || scheduledEv.event_date} · Google Meet bridge ready`;

    if (heroDot) heroDot.className = 'room-status-dot dot-scheduled';
    if (heroBadge) {
      heroBadge.textContent = 'SCHEDULED';
      heroBadge.style.color = 'var(--google-yellow)';
    }
    if (heroTitle) heroTitle.textContent = `Upcoming: ${scheduledEv.title}`;
    if (heroDesc) heroDesc.textContent = `Scheduled for ${scheduledEv.time_label || scheduledEv.event_date}. Bridge slot reserved. Lead can start call early.`;
    if (heroCard) heroCard.style.borderLeft = '3px solid var(--google-yellow)';

    if (btnJoin) {
      btnJoin.style.display = 'inline-flex';
      btnJoin.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 21 5 3"></polygon></svg> Open Google Meet Bridge ↗`;
      btnJoin.onclick = () => joinMeetingGateway(scheduledEv);
    }

    if (btnToggle) {
      if (isHost) {
        btnToggle.textContent = 'Start Call Early';
        btnToggle.className = 'btn btn-filled btn-cal-ping';
        btnToggle.style.display = 'inline-flex';
        btnToggle.onclick = async () => {
          await pingMeetingSession(scheduledEv.id);
        };
      } else {
        btnToggle.style.display = 'none';
      }
    }
    if (quickBadge) {
      quickBadge.innerHTML = `<span class="room-status-dot dot-scheduled" style="display:inline-block; margin-right:4px; vertical-align:middle; width:8px; height:8px;"></span> Scheduled`;
    }
  } else {
    if (dot) dot.className = 'room-status-dot idle-gray';
    if (statusText) statusText.textContent = 'Room Available (No Active Call)';
    if (subtitleText) subtitleText.textContent = 'Google Meet bridge ready. 1 active call max.';

    if (heroDot) heroDot.className = 'room-status-dot idle-gray';
    if (heroBadge) {
      heroBadge.textContent = 'STANDBY';
      heroBadge.style.color = 'var(--text-muted)';
    }
    if (heroTitle) heroTitle.textContent = 'No call active right now';
    if (heroDesc) heroDesc.textContent = 'Rotating across 6 pre-configured Google Meet bridges. Project lead can start a live call anytime.';
    if (heroCard) heroCard.style.borderLeft = '3px solid var(--border-default)';

    if (btnJoin) {
      btnJoin.style.display = 'inline-flex';
      btnJoin.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 21 5 3"></polygon></svg> Enter Google Meet Bridge ↗`;
      btnJoin.onclick = () => joinMeetingGateway({ id: 1, title: 'Frontier Call Room' });
    }

    if (btnToggle) {
      if (isHost) {
        btnToggle.textContent = 'Start Team Call';
        btnToggle.className = 'btn btn-outlined btn-cal-ping';
        btnToggle.style.display = 'inline-flex';
        btnToggle.onclick = async () => {
          const nextEv = state.calendarEvents?.find(e => e.event_type === 'MEETING' || e.event_type === 'RETRO');
          if (nextEv) {
            await pingMeetingSession(nextEv.id);
          } else {
            showToast('No scheduled call found to start. Schedule one below.', true);
          }
        };
      } else {
        btnToggle.style.display = 'none';
      }
    }
    if (quickBadge) {
      quickBadge.innerHTML = `<span class="room-status-dot idle-gray" style="display:inline-block; margin-right:4px; vertical-align:middle; width:8px; height:8px;"></span> Available`;
    }
  }
}

// -------------------------------------------------------------
// VIEW 2: GLOBAL TEAM HUB (PUBLIC TEAM PROFILE)
// -------------------------------------------------------------
function renderGlobalHub() {
  if (!state.tasks || !state.tasks.length) return;

  const completed = state.tasks.filter(t => t.status === 'COMPLETED').length;
  const inProgress = state.tasks.filter(t => t.status === 'IN_PROGRESS').length;
  const todo = state.tasks.filter(t => t.status === 'TODO').length;
  const total = state.tasks.length;
  const pct = Math.round((completed / total) * 100);

  const elComp = document.getElementById('global-team-completion');
  if (elComp) elComp.textContent = `${pct}%`;
  const elFill = document.getElementById('global-team-fill');
  if (elFill) elFill.style.width = `${pct}%`;
  const elBrk = document.getElementById('global-team-breakdown');
  if (elBrk) elBrk.textContent = `${completed} Completed • ${inProgress} In Progress • ${todo} Backlog`;

  if (state.votingSession) {
    const ballots = state.votingSession.totalBallots || 0;
    const eligible = state.votingSession.totalEligible || 8;
    const votePct = Math.round((ballots / eligible) * 100);
    const elRatio = document.getElementById('global-vote-ratio');
    if (elRatio) elRatio.textContent = `${ballots} / ${eligible}`;
    const elVFill = document.getElementById('global-vote-fill');
    if (elVFill) elVFill.style.width = `${votePct}%`;
  }

  // Populate Global Team Overview Table
  const tbody = document.getElementById('global-team-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.members.forEach(m => {
    const memberTasks = state.tasks.filter(t => t.assignee_id === m.id);
    const mCompleted = memberTasks.filter(t => t.status === 'COMPLETED').length;
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="user-avatar" style="width:24px; height:24px; font-size:10px;">${getInitials(m.name)}</div>
          <strong>${m.name}</strong> ${m.is_host ? '<span class="host-pill-tag">HOST</span>' : ''}
        </div>
      </td>
      <td>${m.role}</td>
      <td><span class="track-badge track-${m.team_track}">${m.team_track.toUpperCase()}</span></td>
      <td>${memberTasks.length} Assigned (${mCompleted} Completed)</td>
      <td><span class="kpi-tag ${mCompleted === memberTasks.length && memberTasks.length > 0 ? 'tag-green' : 'tag-blue'}">Active</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// VIEW 3: KANBAN SPRINT BOARD (HOST ALLOTS, PARTICIPANTS ADVANCE)
// -------------------------------------------------------------
async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    state.tasks = data.tasks;
    const badgeTasks = document.getElementById('badge-tasks-count');
    if (badgeTasks) badgeTasks.textContent = state.tasks.length;
    renderKanbanBoard();
    updateTaskKPIs();
    renderGlobalHub();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

function renderKanbanBoard() {
  const colTodo = document.getElementById('cards-todo');
  const colProgress = document.getElementById('cards-in-progress');
  const colCompleted = document.getElementById('cards-completed');

  colTodo.innerHTML = '';
  colProgress.innerHTML = '';
  colCompleted.innerHTML = '';

  const filteredTasks = state.tasks.filter(t => {
    if (state.taskFilter === 'all') return true;
    return t.track === state.taskFilter;
  });

  let countTodo = 0, countProgress = 0, countCompleted = 0;

  filteredTasks.forEach(task => {
    const card = createKanbanCard(task);

    if (task.status === 'TODO') {
      colTodo.appendChild(card);
      countTodo++;
    } else if (task.status === 'IN_PROGRESS') {
      colProgress.appendChild(card);
      countProgress++;
    } else if (task.status === 'COMPLETED') {
      colCompleted.appendChild(card);
      countCompleted++;
    }
  });

  document.getElementById('count-todo').textContent = countTodo;
  document.getElementById('count-in-progress').textContent = countProgress;
  document.getElementById('count-completed').textContent = countCompleted;

  // Empty-state placeholders for empty columns
  const emptyTodoHtml = `<div class="empty-state"><svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1"></rect></svg><p>No tasks here</p></div>`;
  if (countTodo === 0) colTodo.innerHTML = emptyTodoHtml;
  if (countProgress === 0) colProgress.innerHTML = emptyTodoHtml;
  if (countCompleted === 0) colCompleted.innerHTML = emptyTodoHtml;
}


function createKanbanCard(task) {
  const card = document.createElement('div');
  card.className = 'kanban-card';

  const deliverableHtml = task.deliverable_url
    ? `<a href="${task.deliverable_url}" target="_blank" class="deliverable-link">
        PR / Deliverable
       </a>`
    : '';

  card.innerHTML = `
    <div class="card-top-bar">
      <span class="track-badge track-${task.track}">${task.track.toUpperCase()}</span>
      <span class="occ-version-pill" title="Target Deadline">Due: ${task.deadline || 'Flexible'}</span>
    </div>
    
    <div>
      <h4 class="kanban-card-title">${task.title}</h4>
      <p class="kanban-card-desc">${task.description || ''}</p>
    </div>

    ${deliverableHtml}

    <div class="card-footer">
      <div class="assignee-chip">
        <div class="assignee-avatar">${getInitials(task.assignee_name || 'UN')}</div>
        <span class="assignee-name">${task.assignee_name || 'Unassigned'}</span>
      </div>

      <div class="card-action-btns">
        ${task.status !== 'IN_PROGRESS' ? `<button class="btn btn-outlined btn-sm btn-advance-task" data-id="${task.id}" data-version="${task.version}" data-next="IN_PROGRESS" title="Mark In Progress">In Progress</button>` : ''}
        ${task.status !== 'COMPLETED' ? `<button class="btn btn-filled btn-sm btn-advance-task" data-id="${task.id}" data-version="${task.version}" data-next="COMPLETED" title="Mark Completed">Complete</button>` : ''}
        <button class="btn btn-icon btn-test-occ" data-id="${task.id}" data-version="${task.version}" title="Simulate Stale OCC Write Conflict">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </button>
      </div>
    </div>
  `;

  // Status transitions
  card.querySelectorAll('.btn-advance-task').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = parseInt(btn.dataset.id, 10);
      const version = parseInt(btn.dataset.version, 10);
      const nextStatus = btn.dataset.next;
      await updateTask(taskId, { status: nextStatus, version });
    });
  });

  // OCC Demonstration
  card.querySelector('.btn-test-occ').addEventListener('click', async () => {
    const taskId = parseInt(task.id, 10);
    const staleVersion = task.version - 1;
    await updateTaskWithOccCheck(taskId, { status: 'COMPLETED', version: staleVersion }, task);
  });

  return card;
}

async function updateTask(taskId, payload) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to update task', true);
      return;
    }

    showToast('Task updated successfully');
    await loadTasks();
    await loadPersonalDashboard();
  } catch (err) {
    showToast('Network error updating task', true);
  }
}

async function updateTaskWithOccCheck(taskId, payload, originalTask) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.status === 409) {
      document.getElementById('occ-server-version').textContent = `v${data.currentVersion || originalTask.version}`;
      document.getElementById('occ-server-status').textContent = originalTask.status;
      document.getElementById('occ-client-version').textContent = `v${payload.version} (Stale Attempt)`;
      document.getElementById('occ-client-status').textContent = payload.status;
      document.getElementById('modal-occ-conflict').showModal();
      return;
    }

    await loadTasks();
  } catch (err) {
    showToast('Network error during OCC test', true);
  }
}

// -------------------------------------------------------------
// VIEW 4: ANONYMOUS PEER PERFORMANCE VOTING
// -------------------------------------------------------------
async function loadVotingSession() {
  try {
    const sessionId = state.currentVotingSessionId || 1;
    const res = await fetch(`/api/voting/current?session_id=${sessionId}`);
    const data = await res.json();
    state.votingSession = data;

    // Restore unlinked ballot token from sessionStorage if present
    const savedToken = sessionStorage.getItem('ballot_token_' + sessionId);
    if (savedToken) {
      state.unlinkedBallotToken = savedToken;
    }

    renderVotingSession();
  } catch (err) {
    console.error('Failed to load voting session:', err);
  }
}

function renderVotingSession() {
  const s = state.votingSession;
  if (!s || !s.session) return;

  document.getElementById('voting-session-headline').textContent = s.session.title;
  document.getElementById('voting-session-summary').textContent = s.session.description;

  const ballots = s.totalBallots || 0;
  const eligible = s.totalEligible || 8;
  const pct = Math.round((ballots / eligible) * 100);

  document.getElementById('stats-ballots-count').textContent = ballots;
  document.getElementById('stats-ballots-bar').style.width = `${pct}%`;

  const memberName = state.currentUser ? state.currentUser.name : 'Unknown';
  document.getElementById('stepper-member-label').textContent = memberName;

  const step2 = document.getElementById('step-node-2');
  const step3 = document.getElementById('step-node-3');
  const step4 = document.getElementById('step-node-4');

  const claimBox = document.getElementById('voting-claim-box');
  const castBox = document.getElementById('voting-cast-box');
  const completedBox = document.getElementById('voting-completed-box');
  const tallyBox = document.getElementById('tally-results-container');
  const closeVoteBtn = document.getElementById('btn-host-close-voting');
  const reopenVoteBtn = document.getElementById('btn-host-reopen-voting');

  const isClosed = s.session.status === 'CLOSED';
  const isHost = state.currentUser && !!state.currentUser.is_host;

  if (isClosed || (s.isRevealed && s.tally)) {
    // Session is closed or threshold met: show results, hide active voting boxes
    step4.className = 'step-node completed';
    document.getElementById('step-line-3').className = 'stepper-line completed';
    tallyBox.classList.remove('hidden');
    renderTallyMeters(s.tally || [], ballots);

    claimBox.classList.add('hidden');
    castBox.classList.add('hidden');
    completedBox.classList.add('hidden');

    const statusPill = document.getElementById('voting-status-pill');
    if (statusPill) {
      statusPill.textContent = 'SESSION CLOSED';
      statusPill.className = 'status-pill pill-amber';
    }

    if (isHost) {
      if (closeVoteBtn) closeVoteBtn.classList.add('hidden');
      if (reopenVoteBtn) reopenVoteBtn.classList.remove('hidden');
    }
  } else {
    // Active session
    step4.className = 'step-node';
    tallyBox.classList.add('hidden');

    const statusPill = document.getElementById('voting-status-pill');
    if (statusPill) {
      statusPill.textContent = 'ACTIVE ROUND';
      statusPill.className = 'status-pill pill-green';
    }

    if (isHost) {
      if (closeVoteBtn) closeVoteBtn.classList.remove('hidden');
      if (reopenVoteBtn) reopenVoteBtn.classList.add('hidden');
    }

    if (s.userHasClaimedToken) {
      step2.className = 'step-node completed';
      document.getElementById('step-line-2').className = 'stepper-line completed';
      claimBox.classList.add('hidden');

      if (state.unlinkedBallotToken) {
        step3.className = 'step-node active';
        castBox.classList.remove('hidden');
        completedBox.classList.add('hidden');
        document.getElementById('display-blind-token').textContent = state.unlinkedBallotToken;
      } else {
        step3.className = 'step-node completed';
        castBox.classList.add('hidden');
        completedBox.classList.remove('hidden');
      }
    } else {
      step2.className = 'step-node active';
      document.getElementById('step-line-2').className = 'stepper-line';
      step3.className = 'step-node';
      claimBox.classList.remove('hidden');
      castBox.classList.add('hidden');
      completedBox.classList.add('hidden');
    }
  }

  // Populate options dynamically
  const choicesContainer = document.getElementById('ballot-options-container');
  choicesContainer.innerHTML = '';
  (s.options || []).forEach((opt, idx) => {
    const label = document.createElement('label');
    label.className = 'choice-card-label';
    label.innerHTML = `
      <input type="radio" name="ballot-choice-opt" value="${opt.id}" ${idx === 0 ? 'checked' : ''}>
      <div>
        <span class="choice-text"><strong>${opt.candidate_name || opt.label}</strong></span>
        ${opt.candidate_name ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${opt.label}</div>` : ''}
      </div>
    `;
    choicesContainer.appendChild(label);
  });
}

function renderTallyMeters(tally, totalBallots) {
  const container = document.getElementById('tally-bars-display');
  container.innerHTML = '';

  tally.forEach(item => {
    const pct = totalBallots > 0 ? Math.round((item.votes / totalBallots) * 100) : 0;
    const meter = document.createElement('div');
    meter.className = 'tally-meter-item';
    meter.innerHTML = `
      <div class="tally-meter-labels">
        <span><strong>${item.candidate_name || item.label}</strong></span>
        <span>${item.votes} votes (${pct}%)</span>
      </div>
      <div class="tally-meter-track">
        <div class="tally-meter-fill" style="width: ${pct}%;"></div>
      </div>
    `;
    container.appendChild(meter);
  });
}

async function claimBlindToken() {
  try {
    const sessionId = state.currentVotingSessionId || 1;
    const res = await fetch('/api/voting/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to claim token', true);
      return;
    }

    state.unlinkedBallotToken = data.token;
    sessionStorage.setItem('ballot_token_' + sessionId, data.token);
    showToast('Blind Ballot Token issued! Your identity is decoupled from this token.');
    await loadVotingSession();
  } catch (err) {
    showToast('Failed to claim blind token', true);
  }
}

async function castAnonymousBallot(e) {
  e.preventDefault();
  const selected = document.querySelector('input[name="ballot-choice-opt"]:checked');
  if (!selected) return showToast('Please select an option', true);

  const sessionId = state.currentVotingSessionId || 1;
  const optionId = parseInt(selected.value, 10);
  const token = state.unlinkedBallotToken;

  try {
    const res = await fetch('/api/voting/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, option_id: optionId, token })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to submit ballot', true);
      return;
    }

    state.unlinkedBallotToken = null;
    sessionStorage.removeItem('ballot_token_' + sessionId);
    showToast('Anonymous review ballot successfully recorded!');
    await loadVotingSession();
    await loadPersonalDashboard();
  } catch (err) {
    showToast('Network error casting ballot', true);
  }
}

async function hostCloseVotingSession() {
  if (!state.currentUser || !state.currentUser.is_host) {
    showToast('Host Authorization Required: Only the Team Host can close a voting session.', true);
    return;
  }

  try {
    const sessionId = state.currentVotingSessionId || 1;
    const res = await fetch('/api/voting/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to close session', true);
      return;
    }
    showToast('Review session closed. Aggregate tallies revealed!');
    await loadVotingSession();
  } catch (err) {
    showToast('Error closing voting session', true);
  }
}

async function hostReopenVotingSession() {
  if (!state.currentUser || !state.currentUser.is_host) {
    showToast('Host Authorization Required: Only the Team Host can reopen a voting session.', true);
    return;
  }

  try {
    const sessionId = state.currentVotingSessionId || 1;
    const res = await fetch('/api/voting/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to reopen session', true);
      return;
    }
    showToast('Review session reopened for submissions!');
    await loadVotingSession();
  } catch (err) {
    showToast('Error reopening voting session', true);
  }
}

// -------------------------------------------------------------
// VIEW 5: CALENDAR & MEETING PINGS
// -------------------------------------------------------------
async function loadCalendarEvents() {
  try {
    const res = await fetch('/api/calendar');
    const data = await res.json();
    state.calendarEvents = data.events;
    const badgeCal = document.getElementById('badge-cal-count');
    if (badgeCal) badgeCal.textContent = state.calendarEvents.length;
    renderCalendarEvents();
    updateRoomStatusWidget();
  } catch (err) {
    console.error('Failed to load calendar events:', err);
  }
}

function renderCalendarEvents() {
  const container = document.getElementById('calendar-all-events-container');
  if (!container) return;
  container.innerHTML = '';

  // Render Meeting Bridges Overview Panel
  renderMeetingBridges();

  if (state.calendarEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <h4>No Events Scheduled</h4>
        <p>No upcoming deadlines or meetings scheduled.</p>
      </div>`;
    return;
  }

  state.calendarEvents.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'cal-event-card';

    const isMeeting = ev.event_type === 'MEETING' || ev.event_type === 'RETRO';
    const slotLabel = ev.slot_name ? `${ev.slot_name} (${ev.slot_code || ''})` : (ev.meeting_link ? 'Meeting Bridge' : 'Milestone');

    let audienceText = 'All Team Members';
    if (ev.target_audience === 'BACKEND') audienceText = 'Backend Track';
    else if (ev.target_audience === 'FRONTEND') audienceText = 'Frontend Track';
    else if (ev.target_audience && ev.target_audience.startsWith('[')) audienceText = 'Selected Guests';
    else if (ev.assignee_name) audienceText = `Target: ${ev.assignee_name}`;

    card.innerHTML = `
      <div class="cal-card-top">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="cal-type-badge cal-tag-${ev.event_type}">${ev.event_type}</span>
          ${ev.is_live ? '<span class="live-pulse-badge" style="font-size:9.5px; padding:2px 6px;">LIVE NOW</span>' : ''}
        </div>
        <span style="font-size:11.5px; color:var(--text-muted);">${audienceText}</span>
      </div>

      <div>
        <h4 class="cal-event-title">${ev.title}</h4>
        ${ev.description ? `<p style="font-size:12px; color:var(--text-secondary); margin:4px 0 6px 0; line-height:1.4;">${ev.description}</p>` : ''}
        <div class="cal-date-time">${ev.event_date} · ${ev.time_label}</div>
        ${isMeeting ? `<div style="font-size:11.5px; color:var(--google-blue); margin-top:4px;">${slotLabel}</div>` : ''}
      </div>

      <div class="cal-card-actions">
        ${ev.join_url ? `
          <button class="meet-link-btn" onclick="openDockedCallById(${ev.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
            Join Call
          </button>
        ` : `<span style="font-size:12px; color:var(--text-muted);">Submission Deadline</span>`}

        ${state.currentUser && state.currentUser.is_host ? `
          ${isMeeting ? (ev.is_live ? `<button class="btn-cal-action btn-cal-end" onclick="endMeetingSession(${ev.id})">End Call</button>` : `<button class="btn-cal-action btn-cal-ping" onclick="pingMeetingSession(${ev.id})">Ping Now</button>`) : ''}
          <button class="btn-cal-action" onclick="deleteCalendarEvent(${ev.id})" style="color:var(--google-red);">Delete</button>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

async function renderMeetingBridges() {
  const container = document.getElementById('meeting-bridges-container');
  if (!container) return;
  try {
    const res = await fetch('/api/meetings/slots');
    const data = await res.json();
    if (!data.slots) return;

    container.innerHTML = '';
    data.slots.forEach(slot => {
      const card = document.createElement('div');
      card.className = 'bridge-slot-card';
      const lastUsed = slot.last_used_at ? new Date(slot.last_used_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready';
      card.innerHTML = `
        <div class="bridge-slot-top">
          <span class="bridge-slot-code">${slot.slot_code}</span>
          <span class="bridge-status-dot" title="Available"></span>
        </div>
        <div class="bridge-slot-name">${slot.slot_name}</div>
        <div class="bridge-slot-meta">Status: Active · ${slot.last_used_at ? `Used at ${lastUsed}` : 'Unused slot'}</div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load meeting slots:', err);
  }
}

window.pingMeetingSession = async function(id) {
  try {
    const res = await fetch(`/api/calendar/${id}/ping`, { method: 'POST' });
    if (res.ok) {
      showToast('Meeting ping broadcasted to target audience.');
      await loadCalendarEvents();
      await loadPersonalDashboard();
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to broadcast ping', true);
    }
  } catch {
    showToast('Error broadcasting ping', true);
  }
};

window.endMeetingSession = async function(id) {
  try {
    const res = await fetch(`/api/calendar/${id}/end`, { method: 'POST' });
    if (res.ok) {
      showToast('Meeting session ended.');
      await loadCalendarEvents();
      await loadPersonalDashboard();
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to end session', true);
    }
  } catch {
    showToast('Error ending session', true);
  }
};

window.deleteCalendarEvent = async function(id) {
  if (!confirm('Are you sure you want to remove this event from the calendar?')) return;
  try {
    const res = await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Calendar event removed.');
      await loadCalendarEvents();
      await loadPersonalDashboard();
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to delete event', true);
    }
  } catch {
    showToast('Error deleting event', true);
  }
};

// -------------------------------------------------------------
// VIEW 6: 2-MAN GOVERNANCE PIPELINE
// -------------------------------------------------------------
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    state.tickets = data.tickets;
    renderTickets();
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

function renderTickets() {
  const container = document.getElementById('governance-tickets-container');
  if (!container) return;
  container.innerHTML = '';

  if (state.tickets.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        <h4>No Access Requests</h4>
        <p>No privileged access tickets have been raised yet. Use the button above to request access.</p>
      </div>`;
    return;
  }

  state.tickets.forEach(ticket => {
    const card = document.createElement('div');
    card.className = 'ticket-pipeline-card card';

    const isPending = ticket.status === 'PENDING_APPROVAL';
    const isRequester = state.currentUser && state.currentUser.id === ticket.requester_id;

    let actionBtnHtml = '';
    if (isPending) {
      if (isRequester) {
        actionBtnHtml = `<button class="btn btn-outlined btn-sm btn-approve-ticket" data-id="${ticket.id}">Approve (Test Self-Approval Guard)</button>`;
      } else {
        actionBtnHtml = `<button class="btn btn-filled btn-sm btn-approve-ticket" data-id="${ticket.id}">Peer Review & Approve</button>`;
      }
    }

    card.innerHTML = `
      <div class="ticket-top-row">
        <div class="ticket-header-group">
          <h4>${ticket.title}</h4>
          <span class="ticket-scope-tag">${ticket.scope}</span>
        </div>
        <span class="kpi-tag ${isPending ? 'tag-amber' : 'tag-green'}">${ticket.status.replace('_', ' ')}</span>
      </div>

      <div class="ticket-reason-box">
        <strong>Justification:</strong> ${ticket.reason}
      </div>

      <div class="ticket-pipeline-nodes">
        <div class="pipeline-node">
          <div class="user-avatar">${getInitials(ticket.requester_name)}</div>
          <div>
            <div class="node-role-label">Requester</div>
            <div class="node-name-label">${ticket.requester_name}</div>
          </div>
        </div>

        <div class="flow-arrow">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </div>

        <div class="pipeline-node">
          <div class="user-avatar">${ticket.approver_name ? getInitials(ticket.approver_name) : '?'}</div>
          <div>
            <div class="node-role-label">Independent Approver</div>
            <div class="node-name-label">${ticket.approver_name || 'Pending Peer Review'}</div>
          </div>
        </div>

        <div class="pipeline-node">
          <div>
            <div class="node-role-label">Capability Lifetime</div>
            <div class="node-name-label">${ticket.expires_at ? `Active until ${new Date(ticket.expires_at).toLocaleTimeString()}` : `${ticket.duration_minutes} Mins Requested`}</div>
          </div>
        </div>

        ${actionBtnHtml}
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll('.btn-approve-ticket').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ticketId = parseInt(btn.dataset.id, 10);
      await approveTicket(ticketId);
    });
  });
}

async function approveTicket(ticketId) {
  try {
    const res = await fetch(`/api/tickets/${ticketId}/approve`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || '2-Man Rule Violation: Requester cannot self-approve!', true);
      return;
    }

    showToast(data.message || 'Ticket approved! Ephemeral capability granted.');
    await loadTickets();
  } catch (err) {
    showToast('Failed to approve ticket', true);
  }
}

// -------------------------------------------------------------
// VIEW 7: TEAM DIRECTORY
// -------------------------------------------------------------
function renderTeamRoster() {
  const containerSettings = document.getElementById('team-roster-cards');
  const containerPeers = document.getElementById('team-roster-peers-cards');

  const subtitle = document.getElementById('team-roster-subtitle');
  if (subtitle) {
    const memberCount = state.members ? state.members.length : 0;
    subtitle.textContent = `${memberCount} Allowlisted Member${memberCount === 1 ? '' : 's'}: 1 Designated Host + ${Math.max(0, memberCount - 1)} Team Participant${memberCount === 2 ? '' : 's'}`;
  }

  const teamBadge = document.querySelector('[data-view="view-team"] .nav-badge');
  if (teamBadge && state.members) {
    teamBadge.textContent = state.members.length;
  }

  const isHost = state.currentUser && state.currentUser.is_host === 1;

  const renderCard = (m, isPeersView = false) => {
    const card = document.createElement('div');
    card.className = 'roster-card';

    let avatarColor = 'avatar-blue';
    if (m.team_track === 'frontend') avatarColor = 'avatar-purple';
    if (m.team_track === 'lead') avatarColor = 'avatar-amber';

    const assignedTasks = (state.tasks || []).filter(t => t.assignee_id === m.id).length;
    const isMe = state.currentUser && state.currentUser.id === m.id;

    card.innerHTML = `
      <div class="roster-card-header">
        <div class="roster-avatar ${avatarColor}">${getInitials(m.name)}</div>
        <div class="roster-title-group">
          <h4>${m.name} ${m.is_host ? '<span class="host-pill-tag">LEAD</span>' : ''} ${isMe ? '<span class="nav-badge">YOU</span>' : ''}</h4>
          <span class="roster-role-title">${m.role}</span>
        </div>
      </div>

      <div class="roster-meta-stack">
        <div class="meta-row">
          <span class="meta-label">Track</span>
          <span class="meta-val" style="text-transform: capitalize;">${m.team_track}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">GitHub Handle</span>
          <span class="meta-val">@${m.handle}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Allocated Tasks</span>
          <span class="meta-val">${assignedTasks} Tasks</span>
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
        ${isPeersView && !isMe ? `
          <button class="btn btn-filled btn-sm btn-peer-tasklet" data-id="${m.id}" style="flex: 1;">
            + Send Tasklet
          </button>
        ` : ''}
        <button class="btn btn-outlined btn-sm btn-roster-switch" data-handle="${m.handle}" style="${isPeersView && !isMe ? '' : 'flex: 1;'}">
          ${isMe ? 'Current User' : 'Switch Persona'}
        </button>
        ${!isPeersView && isHost && !m.is_host ? `
          <button class="btn btn-danger btn-sm btn-remove-member" data-id="${m.id}" title="Remove member from allowlist">
            Remove
          </button>
        ` : ''}
      </div>
    `;

    card.querySelector('.btn-roster-switch')?.addEventListener('click', async () => {
      if (!isMe) await loginAs(m.handle);
    });

    card.querySelector('.btn-peer-tasklet')?.addEventListener('click', () => {
      openSendTaskletModal(m.id);
    });

    card.querySelector('.btn-remove-member')?.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to remove @${m.handle} from the Frontier AI allowlist?`)) return;
      try {
        const res = await fetch(`/api/members/${m.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message || 'Member removed');
          await loadMembers();
          renderTeamRoster();
        } else {
          showToast(data.error || 'Failed to remove member', true);
        }
      } catch (err) {
        showToast('Network error removing member', true);
      }
    });

    return card;
  };

  if (containerSettings) {
    containerSettings.innerHTML = '';
    state.members.forEach(m => containerSettings.appendChild(renderCard(m, false)));
  }

  if (containerPeers) {
    containerPeers.innerHTML = '';
    state.members.forEach(m => containerPeers.appendChild(renderCard(m, true)));
  }
}

// -------------------------------------------------------------
// VIEW 8: AUDIT TRAIL
// -------------------------------------------------------------
async function loadAuditTrail() {
  try {
    const res = await fetch('/api/audit');
    const data = await res.json();
    state.auditEvents = data.events;
    renderAuditTrail();
  } catch (err) {
    console.error('Failed to load audit trail:', err);
  }
}

function renderAuditTrail() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = state.auditEvents.filter(ev => {
    if (!state.auditSearchTerm) return true;
    const term = state.auditSearchTerm.toLowerCase();
    return (
      ev.actor_handle.toLowerCase().includes(term) ||
      ev.action.toLowerCase().includes(term) ||
      ev.target.toLowerCase().includes(term) ||
      (ev.details && ev.details.toLowerCase().includes(term))
    );
  });

  filtered.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${ev.id}</strong></td>
      <td style="color: var(--text-muted);">${new Date(ev.timestamp).toLocaleTimeString()}</td>
      <td><code>@${ev.actor_handle}</code></td>
      <td><strong>${ev.action}</strong></td>
      <td style="font-family: var(--font-mono); font-size: 11.5px;">${ev.target}</td>
      <td style="color: var(--text-secondary);">${ev.details || ''}</td>
      <td>
        <span class="kpi-tag ${ev.status === 'SUCCESS' || ev.status === 'GRANTED' ? 'tag-green' : (ev.status === 'DENIED' || ev.status === 'CONFLICT' ? 'tag-amber' : 'tag-blue')}">
          ${ev.status}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// ₹0 DISASTER RECOVERY
// -------------------------------------------------------------
async function triggerDisasterBackup() {
  const btn = document.getElementById('btn-trigger-backup-snap');
  const terminal = document.getElementById('backup-terminal-output');

  btn.disabled = true;
  btn.textContent = 'Generating Snapshot...';

  try {
    const res = await fetch('/api/disaster-recovery/export', { method: 'POST' });
    const data = await res.json();

    terminal.innerHTML = `
<code>
[SNAPSHOT EXPORT COMPLETE]
Timestamp:    ${data.timestamp}
File Target:  backups/${data.filename}
Tables Dump:  ${data.totalTables} Relational Tables
Status:       Clean sanitized JSON ready for Git Commit (₹0 Durability)
</code>
    `;
    showToast('Sanitized database snapshot exported to backups/');
  } catch (err) {
    showToast('Failed to export snapshot', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Trigger Backup Snapshot Now';
  }
}

// -------------------------------------------------------------
// MODALS & EVENT HANDLERS
// -------------------------------------------------------------
function populateSelects() {
  const taskAssignee = document.getElementById('task-assignee');
  const calAssignee = document.getElementById('cal-assignee');
  const customMembersBox = document.getElementById('cal-member-checkboxes');

  if (taskAssignee) {
    taskAssignee.innerHTML = '';
    state.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.role})`;
      taskAssignee.appendChild(opt);
    });
  }

  if (calAssignee) {
    calAssignee.innerHTML = '<option value="">All Team Members (Global Ping)</option>';
    state.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.role})`;
      calAssignee.appendChild(opt);
    });
  }

  if (customMembersBox) {
    customMembersBox.innerHTML = '';
    state.members.forEach(m => {
      const label = document.createElement('label');
      label.style = 'display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: var(--text-primary);';
      label.innerHTML = `
        <input type="checkbox" value="${m.id}" class="cal-member-cb" style="accent-color: var(--google-blue);">
        <span>${m.name} <small style="color:var(--text-muted);">(${m.team_track})</small></span>
      `;
      customMembersBox.appendChild(label);
    });
  }
}

function populateDeliverableModalSelect(tasks) {
  const select = document.getElementById('submit-task-select');
  if (!select) return;
  select.innerHTML = '';

  if (tasks.length === 0) {
    select.innerHTML = '<option value="">No tasks currently assigned to you</option>';
    return;
  }

  tasks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.title} [Status: ${t.status}]`;
    select.appendChild(opt);
  });
}

function setupModals() {
  const taskModal = document.getElementById('modal-task');
  const deliverableModal = document.getElementById('modal-submit-deliverable');
  const calModal = document.getElementById('modal-calendar');
  const ticketModal = document.getElementById('modal-ticket');
  const occModal = document.getElementById('modal-occ-conflict');

  // Open Assign Task modal (LEAD ONLY CHECK)
  const openAllotTaskHandler = () => {
    if (!state.currentUser || !state.currentUser.is_host) {
      showToast('Lead Authorization Required: Only the Team Lead can assign tasks.', true);
      return;
    }
    taskModal.showModal();
  };

  document.getElementById('btn-open-task-modal')?.addEventListener('click', openAllotTaskHandler);
  document.getElementById('btn-host-allot-trigger')?.addEventListener('click', openAllotTaskHandler);
  document.getElementById('btn-close-task-modal')?.addEventListener('click', () => taskModal.close());
  document.getElementById('btn-cancel-task')?.addEventListener('click', () => taskModal.close());

  // Open Submit Deliverable modal
  document.getElementById('btn-open-submit-deliverable')?.addEventListener('click', () => {
    deliverableModal.showModal();
  });
  document.getElementById('btn-close-submit-modal')?.addEventListener('click', () => deliverableModal.close());
  document.getElementById('btn-cancel-submit')?.addEventListener('click', () => deliverableModal.close());

  // Open Calendar modal (LEAD ONLY CHECK)
  document.getElementById('btn-open-calendar-modal')?.addEventListener('click', () => {
    if (!state.currentUser || !state.currentUser.is_host) {
      showToast('Lead Authorization Required: Only the Team Lead can schedule events.', true);
      return;
    }
    calModal.showModal();
  });
  document.getElementById('btn-close-cal-modal')?.addEventListener('click', () => calModal.close());
  document.getElementById('btn-cancel-cal')?.addEventListener('click', () => calModal.close());

  // Ticket modal
  document.getElementById('btn-open-ticket-modal')?.addEventListener('click', () => ticketModal.showModal());
  document.getElementById('btn-close-ticket-modal')?.addEventListener('click', () => ticketModal.close());
  document.getElementById('btn-cancel-ticket')?.addEventListener('click', () => ticketModal.close());

  // OCC modal
  document.getElementById('btn-close-occ-modal')?.addEventListener('click', () => occModal.close());
  document.getElementById('btn-resolve-occ')?.addEventListener('click', async () => {
    occModal.close();
    await loadTasks();
  });

  // Onboard Member modal (Host only)
  const onboardModal = document.getElementById('modal-onboard-member');
  document.getElementById('btn-open-onboard-modal')?.addEventListener('click', () => {
    if (!state.currentUser || !state.currentUser.is_host) {
      showToast('Host Authorization Required: Only the Team Host can onboard members.', true);
      return;
    }
    onboardModal.showModal();
  });
  document.getElementById('btn-close-onboard-modal')?.addEventListener('click', () => onboardModal.close());
  document.getElementById('btn-cancel-onboard')?.addEventListener('click', () => onboardModal.close());

  document.getElementById('form-onboard-member')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const github_username = document.getElementById('onboard-github-user').value.trim();
    const role = document.getElementById('onboard-role').value.trim();
    const team_track = document.getElementById('onboard-track').value;
    const submitBtn = document.getElementById('btn-submit-onboard');

    if (!github_username || !role) {
      showToast('Please enter both username and role.', true);
      return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Verifying with GitHub...';
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_username, role, team_track })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to onboard member', true);
        return;
      }
      showToast(data.message || 'Member successfully onboarded!');
      onboardModal.close();
      document.getElementById('form-onboard-member').reset();
      await loadMembers();
      renderTeamRoster();
      populateTaskAssigneeDropdown();
    } catch (err) {
      showToast('Network error onboarding member', true);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  // Create Task Form (Lead only)
  document.getElementById('form-create-task')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-desc').value;
    const track = document.getElementById('task-track').value;
    const assignee_id = parseInt(document.getElementById('task-assignee').value, 10);
    const deadline = document.getElementById('task-deadline').value;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, track, assignee_id, deadline })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to assign task', true);
        return;
      }

      showToast('Task successfully assigned to team member.');
      taskModal.close();
      document.getElementById('form-create-task').reset();
      await loadTasks();
      await loadPersonalDashboard();
    } catch (err) {
      showToast('Error assigning task', true);
    }
  });

  // Submit Deliverable Form (Participant)
  document.getElementById('form-submit-deliverable')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = parseInt(document.getElementById('submit-task-select').value, 10);
    const deliverable_url = document.getElementById('submit-pr-url').value;
    const deliverable_notes = document.getElementById('submit-notes').value;

    if (!taskId) return showToast('Please select a task to submit', true);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'COMPLETED',
          deliverable_url,
          deliverable_notes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to submit deliverable', true);
        return;
      }

      showToast('Deliverable submitted and task marked completed.');
      deliverableModal.close();
      document.getElementById('form-submit-deliverable').reset();
      await loadTasks();
      await loadPersonalDashboard();
    } catch (err) {
      showToast('Error submitting deliverable', true);
    }
  });

  // Dynamic audience and bridge controls in calendar modal
  document.getElementById('cal-audience-select')?.addEventListener('change', (e) => {
    const box = document.getElementById('cal-custom-members-box');
    if (box) {
      box.style.display = e.target.value === 'CUSTOM' ? 'block' : 'none';
    }
  });

  document.getElementById('cal-slot-select')?.addEventListener('change', (e) => {
    const box = document.getElementById('cal-custom-link-box');
    if (box) {
      box.style.display = e.target.value === 'custom' ? 'block' : 'none';
    }
  });

  // Schedule Calendar Event Form (Lead only)
  document.getElementById('form-create-calendar')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('cal-title').value;
    const description = document.getElementById('cal-desc')?.value || '';
    const event_type = document.getElementById('cal-type').value;
    const event_date = document.getElementById('cal-date').value;
    const time_label = document.getElementById('cal-time').value;

    const audienceSelect = document.getElementById('cal-audience-select')?.value || 'ALL';
    let target_audience = audienceSelect;
    if (audienceSelect === 'CUSTOM') {
      const checkedIds = Array.from(document.querySelectorAll('.cal-member-cb:checked')).map(cb => parseInt(cb.value, 10));
      if (checkedIds.length === 0) {
        showToast('Please select at least one recipient for custom audience.', true);
        return;
      }
      target_audience = JSON.stringify(checkedIds);
    }

    const slotSelect = document.getElementById('cal-slot-select')?.value || 'auto';
    const customLink = document.getElementById('cal-link')?.value || '';
    const is_live = document.getElementById('cal-ping-now')?.checked ? 1 : 0;

    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          event_type,
          event_date,
          time_label,
          target_audience,
          meeting_slot_id: slotSelect === 'custom' ? null : (slotSelect === 'auto' ? 'auto' : parseInt(slotSelect, 10)),
          meeting_link: slotSelect === 'custom' ? customLink : null,
          is_live
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to schedule event', true);
        return;
      }

      showToast(is_live ? 'Live session ping broadcasted and scheduled!' : 'Event successfully scheduled on calendar.');
      calModal.close();
      document.getElementById('form-create-calendar').reset();
      const customMembersBox = document.getElementById('cal-custom-members-box');
      if (customMembersBox) customMembersBox.style.display = 'none';
      const customLinkBox = document.getElementById('cal-custom-link-box');
      if (customLinkBox) customLinkBox.style.display = 'none';
      await loadCalendarEvents();
      await loadPersonalDashboard();
    } catch (err) {
      showToast('Error scheduling calendar event', true);
    }
  });

  // Create Ticket Form
  document.getElementById('form-create-ticket')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('ticket-title').value;
    const scope = document.getElementById('ticket-scope').value;
    const duration_minutes = parseInt(document.getElementById('ticket-duration').value, 10);
    const reason = document.getElementById('ticket-reason').value;

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, scope, duration_minutes, reason })
      });

      if (!res.ok) throw new Error('Ticket creation rejected');

      showToast('Access request submitted for independent peer review');
      ticketModal.close();
      document.getElementById('form-create-ticket').reset();
      await loadTickets();
    } catch (err) {
      showToast('Failed to create ticket', true);
    }
  });

  // Send Tasklet Modal
  const taskletModal = document.getElementById('modal-send-tasklet');
  document.getElementById('btn-open-send-tasklet')?.addEventListener('click', () => openSendTaskletModal());
  document.getElementById('btn-close-send-tasklet-modal')?.addEventListener('click', () => taskletModal?.close());
  document.getElementById('btn-cancel-send-tasklet')?.addEventListener('click', () => taskletModal?.close());

  document.getElementById('form-send-tasklet')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const receiver_id = parseInt(document.getElementById('tasklet-receiver').value, 10);
    const title = document.getElementById('tasklet-title').value.trim();
    const description = document.getElementById('tasklet-desc').value.trim();

    if (!receiver_id || !title) {
      showToast('Please select a recipient teammate and enter a title', true);
      return;
    }

    try {
      const res = await fetch('/api/tasklets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id, title, description })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to send tasklet', true);
        return;
      }

      showToast('Tasklet sent to teammate!');
      taskletModal?.close();
      document.getElementById('form-send-tasklet').reset();
      await loadTasklets();
    } catch (err) {
      showToast('Error sending tasklet', true);
    }
  });
}

// -------------------------------------------------------------
// MODULE 4: PEERS & TASKLETS (PEER-TO-PEER MICRO-TASKS)
// -------------------------------------------------------------
async function loadTasklets() {
  try {
    const res = await fetch('/api/tasklets');
    const data = await res.json();
    state.tasklets = data.tasklets || [];
    renderTasklets();
    updateTaskletBadges();
  } catch (err) {
    console.error('Failed to load tasklets:', err);
  }
}

function updateTaskletBadges() {
  if (!state.currentUser) return;
  const received = (state.tasklets || []).filter(t => t.receiver_id === state.currentUser.id);
  const sent = (state.tasklets || []).filter(t => t.sender_id === state.currentUser.id);
  const pendingReceived = received.filter(t => t.status === 'PENDING').length;

  const countRecEl = document.getElementById('count-tasklets-received');
  if (countRecEl) countRecEl.textContent = received.length;

  const countSentEl = document.getElementById('count-tasklets-sent');
  if (countSentEl) countSentEl.textContent = sent.length;

  const badgeEl = document.getElementById('badge-tasklets-count');
  if (badgeEl) {
    badgeEl.textContent = pendingReceived;
    badgeEl.style.display = (!state.currentUser.is_host && pendingReceived > 0) ? 'inline-block' : 'none';
  }
}

function renderTasklets() {
  if (!state.currentUser) return;
  const containerRec = document.getElementById('container-tasklets-received');
  const containerSent = document.getElementById('container-tasklets-sent');
  if (!containerRec || !containerSent) return;

  const isReceived = state.taskletTab === 'received';
  containerRec.classList.toggle('hidden', !isReceived);
  containerSent.classList.toggle('hidden', isReceived);

  const list = isReceived
    ? (state.tasklets || []).filter(t => t.receiver_id === state.currentUser.id)
    : (state.tasklets || []).filter(t => t.sender_id === state.currentUser.id);

  const targetContainer = isReceived ? containerRec : containerSent;
  targetContainer.innerHTML = '';

  if (list.length === 0) {
    targetContainer.innerHTML = `
      <div class="empty-state" style="padding: 24px 12px; text-align: center;">
        <p style="color: var(--text-muted); font-size: 13px;">No ${isReceived ? 'received' : 'sent'} tasklets yet. Click "+ Send Tasklet" to ask a teammate for a review or quick sync.</p>
      </div>
    `;
    return;
  }

  list.forEach(t => {
    const card = document.createElement('div');
    card.className = 'tasklet-card';
    const statusClass = t.status === 'DONE' ? 'tasklet-done' : (t.status === 'ACCEPTED' ? 'tasklet-accepted' : 'tasklet-pending');
    const counterpartLabel = isReceived ? `From: ${t.sender_name || 'Teammate'}` : `To: ${t.receiver_name || 'Teammate'}`;
    const dateStr = new Date(t.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    let actionsHtml = '';
    if (isReceived) {
      if (t.status === 'PENDING') {
        actionsHtml = `
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn btn-outlined btn-sm" onclick="handleTaskletStatus(${t.id}, 'ACCEPTED')">Accept</button>
            <button class="btn btn-filled btn-sm" onclick="handleTaskletStatus(${t.id}, 'DONE')">Mark Done</button>
          </div>
        `;
      } else if (t.status === 'ACCEPTED') {
        actionsHtml = `
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn btn-filled btn-sm" onclick="handleTaskletStatus(${t.id}, 'DONE')">Mark Done</button>
          </div>
        `;
      }
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div>
          <div style="font-weight: 600; font-size: 14px; color: var(--text-primary); margin-bottom: 2px;">${t.title}</div>
          <div style="font-size: 12px; color: var(--text-secondary);">${counterpartLabel} • ${dateStr}</div>
        </div>
        <span class="tasklet-badge ${statusClass}">${t.status}</span>
      </div>
      ${t.description ? `<p style="font-size: 13px; color: var(--text-secondary); margin: 8px 0 0 0; line-height: 1.4;">${t.description}</p>` : ''}
      ${actionsHtml}
    `;
    targetContainer.appendChild(card);
  });
}

window.handleTaskletStatus = async function(id, status) {
  try {
    const res = await fetch(`/api/tasklets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update tasklet', true);
      return;
    }
    showToast(`Tasklet marked ${status.toLowerCase()}`);
    await loadTasklets();
  } catch (err) {
    showToast('Network error updating tasklet', true);
  }
};

function openSendTaskletModal(preselectedReceiverId = null) {
  const modal = document.getElementById('modal-send-tasklet');
  if (!modal) return;
  const select = document.getElementById('tasklet-receiver');
  if (select) {
    select.innerHTML = '';
    (state.members || []).filter(m => m.id !== state.currentUser?.id).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (@${m.handle} · ${m.role})`;
      if (preselectedReceiverId && m.id === preselectedReceiverId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
  document.getElementById('tasklet-title').value = '';
  document.getElementById('tasklet-desc').value = '';
  modal.showModal();
}

// -------------------------------------------------------------
// GOOGLE MEET GATEWAY (PATH A: COMPANION TAB / WINDOW)
// -------------------------------------------------------------
export function joinMeetingGateway(meetingOrId) {
  let url = '/api/meetings/join/1';
  let title = 'Team Meeting';
  if (typeof meetingOrId === 'object' && meetingOrId !== null) {
    url = meetingOrId.join_url || `/api/meetings/join/${meetingOrId.id || 1}`;
    title = meetingOrId.title || title;
  } else if (typeof meetingOrId === 'number' || typeof meetingOrId === 'string') {
    const ev = state.calendarEvents?.find(e => e.id === Number(meetingOrId));
    url = ev?.join_url || `/api/meetings/join/${meetingOrId}`;
    title = ev?.title || title;
  }
  showToast(`Connecting to ${title} via Google Meet gateway...`);
  window.open(url, '_blank');
}

window.openDockedCallById = joinMeetingGateway;
window.joinMeetingGateway = joinMeetingGateway;
export function openDockedCall(meeting) {
  joinMeetingGateway(meeting);
}
export function closeDockedCall() {
  // Path A no-op
}

function setupGlobalSearch() {
  const input = document.getElementById('global-search-input');
  input?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) return;

    if (term.includes('my') || term.includes('mine')) {
      switchView('view-tasks');
      document.getElementById('tab-tasks-mine')?.click();
    } else if (term.includes('all') || term.includes('task') || term.includes('sprint') || term.includes('board')) {
      switchView('view-tasks');
      document.getElementById('tab-tasks-all')?.click();
    } else if (term.includes('vote') || term.includes('ballot') || term.includes('peer') || term.includes('review')) {
      switchView('view-voting');
    } else if (term.includes('cal') || term.includes('meet') || term.includes('call') || term.includes('room')) {
      switchView('view-callroom');
    } else if (term.includes('roster') || term.includes('team') || term.includes('directory')) {
      switchView('view-settings');
      document.querySelector('#settings-subtabs [data-subtab="directory"]')?.click();
    } else if (term.includes('permission') || term.includes('ticket') || term.includes('access')) {
      switchView('view-settings');
      document.querySelector('#settings-subtabs [data-subtab="permissions"]')?.click();
    } else if (term.includes('audit') || term.includes('history') || term.includes('log')) {
      switchView('view-settings');
      document.querySelector('#settings-subtabs [data-subtab="history"]')?.click();
    } else if (term.includes('snapshot') || term.includes('backup') || term.includes('data')) {
      switchView('view-settings');
      document.querySelector('#settings-subtabs [data-subtab="snapshot"]')?.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      input?.focus();
    }
  });

  const auditFilter = document.getElementById('audit-search-input');
  auditFilter?.addEventListener('input', (e) => {
    state.auditSearchTerm = e.target.value;
    renderAuditTrail();
  });
}

function setupEventListeners() {
  document.querySelectorAll('#task-filter-pills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#task-filter-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.taskFilter = pill.dataset.filter;
      renderKanbanBoard();
    });
  });

  document.getElementById('btn-claim-blind-token')?.addEventListener('click', claimBlindToken);
  document.getElementById('form-submit-ballot')?.addEventListener('submit', castAnonymousBallot);
  document.getElementById('btn-host-close-voting')?.addEventListener('click', hostCloseVotingSession);
  document.getElementById('btn-host-reopen-voting')?.addEventListener('click', hostReopenVotingSession);
  document.getElementById('btn-refresh-audit')?.addEventListener('click', loadAuditTrail);
  document.getElementById('btn-trigger-backup-snap')?.addEventListener('click', triggerDisasterBackup);

  // Client data exports
  document.getElementById('btn-export-tasks-json')?.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.tasks, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `frontier_tasks_${new Date().toISOString().slice(0,10)}.json`);
    dl.click();
    showToast('Tasks exported as JSON');
  });

  document.getElementById('btn-export-audit-csv')?.addEventListener('click', () => {
    if (!state.auditEvents || state.auditEvents.length === 0) {
      showToast('No activity history to export', true);
      return;
    }
    const headers = ["ID", "Timestamp", "Actor", "Action", "Target", "Severity", "Details"];
    const rows = state.auditEvents.map(e => [
      e.id,
      `"${e.timestamp || ''}"`,
      `"${e.actor_name || ''}"`,
      `"${e.action || ''}"`,
      `"${e.target || ''}"`,
      `"${e.severity || ''}"`,
      `"${(e.details || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const dl = document.createElement('a');
    dl.setAttribute("href", encodeURI(csvContent));
    dl.setAttribute("download", `frontier_activity_${new Date().toISOString().slice(0,10)}.csv`);
    dl.click();
    showToast('Activity log exported as CSV');
  });
}

// Start app
window.addEventListener('DOMContentLoaded', init);
