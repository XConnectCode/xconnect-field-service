/**
 * slack-intake.tsx
 *
 * Slack → FST incident intake (Phase 1). Exposes `slackIntakeRoutes`, a Hono
 * router mounted on the existing `make-server-64775d98` app at the
 * `/make-server-64775d98` prefix (so the routes below are relative).
 *
 * Flow:
 *   1. A `:XC:` reaction in channel SLACK_INCIDENT_CHANNEL fires a
 *      `reaction_added` event → /slack/events. Reaction events carry no
 *      trigger_id, so we post an ephemeral "Log Incident" button to the
 *      reacting user.
 *   2. The button click (block_actions) carries a trigger_id → we open the
 *      incident modal via views.open → /slack/interactions.
 *   3. Modal submit (view_submission) inserts a row into fst_app.incidents
 *      with the next sequential event_id and status 'New'.
 *
 * Auth = Slack HMAC v0 signature verification (no requireUser gate). Ported
 * from netlify/functions/_slack-bridge/verifySlackSignature.js.
 */

import { Hono } from 'npm:hono';
import { createClient } from 'npm:@supabase/supabase-js@2.49.2';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const FIVE_MINUTES_SECONDS = 60 * 5;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'fst_app' },
  },
);

// ── Slack API helper ─────────────────────────────────────────────────────────

async function slackApi(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch('https://slack.com/api/' + method, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (Deno.env.get('SLACK_BOT_TOKEN') ?? ''),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error(`Slack API ${method} failed:`, json.error);
  }
  return json;
}

async function slackGetPermalink(channel: string, messageTs: string): Promise<string | null> {
  const url =
    'https://slack.com/api/chat.getPermalink?channel=' +
    encodeURIComponent(channel) +
    '&message_ts=' +
    encodeURIComponent(messageTs);
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + (Deno.env.get('SLACK_BOT_TOKEN') ?? '') },
  });
  const json = await res.json();
  if (!json.ok) {
    console.error('Slack chat.getPermalink failed:', json.error);
    return null;
  }
  return json.permalink ?? null;
}

// ── Signature verification ───────────────────────────────────────────────────

function verifySlackSignature(c: any, raw: string): boolean {
  const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET') ?? '';
  const timestamp = c.req.header('x-slack-request-timestamp');
  const signature = c.req.header('x-slack-signature');

  if (!signingSecret || !timestamp || !signature || raw == null) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skewSeconds > FIVE_MINUTES_SECONDS) return false;

  const baseString = `v0:${timestamp}:${raw}`;
  const expected =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Modal option enums ───────────────────────────────────────────────────────

const PRODUCT_LINES = [
  'mRAIL', 'XC 2.75"', 'XC', 'DSX', 'RAIL', 'LynX',
  'ReConnect', 'Haptix', 'XC Oriented', 'DSX2', 'ZZSmokeTemp', '3rd Party',
];
const SEVERITIES = ['Low', 'Moderate', 'Critical', 'Pending'];
const EVENT_CATEGORIES = [
  'Misfire', 'Misrun', 'Released/Fished', 'Other',
  'Shot Spare Gun', 'Surface', 'Caught by field personnel',
];
const XC_CAUSED = ['Yes', 'No', 'Inconclusive', 'N/A', 'Pending Investigation'];

function plainOption(text: string, value: string) {
  return { text: { type: 'plain_text', text: text.slice(0, 75) }, value };
}

function staticOptions(values: string[]) {
  return values.map((v) => plainOption(v, v));
}

// ── Build the incident modal view ────────────────────────────────────────────

async function buildModalView(privateMetadata: string): Promise<any> {
  // Districts: build "<customer_name> — <customer_district>", value = row_id.
  const { data: districts, error: dErr } = await supabase
    .from('districts')
    .select('row_id, customer_district, customer_name');
  if (dErr) console.error('districts query failed:', dErr.message);

  const districtOptions = (districts ?? [])
    .map((d: any) => ({
      text: `${d.customer_name ?? ''} — ${d.customer_district ?? ''}`,
      value: String(d.row_id),
    }))
    .sort((a: any, b: any) => a.text.localeCompare(b.text))
    .slice(0, 100)
    .map((o: any) => plainOption(o.text, o.value));

  const today = new Date().toISOString().slice(0, 10);

  return {
    type: 'modal',
    callback_id: 'incident_intake',
    private_metadata: privateMetadata,
    title: { type: 'plain_text', text: 'Log Incident' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'customer_district',
        label: { type: 'plain_text', text: 'Customer — District' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select district' },
          options: districtOptions,
        },
      },
      {
        type: 'input',
        block_id: 'operating_company',
        label: { type: 'plain_text', text: 'Operating Company' },
        element: {
          type: 'external_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select operating company' },
          min_query_length: 0,
        },
      },
      {
        type: 'input',
        block_id: 'product_line',
        label: { type: 'plain_text', text: 'Product Line' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select product line' },
          options: staticOptions(PRODUCT_LINES),
        },
      },
      {
        type: 'input',
        block_id: 'incident_severity',
        label: { type: 'plain_text', text: 'Severity' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select severity' },
          options: staticOptions(SEVERITIES),
        },
      },
      {
        type: 'input',
        block_id: 'event_category',
        label: { type: 'plain_text', text: 'Event Category' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select event category' },
          options: staticOptions(EVENT_CATEGORIES),
        },
      },
      {
        type: 'input',
        block_id: 'xc_caused',
        label: { type: 'plain_text', text: 'XC Caused' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select' },
          options: staticOptions(XC_CAUSED),
        },
      },
      {
        type: 'input',
        block_id: 'date_incident',
        label: { type: 'plain_text', text: 'Incident Date' },
        element: {
          type: 'datepicker',
          action_id: 'value',
          initial_date: today,
        },
      },
      {
        type: 'input',
        block_id: 'well_name',
        optional: true,
        label: { type: 'plain_text', text: 'Well Name' },
        element: { type: 'plain_text_input', action_id: 'value' },
      },
      {
        type: 'input',
        block_id: 'stage_number',
        optional: true,
        label: { type: 'plain_text', text: 'Stage #' },
        element: { type: 'plain_text_input', action_id: 'value' },
      },
      {
        type: 'input',
        block_id: 'incident_description',
        optional: true,
        label: { type: 'plain_text', text: 'Description' },
        element: { type: 'plain_text_input', action_id: 'value', multiline: true },
      },
    ],
  };
}

// ── Value extraction helpers (view_submission state) ─────────────────────────

function selectValue(values: any, blockId: string): string | undefined {
  return values?.[blockId]?.value?.selected_option?.value;
}
function dateValue(values: any, blockId: string): string | undefined {
  return values?.[blockId]?.value?.selected_date;
}
function textValue(values: any, blockId: string): string | undefined {
  const v = values?.[blockId]?.value?.value;
  return v && String(v).trim().length > 0 ? v : undefined;
}

// ── Sequential event_id resolution ───────────────────────────────────────────

async function nextEventId(): Promise<number> {
  const { data, error } = await supabase.from('incidents').select('event_id');
  if (error) {
    console.error('event_id query failed:', error.message);
    return 1;
  }
  let max = 0;
  for (const row of data ?? []) {
    const n = parseInt(String((row as any).event_id), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const slackIntakeRoutes = new Hono();

slackIntakeRoutes.post('/slack/events', async (c) => {
  const raw = await c.req.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ ok: true });
  }

  if (!verifySlackSignature(c, raw)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback') {
    return c.json({ ok: true });
  }

  const ev = payload.event;
  if (
    ev?.type === 'reaction_added' &&
    ev.reaction === 'XC' &&
    ev.item?.channel === Deno.env.get('SLACK_INCIDENT_CHANNEL')
  ) {
    const channel = ev.item.channel;
    const messageTs = ev.item.ts;
    const reactor = ev.user;
    const permalink = await slackGetPermalink(channel, messageTs);

    const value = JSON.stringify({ channel, message_ts: messageTs, permalink, reactor });

    await slackApi('chat.postEphemeral', {
      channel,
      user: reactor,
      text: 'Log this message as an FST incident?',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*Log this message as an FST incident?*' },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'open_incident_modal',
              style: 'primary',
              text: { type: 'plain_text', text: 'Log Incident' },
              value,
            },
          ],
        },
      ],
    });
  }

  return c.json({ ok: true });
});

slackIntakeRoutes.post('/slack/interactions', async (c) => {
  const raw = await c.req.text();
  if (!verifySlackSignature(c, raw)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const params = new URLSearchParams(raw);
  const payload = JSON.parse(params.get('payload') ?? '{}');

  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    if (action?.action_id === 'open_incident_modal') {
      let ctx: any = {};
      try {
        ctx = JSON.parse(action.value ?? '{}');
      } catch { /* ignore */ }
      const privateMetadata = JSON.stringify({
        channel: ctx.channel,
        message_ts: ctx.message_ts,
        permalink: ctx.permalink,
        reactor: ctx.reactor,
      });
      const view = await buildModalView(privateMetadata);
      await slackApi('views.open', { trigger_id: payload.trigger_id, view });
    }
    return c.body(null, 200);
  }

  if (payload.type === 'view_submission') {
    const values = payload.view?.state?.values;
    let meta: any = {};
    try {
      meta = JSON.parse(payload.view?.private_metadata ?? '{}');
    } catch { /* ignore */ }

    const districtRowId = selectValue(values, 'customer_district');
    const operatingCompany = selectValue(values, 'operating_company');
    const productLine = selectValue(values, 'product_line');
    const severity = selectValue(values, 'incident_severity');
    const eventCategory = selectValue(values, 'event_category');
    const xcCaused = selectValue(values, 'xc_caused');
    const dateIncident = dateValue(values, 'date_incident');
    const wellName = textValue(values, 'well_name');
    const stageNumber = textValue(values, 'stage_number');
    const description = textValue(values, 'incident_description');

    if (!districtRowId) {
      return c.json({
        response_action: 'errors',
        errors: { customer_district: 'Please select a district.' },
      });
    }

    // Resolve parent customer (row_id) from chosen district.
    const { data: districtRow, error: dErr } = await supabase
      .from('districts')
      .select('row_id, customer')
      .eq('row_id', districtRowId)
      .single();
    if (dErr || !districtRow) {
      return c.json({
        response_action: 'errors',
        errors: { customer_district: 'Could not resolve the selected district.' },
      });
    }

    const reporter = payload.user?.name ?? payload.user?.username ?? null;

    const baseRow: Record<string, unknown> = {
      incident_status: 'New',
      customer: (districtRow as any).customer,
      customer_district: (districtRow as any).row_id,
      operating_company: operatingCompany,
      product_line: productLine,
      incident_severity: severity,
      event_category: eventCategory,
      xc_caused: xcCaused,
      date_incident: dateIncident,
      well_name: wellName,
      stage_number: stageNumber,
      incident_description: description,
      xc_rep: reporter,
      slack_channel: meta.channel,
      slack_ts: meta.message_ts,
      slack_url: meta.permalink,
    };

    let candidate = await nextEventId();
    let inserted: any = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('incidents')
        .insert({ ...baseRow, event_id: String(candidate) })
        .select()
        .single();
      if (!error) {
        inserted = data;
        break;
      }
      lastError = error;
      if (error.code === '23505') {
        candidate += 1; // unique-violation on event_id → bump and retry
        continue;
      }
      break;
    }

    if (!inserted) {
      console.error('incident insert failed:', lastError?.message, lastError?.code);
      const field =
        lastError?.code === '23502'
          ? 'customer_district'
          : 'customer_district';
      return c.json({
        response_action: 'errors',
        errors: { [field]: 'Failed to create incident: ' + (lastError?.message ?? 'unknown error') },
      });
    }

    // Nice-to-have: confirmation in the source thread.
    if (meta.channel && meta.message_ts) {
      await slackApi('chat.postMessage', {
        channel: meta.channel,
        thread_ts: meta.message_ts,
        text: `Incident ${inserted.event_id} logged to FST.`,
      });
    }

    return c.json({ response_action: 'clear' });
  }

  return c.body(null, 200);
});

slackIntakeRoutes.post('/slack/options', async (c) => {
  const raw = await c.req.text();
  if (!verifySlackSignature(c, raw)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const params = new URLSearchParams(raw);
  const payload = JSON.parse(params.get('payload') ?? '{}');
  const query = String(payload.value ?? '');

  let q = supabase.from('ep').select('operating_company');
  if (query.trim().length > 0) {
    q = q.ilike('operating_company', `%${query}%`);
  }
  const { data, error } = await q.limit(100);
  if (error) {
    console.error('ep options query failed:', error.message);
    return c.json({ options: [] });
  }

  const options = (data ?? [])
    .map((r: any) => r.operating_company)
    .filter((name: any) => typeof name === 'string' && name.length > 0)
    .map((name: string) => plainOption(name, name));

  return c.json({ options });
});
