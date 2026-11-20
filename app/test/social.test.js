'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { deriveId, signedBytes } = require('../src/main/ident');
const { Store } = require('../src/main/store');
const {
  computeMajlisWrapped,
  normalizeHandle,
  isValidHandle,
  verifySocialEnvelope,
  buildSharedProfilePayload,
  parseRuntimeMin,
  computeCompareHighlights,
  buildMemberAffinity,
  scoreGroupTaste,
  normalizeGenres,
} = require('../src/main/social');
const { SEED_MOVIES } = require('../src/main/media/seed-movies');

test('social: @handle validation and normalization', () => {
  assert.strictEqual(normalizeHandle('  @Abu_Saqr99 '), 'abu_saqr99');
  assert.strictEqual(isValidHandle('@Abu_Saqr99'), true);
  assert.strictEqual(isValidHandle('cinema_lover'), true);
  assert.strictEqual(isValidHandle('ab'), false, 'too short');
  assert.strictEqual(isValidHandle('123456789'), false, 'all-digits rejected so handles never collide with 9-digit Majlis IDs');
  assert.strictEqual(isValidHandle('bad-handle!'), false, 'only a-z, 0-9 and _');
});

test('social: P2P signaling envelope signature verification and size cap', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkRaw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const pkB64 = pkRaw.toString('base64');
  const id = deriveId(pkRaw, 0);
  const now = Date.now();

  const msg = {
    t: 'social',
    sub: 'profile_res',
    from: id,
    to: '123456789',
    pk: pkB64,
    salt: 0,
    profile: { displayName: 'Noura', handle: 'noura_sa' },
    ts: now,
  };
  msg.sig = crypto.sign(null, signedBytes(msg), privateKey).toString('base64');
  assert.strictEqual(verifySocialEnvelope(msg, now), true);

  // Tampered payload fails signature check
  const tampered = { ...msg, profile: { displayName: 'Mallory' } };
  assert.strictEqual(verifySocialEnvelope(tampered, now), false);

  // Wrong sender ID for the public key fails deriveId check
  const spoofedId = { ...msg, from: '987654321' };
  spoofedId.sig = crypto.sign(null, signedBytes(spoofedId), privateKey).toString('base64');
  assert.strictEqual(verifySocialEnvelope(spoofedId, now), false);

  // Stale timestamp fails freshness check
  assert.strictEqual(verifySocialEnvelope(msg, now + 300000), false);
});

test('social: shared profile payload respects shareHistory privacy and size cap', () => {
  const profile = {
    id: '111222333',
    displayName: 'Fahad',
    handle: 'fahad_cinema',
    accent: '#12a594',
    bio: 'Sci-fi & thriller fan',
    shareHistory: 'friends',
    favorites: [{ id: 'tt0816692', type: 'movie', name: 'Interstellar', year: 2014 }],
    lists: [{ id: 'l1', name: 'Desert Island', items: [{ id: 'tt0113277', type: 'movie', name: 'Heat', year: 1995 }] }],
  };
  const library = {
    favorites: [{ id: 'tt0133093', type: 'movie', name: 'The Matrix', year: 1999 }],
    history: [{ id: 'tt0816692', type: 'movie', name: 'Interstellar', at: 1700000000000 }],
  };
  const letterboxd = {
    'heat|1995': { name: 'Heat', year: '1995', watched: true, rating: 5, review: 'Masterpiece heist film.' },
  };

  const shared = buildSharedProfilePayload({ profile, library, letterboxd, tune: {} });
  assert.strictEqual(shared.historyHidden, false);
  assert.strictEqual(shared.favorites.length, 2);
  assert.strictEqual(shared.lists.length, 1);
  assert.strictEqual(shared.history.length, 1);
  assert.strictEqual(shared.ratings.length, 1);
  assert.strictEqual(shared.ratings[0].rating, 5);

  // Privacy set to 'none' strips watch history and ratings while keeping profile card, favorites & custom lists
  const priv = buildSharedProfilePayload({
    profile: { ...profile, shareHistory: 'none' },
    library,
    letterboxd,
    tune: {},
  });
  assert.strictEqual(priv.historyHidden, true);
  assert.strictEqual(priv.history.length, 0);
  assert.strictEqual(priv.ratings.length, 0);
  assert.strictEqual(priv.favorites.length, 2);
  assert.strictEqual(priv.lists.length, 1);
});

test('social: Head-to-Head comparison matrix highlights best values per row', () => {
  assert.strictEqual(parseRuntimeMin('2h 28m'), 148);
  assert.strictEqual(parseRuntimeMin('116 min'), 116);

  const cols = [
    {
      id: 'tt1',
      name: 'Alpha',
      ratings: { imdb: 8.6, rt: 91, letterboxd: 4.3, mal: null },
      audience: 450000,
      year: 2019,
      runtimeMin: 142,
      genres: ['Sci-Fi', 'Drama'],
      watchedBy: [{ id: 'u1', watched: true }],
    },
    {
      id: 'tt2',
      name: 'Beta',
      ratings: { imdb: 8.1, rt: 96, letterboxd: 4.5, mal: 8.9 },
      audience: 120000,
      year: 2023,
      runtimeMin: 104,
      genres: ['Sci-Fi', 'Thriller'],
      watchedBy: [],
    },
  ];
  const { best, sharedGenres } = computeCompareHighlights(cols);
  assert.deepStrictEqual(best.imdb, ['tt1']);
  assert.deepStrictEqual(best.rt, ['tt2']);
  assert.deepStrictEqual(best.letterboxd, ['tt2']);
  assert.deepStrictEqual(best.mal, ['tt2']);
  assert.deepStrictEqual(best.audience, ['tt1']);
  assert.deepStrictEqual(best.year, ['tt2']);
  assert.deepStrictEqual(best.runtimeMin, ['tt2'], 'shortest runtime highlighted');
  assert.deepStrictEqual(best.unwatched, ['tt2'], 'unwatched title highlighted');
  assert.deepStrictEqual(sharedGenres, ['Sci-Fi']);
});

test('social: Group Taste Matcher excludes movies watched by anyone and ranks group fit', () => {
  const candidates = [
    {
      id: 'tt_watched_by_ali',
      type: 'movie',
      name: 'Already Seen By Ali',
      year: 2020,
      runtime: '120 min',
      genres: ['Sci-Fi', 'Thriller'],
      cast: ['Cillian Murphy'],
      director: ['Christopher Nolan'],
      imdbRating: '8.8',
    },
    {
      id: 'tt_watched_by_sara_lb',
      type: 'movie',
      name: 'Seen On Letterboxd',
      year: 2019,
      runtime: '115 min',
      genres: ['Sci-Fi', 'Thriller'],
      cast: ['Cillian Murphy'],
      director: ['Christopher Nolan'],
      imdbRating: '8.7',
    },
    {
      id: 'tt_perfect_fit',
      type: 'movie',
      name: 'Shared Sci-Fi Thriller',
      year: 2021,
      runtime: '118 min',
      genres: ['Sci-Fi', 'Thriller'],
      cast: ['Cillian Murphy'],
      director: ['Denis Villeneuve'],
      imdbRating: '8.4',
    },
    {
      id: 'tt_only_ali_likes',
      type: 'movie',
      name: 'Pure Horror Slasher',
      year: 1985,
      runtime: '95 min',
      genres: ['Horror'],
      cast: ['Unknown'],
      director: ['Unknown'],
      imdbRating: '6.5',
    },
    {
      id: 'tt_long_epic',
      type: 'movie',
      name: 'Three Hour Epic',
      year: 2022,
      runtime: '195 min',
      genres: ['Sci-Fi', 'Adventure'],
      cast: ['Cillian Murphy'],
      director: ['Denis Villeneuve'],
      imdbRating: '8.3',
    },
    {
      id: 'tt_chill_comedy',
      type: 'movie',
      name: 'Night Out Comedy',
      year: 2021,
      runtime: '102 min',
      genres: ['Comedy', 'Family'],
      cast: [],
      director: [],
      imdbRating: '7.6',
    },
  ];

  // Ali loves Sci-Fi & Thriller (2020s, Denis Villeneuve) and already watched tt_watched_by_ali
  const ali = buildMemberAffinity({
    id: '100000001',
    name: 'Ali',
    favorites: [
      { id: 'tt_watched_by_ali', name: 'Already Seen By Ali', year: 2020, genres: ['Sci-Fi', 'Thriller'], director: ['Denis Villeneuve'], cast: ['Cillian Murphy'] },
    ],
    tune: { tt999: { v: 1, genres: ['Sci-Fi', 'Thriller'] }, tt888: { v: -1, genres: ['Romance'] } },
  });

  // Sara loves Thriller & Sci-Fi, dislikes Horror, and watched "Seen On Letterboxd" (2019) via Letterboxd export
  const sara = buildMemberAffinity({
    id: '100000002',
    name: 'Sara',
    ratings: [
      { name: 'Seen On Letterboxd', year: 2019, watched: true, rating: 5, genres: ['Thriller', 'Sci-Fi'], cast: ['Cillian Murphy'] },
      { name: 'Bad Slasher', year: 2018, watched: true, rating: 1, genres: ['Horror'] },
    ],
  });

  const picks = scoreGroupTaste(candidates, [ali, sara], {}, 5);
  const pickIds = picks.map((p) => p.id);

  assert.strictEqual(pickIds.includes('tt_watched_by_ali'), false, 'excluded because Ali watched it by ID');
  assert.strictEqual(pickIds.includes('tt_watched_by_sara_lb'), false, 'excluded because Sara watched it on Letterboxd by name|year');
  assert.strictEqual(picks[0].id, 'tt_perfect_fit', 'mutual Sci-Fi/Thriller + cast/director affinity ranks #1');
  assert.strictEqual(picks.at(-1).id, 'tt_only_ali_likes', 'genre disliked by Sara ranks last');

  // Filter: maxRuntime = 125 min excludes the 195-min movie
  const shortPicks = scoreGroupTaste(candidates, [ali, sara], { maxRuntime: 125 }, 5);
  assert.strictEqual(shortPicks.some((p) => p.id === 'tt_long_epic'), false);

  // Filter: era = '2020s' excludes 1985 movie
  const eraPicks = scoreGroupTaste(candidates, [ali, sara], { era: '2020s' }, 5);
  assert.strictEqual(eraPicks.some((p) => p.id === 'tt_only_ali_likes'), false);

  // Filter: mood = 'chill' picks the comedy
  const chillPicks = scoreGroupTaste(candidates, [ali, sara], { mood: 'chill' }, 5);
  assert.strictEqual(chillPicks[0].id, 'tt_chill_comedy');
});

test('social: Store persists per-profile community fields, custom lists, and friend requests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-social-test-'));
  try {
    const st = new Store(dir);
    const updated = st.setSocialProfile({
      displayName: 'Tariq',
      handle: '@Tariq_99',
      accent: '#3e63dd',
      bio: 'Late night cinema host',
      shareHistory: 'none',
      lists: [{ id: 'l1', name: 'Top Heists', items: [{ id: 'tt0113277', type: 'movie', name: 'Heat', year: 1995 }] }],
    });
    assert.strictEqual(updated.displayName, 'Tariq');
    assert.strictEqual(updated.handle, 'tariq_99');
    assert.strictEqual(updated.accent, '#3e63dd');
    assert.strictEqual(updated.shareHistory, 'none');
    assert.strictEqual(updated.lists.length, 1);
    assert.strictEqual(updated.lists[0].items[0].id, 'tt0113277');

    st.upsertFriendRequest({ id: '222333444', name: 'Maha', handle: 'maha_cinema', direction: 'in' });
    assert.strictEqual(st.friendRequests().length, 1);
    assert.strictEqual(st.lookupLocalHandle('@maha_cinema')?.id, '222333444');
    st.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('social: normalizeGenres, era 1990s fix, multi-select genres, and 3-tier seed fallback never returns 0 picks', () => {
  assert.deepStrictEqual(
    normalizeGenres(['Science Fiction', 'خيال علمي', 'رعب'], [35, 14]),
    ['Sci-Fi', 'Horror', 'Comedy', 'Fantasy'],
  );

  const member = buildMemberAffinity({
    id: '100000010',
    name: 'Mazen',
    favorites: [{ id: 'tt0133093', name: 'The Matrix', year: 1999, genres: ['Action', 'Sci-Fi'] }],
  });

  // Explicit 1990s filter (bug previously only checked '90s', missing UI '1990s')
  const nineties = scoreGroupTaste(SEED_MOVIES, [member], { era: '1990s' }, 5, { fillToLimit: true });
  assert.strictEqual(nineties.length, 5);
  assert.ok(nineties.some((p) => p.matchTier === 1 && p.year >= 1990 && p.year <= 1999), 'matches 1990-1999 picks');
  assert.ok(nineties.every((p) => p.id !== 'tt0133093'), 'excludes watched Matrix');

  // Multi-select rare classic combo -> Tier 1 + Tier 2 partial + Tier 3 = 5 unseen picks (NEVER 0)
  const rare = scoreGroupTaste(
    SEED_MOVIES,
    [member],
    { genres: ['Horror', 'Comedy', 'Fantasy'], era: 'classic', maxRuntime: 105 },
    5,
    { fillToLimit: true },
  );
  assert.strictEqual(rare.length, 5);
  assert.ok(rare.some((p) => p.matchTier === 1 && p.year < 1990 && p.matchedSelectedGenres.length === 3));
  assert.ok(rare.every((p) => p.id !== 'tt0133093'));

  // Impossible strict combo still returns 5 picks via Tier 2/Tier 3 fallback
  const impossible = scoreGroupTaste(
    SEED_MOVIES,
    [member],
    { genres: ['Documentary', 'War', 'Horror', 'Animation'], era: 'classic', maxRuntime: 60 },
    5,
    { fillToLimit: true },
  );
  assert.strictEqual(impossible.length, 5);
  assert.ok(impossible.some((p) => p.matchTier >= 2));
});

test('track 3: buildMemberAffinity scales 1-10 ratings (preserving 1-5 Letterboxd) & computeMajlisWrapped aggregates month/all stats', () => {
  const member = buildMemberAffinity({
    id: '200000001',
    name: 'Nora',
    ratings: [
      { id: 'tt0816692', name: 'Interstellar', genres: ['Sci-Fi'], rating: 9 },      // 1-10 high (9 -> 4.5 >= 4 => +2.8)
      { id: 'tt0110912', name: 'Pulp Fiction', genres: ['Comedy'], score: 3 },       // 1-10 low  (3 -> 1.5 < 3 => -1.5)
      { id: 'tt0111161', name: 'Shawshank', genres: ['Drama'], rating: 4.5 },        // 1-5 LB high (4.5 >= 4 => +2.8)
      { id: 'tt0099685', name: 'Goodfellas', genres: ['Thriller'], rating: 2.0 },    // 1-5 LB low  (2.0 < 3 => -1.5)
    ],
  });
  assert.ok(member.genres['sci-fi'] > 2.5);
  assert.ok(member.genres.comedy < 0);
  assert.ok(member.genres.drama > 2.5);
  assert.ok(member.genres.thriller < 0);

  const now = new Date();
  const thisMonthMorning = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 15), 21, 0, 0).getTime();
  const thisMonthNightOwl = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 15), 2, 15, 0).getTime();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 2, 10, 20, 0, 0).getTime();

  const history = [
    {
      id: 'h1', startedAt: thisMonthMorning, endedAt: thisMonthMorning + 90 * 60000, watchedMs: 90 * 60000,
      titleId: 'tt1', title: 'Dune', poster: null, genres: ['Sci-Fi', 'Adventure'],
      attendees: [{ id: 'me', name: 'Me' }, { id: '300000001', name: 'Khalid', accent: '#3e63dd' }],
      groupRating: 9,
    },
    {
      id: 'h2', startedAt: thisMonthNightOwl, endedAt: thisMonthNightOwl + 120 * 60000, watchedMs: 120 * 60000,
      titleId: 'tt2', title: 'Arrival', poster: null, genres: ['Sci-Fi', 'Drama'],
      attendees: [{ id: '300000001', name: 'Khalid', accent: '#3e63dd' }, { id: '300000002', name: 'Reem', accent: '#e5484d' }],
      groupRating: 8,
    },
    {
      id: 'h3', startedAt: prevMonth, endedAt: prevMonth + 450 * 60000, watchedMs: 450 * 60000,
      titleId: 'tt3', title: 'LOTR', poster: null, genres: ['Fantasy'],
      attendees: [{ id: '300000002', name: 'Reem', accent: '#e5484d' }],
      groupRating: 10,
    },
  ];

  const monthWrapped = computeMajlisWrapped(history, 'month', 'me');
  assert.strictEqual(monthWrapped.range, 'month');
  assert.strictEqual(monthWrapped.totalSessions, 2);
  assert.strictEqual(monthWrapped.totalMinutes, 210);
  assert.strictEqual(monthWrapped.avgGroupRating, 8.5);
  assert.strictEqual(monthWrapped.topGenres[0].genre, 'Sci-Fi');
  assert.strictEqual(monthWrapped.topBuddies[0].id, '300000001');
  assert.ok(monthWrapped.milestones.includes('first_party'));
  assert.ok(monthWrapped.milestones.includes('night_owl'));

  const allWrapped = computeMajlisWrapped(history, 'all', 'me');
  assert.strictEqual(allWrapped.totalSessions, 3);
  assert.strictEqual(allWrapped.totalMinutes, 660);
  assert.strictEqual(allWrapped.avgGroupRating, 9.0);
  assert.strictEqual(allWrapped.highestRated.titleId, 'tt3');
  assert.ok(allWrapped.milestones.includes('ten_hours'));
  assert.ok(allWrapped.milestones.includes('critic_circle'));
});
