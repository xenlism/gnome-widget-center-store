import { api } from './api.js';
import { escapeHtml } from './nav.js';

const guard = document.getElementById('guard');
const body = document.getElementById('admin-body');

async function init() {
  const { user } = await api.me().catch(() => ({ user: null }));
  if (!user) {
    guard.innerHTML = `<p class="alert alert-error">กรุณา <a href="/login.html">เข้าสู่ระบบ</a> ก่อน</p>`;
    return;
  }
  if (!user.isAdmin) {
    guard.innerHTML = `<p class="alert alert-error">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>`;
    return;
  }

  body.style.display = 'block';
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-pending').style.display = tab.dataset.tab === 'pending' ? 'block' : 'none';
      document.getElementById('tab-users').style.display = tab.dataset.tab === 'users' ? 'block' : 'none';
    });
  });

  loadPending();
  loadUsers();
}

// ---------------------------------------------------------------------
// pending review queue
// ---------------------------------------------------------------------
async function loadPending() {
  const el = document.getElementById('tab-pending');
  el.innerHTML = '<p class="muted">กำลังโหลด...</p>';

  const { widgets, themepacks } = await api.adminPending();
  const items = [
    ...widgets.map((w) => ({ ...w, type: 'widget' })),
    ...themepacks.map((t) => ({ ...t, type: 'themepack' })),
  ];

  if (items.length === 0) {
    el.innerHTML = '<div class="empty-state">ไม่มีรายการรอตรวจสอบ 🎉</div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>ชื่อ</th><th>ประเภท</th><th>ส่งเมื่อ</th><th>ไฟล์</th><th></th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr data-type="${item.type}" data-id="${escapeHtml(item.id)}">
              <td>
                <div>${escapeHtml(item.name)}</div>
                <div class="faint">${escapeHtml(item.description || '')}</div>
              </td>
              <td><span class="badge badge-${item.type}">${item.type === 'widget' ? 'Widget' : 'Theme Pack'}</span></td>
              <td class="faint">${new Date(item.created_at).toLocaleString('th-TH')}</td>
              <td><a href="${api.adminDownloadUrl(item.type, item.id)}" class="btn btn-sm">ดาวน์โหลด</a></td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-primary approve-btn">อนุมัติ</button>
                <button class="btn btn-sm btn-danger reject-btn">ปฏิเสธ</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll('.approve-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      btn.disabled = true;
      try {
        await api.adminApprove(row.dataset.type, row.dataset.id);
        row.remove();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('.reject-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const reason = prompt('เหตุผลการปฏิเสธ (ไม่บังคับ):') || '';
      btn.disabled = true;
      try {
        await api.adminReject(row.dataset.type, row.dataset.id, reason);
        row.remove();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------------
// user management
// ---------------------------------------------------------------------
async function loadUsers() {
  const el = document.getElementById('tab-users');
  el.innerHTML = '<p class="muted">กำลังโหลด...</p>';

  const { users } = await api.adminListUsers();

  el.innerHTML = `
    <div class="form-card" style="max-width:none; margin:0 0 20px;">
      <h2 style="margin-top:0; font-size:1.05rem;">เพิ่มผู้ใช้ใหม่</h2>
      <form id="add-user-form" style="display:grid; grid-template-columns: 1fr 1fr 1fr auto; gap:10px; align-items:end;">
        <div class="field" style="margin:0;"><label>อีเมล</label><input type="email" id="new-email" required></div>
        <div class="field" style="margin:0;"><label>ชื่อที่แสดง</label><input type="text" id="new-name"></div>
        <div class="field" style="margin:0;"><label>รหัสผ่านชั่วคราว</label><input type="text" id="new-password" required minlength="8"></div>
        <button type="submit" class="btn btn-primary">เพิ่ม</button>
      </form>
      <div id="add-user-alert"></div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>อีเมล</th><th>ชื่อ</th><th>สถานะ</th><th>สมัครเมื่อ</th><th></th></tr></thead>
        <tbody id="users-tbody">
          ${users.map(rowForUser).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('add-user-alert');
    try {
      await api.adminCreateUser({
        email: document.getElementById('new-email').value.trim(),
        displayName: document.getElementById('new-name').value.trim(),
        password: document.getElementById('new-password').value,
      });
      loadUsers();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  wireUserRowActions();
}

function rowForUser(u) {
  return `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.email)}</td>
      <td>
        <span class="display-name">${escapeHtml(u.display_name)}</span>
        ${u.is_admin ? '<span class="badge badge-approved" style="margin-left:6px;">admin</span>' : ''}
      </td>
      <td>
        ${u.is_banned ? '<span class="badge badge-rejected">ถูกระงับ</span>' : '<span class="badge badge-approved">ปกติ</span>'}
        ${!u.is_email_verified ? '<span class="badge badge-pending" style="margin-left:4px;">ยังไม่ยืนยันอีเมล</span>' : ''}
      </td>
      <td class="faint">${new Date(u.created_at).toLocaleDateString('th-TH')}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm ban-btn">${u.is_banned ? 'ปลดระงับ' : 'ระงับ'}</button>
        <button class="btn btn-sm admin-btn">${u.is_admin ? 'ถอด admin' : 'ตั้งเป็น admin'}</button>
        <button class="btn btn-sm btn-danger remove-btn">ลบผู้ใช้</button>
      </td>
    </tr>
  `;
}

function wireUserRowActions() {
  const tbody = document.getElementById('users-tbody');

  tbody.querySelectorAll('.ban-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const isBanned = btn.textContent.trim() === 'ระงับ';
      await api.adminUpdateUser(row.dataset.id, { isBanned });
      loadUsers();
    });
  });

  tbody.querySelectorAll('.admin-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const makeAdmin = btn.textContent.trim() === 'ตั้งเป็น admin';
      await api.adminUpdateUser(row.dataset.id, { isAdmin: makeAdmin });
      loadUsers();
    });
  });

  tbody.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      if (!confirm('ลบผู้ใช้นี้? อีเมลและรหัสผ่านจะถูกล้าง แต่ผลงานที่เคยส่งจะยังอยู่ในระบบ')) return;
      const row = e.target.closest('tr');
      await api.adminRemoveUser(row.dataset.id);
      loadUsers();
    });
  });
}

init();
