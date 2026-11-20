import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Gamepad2, Tv } from 'lucide-react';
import { cin, invoke } from '../../api';
import { useHost } from '../../host';
import {
  ActionRow, DropdownRow, InfoBanner, KeybindRecorder, LivePreviewCard,
  SegmentedRow, SettingSection, SliderRow, TagPriorityList, ToggleRow,
} from '../primitives';
import { DEFAULT_SHORTCUTS, useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const SHORTCUT_GROUPS: { titleEn: string; titleAr: string; keys: [string, string][] }[] = [
  { titleEn: 'Global', titleAr: 'عام', keys: [['global.search', 'Focus search'], ['global.settings', 'Open settings'], ['global.scaleUp', 'Scale up'], ['global.scaleDown', 'Scale down'], ['global.scaleReset', 'Scale reset']] },
  { titleEn: 'Player', titleAr: 'المشغل', keys: [['player.close', 'Close player'], ['player.playPause', 'Play / Pause'], ['player.fullscreen', 'Fullscreen'], ['player.pip', 'Picture in Picture'], ['player.lock', 'Lock controls'], ['player.stats', 'Stats overlay'], ['player.aspect', 'Cycle aspect'], ['player.screenshot', 'Screenshot'], ['player.gif', 'Record GIF'], ['player.clip', 'Save instant clip'], ['player.anime4k', 'Toggle Anime4K'], ['player.rtx', 'Toggle RTX HDR/VSR']] },
  { titleEn: 'Seeking', titleAr: 'التقديم والتأخير', keys: [['seek.back', 'Seek back'], ['seek.fwd', 'Seek forward'], ['seek.shortBack', 'Short seek back'], ['seek.shortFwd', 'Short seek forward'], ['seek.back30', 'Jump back 30s'], ['seek.fwd30', 'Jump forward 30s'], ['seek.prevFrame', 'Previous frame'], ['seek.nextFrame', 'Next frame'], ['seek.start', 'Jump to start'], ['seek.end', 'Jump to end']] },
  { titleEn: 'Audio & Subtitles', titleAr: 'الصوت والترجمة', keys: [['av.volUp', 'Volume up'], ['av.volDown', 'Volume down'], ['av.mute', 'Mute audio'], ['av.cycleSubs', 'Cycle subtitles'], ['av.subDelayMinus', 'Sub delay -'], ['av.subDelayPlus', 'Sub delay +'], ['av.cycleAudio', 'Cycle audio track']] },
  { titleEn: 'Episodes & Panels', titleAr: 'الحلقات والأدوات', keys: [['ep.next', 'Next episode'], ['ep.prev', 'Previous episode'], ['ep.speedUp', 'Speed +'], ['ep.speedDown', 'Speed -'], ['ep.sources', 'Stream switcher'], ['ep.upNext', 'Up next panel'], ['ep.sleepTimer', 'Sleep timer'], ['ep.reload', 'Reload source']] },
];

function CoopHotkeyRecorder({
  label,
  description,
  value,
  mode,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  mode: 'code' | 'accel';
  onChange: (next: string) => void;
}) {
  const { lang } = useHost();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording || mode !== 'code') return;
    const onMouse = (e: MouseEvent) => {
      if (e.button < 1) return;
      e.preventDefault();
      e.stopPropagation();
      setRecording(false);
      onChange(`Mouse${e.button + 1}`);
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onMouse, true), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onMouse, true); };
  }, [recording, mode, onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setRecording(false); return; }
    if (mode === 'code') {
      if (!e.code) return;
      setRecording(false);
      onChange(e.code);
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    let k = '';
    if (e.code?.startsWith('Key')) k = e.code.slice(3);
    else if (e.code?.startsWith('Digit')) k = e.code.slice(5);
    else if (/^F\d{1,2}$/.test(e.code || '')) k = e.code;
    else if (e.key === ' ') k = 'Space';
    else if (e.key.length === 1) k = e.key.toUpperCase();
    else if (['Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) k = e.key;
    if (!k || (!mods.length && !/^F\d{1,2}$/.test(k))) return;
    setRecording(false);
    onChange([...mods, k].join('+'));
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <p className="text-[11px] text-[var(--text-muted)]">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        className={`min-w-[140px] rounded-lg px-3 py-1.5 text-center font-mono text-xs font-semibold ring-1 transition ${
          recording
            ? 'animate-pulse bg-[var(--accent)]/20 text-[var(--accent)] ring-[var(--accent)]'
            : 'bg-black/40 text-[var(--text-primary)] ring-[var(--border-strong)] hover:ring-white/30'
        }`}
      >
        {recording ? (lang === 'ar' ? 'اضغط أي مفتاح...' : 'Press key...') : (value || (lang === 'ar' ? 'غير معين' : 'Unbound'))}
      </button>
    </div>
  );
}

export function ControlsDevicesPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update } = useSettingsStore();
  const c = data.controls;

  const stateQ = useQuery({
    queryKey: ['app-state'],
    queryFn: () => invoke<{
      helper?: { vigem?: boolean; wgc?: boolean } | null;
      settings?: {
        voice?: 'off' | 'ptt' | 'open';
        pttKey?: string;
        knockSound?: boolean;
        soundEffects?: boolean;
        sfxMuteDuringPlayback?: boolean;
        panicKey?: string;
        overlayKey?: string;
        replayKey?: string;
        padSwapAB?: boolean;
        controllerHud?: boolean;
        privacyCurtain?: boolean;
        mouseSens?: number;
        defaultRole?: 'watch' | 'pad' | 'kbm' | 'full';
        spectatorQuality?: number;
        noVsync?: boolean;
      };
    }>('state').catch(() => null),
    staleTime: 5000,
  });

  const p2pQ = useQuery({
    queryKey: ['p2p-status'],
    queryFn: () => cin<{ running: boolean; port: number | null; activeFiles: number }>('p2p-status').catch(() => ({ running: false, port: null, activeFiles: 0 })),
    enabled: pageId.startsWith('tv-'),
    staleTime: 10000,
  });

  const setAppSetting = async (patch: Record<string, unknown>) => {
    await invoke('settings', patch).catch(() => {});
    qc.invalidateQueries({ queryKey: ['app-state'] });
  };

  const [padTab, setPadTab] = useState<'xbox' | 'ps'>('xbox');
  const [testingPad, setTestingPad] = useState(false);
  const [livePad, setLivePad] = useState<{ name: string; pressed: number[]; axes: number[] } | null>(null);

  useEffect(() => {
    if (!testingPad || pageId !== 'controller') return;
    let raf = 0;
    const poll = () => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      if (pads.length && pads[0]) {
        const gp = pads[0]!;
        const pressed = gp.buttons.map((b, i) => (b.pressed ? i : -1)).filter((x) => x >= 0);
        setLivePad({ name: gp.id, pressed, axes: gp.axes.slice(0, 4).map((a) => +a.toFixed(2)) });
      } else {
        setLivePad(null);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [testingPad, pageId]);

  if (pageId === 'keyboard-shortcuts') {
    const appSt = stateQ.data?.settings;
    return (
      <>
        <SettingSection title={ar ? 'الصوت واختصارات اللعب الجماعي والنظام' : 'Co-op Voice & Global System Hotkeys'}>
          <SegmentedRow
            label={ar ? 'وضع الدردشة الصوتية' : 'Voice Chat Mode'}
            value={appSt?.voice || 'ptt'}
            options={[
              { value: 'off', label: ar ? 'مغلق' : 'Off' },
              { value: 'ptt', label: ar ? 'اضغط للتحدث (PTT)' : 'Push to Talk' },
              { value: 'open', label: ar ? 'مفتوح دائماً' : 'Open Mic' },
            ]}
            onChange={(v) => setAppSetting({ voice: v })}
          />
          <ToggleRow
            label={ar ? 'صوت تنبيه عند طلب الانضمام للغرفة' : 'Incoming knock alert sound'}
            checked={appSt?.knockSound !== false}
            onChange={(v) => setAppSetting({ knockSound: v })}
          />
          <ToggleRow
            label={ar ? 'المؤثرات الصوتية الخفيفة لغرفة المشاهدة' : 'Subtle Majlis watch party sound effects'}
            checked={appSt?.soundEffects !== false}
            onChange={(v) => setAppSetting({ soundEffects: v })}
          />
          <ToggleRow
            label={ar ? 'كتم المؤثرات تلقائياً أثناء تشغيل الفيديو' : 'Auto-mute chimes while film is playing'}
            checked={appSt?.sfxMuteDuringPlayback !== false}
            onChange={(v) => setAppSetting({ sfxMuteDuringPlayback: v })}
          />
          <CoopHotkeyRecorder
            label={ar ? 'مفتاح الضغط للتحدث (PTT)' : 'Push-to-Talk Key'}
            description={ar ? 'يدعم أزرار الفأرة الجانبية ولوحة المفاتيح داخل الألعاب' : 'Supports keyboard keys and Mouse3/Mouse4/Mouse5'}
            value={appSt?.pttKey || 'CapsLock'}
            mode="code"
            onChange={(next) => setAppSetting({ pttKey: next })}
          />
          <CoopHotkeyRecorder
            label={ar ? 'مفتاح الطوارئ وقطع الاتصال الفوري' : 'Panic Disconnect Hotkey'}
            value={appSt?.panicKey || 'Control+Alt+Shift+F12'}
            mode="accel"
            onChange={(next) => setAppSetting({ panicKey: next })}
          />
          <CoopHotkeyRecorder
            label={ar ? 'مفتاح إظهار/إخفاء نافذة التحكم' : 'Co-op Overlay Hotkey'}
            value={appSt?.overlayKey || 'Control+Alt+M'}
            mode="accel"
            onChange={(next) => setAppSetting({ overlayKey: next })}
          />
          <CoopHotkeyRecorder
            label={ar ? 'مفتاح حفظ لقطة الإعادة الفورية' : 'Instant Replay Hotkey'}
            value={appSt?.replayKey || 'Control+Alt+R'}
            mode="accel"
            onChange={(next) => setAppSetting({ replayKey: next })}
          />
        </SettingSection>

        {SHORTCUT_GROUPS.map((grp) => (
          <SettingSection
            key={grp.titleEn}
            title={ar ? grp.titleAr : grp.titleEn}
            rightAction={
              grp.titleEn === 'Global' ? (
                <button type="button" onClick={() => update((s) => { s.controls.shortcuts = { ...DEFAULT_SHORTCUTS }; })} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
                  {ar ? 'إعادة ضبط الاختصارات' : 'Reset all'}
                </button>
              ) : undefined
            }
          >
            {grp.keys.map(([id, label]) => (
              <KeybindRecorder
                key={id}
                label={label}
                value={c.shortcuts[id] || ''}
                onChange={(combo) => update((s) => { s.controls.shortcuts[id] = combo; })}
              />
            ))}
          </SettingSection>
        ))}
      </>
    );
  }

  if (pageId === 'keyboard-behavior') {
    return (
      <SettingSection title={ar ? 'سلوك لوحة المفاتيح والتقديم' : 'Keyboard behavior'}>
        <ToggleRow label={ar ? 'التنقل بأسلوب التلفاز (TV navigation)' : 'TV navigation'} checked={c.tvNav} onChange={(v) => update((s) => { s.controls.tvNav = v; })} />
        <ToggleRow label={ar ? 'التنقل التلفازي داخل المشغل' : 'TV navigation in player'} checked={c.tvNavPlayer} onChange={(v) => update((s) => { s.controls.tvNavPlayer = v; })} />
        <ToggleRow label={ar ? 'زر Esc يخرج من ملء الشاشة أولاً' : 'Esc exits fullscreen first'} checked={c.escExitsFullscreenFirst} onChange={(v) => update((s) => { s.controls.escExitsFullscreenFirst = v; })} />
        <ToggleRow label={ar ? 'سؤال للتأكيد قبل مغادرة المشغل' : 'Ask before leaving'} checked={c.askBeforeLeaving} onChange={(v) => update((s) => { s.controls.askBeforeLeaving = v; })} />
        <DropdownRow label={ar ? 'التراجع عند التخطي للخلف' : 'Seek step back'} value={c.seekBackSec} options={[5, 10, 15, 30].map((n) => ({ value: n as typeof c.seekBackSec, label: `${n}s` }))} onChange={(v) => update((s) => { s.controls.seekBackSec = v; })} />
        <DropdownRow label={ar ? 'التقديم عند التخطي للأمام' : 'Seek step forward'} value={c.seekFwdSec} options={[5, 10, 15, 30].map((n) => ({ value: n as typeof c.seekFwdSec, label: `${n}s` }))} onChange={(v) => update((s) => { s.controls.seekFwdSec = v; })} />
        <DropdownRow label={ar ? 'التخطي القصير (Shift + الأسهم)' : 'Short seek (Shift + arrows)'} value={c.shortSeekSec} options={[1, 3, 5].map((n) => ({ value: n as typeof c.shortSeekSec, label: `${n}s` }))} onChange={(v) => update((s) => { s.controls.shortSeekSec = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'controller') {
    const face = padTab === 'xbox' ? ['A', 'B', 'X', 'Y'] : ['✕', '○', '□', '△'];
    return (
      <>
        <SettingSection title={ar ? 'يد التحكم (Gamepad)' : 'Controller settings'}>
          <ToggleRow label={ar ? 'تفعيل يد التحكم' : 'Enable controller'} checked={c.controllerEnabled} onChange={(v) => update((s) => { s.controls.controllerEnabled = v; })} />
          <ToggleRow label={ar ? 'الاستمرار في استقبال التحكم بالخلفية' : 'Keep controlling App in the background'} checked={c.controllerBackground} onChange={(v) => update((s) => { s.controls.controllerBackground = v; })} />
          <div className="pt-4">
            <LivePreviewCard
              title={ar ? 'فاحص يد التحكم الحي' : 'LIVE CONTROLLER PREVIEW'}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setPadTab('xbox')} className={`rounded-lg px-3 py-1 text-xs font-semibold ${padTab === 'xbox' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/10'}`}>Xbox</button>
                  <button type="button" onClick={() => setPadTab('ps')} className={`rounded-lg px-3 py-1 text-xs font-semibold ${padTab === 'ps' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/10'}`}>PlayStation</button>
                </div>
                <button type="button" onClick={() => setTestingPad((x) => !x)} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold ${testingPad ? 'bg-emerald-500 text-[#0B120E]' : 'bg-white/12'}`}>
                  <Gamepad2 size={13} />{testingPad ? (ar ? 'إيقاف الاختبار' : 'Stop testing') : (ar ? 'اختبار اليد حياً' : 'Test controller')}
                </button>
              </div>
              <svg viewBox="0 0 360 150" className="mx-auto h-36 w-full max-w-sm">
                <path d="M90 35 Q180 20 270 35 L295 105 Q295 130 265 125 L235 95 L125 95 L95 125 Q65 130 65 105 Z" fill="#181613" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
                <circle cx="122" cy="68" r="14" fill={livePad?.pressed.includes(12) ? '#E5A93C' : '#26221D'} stroke="#555" />
                <circle cx="180" cy="60" r="9" fill={livePad?.pressed.includes(9) ? '#E5A93C' : '#26221D'} />
                {[0, 1, 2, 3].map((idx) => {
                  const pts = [[238, 82], [254, 68], [222, 68], [238, 54]][idx];
                  const active = livePad?.pressed.includes(idx);
                  return (
                    <g key={idx}>
                      <circle cx={pts[0]} cy={pts[1]} r="9" fill={active ? '#E5A93C' : '#26221D'} stroke="rgba(255,255,255,0.25)" />
                      <text x={pts[0]} y={pts[1] + 3} textAnchor="middle" fill={active ? '#12100E' : '#F2EFE9'} fontSize="9" fontWeight="700">{face[idx]}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="mt-2 text-center text-xs text-[var(--text-muted)]">
                {testingPad
                  ? livePad ? `Connected: ${livePad.name} · Axes [${livePad.axes.join(', ')}]` : (ar ? 'اضغط أي زر على يد التحكم المتصلة الآن...' : 'Press any button on your connected controller...')
                  : (ar ? 'اضغط "اختبار اليد" لقراءة Web Gamepad API مباشرة' : 'Click "Test controller" to read live USB/Bluetooth gamepad inputs')}
              </div>
            </LivePreviewCard>
          </div>
          <ToggleRow label={ar ? 'مؤشر فأرة بيد التحكم' : 'Show cursor'} checked={c.showControllerCursor} onChange={(v) => update((s) => { s.controls.showControllerCursor = v; })} />
          <SegmentedRow label={ar ? 'شكل المؤشر' : 'Cursor shape'} value={c.cursorShape} options={[{ value: 'dot', label: 'Dot' }, { value: 'ring', label: 'Ring' }, { value: 'pointer', label: 'Pointer' }, { value: 'feather', label: 'Feather' }, { value: 'custom', label: 'Custom' }]} onChange={(v) => update((s) => { s.controls.cursorShape = v; })} />
          <SliderRow label={ar ? 'حجم المؤشر' : 'Cursor size'} value={c.cursorSizePx} min={12} max={36} unit="px" defaultValue={18} onChange={(v) => update((s) => { s.controls.cursorSizePx = v; })} />
          <SliderRow label={ar ? 'إخفاء المؤشر عند الخمول' : 'Hide after idle'} value={c.cursorIdleHideSec} min={0} max={10} unit="s" defaultValue={3} onChange={(v) => update((s) => { s.controls.cursorIdleHideSec = v; })} />
        </SettingSection>

        <SettingSection title={ar ? 'يد التحكم الافتراضية والتحكم باللعب الجماعي' : 'Co-op Virtual Gamepad & Host Controls'}>
          {(() => {
            const appSt = stateQ.data?.settings;
            const vigemOk = !!stateQ.data?.helper?.vigem;
            const specQ = typeof appSt?.spectatorQuality === 'number' ? appSt.spectatorQuality : 0.35;
            return (
              <>
                <ActionRow
                  label={ar ? 'تعريف ViGEmBus لوحدات التحكم' : 'ViGEmBus Virtual Gamepad Driver'}
                  description={vigemOk ? (ar ? 'مثبت وجاهز لمحاكاة أيدي التحكم للضيوف' : 'Installed and ready for guest controller input') : (ar ? 'غير مثبت — مطلوب لتشغيل أيدي تحكم الضيوف' : 'Missing — required to emulate Xbox/DualShock controllers')}
                  buttonLabel={ar ? 'صفحة التنزيل' : 'Get ViGEmBus'}
                  extra={
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${vigemOk ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {vigemOk ? (ar ? 'جاهز' : 'Ready') : (ar ? 'غير مثبت' : 'Missing')}
                    </span>
                  }
                  onClick={() => invoke('vigem').catch(() => {})}
                />
                <ToggleRow
                  label={ar ? 'عكس زري A و B في يد التحكم' : 'Swap A / B controller buttons'}
                  checked={!!appSt?.padSwapAB}
                  onChange={(v) => setAppSetting({ padSwapAB: v })}
                />
                <SliderRow
                  label={ar ? 'حساسية الفأرة في اللعب الجماعي' : 'Co-op mouse sensitivity'}
                  value={typeof appSt?.mouseSens === 'number' ? appSt.mouseSens : 1}
                  min={0.3}
                  max={3}
                  step={0.05}
                  unit="×"
                  defaultValue={1}
                  onChange={(v) => setAppSetting({ mouseSens: v })}
                />
                <DropdownRow
                  label={ar ? 'الصلاحية الافتراضية للضيوف' : 'Default guest role'}
                  value={appSt?.defaultRole || 'pad'}
                  options={[
                    { value: 'watch', label: ar ? 'مشاهدة فقط (Watch)' : 'Spectate only' },
                    { value: 'pad', label: ar ? 'يد تحكم (Controller)' : 'Controller' },
                    { value: 'kbm', label: ar ? 'فأرة ولوحة مفاتيح (KBM)' : 'Keyboard & Mouse' },
                    { value: 'full', label: ar ? 'تحكم كامل (Full)' : 'Full access' },
                  ]}
                  onChange={(v) => setAppSetting({ defaultRole: v })}
                />
                <SegmentedRow
                  label={ar ? 'جودة البث للمشاهدين فقط' : 'Spectator stream quality'}
                  value={specQ}
                  options={[
                    { value: 0.25, label: '25%' },
                    { value: 0.35, label: '35%' },
                    { value: 0.5, label: '50%' },
                  ]}
                  onChange={(v) => setAppSetting({ spectatorQuality: v })}
                />
                <ToggleRow
                  label={ar ? 'مؤشر يد التحكم على الشاشة' : 'On-screen Controller HUD'}
                  checked={!!appSt?.controllerHud}
                  onChange={(v) => setAppSetting({ controllerHud: v })}
                />
                <ToggleRow
                  label={ar ? 'ستارة الخصوصية التلقائية عند Alt-Tab' : 'Auto Privacy Curtain on Alt-Tab'}
                  checked={!!appSt?.privacyCurtain}
                  onChange={(v) => setAppSetting({ privacyCurtain: v })}
                />
                <ActionRow
                  label={ar ? 'إعادة ضبط أيدي التحكم (ViGEmBus)' : 'Reset ViGEmBus Controllers'}
                  description={ar ? 'فصل وإعادة تهيئة جميع أيدي التحكم الافتراضية دون إغلاق الغرفة' : 'Unplug and re-initialize virtual gamepads without closing room'}
                  buttonLabel={ar ? 'إعادة ضبط' : 'Reset'}
                  onClick={async () => {
                    await invoke('host:pads-reset').catch(() => {});
                    toast(ar ? 'تمت إعادة ضبط أيدي التحكم' : 'ViGEmBus controllers reset');
                  }}
                />
                <ToggleRow
                  label={ar ? 'تعطيل VSync لتحسين زمن الاستجابة' : 'Disable VSync (lower Co-op capture latency)'}
                  description={ar ? 'يُطبّق التغيير عند إعادة تشغيل التطبيق' : 'Takes effect on next app launch'}
                  checked={!!appSt?.noVsync}
                  onChange={async (v) => {
                    await setAppSetting({ noVsync: v });
                    toast(ar ? 'تم الحفظ — أعد التشغيل لتطبيق VSync' : 'Saved — restart app to apply VSync');
                  }}
                />
              </>
            );
          })()}
        </SettingSection>
      </>
    );
  }

  if (pageId === 'buttons-sticks') {
    const MAP = [
      ['Move focus', 'D-Pad / Left Stick', 'D-Pad / Left Stick'],
      ['Select', 'A', '✕ Cross'],
      ['Back', 'B', '○ Circle'],
      ['Play / Pause', 'X / Start', '□ / Options'],
      ['Subtitles / Menu', 'Y', '△ Triangle'],
      ['Seek', 'LB / RB', 'L1 / R1'],
      ['Next / Prev Episode', 'LT / RT', 'L2 / R2'],
    ];
    return (
      <SettingSection title={ar ? 'الأزرار وعصي التحكم' : 'Buttons & sticks'}>
        <div className="mb-4 divide-y divide-white/5 rounded-xl bg-black/30 text-xs">
          {MAP.map(([act, xb, ps]) => (
            <div key={act} className="grid grid-cols-3 px-3 py-2"><span className="font-semibold">{act}</span><span className="text-emerald-300">{xb}</span><span className="text-sky-300">{ps}</span></div>
          ))}
        </div>
        <SliderRow label={ar ? 'منطقة السكون (Deadzone)' : 'Stick deadzone'} value={c.stickDeadzonePct} min={5} max={50} unit="%" defaultValue={18} onChange={(v) => update((s) => { s.controls.stickDeadzonePct = v; })} />
        <SliderRow label={ar ? 'سرعة التكرار' : 'Repeat speed'} value={c.repeatSpeedMs} min={50} max={300} step={10} unit=" ms" defaultValue={120} onChange={(v) => update((s) => { s.controls.repeatSpeedMs = v; })} />
        <SliderRow label={ar ? 'التأخير الأولي' : 'Initial delay'} value={c.initialDelayMs} min={200} max={800} step={25} unit=" ms" defaultValue={400} onChange={(v) => update((s) => { s.controls.initialDelayMs = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'remotes') {
    return (
      <SettingSection title={ar ? 'التحكم عبر الشبكة المحلية' : 'LAN Streaming & Endpoints'}>
        <ToggleRow label={ar ? 'تفعيل خادم الوسائط على الشبكة المحلية' : 'Expose local media endpoint on LAN'} checked={c.serveRemoteNetwork} onChange={(v) => update((s) => { s.controls.serveRemoteNetwork = v; })} />
        <p className="pt-2 text-xs text-white/55">
          {ar ? 'عند تفعيل بث التورنت في الخلفية يعمل خادم الوسائط محلياً على منفذ عشوائي في جهازك فقط بدون أي نطاق مركزي.' : 'Local media HTTP range serving binds locally per session with no external domain required.'}
        </p>
      </SettingSection>
    );
  }

  if (pageId.startsWith('tv-')) {
    const p2p = p2pQ.data;
    const exportTvSettings = () => {
      const payload = {
        tvAppearance: c.tvAppearance,
        tvPlayback: c.tvPlayback,
        preferredLanguages: data.languages.subtitlePriority,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `majlis-tv-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(ar ? 'تم تصدير إعدادات التلفاز' : 'TV settings JSON exported');
    };
    const tvBanner = (
      <InfoBanner
        title={ar ? 'تفضيلات وضع التلفاز والشاشات الكبيرة' : 'TV & Large-Display Preferences'}
        body={p2p?.running && p2p.port
          ? (ar ? `خادم البث المحلي نشط على المنفذ ${p2p.port}` : `Local media HTTP endpoint active on port ${p2p.port}`)
          : (ar ? 'تُحفظ تفضيلات التلفاز محلياً وتُصدر بصيغة JSON لأجهزتك على الشبكة.' : 'TV appearance & playback presets persist locally and can be exported as JSON.')}
        action={
          <button type="button" onClick={exportTvSettings} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-bold text-[var(--accent-fg)]">
            <Download size={12} />{ar ? 'تصدير JSON' : 'Export TV JSON'}
          </button>
        }
      />
    );
    if (pageId === 'tv-devices') {
      return (
        <>
          {tvBanner}
          <SettingSection title={ar ? 'حالة البث على الشبكة المحلية (LAN)' : 'Local Network TV Streaming Status'}>
            <div className="flex items-center justify-between py-3 text-xs">
              <span className="flex items-center gap-2">
                <Tv size={15} className="text-[var(--accent)]" />
                {p2p?.running && p2p.port
                  ? (ar ? `خادم البث المحلي (منفذ ${p2p.port})` : `Local Streaming Server (Port ${p2p.port})`)
                  : (ar ? 'لا توجد أجهزة تلفاز مقترنة حالياً — يعمل الخادم محلياً عند بدء بث' : 'No paired LAN TV receivers detected — local endpoint starts on playback')}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${p2p?.running ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/65'}`}>
                {p2p?.running ? (ar ? 'نشط' : 'Active') : (ar ? 'في وضع الاستعداد' : 'Standby')}
              </span>
            </div>
          </SettingSection>
        </>
      );
    }
    if (pageId === 'tv-appearance') {
      return (
        <>
          {tvBanner}
          <SettingSection title={ar ? 'مظهر شاشة التلفاز والترجمة' : 'TV Appearance & Subtitles'}>
            <SegmentedRow label={ar ? 'نمط الترجمة على التلفاز' : 'TV Subtitle preset'} value={c.tvAppearance.subPreset} options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }, { value: 'cinema', label: 'Cinema' }, { value: 'minimal', label: 'Minimal' }]} onChange={(v) => update((s) => { s.controls.tvAppearance.subPreset = v; })} />
            <SliderRow label={ar ? 'حجم الخط' : 'TV Sub Size'} value={c.tvAppearance.subSize} min={70} max={180} unit="%" defaultValue={110} onChange={(v) => update((s) => { s.controls.tvAppearance.subSize = v; })} />
            <SegmentedRow label={ar ? 'هوامش الحواف (Overscan)' : 'Edge margin'} value={c.tvAppearance.edgeMargin} options={(['off', '2%', '3.5%', '5%'] as const).map((m) => ({ value: m, label: m }))} onChange={(v) => update((s) => { s.controls.tvAppearance.edgeMargin = v; })} />
            <ToggleRow label={ar ? 'تلاشي ناعم بين الخلفيات' : 'Fade between backdrops'} checked={c.tvAppearance.fadeBackdrops} onChange={(v) => update((s) => { s.controls.tvAppearance.fadeBackdrops = v; })} />
          </SettingSection>
        </>
      );
    }
    if (pageId === 'tv-playback') {
      return (
        <>
          {tvBanner}
          <SettingSection title={ar ? 'التشغيل على التلفاز' : 'TV Playback'}>
            <SegmentedRow label={ar ? 'تخطيط الرئيسية' : 'Home layout'} value={c.tvPlayback.homeLayout} options={[{ value: 'classic', label: 'Classic' }, { value: 'modern', label: 'Modern' }]} onChange={(v) => update((s) => { s.controls.tvPlayback.homeLayout = v; })} />
            <ToggleRow label={ar ? 'تشغيل فوري على التلفاز' : 'Instant play'} checked={c.tvPlayback.instantPlay} onChange={(v) => update((s) => { s.controls.tvPlayback.instantPlay = v; })} />
            <ToggleRow label={ar ? 'تشغيل الحلقة التالية تلقائياً' : 'Auto-play next episode'} checked={c.tvPlayback.autoPlayNext} onChange={(v) => update((s) => { s.controls.tvPlayback.autoPlayNext = v; })} />
            <ToggleRow label={ar ? 'تخطي المقدمات والشارات' : 'Skip intros & credits'} checked={c.tvPlayback.skipIntrosCredits} onChange={(v) => update((s) => { s.controls.tvPlayback.skipIntrosCredits = v; })} />
            <ToggleRow label={ar ? 'إخفاء صور الحلقات لتجنب الحرق' : 'Hide episode thumbnails'} checked={c.tvPlayback.hideEpThumbnails} onChange={(v) => update((s) => { s.controls.tvPlayback.hideEpThumbnails = v; })} />
          </SettingSection>
        </>
      );
    }
    return (
      <>
        {tvBanner}
        <SettingSection title={ar ? 'لغات ومحتوى التلفاز' : 'TV Content'}>
          <TagPriorityList label={ar ? 'أولوية الصوت والترجمة على التلفاز' : 'TV Preferred Languages'} tags={data.languages.subtitlePriority} availableOptions={['Arabic', 'English', 'Japanese', 'French']} onChange={(next) => update((s) => { s.languages.subtitlePriority = next; })} />
        </SettingSection>
      </>
    );
  }

  // big-picture
  return (
    <SettingSection title={ar ? 'وضع الشاشة الكبيرة (Big Picture)' : 'Big Picture Mode'}>
      <ToggleRow label={ar ? 'البدء بوضع الشاشة الكبيرة' : 'Start in Big Picture'} checked={c.bigPictureStart} onChange={(v) => update((s) => { s.controls.bigPictureStart = v; })} />
      <ToggleRow label={ar ? 'إظهار زر وضع الشاشة الكبيرة في الشريط العلوي' : 'Show Big Picture button'} checked={c.bigPictureButton} onChange={(v) => update((s) => { s.controls.bigPictureButton = v; })} />
      <ToggleRow label={ar ? 'خلفية متحركة' : 'Animated backdrop'} checked={c.bigPictureAnimatedBackdrop} onChange={(v) => update((s) => { s.controls.bigPictureAnimatedBackdrop = v; })} />
      <SegmentedRow label={ar ? 'أصوات التنقل' : 'Interface sounds'} value={c.bigPictureSounds} options={[{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'modern', label: 'Modern' }, { value: 'cinematic', label: 'Cinematic' }, { value: 'retro', label: 'Retro' }]} onChange={(v) => update((s) => { s.controls.bigPictureSounds = v; })} />
      <SegmentedRow label={ar ? 'هوامش الحواف' : 'Edge margin'} value={c.bigPictureEdgeMargin} options={(['off', '2%', '3.5%', '5%'] as const).map((m) => ({ value: m, label: m }))} onChange={(v) => update((s) => { s.controls.bigPictureEdgeMargin = v; })} />
    </SettingSection>
  );
}
