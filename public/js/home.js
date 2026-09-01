import { WIDGETS_MANIFEST_URL, THEMEPACKS_MANIFEST_URL } from './config.js';
import { escapeHtml } from './nav.js';

let allItems = [];

async function load() {
  const [widgetsRes, themepacksRes] = await Promise.all([
    fetch(WIDGETS_MANIFEST_URL, { cache: 'no-store' }),
    fetch(THEMEPACKS_MANIFEST_URL, { cache: 'no-store' }),
  ]);

  if (!widgetsRes.ok && !themepacksRes.ok) {
    document.getElementById('empty').style.display = 'block';
    document.getElementById('empty').textContent = 'โหลดแคตตาล็อกไม่สำเร็จ ลองใหม่อีกครั้ง';
    return;
  }

  const widgets = widgetsRes.ok ? (await widgetsRes.json()).widgets : [];
  const themepacks = themepacksRes.ok ? (await themepacksRes.json()).themepacks : [];

  allItems = [
    ...widgets.map((w) => ({ ...w, type: 'widget' })),
    ...themepacks.map((t) => ({ ...t, type: 'themepack' })),
  ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  render();
}

function render() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const typeFilter = document.getElementById('type-filter').value;

  const items = allItems.filter((item) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = items.map((item) => `
    <a class="card" href="/package.html?type=${item.type}&id=${encodeURIComponent(item.id)}">
      <div class="card-thumb">
        ${item.screenshotUrl ? `<img src="${item.screenshotUrl}" alt="">` : 'ไม่มีภาพตัวอย่าง'}
      </div>
      <div class="card-body">
        <span class="badge badge-${item.type}">${item.type === 'widget' ? 'Widget' : 'Theme Pack'}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.description || '')}</p>
        <div class="card-meta">
          <span class="stars">${'★'.repeat(Math.round(item.avgRating))}${'☆'.repeat(5 - Math.round(item.avgRating))} (${item.ratingCount})</span>
          <span>${item.downloadCount} ดาวน์โหลด</span>
        </div>
      </div>
    </a>
  `).join('');
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('type-filter').addEventListener('change', render);

load();
