const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function status(error) {
  if (error?.code === 'not_found') return 404;
  if (['invalid_cursor', 'invalid_limit'].includes(error?.code)) return 400;
  return 503;
}

function cursor(req) {
  const value = req.headers['last-event-id'] ?? new URL(req.url || '/', 'http://localhost').searchParams.get('after') ?? '0';
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw Object.assign(new Error('invalid_cursor'), {code: 'invalid_cursor'});
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw Object.assign(new Error('invalid_cursor'), {code: 'invalid_cursor'});
  return parsed;
}

function eventName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : 'run.event';
}

function formatEvent(entry) {
  return `id: ${entry.id}\nevent: ${eventName(entry.type)}\ndata: ${JSON.stringify({payload: entry.payload, createdAt: entry.createdAt})}\n\n`;
}

/** Bounded authenticated SIE-017 replay with optional injected live fanout. */
export function runEventRoute(req, res, pathname, {auth, service, authorizedOrigins = []} = {}) {
  const match = /^\/v1\/runs\/([0-9a-f-]{36})\/events$/.exec(pathname);
  if (!match) return false;
  if (req.method !== 'GET') {
    reply(res, 405, {code: 'method_not_allowed'});
    return true;
  }
  if (!auth || !service || typeof service.events !== 'function') {
    reply(res, 503, {code: 'run_events_unconfigured'});
    return true;
  }
  const product = req.headers['x-sie-product'];
  const tenantId = req.headers['x-tenant-id'];
  const origin = req.headers.origin;
  if (!['academy', 'command'].includes(product) || typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    reply(res, 401, {code: 'identity_scope_required'});
    return true;
  }
  if (!origin || !authorizedOrigins.includes(origin)) {
    reply(res, 403, {code: 'origin_not_allowed'});
    return true;
  }

  (async () => {
    const session = await auth.session({product, cookieHeader: req.headers.cookie || ''});
    if (!session) throw Object.assign(new Error('authentication_required'), {code: 'authentication_required'});

    const after = cursor(req);
    const scope = {tenantId, runId: match[1], identityId: session.identityId};
    const pending = [];
    let replaying = true;
    let next = after;
    let closed = false;
    let unsubscribe;

    const close = () => {
      if (closed) return;
      closed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    res.once('close', close);

    const emit = entry => {
      if (closed || !Number.isSafeInteger(entry?.id) || entry.id <= next) return;
      if (replaying) {
        pending.push(entry);
        return;
      }
      next = entry.id;
      res.write(formatEvent(entry));
    };

    if (typeof service.subscribe === 'function') {
      unsubscribe = await service.subscribe({...scope, after, onEvent: emit, onError: () => {
        if (!closed) res.end('event: error\ndata: {"code":"run_events_unavailable"}\n\n');
        close();
      }});
      if (closed && typeof unsubscribe === 'function') unsubscribe();
    }

    const events = await service.events({...scope, after, limit: 200});
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Connection': 'keep-alive'
    });
    for (const entry of events) emit(entry);
    replaying = false;
    pending.sort((left, right) => left.id - right.id);
    for (const entry of pending) emit(entry);
    res.write(`event: replay-end\ndata: ${JSON.stringify({cursor: next})}\n\n`);

    if (typeof service.subscribe !== 'function') {
      close();
      res.end();
    }
  })().catch(error => {
    if (res.headersSent) res.end('event: error\ndata: {"code":"run_events_unavailable"}\n\n');
    else if (error?.code === 'authentication_required') reply(res, 401, {code: 'authentication_required'});
    else reply(res, status(error), {code: ['not_found', 'invalid_cursor', 'invalid_limit'].includes(error?.code) ? error.code : 'run_events_unavailable'});
  });
  return true;
}
