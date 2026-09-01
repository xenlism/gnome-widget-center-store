import { handleRegister, handleVerifyEmail, handleLogin, handleLogout, handleMe } from './routes/auth.js';
import { handleSubmit } from './routes/submit.js';
import {
  handlePending, handleAdminDownload, handleApprove, handleReject,
  handleListUsers, handleCreateUser, handleUpdateUser, handleRemoveUser,
  handleDeleteReview,
} from './routes/admin.js';
import { handlePostReview, handleGetReviews } from './routes/reviews.js';
import { error, json } from './utils/response.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === '/api/health') return json({ ok: true });

      // --- auth ---
      if (pathname === '/api/auth/register' && method === 'POST') return handleRegister(request, env, ctx);
      if (pathname === '/api/auth/verify-email' && method === 'GET') return handleVerifyEmail(request, env);
      if (pathname === '/api/auth/login' && method === 'POST') return handleLogin(request, env);
      if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout();
      if (pathname === '/api/me' && method === 'GET') return handleMe(request, env);

      // --- submissions ---
      const submitMatch = pathname.match(/^\/api\/submit\/(widget|themepack)$/);
      if (submitMatch && method === 'POST') return handleSubmit(request, env, submitMatch[1]);

      // --- admin: review queue ---
      if (pathname === '/api/admin/pending' && method === 'GET') return handlePending(request, env);

      const downloadMatch = pathname.match(/^\/api\/admin\/(widget|themepack)\/([^/]+)\/download$/);
      if (downloadMatch && method === 'GET') {
        return handleAdminDownload(request, env, downloadMatch[1], decodeURIComponent(downloadMatch[2]));
      }

      const approveMatch = pathname.match(/^\/api\/admin\/(widget|themepack)\/([^/]+)\/approve$/);
      if (approveMatch && method === 'POST') {
        return handleApprove(request, env, ctx, approveMatch[1], decodeURIComponent(approveMatch[2]));
      }

      const rejectMatch = pathname.match(/^\/api\/admin\/(widget|themepack)\/([^/]+)\/reject$/);
      if (rejectMatch && method === 'POST') {
        return handleReject(request, env, rejectMatch[1], decodeURIComponent(rejectMatch[2]));
      }

      // --- admin: user management ---
      if (pathname === '/api/admin/users' && method === 'GET') return handleListUsers(request, env);
      if (pathname === '/api/admin/users' && method === 'POST') return handleCreateUser(request, env);

      const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
      if (userMatch && method === 'PATCH') return handleUpdateUser(request, env, Number(userMatch[1]));
      if (userMatch && method === 'DELETE') return handleRemoveUser(request, env, Number(userMatch[1]));

      // --- admin: review moderation ---
      const reviewDeleteMatch = pathname.match(/^\/api\/admin\/reviews\/(\d+)$/);
      if (reviewDeleteMatch && method === 'DELETE') {
        return handleDeleteReview(request, env, Number(reviewDeleteMatch[1]));
      }

      // --- reviews (public) ---
      if (pathname === '/api/reviews' && method === 'POST') return handlePostReview(request, env);

      const reviewsGetMatch = pathname.match(/^\/api\/reviews\/(widget|themepack)\/([^/]+)$/);
      if (reviewsGetMatch && method === 'GET') {
        return handleGetReviews(request, env, reviewsGetMatch[1], decodeURIComponent(reviewsGetMatch[2]));
      }

      return error('not found', 404);
    } catch (err) {
      console.error(err);
      return error('internal error', 500);
    }
  },

  async scheduled(event, env, ctx) {
    // TODO: aggregate download counts from Analytics Engine into D1.
    // Left as a stub — real downloads bypass this Worker entirely (they
    // hit R2's public custom domain directly), so there is nothing to
    // wire up here until an Analytics Engine dataset + GraphQL query is
    // added. See the note at the bottom of migrations/0001_init.sql.
    console.log('scheduled: no-op (download_count aggregation not yet implemented)');
  },
};
