import { Resend } from 'resend';
import { promises as dns } from 'node:dns';

// Receives the case-study gate form: checks the name and email, then emails
// Dante who unlocked the case studies. The page unlocks when this returns ok.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CASES = {
  'case-teamshares-payroll': 'Teamshares Payroll',
  'case-teamshares-ats': 'Teamshares ATS',
  'case-marketo-sky': 'Marketo Sky',
  'case-marketo-migration': 'Marketo Migration',
  'case-meroxa': 'Meroxa',
};

// A domain that can't receive mail means the address isn't real. A slow DNS
// lookup doesn't block anyone.
async function domainTakesMail(domain) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000));
  const lookup = (async () => {
    try {
      return (await dns.resolveMx(domain)).length > 0;
    } catch {
      try {
        return (await dns.resolve4(domain)).length > 0;
      } catch {
        return false;
      }
    }
  })();
  const result = await Promise.race([lookup, timeout]);
  return result === 'timeout' ? true : result;
}

const clean = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  // Honeypot: bots fill the hidden field. Pretend it worked and send nothing.
  if (clean(body.company, 200)) return res.status(200).json({ ok: true });

  const name = clean(body.name, 100);
  const email = clean(body.email, 254).toLowerCase();
  if (!name) return res.status(400).json({ ok: false, error: 'invalid_name' });
  if (!EMAIL_RE.test(email) || !(await domainTakesMail(email.split('@')[1]))) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('unlock: RESEND_API_KEY is not set');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  const caseName = CASES[body.case] || 'a case study';
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'ldanteguarin.com <onboarding@resend.dev>',
    to: 'hello@ldante.com',
    replyTo: email,
    subject: `${name} unlocked your case studies`,
    text: [
      `${name} (${email}) just unlocked the case studies on ldanteguarin.com.`,
      '',
      `They were on: ${caseName}`,
      `When: ${when} (Pacific)`,
      `Came from: ${clean(req.headers.referer, 300) || 'unknown'}`,
      '',
      'Reply to this email to reach them directly.',
    ].join('\n'),
  });
  if (error) {
    console.error('unlock: resend failed', error);
    return res.status(502).json({ ok: false, error: 'send_failed' });
  }
  return res.status(200).json({ ok: true });
}
