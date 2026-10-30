import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(new URL('../dist/mcp.js', import.meta.url))

function exchange(...messages) {
  const input = messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n'
  const run = spawnSync(process.execPath, [server], { input, env: { ...process.env, ER_API_KEY: 'test' }, encoding: 'utf8' })
  return run.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

test('mcp: initialize, tools/list, notifications get no reply', () => {
  const replies = exchange(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  )
  assert.equal(replies.length, 2)
  assert.equal(replies[0].result.protocolVersion, '2025-06-18')
  assert.deepEqual(replies[1].result.tools.map((t) => t.name), ['player_profile', 'game_detail', 'top_ranks'])
})

test('mcp: malformed requests get errors, never a silent drop', () => {
  const byId = new Map(exchange(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'constructor' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'top_ranks', arguments: 123 } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'player_profile', arguments: { nickname: 'x', games: null } } },
    { jsonrpc: '2.0', id: 4, method: 'nope' },
  ).map((r) => [r.id, r]))
  assert.equal(byId.get(1).error.code, -32602)
  assert.equal(byId.get(2).error.code, -32602)
  assert.equal(byId.get(3).result.isError, true)
  assert.equal(byId.get(4).error.code, -32601)
  const invalid = exchange('not json', { id: 5, method: 'ping' }, { jsonrpc: '2.0', id: null, method: 'ping' })
  assert.deepEqual(invalid.map((r) => [r.id, r.error.code]), [[null, -32700], [null, -32600], [null, -32600]])
})
