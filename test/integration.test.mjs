import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { makeR2 } from './r2-shim.mjs';

import { handleRegister, handleVerifyEmail, handleLogin, handleMe } from '../src/routes/auth.js';
import { handleSubmit } from '../src/routes/submit.js';
import { handlePending, handleApprove, handleAdminDownload, handleUpdateUser } from '../src/routes/admin.js';
import { handlePostReview, handleGetReviews } from '../src/routes/reviews.js';
import { getUserByEmail } from '../src/db.js';

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

function makeEnv() {
  return {
    DB: makeD1(schema),
    PENDING_BUCKET: makeR2(),
    PUBLIC_BUCKET: makeR2(),
    JWT_SECRET: 'test-secret-do-not-use-in-prod',
    SITE_URL: 'https://store.example.test',
    PUBLIC_FILES_BASE_URL: 'https://files.example.test',
    RESEND_API_KEY: 'unused-in-test',
    EMAIL_FROM: 'noreply@example.test',
  };
}

function makeCtx() {
  const tasks = [];
  return { waitUntil: (p) => tasks.push(p), _flush: () => Promise.all(tasks) };
}

function cookieFrom(response) {
  const setCookie = response.headers.get('Set-Cookie') || '';
  return setCookie.split(';')[0];
}

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed++;
  console.log(`  ok - ${label}`);
}

async function run() {
  const env = makeEnv();
  const ctx = makeCtx();

  console.log('== register -> verify -> login ==');
  {
    const req = new Request('https://x/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse battery', displayName: 'Alice' }),
    });
    const res = await handleRegister(req, env, ctx);
    check('register returns 201', res.status === 201);
    await ctx._flush(); // let the (mocked-away) verification email attempt settle

    const loginTooSoon = await handleLogin(
      new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse battery' }) }),
      env
    );
    check('login before verification is rejected (403)', loginTooSoon.status === 403);

    const user = await getUserByEmail(env.DB, 'alice@example.com');
    const tokenRow = await env.DB.prepare('SELECT token FROM email_verifications WHERE user_id = ?').bind(user.id).first();
    check('a verification token row was created', !!tokenRow);

    const verifyRes = await handleVerifyEmail(new Request(`https://x/api/auth/verify-email?token=${tokenRow.token}`), env);
    check('verify-email succeeds', verifyRes.status === 200);

    const badPw = await handleLogin(
      new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com', password: 'wrong password here' }) }),
      env
    );
    check('login with wrong password is rejected (401)', badPw.status === 401);

    const loginRes = await handleLogin(
      new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse battery' }) }),
      env
    );
    check('login after verification succeeds', loginRes.status === 200);
    global.__aliceCookie = cookieFrom(loginRes);

    const meRes = await handleMe(new Request('https://x/api/me', { headers: { Cookie: global.__aliceCookie } }), env);
    const me = await meRes.json();
    check('session cookie resolves to the right user', me.user && me.user.email === 'alice@example.com');
  }

  console.log('== submit (widget) -> admin approve -> catalog ==');
  {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]); // fake zip header
    const form = new FormData();
    form.set('name', 'Cool Clock');
    form.set('description', 'A clock widget');
    form.set('file', new File([zipBytes], 'cool-clock.gwcw'));

    const submitRes = await handleSubmit(
      new Request('https://x/api/submit/widget', { method: 'POST', headers: { Cookie: global.__aliceCookie }, body: form }),
      env,
      'widget'
    );
    check('widget submit returns 201', submitRes.status === 201);
    const { id: widgetId } = await submitRes.json();

    check('file landed in the PRIVATE pending bucket', env.PENDING_BUCKET._has(`widgets/${widgetId}.gwcw`));
    check('file is NOT in the public bucket yet', !env.PUBLIC_BUCKET._has(`widgets/${widgetId}.gwcw`));

    // register + verify an admin user directly for the test
    await handleRegister(new Request('https://x/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'super secret pw', displayName: 'Admin' }) }), env, ctx);
    await ctx._flush();
    const adminRow = await getUserByEmail(env.DB, 'admin@example.com');
    await env.DB.prepare('UPDATE users SET is_admin = 1, is_email_verified = 1 WHERE id = ?').bind(adminRow.id).run();
    const adminLogin = await handleLogin(new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'super secret pw' }) }), env);
    const adminCookie = cookieFrom(adminLogin);

    const pendingRes = await handlePending(new Request('https://x/api/admin/pending', { headers: { Cookie: adminCookie } }), env);
    const pending = await pendingRes.json();
    check('pending queue lists the widget', pending.widgets.some((w) => w.id === widgetId));

    const nonAdminPending = await handlePending(new Request('https://x/api/admin/pending', { headers: { Cookie: global.__aliceCookie } }), env);
    check('non-admin is refused the pending queue (403)', nonAdminPending.status === 403);

    const dlRes = await handleAdminDownload(new Request('https://x/x', { headers: { Cookie: adminCookie } }), env, 'widget', widgetId);
    check('admin can download the pending file for inspection', dlRes.status === 200);

    const approveRes = await handleApprove(new Request('https://x/x', { method: 'POST', headers: { Cookie: adminCookie } }), env, ctx, 'widget', widgetId);
    check('approve returns approved status', approveRes.status === 200 && (await approveRes.json()).status === 'approved');
    await ctx._flush();

    check('file moved OUT of the pending bucket', !env.PENDING_BUCKET._has(`widgets/${widgetId}.gwcw`));
    check('file moved INTO the public bucket', env.PUBLIC_BUCKET._has(`widgets/${widgetId}.gwcw`));

    const catalogObj = await env.PUBLIC_BUCKET.get('repo/widgets.json');
    check('repo/widgets.json was regenerated', !!catalogObj);
    const catalogBuf = await catalogObj.arrayBuffer();
    const catalog = JSON.parse(new TextDecoder().decode(catalogBuf));
    check('repo/widgets.json lists the approved widget', catalog.widgets.some((w) => w.id === widgetId));

    const themepackCatalogObj = await env.PUBLIC_BUCKET.get('repo/themepacks.json');
    check('repo/themepacks.json was also (re)generated, even with no themepacks yet', !!themepackCatalogObj);

    global.__widgetId = widgetId;
    global.__adminCookie = adminCookie;
  }

  console.log('== reviews + rating trigger ==');
  {
    const widgetId = global.__widgetId;
    const post1 = await handlePostReview(new Request('https://x/api/reviews', { method: 'POST', headers: { Cookie: global.__aliceCookie }, body: JSON.stringify({ packageType: 'widget', packageId: widgetId, stars: 4, comment: 'nice!' }) }), env);
    check('alice can post a review', post1.status === 200);

    const listRes = await handleGetReviews(new Request('https://x/x'), env, 'widget', widgetId);
    const { reviews } = await listRes.json();
    check('review appears in listing', reviews.length === 1 && reviews[0].stars === 4);

    const pkgRow = await env.DB.prepare('SELECT avg_rating, rating_count FROM widgets WHERE id = ?').bind(widgetId).first();
    check('trigger updated avg_rating/rating_count', pkgRow.avg_rating === 4 && pkgRow.rating_count === 1);
  }

  console.log('== admin ban blocks further action ==');
  {
    const aliceRow = await getUserByEmail(env.DB, 'alice@example.com');
    const banRes = await handleUpdateUser(new Request('https://x/x', { method: 'PATCH', headers: { Cookie: global.__adminCookie }, body: JSON.stringify({ isBanned: true }) }), env, aliceRow.id);
    check('admin ban call succeeds', banRes.status === 200);

    const form = new FormData();
    form.set('name', 'Second Widget');
    form.set('file', new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'x.gwcw'));
    const blockedSubmit = await handleSubmit(new Request('https://x/api/submit/widget', { method: 'POST', headers: { Cookie: global.__aliceCookie }, body: form }), env, 'widget');
    check('banned user is blocked from submitting even with a still-valid cookie (403)', blockedSubmit.status === 403);
  }

  console.log(`\nAll ${passed} checks passed.`);
}

run().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
