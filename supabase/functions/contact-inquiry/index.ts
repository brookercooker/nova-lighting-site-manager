import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';
import { validSalesTaxCertPath } from './validation.ts';

// Showroom → inbox routing. "No preference" routes to Orem.
const SHOWROOM_INBOXES: Record<string, string> = {
  'No preference': 'orem@novalighting.com',
  Orem: 'orem@novalighting.com',
  Sandy: 'sandy@novalighting.com',
  'Heber City': 'heber@novalighting.com',
  Midvale: 'midvale@novalighting.com',
  Layton: 'layton@novalighting.com',
  'St. George': 'stgeorge@novalighting.com',
};

// Trade & builder account requests route here, regardless of showroom.
const TRADE_INBOX = 'Perry@novalighting.com';

const BodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(30).optional().default(''),
  showroom: z.string().trim().max(50),
  message: z.string().trim().min(1).max(1000),
  inquiryType: z.enum(['general', 'trade']).optional().default('general'),
  company: z.string().trim().max(120).optional().default(''),
  tradeRole: z.string().trim().max(60).optional().default(''),
  projectScale: z.string().trim().max(60).optional().default(''),
  address: z.string().trim().max(200).optional().default(''),
  taxId: z.string().trim().max(40).optional().default(''),
  taxExempt: z.boolean().optional().default(false),
  salesTaxCertPath: z.string().refine(validSalesTaxCertPath, "Invalid certificate path").nullable().optional().default(null),
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const raw = await req.json();

    // Anonymous visitors never write to storage directly: the server picks the
    // path and returns a one-time signed upload token for the private bucket.
    if (raw && typeof raw === 'object' && raw.action === 'cert-upload-url') {
      const ext = String(raw.ext ?? '').toLowerCase();
      if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext)) {
        return json({ error: 'Unsupported file type' }, 400);
      }
      const safeCompany = String(raw.company ?? 'trade')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'trade';
      const path = `${new Date().toISOString().slice(0, 10)}/${safeCompany}-${crypto.randomUUID()}.${ext}`;
      const url = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !serviceKey) return json({ error: 'Upload unavailable' }, 500);
      const res = await fetch(`${url}/storage/v1/object/upload/sign/trade-documents/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: '{}',
      });
      if (!res.ok) return json({ error: 'Upload unavailable' }, 500);
      const { url: signed } = await res.json();
      const token = new URL(signed, url).searchParams.get('token');
      if (!token) return json({ error: 'Upload unavailable' }, 500);
      return json({ path, token });
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }

    const {
      name,
      email,
      phone,
      showroom,
      message,
      inquiryType,
      company,
      tradeRole,
      projectScale,
      address,
      taxId,
      taxExempt,
      salesTaxCertPath,
    } = parsed.data;
    const isTrade = inquiryType === 'trade';
    // Trade account requests bypass showroom routing — they all go to the
    // trade desk, with the preferred showroom carried through in the body.
    const to = isTrade
      ? TRADE_INBOX
      : (SHOWROOM_INBOXES[showroom] ?? SHOWROOM_INBOXES['No preference']);

    // Certificates live in a private bucket — hand the trade desk a signed link.
    let certLink: string | null = null;
    if (isTrade && salesTaxCertPath) {
      const url = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (url && serviceKey) {
        try {
          const res = await fetch(
            `${url}/storage/v1/object/sign/trade-documents/${salesTaxCertPath}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 }),
            },
          );
          if (res.ok) {
            const { signedURL, signedUrl } = await res.json();
            const path = signedUrl ?? signedURL;
            if (path) certLink = `${url}/storage/v1${path.startsWith('/') ? '' : '/'}${path}`;
          }
        } catch (_err) {
          certLink = null;
        }
      }
    }

    const showroomLabel = showroom === 'No preference' ? 'No showroom preference' : showroom;
    const subject = isTrade
      ? `Trade account request — ${company || name} (${showroomLabel})`
      : `New website inquiry — ${showroomLabel}`;
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; color:#212121; line-height:1.6;">
        <h2 style="font-weight:400; margin:0 0 16px;">${isTrade ? 'Trade account request' : 'New website inquiry'}</h2>
        <p style="margin:0 0 4px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p style="margin:0 0 4px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${phone ? `<p style="margin:0 0 4px;"><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
        ${isTrade && company ? `<p style="margin:0 0 4px;"><strong>Company:</strong> ${escapeHtml(company)}</p>` : ''}
        ${isTrade && address ? `<p style="margin:0 0 4px;"><strong>Address:</strong> ${escapeHtml(address)}</p>` : ''}
        ${isTrade && taxId ? `<p style="margin:0 0 4px;"><strong>Tax ID:</strong> ${escapeHtml(taxId)}</p>` : ''}
        ${isTrade ? `<p style="margin:0 0 4px;"><strong>Tax-exempt:</strong> ${taxExempt ? 'Yes' : 'No'}</p>` : ''}
        ${
          isTrade && salesTaxCertPath
            ? `<p style="margin:0 0 4px;"><strong>Sales tax certificate:</strong> ${
                certLink
                  ? `<a href="${escapeHtml(certLink)}">Download (link valid 30 days)</a>`
                  : escapeHtml(salesTaxCertPath)
              }</p>`
            : ''
        }
        ${isTrade && tradeRole ? `<p style="margin:0 0 4px;"><strong>Role:</strong> ${escapeHtml(tradeRole)}</p>` : ''}
        ${isTrade && projectScale ? `<p style="margin:0 0 4px;"><strong>Project volume:</strong> ${escapeHtml(projectScale)}</p>` : ''}
        <p style="margin:0 0 16px;"><strong>Preferred showroom:</strong> ${escapeHtml(showroom)}</p>
        <p style="margin:0 0 4px;"><strong>Message</strong></p>
        <p style="margin:0; white-space:pre-wrap;">${escapeHtml(message)}</p>
      </div>
    `;

    // Delivery is handled by the project's transactional email function once a
    // sender domain is verified. Until then the inquiry is logged with its
    // resolved destination so nothing is silently lost.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    let delivered = false;
    let deliveryError: string | null = null;

    if (supabaseUrl && anonKey) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ to, subject, html, reply_to: email }),
        });
        if (res.ok) {
          delivered = true;
        } else {
          deliveryError = `[${res.status}] ${await res.text()}`;
        }
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : String(err);
      }
    }

    // Also capture the contact in Mailchimp, tagged "contact us".
    // Only name, phone, and email are recorded.
    let mailchimp = false;
    let mailchimpError: string | null = null;
    if (supabaseUrl && anonKey) {
      try {
        const [firstName, ...rest] = name.split(/\s+/);
        const res = await fetch(`${supabaseUrl}/functions/v1/mailchimp-subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            email,
            firstName,
            lastName: rest.join(' '),
            phone,
            tags: ['contact us'],
          }),
        });
        if (res.ok) {
          mailchimp = true;
        } else {
          mailchimpError = `[${res.status}] ${await res.text()}`;
        }
      } catch (err) {
        mailchimpError = err instanceof Error ? err.message : String(err);
      }
    }

    console.log(
      JSON.stringify({
        event: 'contact_inquiry',
        routed_to: to,
        showroom,
        inquiry_type: inquiryType,
        from: email,
        delivered,
        deliveryError,
        mailchimp,
        mailchimpError,
      }),
    );

    return json({ ok: true, delivered, mailchimp });

  } catch (err) {
    console.error('contact-inquiry failed:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
