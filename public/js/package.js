import { WIDGETS_MANIFEST_URL, THEMEPACKS_MANIFEST_URL } from './config.js';
import { api } from './api.js';
import { escapeHtml } from './nav.js';

const params = new URLSearchParams(location.search);
const type = params.get('type');
const id = params.get('id');
const content = document.getElementById('content');

let currentUser = null;
let selectedStars = 0;

async function load() {
  if (!type || !id) {
    content.innerHTML = '<p class="alert alert-error">ไม่พบรายการที่ต้องการ</p>';
    return;
  }

  // Only fetch the one manifest that matches this page's type — a real
  // saving now that the two are separate files instead of one combined
  // repo/widgets.json / repo/themepacks.json.
  const manifestUrl = type === 'widget' ? WIDGETS_MANIFEST_URL : THEMEPACKS_MANIFEST_URL;

  const [manifestRes, meRes] = await Promise.all([
    fetch(manifestUrl, { cache: 'no-store' }),
    api.me().catch(() => ({ user: null })),
  ]);
  currentUser = meRes.user;

  const manifest = await manifestRes.json();
  const list = type === 'widget' ? manifest.widgets : manifest.themepacks;
  const item = (list || []).find((i) => i.id === id);

  if (!item) {
    content.innerHTML = '<p class="alert alert-error">ไม่พบรายการนี้ในสโตร์ (อาจยังไม่ได้รับการอนุมัติ)</p>';
    return;
  }

  content.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr; gap:24px; max-width:720px; margin:0 auto;">
      <div class="card-thumb" style="border-radius:12px; aspect-ratio:16/9;">
        ${item.screenshotUrl ? `<img src="${item.screenshotUrl}" alt="">` : 'ไม่มีภาพตัวอย่าง'}
      </div>
      <div>
        <span class="badge badge-${type}">${type === 'widget' ? 'Widget' : 'Theme Pack'}</span>
        <h1 style="margin:8px 0;">${escapeHtml(item.name)}</h1>
        <p class="muted">${escapeHtml(item.description || '')}</p>
        <div class="card-meta" style="margin:12px 0;">
          <span class="stars">${'★'.repeat(Math.round(item.avgRating))}${'☆'.repeat(5 - Math.round(item.avgRating))} (${item.ratingCount} รีวิว)</span>
          <span>${item.downloadCount} ดาวน์โหลด</span>
        </div>
        <a class="btn btn-primary" href="${item.downloadUrl}" download>ดาวน์โหลด</a>
      </div>

      <div>
        <h2>รีวิว</h2>
        <div id="review-form-slot"></div>
        <div id="reviews-list" class="muted">กำลังโหลดรีวิว...</div>
      </div>
    </div>
  `;

  renderReviewForm();
  loadReviews();
}

function renderReviewForm() {
  const slot = document.getElementById('review-form-slot');
  if (!currentUser) {
    slot.innerHTML = `<p class="faint">ต้อง <a href="/login.html">เข้าสู่ระบบ</a> ก่อนจึงจะรีวิวได้</p>`;
    return;
  }
  slot.innerHTML = `
    <div class="form-card" style="max-width:none; margin:0 0 20px;">
      <div class="star-input" id="star-input">
        ${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">★</span>`).join('')}
      </div>
      <textarea id="review-comment" placeholder="เขียนความคิดเห็น (ไม่บังคับ)" style="margin-top:10px;"></textarea>
      <button class="btn btn-primary" id="submit-review" style="margin-top:10px;">ส่งรีวิว</button>
      <div id="review-alert"></div>
    </div>
  `;

  const stars = document.querySelectorAll('#star-input span');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      selectedStars = Number(star.dataset.n);
      stars.forEach((s) => s.classList.toggle('active', Number(s.dataset.n) <= selectedStars));
    });
  });

  document.getElementById('submit-review').addEventListener('click', async () => {
    const alertBox = document.getElementById('review-alert');
    if (!selectedStars) {
      alertBox.innerHTML = '<div class="alert alert-error">กรุณาเลือกจำนวนดาว</div>';
      return;
    }
    try {
      await api.postReview({
        packageType: type,
        packageId: id,
        stars: selectedStars,
        comment: document.getElementById('review-comment').value.trim(),
      });
      alertBox.innerHTML = '<div class="alert alert-success">ส่งรีวิวสำเร็จ</div>';
      loadReviews();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

async function loadReviews() {
  const listEl = document.getElementById('reviews-list');
  const { reviews } = await api.reviews(type, id);
  if (reviews.length === 0) {
    listEl.innerHTML = '<p class="faint">ยังไม่มีรีวิว</p>';
    return;
  }
  listEl.innerHTML = reviews.map((r) => `
    <div style="padding:12px 0; border-bottom:1px solid var(--border-soft);">
      <div class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
      <div style="font-weight:600; font-size:0.9rem; margin-top:2px;">${escapeHtml(r.display_name)}</div>
      ${r.comment ? `<p class="muted" style="margin:4px 0 0;">${escapeHtml(r.comment)}</p>` : ''}
    </div>
  `).join('');
}

load();
