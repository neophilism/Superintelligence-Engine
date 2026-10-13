import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runEventRoute} from '../src/run-event-routes.mjs';

const tenant = '00000000-0000-4000-8000-000000000001';
const run = '00000000-0000-4000-8000-000000000002';
const identity = '00000000-0000-4000-8000-000000000003';

async function serve(t, options) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!runEventRoute(req, res, path, options)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const headers = origin => ({'x-sie-product': 'command', 'x-tenant-id': tenant, origin, cookie: 'sie=ok'});

test('replays tenant-authorized events after a durable cursor', async t => {
  let input;
  const options = {
    auth: {session: async () => ({identityId: identity})},
    service: {events: async value => {
      input = value;
      return [{id: 42, type: 'job.succeeded', payload: {nodeId: 'collect'}, createdAt: '2026-10-13T08:00:00.000Z'}];
    }},
    authorizedOrigins: []
  };
  const base = await serve(t, options);
  const origin = new URL(base).origin;
  options.authorizedOrigins.push(origin);
  const response = await fetch(`${base}/v1/runs/${run}/events`, {headers: {...headers(origin), 'last-event-id': '41'}});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /id: 42\nevent: job.succeeded/);
  assert.match(body, /event: replay-end\ndata: {"cursor":42}/);
  assert.deepEqual(input, {tenantId: tenant, runId: run, identityId: identity, after: 41, limit: 200});
});

test('subscribes before replay and delivers a concurrent event once', async t => {
  let publish;
  let unsubscribed = false;
  const options = {
    auth: {session: async () => ({identityId: identity})},
    service: {
      subscribe: async ({onEvent}) => {
        publish = onEvent;
        return () => { unsubscribed = true; };
      },
      events: async () => {
        publish({id: 43, type: 'job.progress', payload: {percent: 50}, createdAt: '2026-10-13T08:00:01.000Z'});
        return [{id: 42, type: 'job.started', payload: {}, createdAt: '2026-10-13T08:00:00.000Z'}];
      }
    },
    authorizedOrigins: []
  };
  const base = await serve(t, options);
  const origin = new URL(base).origin;
  options.authorizedOrigins.push(origin);
  const controller = new AbortController();
  const response = await fetch(`${base}/v1/runs/${run}/events?after=41`, {headers: headers(origin), signal: controller.signal});
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /id: 42[\s\S]*id: 43[\s\S]*replay-end/);
  assert.equal((first.match(/id: 43/g) || []).length, 1);
  await reader.cancel();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(unsubscribed, true);
});

test('fails closed and releases a subscription that errors before replay', async t => {
  let unsubscribed = false;
  const options = {
    auth: {session: async () => ({identityId: identity})},
    service: {
      subscribe: async ({onError}) => {
        onError();
        return () => { unsubscribed = true; };
      },
      events: async () => assert.fail('replay must not start after a subscription error')
    },
    authorizedOrigins: []
  };
  const base = await serve(t, options);
  const origin = new URL(base).origin;
  options.authorizedOrigins.push(origin);
  const response = await fetch(`${base}/v1/runs/${run}/events`, {headers: headers(origin)});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {code: 'run_events_unavailable'});
  assert.equal(unsubscribed, true);
});

test('fails closed for invalid cursors, origins and sessions', async t => {
  let calls = 0;
  const options = {auth: {session: async () => null}, service: {events: async () => { calls++; return []; }}, authorizedOrigins: []};
  const base = await serve(t, options);
  const origin = new URL(base).origin;
  options.authorizedOrigins.push(origin);
  let response = await fetch(`${base}/v1/runs/${run}/events?after=unsafe`, {headers: headers(origin)});
  assert.equal(response.status, 401);
  options.auth = {session: async () => ({identityId: identity})};
  response = await fetch(`${base}/v1/runs/${run}/events?after=unsafe`, {headers: headers(origin)});
  assert.equal(response.status, 400);
  response = await fetch(`${base}/v1/runs/${run}/events`, {headers: headers('https://attacker.invalid')});
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});
