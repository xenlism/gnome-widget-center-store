// Sends transactional email via Resend's HTTP API (plain fetch, no SDK).
//
// Why Resend and not "the free Cloudflare way": MailChannels used to let
// Workers send email for free with zero signup, but that ended on
// 2024-08-31. Cloudflare's own Email Service (public beta) requires the
// $5/mo Workers Paid plan after a small included quota, which breaks the
// free-tier-only goal. Resend's free plan (3,000 emails/month) has no
// paid-plan prerequisite and is a single fetch() call — so it's the best
// fit here. Re-check pricing before relying on this long-term; email
// provider free tiers change.
//
// Requires secrets: RESEND_API_KEY (wrangler secret put RESEND_API_KEY)
// and a var: EMAIL_FROM (a verified sender on your Resend domain).

export async function sendVerificationEmail(env, toEmail, token) {
  const verifyUrl = `${env.SITE_URL}/verify.html?token=${encodeURIComponent(token)}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: toEmail,
      subject: 'ยืนยันอีเมลของคุณ — GNOME Widget Center Store',
      html: `
        <p>สวัสดี,</p>
        <p>กดลิงก์ด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานบัญชีของคุณ:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>ลิงก์นี้จะหมดอายุใน 24 ชั่วโมง หากคุณไม่ได้สมัครสมาชิก สามารถละเว้นอีเมลนี้ได้</p>
      `,
    }),
  });

  if (!res.ok) {
    // Don't throw — a failed verification email shouldn't 500 the register
    // request (the account already exists; the user can request a resend
    // later). Log for operator visibility instead.
    console.error('sendVerificationEmail failed', res.status, await res.text());
  }
}
