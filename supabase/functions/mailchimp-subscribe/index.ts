import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createHash } from 'node:crypto';
import { allowedTags, buildMergeFields, isMemberExists } from './rules.ts';

interface SubscribeBody {
  email: string;
  audienceId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  tags?: string[];
  mergeFields?: Record<string, unknown>;
}

const DEFAULT_AUDIENCE_ID = '710b75abb6';
const GENERIC_ERROR = 'Could not subscribe right now.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('MAILCHIMP_API_KEY');
    if (!apiKey) {
      console.error('MAILCHIMP_API_KEY is not configured');
      return json({ error: GENERIC_ERROR }, 502);
    }
    const dashIdx = apiKey.lastIndexOf('-');
    if (dashIdx === -1) {
      console.error('Invalid Mailchimp API key format');
      return json({ error: GENERIC_ERROR }, 502);
    }
    const serverPrefix = apiKey.slice(dashIdx + 1);

    let body: SubscribeBody;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const email = (body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return json({ error: 'A valid email is required' }, 400);
    }

    // Audience is fixed server-side; request audienceId/mergeFields are ignored.
    const audienceId = DEFAULT_AUDIENCE_ID;
    const merge_fields = buildMergeFields(body as unknown as Record<string, unknown>);
    const tags = allowedTags(body.tags);

    const subscriberHash = createHash('md5').update(email).digest('hex');
    const authHeader = `Basic ${btoa(`anystring:${apiKey}`)}`;
    const listUrl = `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}`;
    const url = `${listUrl}/members/${subscriberHash}`;

    // Auto-fill required merge fields with placeholders so legacy required custom
    // fields (leftover from old Mailchimp forms) don't block API signups.
    try {
      const mfRes = await fetch(
        `${listUrl}/merge-fields?count=100&fields=merge_fields.tag,merge_fields.type,merge_fields.required,merge_fields.options`,
        { headers: { Authorization: authHeader } },
      );
      if (mfRes.ok) {
        const mfData = await mfRes.json();
        for (const f of mfData.merge_fields || []) {
          if (!f.required) continue;
          if (merge_fields[f.tag] !== undefined && merge_fields[f.tag] !== '') continue;
          if (f.type === 'dropdown' || f.type === 'radio') {
            const first = f.options?.choices?.[0];
            if (first) merge_fields[f.tag] = first;
          } else if (f.type === 'number') {
            merge_fields[f.tag] = 0;
          } else if (f.type === 'address') {
            merge_fields[f.tag] = { addr1: 'N/A', city: '-', state: '-', zip: '-', country: 'US' };
          } else {
            merge_fields[f.tag] = 'N/A';
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch merge fields; proceeding without auto-fill', e);
    }

    // POST adds brand-new people only, as pending (double opt-in).
    const mcRes = await fetch(`${listUrl}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ email_address: email, status: 'pending', merge_fields }),
    });
    const mcData = await mcRes.json().catch(() => ({}));

    if (!mcRes.ok) {
      // Existing members are left untouched (no field or tag changes).
      if (isMemberExists(mcRes.status, mcData)) return json({ success: true });
      console.error('Mailchimp error', mcRes.status, mcData);
      return json({ error: GENERIC_ERROR }, 502);
    }

    if (tags.length > 0) {
      const tagsRes = await fetch(`${url}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ tags: tags.map((name) => ({ name, status: 'active' })) }),
      });
      if (!tagsRes.ok) {
        const tagsErr = await tagsRes.json().catch(() => ({}));
        console.error('Mailchimp tag error', tagsRes.status, tagsErr);
      }
    }

    return json({ success: true });
  } catch (err) {
    console.error('mailchimp-subscribe unexpected error', err);
    return json({ error: GENERIC_ERROR }, 502);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
