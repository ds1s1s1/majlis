'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Host } = require('../src/main/host');

// the vote methods on a bare host: no network, two guests in the room
function room() {
  const h = Object.assign(new EventEmitter(), { vote: [], sent: [], store: { get: () => 'Host' } });
  h.guests = new Map([['g1', { nick: 'Ali', link: { ctrl: (m) => h.sent.push(m) } }], ['g2', { nick: 'Sara', link: { ctrl: () => {} } }]]);
  for (const k of ['voteNominate', 'voteCast', 'voteClear', 'voteWinner', '_voteView', '_voteSend']) h[k] = Host.prototype[k].bind(h);
  return h;
}

test('vote: nominations are checked, one vote each, changing a vote moves it', () => {
  const h = room();
  h.voteNominate({ id: 'tt0113277', type: 'movie', name: 'Heat', poster: 'https://img/heat.jpg' }, 'Ali');
  h.voteNominate({ id: 'tt0113277', name: 'Heat again' }, 'Sara');                 // same title twice
  h.voteNominate({ id: 'bad id <script>', name: 'x' }, 'Sara');                     // not an id
  h.voteNominate({ id: 'tt1160419', type: 'movie', name: 'Dune', poster: 'javascript:alert(1)' }, 'Sara');
  assert.deepStrictEqual(h.vote.map((v) => v.id), ['tt0113277', 'tt1160419']);
  assert.strictEqual(h.vote[1].poster, null, 'only https posters');
  h.voteCast('tt0113277', 'g1'); h.voteCast('tt0113277', 'g2'); h.voteCast('tt1160419', 'host');
  h.voteCast('tt1160419', 'g2'); // Sara changes her mind
  const view = h._voteView();
  assert.deepStrictEqual(view.map((v) => [v.id, v.votes]), [['tt0113277', 1], ['tt1160419', 2]]);
  assert.deepStrictEqual(view[1].voters, ['Host', 'Sara']);
  assert.strictEqual(h.voteWinner().id, 'tt1160419');
  assert.strictEqual(h.sent.at(-1).t, 'vote_state', 'guests hear every change');
});

test('vote: a tie is settled among the tied only', () => {
  const h = room();
  h.voteNominate({ id: 'tt1', name: 'A' }, 'x'); h.voteNominate({ id: 'tt2', name: 'B' }, 'x'); h.voteNominate({ id: 'tt3', name: 'C' }, 'x');
  h.voteCast('tt1', 'g1'); h.voteCast('tt2', 'g2');
  const seen = new Set(); for (let i = 0; i < 50; i++) seen.add(h.voteWinner().id);
  assert.deepStrictEqual([...seen].sort(), ['tt1', 'tt2']);
  h.voteClear(); assert.strictEqual(h.voteWinner(), null);
});
