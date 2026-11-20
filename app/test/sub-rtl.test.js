'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  hasArabic, shapeArabicLine, isolateArabicSrt, prepareSubtitleFile,
  langDisplay, formatAddonSubTitle, parseSrtCueStarts,
} = require('../src/main/media/sub-rtl');

test('sub-rtl: hasArabic and shapeArabicLine isolate trailing punctuation and dialogue dashes', () => {
  assert.equal(hasArabic('Hello world'), false);
  assert.equal(hasArabic('مرحبا بكم'), true);

  assert.equal(shapeArabicLine('Plain English line -'), 'Plain English line -');

  const shapedTrail = shapeArabicLine('نعم , نعم -');
  assert.ok(shapedTrail.startsWith('\u202B'), 'wrapped in RLE');
  assert.ok(shapedTrail.endsWith('\u202C'), 'closed with PDF');
  assert.ok(shapedTrail.includes('-\u200F\u202C'), 'trailing dash anchored with RLM before PDF');

  const shapedDialog = shapeArabicLine('- هذا رائع!');
  assert.ok(shapedDialog.includes('\u200F- '), 'leading dash anchored with RLM');
  assert.ok(shapedDialog.includes('!\u200F\u202C'), 'trailing exclamation anchored with RLM');
});

test('sub-rtl: isolateArabicSrt keeps SRT indices & timestamps untouched while shaping Arabic cues', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'نعم , هذا صحيح -',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    'English subtitle line.',
  ].join('\n');

  const out = isolateArabicSrt(srt).split('\n');
  assert.equal(out[0], '1');
  assert.equal(out[1], '00:00:01,000 --> 00:00:03,500');
  assert.ok(out[2].startsWith('\u202B') && out[2].endsWith('\u202C'));
  assert.equal(out[4], '2');
  assert.equal(out[5], '00:00:04,000 --> 00:00:06,000');
  assert.equal(out[6], 'English subtitle line.');
});

test('sub-rtl: prepareSubtitleFile shapes local .srt into temp file and leaves .ass untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-subrtl-'));
  const subOut = path.join(dir, 'out');
  try {
    const srtPath = path.join(dir, 'sample.ar.srt');
    fs.writeFileSync(srtPath, '1\n00:00:01,000 --> 00:00:02,000\nمرحبا -\n', 'utf8');
    const shapedPath = await prepareSubtitleFile(srtPath, 'ar', subOut);
    assert.notEqual(shapedPath, srtPath);
    assert.equal(path.dirname(shapedPath), subOut);
    const body = fs.readFileSync(shapedPath, 'utf8');
    assert.ok(body.includes('\u202B') && body.includes('-\u200F\u202C'));

    const assPath = path.join(dir, 'sample.ass');
    fs.writeFileSync(assPath, '[Script Info]\nScriptType: v4.00+\n', 'utf8');
    const keptAss = await prepareSubtitleFile(assPath, 'ar', subOut);
    assert.equal(keptAss, assPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sub-rtl: langDisplay, formatAddonSubTitle and parseSrtCueStarts work for real release names', () => {
  assert.equal(langDisplay('ara'), 'العربية');
  assert.equal(langDisplay('fre'), 'Français');
  assert.equal(langDisplay('ger'), 'Deutsch');
  assert.equal(langDisplay('spa'), 'Español');
  assert.equal(langDisplay('eng'), 'English');

  assert.equal(
    formatAddonSubTitle({ lang: 'ara', addon: 'OpenSubtitles v3', filename: 'Dark.Matter.2024.S01E01.WEB-DL.srt', sdh: true }),
    'Dark.Matter.2024.S01E01.WEB-DL [SDH]'
  );
  assert.equal(
    formatAddonSubTitle({ lang: 'eng', addon: 'SubDL', url: 'https://subs.example/Dune.Part.Two.2024.1080p.vtt', forced: true }),
    'Dune.Part.Two.2024.1080p [Forced]'
  );
  assert.equal(
    formatAddonSubTitle({ lang: 'fre', addon: 'OpenSubtitles', title: 'fre' }, 2),
    'Français (OpenSubtitles)'
  );

  const starts = parseSrtCueStarts('WEBVTT\n\n00:00:02,500 --> 00:00:05,000\nLine 1\n\n01:02:03.250 --> 01:02:05.000\nLine 2\n');
  assert.deepEqual(starts, [2.5, 3723.25]);
});
