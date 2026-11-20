import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Gauge, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';
import { cin, invoke } from '../../api';
import { useHost } from '../../host';
import {
  ActionRow, DropdownRow, InfoBanner, InputRow, LivePreviewCard,
  RadioCardGroup, SegmentedRow, SettingSection, SliderRow, ToggleRow,
} from '../primitives';
import { useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const TONE_CURVES: { id: 'auto' | 'bt.2446a' | 'bt.2390' | 'hable' | 'mobius' | 'reinhard' | 'spline'; label: string; d: string }[] = [
  { id: 'auto', label: 'Auto (recommended)', d: 'M 4 52 C 18 46, 36 16, 76 10' },
  { id: 'bt.2446a', label: 'Cinema HDR (bt.2446a)', d: 'M 4 52 C 18 42, 38 14, 76 9' },
  { id: 'bt.2390', label: 'Reference (bt.2390)', d: 'M 4 52 C 20 38, 42 14, 76 12' },
  { id: 'hable', label: 'Filmic (hable)', d: 'M 4 52 C 22 48, 44 18, 76 11' },
  { id: 'mobius', label: 'Balanced (mobius)', d: 'M 4 52 L 32 22 Q 48 12, 76 11' },
  { id: 'reinhard', label: 'Soft (reinhard)', d: 'M 4 52 Q 26 20, 76 12' },
  { id: 'spline', label: 'Modern (spline)', d: 'M 4 52 C 16 40, 38 14, 76 8' },
];

export function PlaybackPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const { data, update, setActivePage } = useSettingsStore();
  const p = data.playback;
  const qc = useQueryClient();
  const appStateQ = useQuery({
    queryKey: ['app-state'],
    queryFn: () => invoke<{ settings?: { smartCatchUp?: boolean } }>('state').catch(() => null),
    staleTime: 5000,
  });
  const prefsQ = useQuery({
    queryKey: ['prefs'],
    queryFn: () => cin<{ perf?: boolean; cinemaPerfMode?: boolean; autoSkipStalled?: boolean }>('prefs').catch(() => null),
    staleTime: 5000,
  });
  const appSt = appStateQ.data?.settings;
  const setAppSetting = async (patch: Record<string, unknown>) => {
    await invoke('settings', patch).catch(() => {});
    qc.invalidateQueries({ queryKey: ['app-state'] });
  };
  const setCinPref = async (patch: Record<string, unknown>) => {
    await cin('prefs-set', patch).catch(() => {});
    qc.invalidateQueries({ queryKey: ['prefs'] });
  };

  const [speedTesting, setSpeedTesting] = useState(false);
  const [speedResult, setSpeedResult] = useState<string | null>(null);
  const [showGenConf, setShowGenConf] = useState(false);
  const [shaderDiff, setShaderDiff] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);

  const probesQ = useQuery({
    queryKey: ['player-probes'],
    queryFn: () => cin<{
      mpv: string | null; vlc: string | null; ffmpeg: string | null; svp: string | null;
      shaders: { dir: string | null; count: number; files: string[] };
    }>('player-probes').catch(() => ({
      mpv: null, vlc: null, ffmpeg: null, svp: null, shaders: { dir: null, count: 0, files: [] as string[] },
    })),
    staleTime: 60000,
  });
  const svpInstalled = !!probesQ.data?.svp;
  const shaderInfo = probesQ.data?.shaders || { dir: null, count: 0, files: [] as string[] };

  const generatedMpvConf = useMemo(() => {
    const lines = [
      `vo=${p.renderer === 'gpu-next' ? 'gpu-next' : 'gpu'}`,
      `hwdec=${p.hwAccel === 'force' ? 'auto-safe' : 'no'}`,
      `tone-mapping=${p.picture.toneMapping}`,
      `brightness=${p.picture.brightness}`,
      `contrast=${p.picture.contrast}`,
      `saturation=${p.picture.saturation}`,
      `gamma=${p.picture.gamma}`,
      `sharpen=${p.picture.sharpen}`,
      `volume-max=${p.maxVolumeBoost}`,
      `scale-antiring=0.7`,
    ];
    if (p.equalizer === 'night') lines.push('af=acompressor=ratio=4:makeup=4');
    if (p.rtxVsr) lines.push('vf=d3d11vpp=scale=2:nvidia-true-hdr=no');
    if (p.customMpvConf.trim()) lines.push(p.customMpvConf.trim());
    return lines.join('\n');
  }, [p]);

  if (pageId === 'when-you-press-play') {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <SettingSection title={ar ? 'سلوك التشغيل' : 'Playback behavior'}>
            <DropdownRow label={ar ? 'نمط نافذة صورة داخل صورة (PiP)' : 'Picture-in-picture style'} value={p.pipStyle} options={[{ value: 'window', label: ar ? 'نافذة مستقلة' : 'Window' }, { value: 'mini', label: ar ? 'مشغل مصغر' : 'Mini-player' }]} onChange={(v) => update((s) => { s.playback.pipStyle = v; })} />
            <DropdownRow label={ar ? 'أين يبحث زر التشغيل أولاً' : 'Where Play looks first'} value={p.playLooksFirst} options={[{ value: 'online', label: ar ? 'البث المباشر أولاً' : 'Prefer online streams' }, { value: 'local', label: ar ? 'الملفات المحلية أولاً' : 'Prefer local files' }, { value: 'ask', label: ar ? 'اسأل كل مرة' : 'Ask every time' }]} onChange={(v) => update((s) => { s.playback.playLooksFirst = v; })} />
            <SegmentedRow label={ar ? 'عند الضغط على تشغيل' : 'When you press Play'} value={p.pressPlayMode} options={[{ value: 'instant', label: ar ? 'تشغيل فوري' : 'Instant' }, { value: 'pick', label: ar ? 'اختر مصدراً' : 'Pick a source' }]} onChange={(v) => update((s) => { s.playback.pressPlayMode = v; })} />
            <ToggleRow label={ar ? 'البقاء على نفس المصدر طوال الجلسة' : 'Stay on one source for a session'} checked={p.stayOnSourceSession} onChange={(v) => update((s) => { s.playback.stayOnSourceSession = v; })} />
            <ToggleRow label={ar ? 'تجهيز التشغيل الفوري مسبقاً' : 'Instant playback preparation'} checked={p.instantPrep} onChange={(v) => update((s) => { s.playback.instantPrep = v; })} />
            <ToggleRow label={ar ? 'تذكّر آخر رابط مستخدم' : 'Remember last stream'} checked={p.rememberLastStream} onChange={(v) => update((s) => { s.playback.rememberLastStream = v; })} />
          </SettingSection>

          <SettingSection title={ar ? 'الاستئناف' : 'RESUME'}>
            <ToggleRow label={ar ? 'استئناف من حيث توقفت' : 'Resume where you left off'} checked={p.resumeLeftOff} onChange={(v) => update((s) => { s.playback.resumeLeftOff = v; })} />
            <ToggleRow label={ar ? 'تأكيد قبل الاستئناف' : 'Prompt before resuming'} checked={p.promptBeforeResume} onChange={(v) => update((s) => { s.playback.promptBeforeResume = v; })} />
          </SettingSection>

          <SettingSection title={ar ? 'المصادر' : 'STREAMS'}>
            <ToggleRow label={ar ? 'تجاوز الروابط المتوقفة تلقائياً' : 'Auto-skip stalled streams'} checked={p.autoSkipStalled} onChange={(v) => { update((s) => { s.playback.autoSkipStalled = v; }); setCinPref({ autoSkipStalled: v }); }} />
            <ToggleRow label={ar ? 'وضع أداء السينما (تعليق الحركات والاستعلامات الخلفية)' : 'Cinema Performance Mode (suspend background polling & animations)'} checked={!!prefsQ.data?.cinemaPerfMode} onChange={(v) => setCinPref({ cinemaPerfMode: v })} />
            <ToggleRow label={ar ? 'اللحاق الذكي بمزامنة الغرفة (1.15x)' : 'Watch Party Smart Catch-Up (1.15x pitch-corrected)'} checked={appSt?.smartCatchUp !== false} onChange={(v) => setAppSetting({ smartCatchUp: v })} />
            <ToggleRow label={ar ? 'الاحتفاظ بنفس المزود للحلقة التالية' : 'Keep same source on next episode'} checked={p.keepSameSourceNext} onChange={(v) => update((s) => { s.playback.keepSameSourceNext = v; })} />
            <ToggleRow label={ar ? 'تنزيل الملف بالكامل أثناء البث' : 'Download the whole file while streaming'} checked={p.downloadWholeFile} onChange={(v) => update((s) => { s.playback.downloadWholeFile = v; })} />
          </SettingSection>
        </div>

        <div className="space-y-4">
          <LivePreviewCard title={ar ? 'معاينة التشغيل' : 'PLAY BEHAVIOR'}>
            <div className="rounded-xl bg-black/50 p-3 text-xs space-y-2">
              <div className="font-bold text-[var(--accent)]">{p.pressPlayMode === 'instant' ? (ar ? '▶ يبدأ فوراً' : '▶ Starts Immediately') : (ar ? '☰ قائمة الروابط' : '☰ Shows Stream Picker')}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-[var(--accent)]" style={{ width: p.resumeLeftOff ? '44%' : '0%' }} />
              </div>
              <div dir="ltr" className="flex justify-between font-mono text-[10px] text-white/55">
                <span>{p.resumeLeftOff ? '33:20' : '00:00'}</span>
                <span>1:15:40</span>
              </div>
            </div>
          </LivePreviewCard>
        </div>
      </div>
    );
  }

  if (pageId === 'video-player') {
    const runSpeedTest = async () => {
      setSpeedTesting(true);
      try {
        const res = await invoke<{
          download?: { mbps: number; ms: number } | null;
          upload?: { mbps: number } | null;
          relays?: { best?: number | null }[];
        }>('netcheck', { download: true, upload: true }).catch(() => null);
        const parts: string[] = [];
        if (res?.download?.mbps) parts.push(`↓ ${res.download.mbps} Mbps`);
        if (res?.upload?.mbps) parts.push(`↑ ${res.upload.mbps} Mbps`);
        const rtt = res?.relays?.[0]?.best;
        if (typeof rtt === 'number' && rtt > 0) parts.push(`${Math.round(rtt)} ms`);
        setSpeedResult(parts.length
          ? parts.join(' · ')
          : (ar ? 'تعذر قياس السرعة — تحقق من الاتصال' : 'Speed test unavailable — check connection'));
      } finally {
        setSpeedTesting(false);
      }
    };
    return (
      <>
        <SettingSection title={ar ? 'محرك المشغل' : 'Player engine'}>
          <RadioCardGroup
            columns={3}
            value={p.engine}
            onChange={(v) => update((s) => { s.playback.engine = v; })}
            options={[
              { value: 'auto', title: 'Auto', badge: 'RECOMMENDED', description: ar ? 'اختيار ذكي حسب الفيديو و HDR.' : 'Smart engine selection per stream.' },
              { value: 'html5', title: 'HTML5', description: ar ? 'مشغل ويب خفيف للروابط القياسية.' : 'Lightweight built-in web player.' },
              { value: 'mpv', title: 'mpv (libmpv)', description: ar ? 'TrueHD و DTS-HD و AV1 والشادرز.' : 'Native engine for TrueHD, DTS-HD, AV1 & shaders.' },
            ]}
          />
          <ToggleRow label={ar ? 'التشغيل عبر مشغل mpv الخارجي الخاص بي' : 'Play in my own mpv'} checked={p.externalMpv} onChange={(v) => update((s) => { s.playback.externalMpv = v; })} />
          <ToggleRow label={ar ? 'دمج نافذة mpv داخل تطبيق مجلس' : 'Embed mpv inside App window'} checked={p.embedMpv} onChange={(v) => update((s) => { s.playback.embedMpv = v; })} />
        </SettingSection>

        <SettingSection title="HDR">
          <RadioCardGroup
            columns={3}
            value={p.hdrMode}
            onChange={(v) => update((s) => { s.playback.hdrMode = v; })}
            options={[
              { value: 'sdr', title: ar ? 'تحويل الألوان إلى SDR' : 'Tone-map to SDR', badge: 'RECOMMENDED', description: ar ? 'مظهر متوازن على جميع الشاشات.' : 'Consistent colors across standard displays.' },
              { value: 'hdr-window', title: ar ? 'HDR حقيقي في نافذة مستقلة' : 'True HDR, separate window', description: ar ? 'خرج HDR10 أصلي لشاشتك.' : 'Native HDR passthrough window.' },
              { value: 'hdr-embedded', title: ar ? 'HDR مدمج (تجريبي)' : 'True HDR, embedded', badge: 'EXPERIMENTAL', description: ar ? 'تحت نافذة مجلس مباشرة.' : 'Experimental embedded HDR composition.' },
            ]}
          />
        </SettingSection>

        <SettingSection title={ar ? 'الشاشة والمعالجة' : 'DISPLAY & STREAMING'}>
          <SegmentedRow
            label={ar ? 'نوع الشاشة' : 'Display panel'}
            value={p.displayPanel}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'oled', label: 'OLED' }, { value: 'lcd', label: 'LCD' }]}
            onChange={(v) => update((s) => { s.playback.displayPanel = v; })}
            caption={p.displayPanel === 'oled' ? (ar ? 'تباين أسود مطلق وحماية التفاصيل الداكنة.' : 'Pure true black curve optimized for OLED.') : undefined}
          />
          <ToggleRow label="RTX Video HDR" badge="EXPERIMENTAL" checked={p.rtxVideoHdr} onChange={(v) => update((s) => { s.playback.rtxVideoHdr = v; })} />
          <ToggleRow label="RTX Video Super Resolution" badge="EXPERIMENTAL" checked={p.rtxVsr} onChange={(v) => update((s) => { s.playback.rtxVsr = v; })} />
          <DropdownRow label={ar ? 'توافق الجهاز' : 'Device compatibility'} value={p.deviceCompat} options={[{ value: 'auto', label: 'Automatic' }, { value: 'transcode', label: 'Force transcode' }, { value: 'direct', label: 'Direct play only' }]} onChange={(v) => update((s) => { s.playback.deviceCompat = v; })} />
          <SegmentedRow label={ar ? 'سقف سرعة الإنترنت' : 'Internet speed'} value={p.internetSpeedCap} options={[{ value: 'unlimited', label: 'No limit' }, { value: '10', label: '10M' }, { value: '25', label: '25M' }, { value: '50', label: '50M' }, { value: '100', label: '100M' }, { value: '300', label: '300M' }, { value: '1000', label: '1G' }]} onChange={(v) => update((s) => { s.playback.internetSpeedCap = v; })} />
          <ActionRow label={ar ? 'اختبار السرعة' : 'Speed test'} description={speedResult || (ar ? 'افحص جاهزية الشبكة لبث 4K' : 'Check connection throughput')} buttonLabel={ar ? 'تشغيل الاختبار' : 'Run speed test'} busy={speedTesting} extra={speedResult ? <Gauge size={14} className="text-emerald-400" /> : null} onClick={runSpeedTest} />
          <ToggleRow label={ar ? 'الوضع النظيف بدون عناصر إضافية (OSD)' : 'Line-free clean mode'} checked={p.cleanMode} onChange={(v) => update((s) => { s.playback.cleanMode = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'aspect-ratio') {
    const ratioBox: Record<typeof p.aspectRatio, string> = {
      fit: 'inset-x-8 inset-y-2', fill: '-inset-4', stretch: 'inset-0',
      '16:9': 'inset-x-3 inset-y-2', '4:3': 'inset-x-16 inset-y-1', '21:9': 'inset-x-2 inset-y-10', '1.85:1': 'inset-x-4 inset-y-3', '2.39:1': 'inset-x-2 inset-y-12',
    };
    return (
      <>
        <SettingSection title={ar ? 'نسبة العرض' : 'Aspect ratio'}>
          <SegmentedRow
            label={ar ? 'نسبة العرض المطبقة' : 'Target ratio'}
            value={p.aspectRatio}
            options={(['fit', 'fill', 'stretch', '16:9', '4:3', '21:9', '1.85:1', '2.39:1'] as const).map((r) => ({ value: r, label: r.toUpperCase() }))}
            onChange={(v) => update((s) => { s.playback.aspectRatio = v; })}
          />
          <div className="pt-4">
            <LivePreviewCard>
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/15">
                <div className={`absolute rounded bg-gradient-to-br from-[#3b2912] via-[#1f1812] to-[#12100E] ring-1 ring-[var(--accent)]/60 transition-all duration-300 flex items-center justify-center ${ratioBox[p.aspectRatio]}`}>
                  <span dir="ltr" className="font-mono text-sm font-bold text-[var(--accent)]">{p.aspectRatio.toUpperCase()}</span>
                </div>
              </div>
            </LivePreviewCard>
          </div>
          <ActionRow label={ar ? 'تغيير النسبة أثناء المشاهدة' : 'Change the ratio while watching'} buttonLabel={ar ? 'تفعيل في تخطيط المشغل' : 'Turn it on in Player layout'} onClick={() => setActivePage('player-layout')} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'audio') {
    const eqCaptions: Record<typeof p.equalizer, string> = {
      off: ar ? 'صوت قياسي دون تعديل.' : 'Flat reference audio curve.',
      bass: ar ? 'تعزيز الترددات المنخفضة للأكشن.' : 'Boosts low-end punch (+6 dB under 120Hz).',
      vocal: ar ? 'وضوح أعلى للحوار والمحادثات.' : 'Lifts 1–4 kHz mid frequencies for crisp dialogue.',
      'less-bass': ar ? 'تخفيف الجهير للغرف المشتركة.' : 'Reduces rumble and sub-bass resonance.',
      night: ar ? 'ضغط المدى الديناميكي لحماية أذنيك ليلاً.' : 'Dynamic range compression tames loud explosions while keeping whispers audible.',
    };
    return (
      <>
        <SettingSection title={ar ? 'إعدادات الصوت' : 'Audio processing'}>
          <ToggleRow label={ar ? 'توحيد مستوى الصوت' : 'Normalize loudness'} checked={p.normalizeLoudness} onChange={(v) => update((s) => { s.playback.normalizeLoudness = v; })} />
          <ToggleRow label={ar ? 'دمج الصوت المحيطي إلى ستيريو' : 'Mix surround sound down to stereo'} checked={p.mixSurroundStereo} onChange={(v) => update((s) => { s.playback.mixSurroundStereo = v; })} />
          <SegmentedRow
            label={ar ? 'المعادل الصوتي (EQ)' : 'Equalizer'}
            value={p.equalizer}
            options={[
              { value: 'off', label: ar ? 'إيقاف' : 'Off' },
              { value: 'bass', label: 'Bass boost' },
              { value: 'vocal', label: 'Vocal clarity' },
              { value: 'less-bass', label: 'Less bass' },
              { value: 'night', label: 'Night mode' },
            ]}
            caption={eqCaptions[p.equalizer]}
            onChange={(v) => update((s) => { s.playback.equalizer = v; })}
          />
          <SegmentedRow
            label={ar ? 'أقصى تضخيم للصوت' : 'Maximum volume boost'}
            value={p.maxVolumeBoost}
            options={([100, 150, 200, 250, 300, 400] as const).map((n) => ({ value: n, label: `${n}%` }))}
            caption={p.maxVolumeBoost > 200 ? (ar ? 'تنبيه: القيم فوق 200% قد تسبب تشويشاً في الصوت.' : 'Warning: values above 200% may cause clipping or distortion.') : undefined}
            onChange={(v) => update((s) => { s.playback.maxVolumeBoost = v; })}
          />
          <DropdownRow label={ar ? 'جهاز الإخراج' : 'Output device'} value={p.outputDevice} options={[{ value: 'system-default', label: ar ? 'افتراضي النظام' : 'System default' }, { value: 'wasapi-hdmi', label: 'HDMI / DisplayPort Audio' }, { value: 'spdif', label: 'Digital Optical (S/PDIF)' }]} onChange={(v) => update((s) => { s.playback.outputDevice = v; })} />
        </SettingSection>
        <VoiceChatAudioSection ar={ar} toast={toast} />
      </>
    );
  }

  if (pageId === 'on-screen-controls') {
    const posCls = p.volumePopupPos === 'top-left' ? 'start-3 top-3' : p.volumePopupPos === 'top-right' ? 'end-3 top-3' : 'left-1/2 -translate-x-1/2 top-3';
    return (
      <SettingSection title={ar ? 'عناصر التحكم على الشاشة' : 'On-screen controls'}>
        <ToggleRow label={ar ? 'إظهار شارة جودة البث في المشغل' : 'Stream quality in player'} checked={p.streamQualityInPlayer} onChange={(v) => update((s) => { s.playback.streamQualityInPlayer = v; })} />
        <ToggleRow label={ar ? 'إظهار الأزرار عند الإيقاف من لوحة المفاتيح' : 'Show controls when pausing with keyboard'} checked={p.showControlsOnKeyboardPause} onChange={(v) => update((s) => { s.playback.showControlsOnKeyboardPause = v; })} />
        <ToggleRow label={ar ? 'مؤقت النوم في الشريط العلوي' : 'Sleep timer in the top bar'} checked={p.sleepTimerInTopBar} onChange={(v) => update((s) => { s.playback.sleepTimerInTopBar = v; })} />
        <DropdownRow label={ar ? 'وضع ملء الشاشة' : 'Fullscreen window class'} value={p.fullscreenClass} options={[{ value: 'true', label: ar ? 'ملء شاشة حصري' : 'True fullscreen' }, { value: 'borderless', label: ar ? 'ملء شاشة بدون حدود' : 'Borderless fullscreen' }]} onChange={(v) => update((s) => { s.playback.fullscreenClass = v; })} />
        <ToggleRow label={ar ? 'البقاء بملء الشاشة بعد إغلاق الفيديو' : 'Stay in fullscreen after closing the player'} checked={p.stayFullscreenAfterClose} onChange={(v) => update((s) => { s.playback.stayFullscreenAfterClose = v; })} />
        <ToggleRow label={ar ? 'استعادة موضع النافذة بعد الخروج من ملء الشاشة' : 'Restore window position after fullscreen'} checked={p.restoreWindowPos} onChange={(v) => update((s) => { s.playback.restoreWindowPos = v; })} />
        <ToggleRow label={ar ? 'إشعار الصوت المنبثق أثناء المشاهدة' : 'Volume pop-up while watching'} checked={p.volumePopup} onChange={(v) => update((s) => { s.playback.volumePopup = v; })} />
        <SegmentedRow label={ar ? 'موقع منبثق الصوت' : 'Pop-up position'} value={p.volumePopupPos} options={[{ value: 'top', label: 'Top' }, { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }]} onChange={(v) => update((s) => { s.playback.volumePopupPos = v; })} />
        {p.volumePopup ? (
          <div className="pt-4">
            <LivePreviewCard>
              <div className="relative h-28 w-full rounded-xl bg-black/60 ring-1 ring-white/10">
                <div className={`absolute ${posCls} rounded-full bg-[#1C1915] px-3 py-1 font-mono text-xs font-bold text-[var(--accent)] ring-1 ring-[var(--accent)]/50 transition-all`}>
                  VOL 78%
                </div>
              </div>
            </LivePreviewCard>
          </div>
        ) : null}
      </SettingSection>
    );
  }

  if (pageId === 'xray') {
    return (
      <SettingSection title="X-Ray" badge="EXPERIMENTAL">
        <ToggleRow label={ar ? 'تفعيل X-Ray (طاقم الممثلين عند الإيقاف)' : 'Enable X-Ray (experimental)'} description={ar ? 'يعرض أسماء الممثلين والمشهد عند إيقاف الفيديو مؤقتاً.' : 'Displays cast cards & actor metadata when paused.'} checked={p.xrayEnabled} onChange={(v) => update((s) => { s.playback.xrayEnabled = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'ad-skipping') {
    return (
      <SettingSection title={ar ? 'تخطي المقاطع الإعلانية المدمجة' : 'Injected ad skip'} badge="EXPERIMENTAL">
        <div className="mb-3 flex h-7 overflow-hidden rounded-lg font-mono text-[10px] font-bold">
          <div className="flex flex-[4] items-center justify-center bg-emerald-500/20 text-emerald-200">VIDEO</div>
          <div className="flex flex-[2] items-center justify-center bg-amber-500/30 text-amber-200 border-x border-black">INJECTED AD</div>
          <div className="flex flex-[4] items-center justify-center bg-emerald-500/20 text-emerald-200">VIDEO CONTINUES</div>
        </div>
        <ToggleRow label={ar ? 'تفعيل تخطي الإعلانات المدمجة' : 'Enable injected ad skip'} checked={p.adSkipEnabled} onChange={(v) => update((s) => { s.playback.adSkipEnabled = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'intros') {
    return (
      <SettingSection title={ar ? 'المقدمات والشارات' : 'Intros & recaps'}>
        <ToggleRow label={ar ? 'إظهار زر التخطي' : 'Show the Skip button'} checked={p.showSkipButton} onChange={(v) => update((s) => { s.playback.showSkipButton = v; })} />
        <ToggleRow label={ar ? 'تخطي المقدمات تلقائياً' : 'Auto-skip intros'} checked={p.autoSkipIntros} onChange={(v) => update((s) => { s.playback.autoSkipIntros = v; })} />
        <ToggleRow label={ar ? 'تخطي الملخصات تلقائياً' : 'Auto-skip recaps'} checked={p.autoSkipRecaps} onChange={(v) => update((s) => { s.playback.autoSkipRecaps = v; })} />
        <ToggleRow label={ar ? 'تخطي شارة النهاية تلقائياً' : 'Auto-skip credit outros'} checked={p.autoSkipCredits} onChange={(v) => update((s) => { s.playback.autoSkipCredits = v; })} />
        <SegmentedRow label={ar ? 'إخفاء زر التخطي بعد' : 'Auto-hide the Skip button after'} value={p.hideSkipAfter} options={[{ value: 'off', label: 'Off' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' }, { value: '30', label: '30s' }]} onChange={(v) => update((s) => { s.playback.hideSkipAfter = v; })} />
        <InputRow
          label={ar ? 'مفتاح المساهمة في قاعدة المقدمات' : 'Crowd-sourced intro database API key'}
          value={p.introDbKey}
          secret
          savedBadge={!!p.introDbKey}
          onChange={(v) => update((s) => { s.playback.introDbKey = v; })}
          onSave={async () => {
            await cin('keys-set', { introdb: p.introDbKey }).catch(() => {});
            qc.invalidateQueries({ queryKey: ['keys'] });
            toast(ar ? 'تم حفظ المفتاح' : 'Key saved');
          }}
        />
      </SettingSection>
    );
  }

  if (pageId === 'up-next') {
    return (
      <>
        <SettingSection title={ar ? 'الحلقة التالية' : 'Up next'}>
          <DropdownRow label={ar ? 'توقيت ظهور الحلقة التالية' : 'Next episode prompt'} value={p.nextEpisodePrompt} options={[{ value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }, { value: '30', label: '30s' }, { value: '60', label: '60s' }, { value: '90', label: '90s' }]} onChange={(v) => update((s) => { s.playback.nextEpisodePrompt = v; })} />
          <ToggleRow label={ar ? 'تشغيل الحلقة التالية تلقائياً' : 'Auto-play next episode'} checked={p.autoPlayNext} onChange={(v) => update((s) => { s.playback.autoPlayNext = v; })} />
          <ToggleRow label={ar ? 'اسأل هل ما زلت تشاهد' : "Ask if you're still watching"} checked={p.stillWatchingPrompt} onChange={(v) => update((s) => { s.playback.stillWatchingPrompt = v; })} />
          <ToggleRow label={ar ? 'التشغيل التلقائي من القائمة' : 'Auto-play from playlist'} checked={p.autoPlayPlaylist} onChange={(v) => update((s) => { s.playback.autoPlayPlaylist = v; })} />
        </SettingSection>

        <SettingSection title={ar ? 'أعمال مشابهة في النهاية' : 'More like this at the end'}>
          <SegmentedRow label={ar ? 'توقيت الظهور' : 'Trigger offset'} value={p.moreLikeThisOffset} options={['Off', '15s', '30s', '1m', '2m', '5m'].map((v) => ({ value: v, label: v }))} onChange={(v) => update((s) => { s.playback.moreLikeThisOffset = v; })} />
          <ToggleRow label={ar ? 'إخفاء الأعمال المشاهَدة' : 'Hide watched titles'} checked={p.hideWatchedUpNext} onChange={(v) => update((s) => { s.playback.hideWatchedUpNext = v; })} />
          <ToggleRow label={ar ? 'تفعيل للمسلسلات المستمرة بالعرض' : 'On still-airing series'} checked={p.stillAiringNext} onChange={(v) => update((s) => { s.playback.stillAiringNext = v; })} />
          <ToggleRow label={ar ? 'إظهار العد التنازلي' : 'Countdown'} checked={p.upNextCountdown} onChange={(v) => update((s) => { s.playback.upNextCountdown = v; })} />
          <SegmentedRow label={ar ? 'مدة العد التنازلي' : 'Countdown length'} value={p.upNextCountdownLen} options={([5, 10, 15, 20, 30] as const).map((n) => ({ value: n, label: `${n}s` }))} onChange={(v) => update((s) => { s.playback.upNextCountdownLen = v; })} />
          <SegmentedRow label={ar ? 'عند انتهاء العد' : 'When the countdown ends'} value={p.upNextEndBehavior} options={[{ value: 'move', label: ar ? 'انتقل تلقائياً' : 'Move you on' }, { value: 'stay', label: ar ? 'ابقَ في الصفحة' : 'Stay focused' }]} onChange={(v) => update((s) => { s.playback.upNextEndBehavior = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'trailers') {
    return (
      <SettingSection title={ar ? 'العروض الترويجية' : 'Trailers'}>
        <DropdownRow label={ar ? 'جودة التشغيل' : 'Playback quality'} value={p.trailerQuality} options={[{ value: 'auto', label: 'Auto' }, { value: '2160', label: '2160p (4K)' }, { value: '1080', label: '1080p HD' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }]} onChange={(v) => update((s) => { s.playback.trailerQuality = v; })} />
        <ToggleRow label={ar ? 'تشغيل الإعلان الترويجي تلقائياً في صفحة العمل' : 'Auto-play trailer on detail pages'} checked={p.autoPlayTrailerDetail} onChange={(v) => update((s) => { s.playback.autoPlayTrailerDetail = v; })} />
        <ToggleRow label={ar ? 'التمرير لأعلى لتكبير الإعلان' : 'Scroll up for the trailer'} checked={p.scrollUpTrailer} onChange={(v) => update((s) => { s.playback.scrollUpTrailer = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'video-quality') {
    return (
      <SettingSection title={ar ? 'جودة الصورة والأداء' : 'Video quality & rendering'}>
        <RadioCardGroup
          columns={3}
          value={p.videoQualityPreset}
          onChange={(v) => update((s) => { s.playback.videoQualityPreset = v; })}
          options={[
            { value: 'weak', title: ar ? 'سلس للأجهزة الضعيفة' : 'Smooth on weak PCs', description: ar ? 'يعطي الأولوية لثبات الإطارات حتى 720p.' : 'Bilinear scaling & lower buffer footprint.' },
            { value: 'balanced', title: ar ? 'متوازن' : 'Balanced', badge: 'RECOMMENDED', description: ar ? 'Spline36 مع فك التشفير السريع 1080p.' : 'High-quality 1080p spline36 scaling.' },
            { value: 'max', title: ar ? 'أقصى جودة (4K)' : 'Maximum quality', description: ar ? 'EWA Lanczos حاد ومجهز لشاشات 4K HDR.' : 'EWA Lanczos sharp upscaling & 10-bit pipeline.' },
          ]}
        />
        <SegmentedRow label={ar ? 'تسريع العتاد (GPU)' : 'Hardware acceleration'} value={p.hwAccel} options={[{ value: 'force', label: ar ? 'تفعيل (GPU)' : 'Force on' }, { value: 'cpu', label: ar ? 'إيقاف (CPU)' : 'Off (use CPU)' }]} onChange={(v) => update((s) => { s.playback.hwAccel = v; })} />
        <SegmentedRow label={ar ? 'المُصيّر (Renderer)' : 'Renderer'} value={p.renderer} options={[{ value: 'gpu-next', label: 'GPU-next' }, { value: 'gpu', label: 'GPU (compatibility)' }]} onChange={(v) => update((s) => { s.playback.renderer = v; })} />
        <ToggleRow label={ar ? 'وضع الألوان البسيط' : 'Simple color mode'} checked={p.simpleColorMode} onChange={(v) => update((s) => { s.playback.simpleColorMode = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'picture-adjustments') {
    const pic = p.picture;
    const cssFilter = `brightness(${100 + pic.brightness}%) contrast(${100 + pic.contrast}%) saturate(${100 + pic.saturation}%)`;
    return (
      <>
        <SettingSection title={ar ? 'تعديلات بلمسة واحدة' : 'One-tap looks'}>
          <div className="flex flex-wrap gap-2 py-2">
            {[
              { label: ar ? 'تفتيح المشاهد الداكنة' : 'Brighten dark scenes', apply: { brightness: 12, contrast: 6, gamma: 10, saturation: 5 } },
              { label: ar ? 'ألوان أغنى' : 'Punchier color', apply: { saturation: 18, contrast: 8 } },
              { label: ar ? 'مريح للعين' : 'Easy on the eyes', apply: { brightness: -6, contrast: -4, saturation: -8 } },
              { label: ar ? 'حدة للأنمي والكرتون' : 'Crisp (anime & cartoons)', apply: { sharpen: 0.75, contrast: 10, saturation: 12 } },
            ].map((pr) => (
              <button
                key={pr.label}
                type="button"
                onClick={() => update((s) => { s.playback.picture = { ...s.playback.picture, ...pr.apply }; })}
                className="rounded-full border border-[var(--border-strong)] bg-black/35 px-3.5 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {pr.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => update((s) => { s.playback.picture = { brightness: 0, contrast: 0, saturation: 0, gamma: 0, sharpen: 0, toneMapping: 'auto', boostSdrToHdr: false }; })}
              className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              {ar ? 'إعادة ضبط الصورة' : 'Reset picture'}
            </button>
          </div>
        </SettingSection>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <SettingSection title={ar ? 'تعديلات دقيقة' : 'Picture controls'}>
            <SliderRow label={ar ? 'السطوع' : 'Brightness'} value={pic.brightness} min={-50} max={50} defaultValue={0} onChange={(v) => update((s) => { s.playback.picture.brightness = v; })} />
            <SliderRow label={ar ? 'التباين' : 'Contrast'} value={pic.contrast} min={-50} max={50} defaultValue={0} onChange={(v) => update((s) => { s.playback.picture.contrast = v; })} />
            <SliderRow label={ar ? 'التشبع اللوني' : 'Saturation'} value={pic.saturation} min={-50} max={50} defaultValue={0} onChange={(v) => update((s) => { s.playback.picture.saturation = v; })} />
            <SliderRow label={ar ? 'الجاما والظلال' : 'Gamma / Midtones'} value={pic.gamma} min={-50} max={50} defaultValue={0} onChange={(v) => update((s) => { s.playback.picture.gamma = v; })} />
            <SliderRow label={ar ? 'الحدة (Sharpen)' : 'Sharpen'} value={pic.sharpen} min={0} max={2} step={0.1} defaultValue={0} onChange={(v) => update((s) => { s.playback.picture.sharpen = v; })} />
          </SettingSection>

          <div className="lg:sticky lg:top-6 self-start">
            <LivePreviewCard>
              <div className="overflow-hidden rounded-xl bg-black ring-1 ring-white/10" style={{ filter: cssFilter }}>
                <svg viewBox="0 0 320 180" className="w-full h-40">
                  <defs>
                    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#3B82F6" /><stop offset="55%" stopColor="#E5A93C" /><stop offset="100%" stopColor="#7C2D12" /></linearGradient>
                  </defs>
                  <rect width="320" height="180" fill="url(#sky)" />
                  <circle cx="245" cy="52" r="24" fill="#FEF08A" />
                  <path d="M0 140 L70 92 L130 125 L205 78 L320 140 L320 180 L0 180 Z" fill="#181613" />
                </svg>
              </div>
              <div dir="ltr" className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">{cssFilter}</div>
            </LivePreviewCard>
          </div>
        </div>

        <SettingSection title={ar ? 'الألوان ومعالجة HDR' : 'Color & HDR Tone-Mapping'}>
          <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
            {TONE_CURVES.map((c) => {
              const on = pic.toneMapping === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => update((s) => { s.playback.picture.toneMapping = c.id; })}
                  className={`rounded-xl border p-3 text-start transition ${on ? 'border-[var(--accent)] bg-[var(--surface-active)]' : 'border-[var(--border-subtle)] bg-black/25 hover:bg-white/5'}`}
                >
                  <svg viewBox="0 0 80 56" className="mb-2 h-12 w-full rounded bg-black/50 p-1">
                    <path d={c.d} fill="none" stroke={on ? 'var(--accent)' : '#A1A1AA'} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <div className="text-xs font-semibold">{c.label}</div>
                </button>
              );
            })}
          </div>
          <ToggleRow label={ar ? 'رفع ألوان SDR نحو HDR' : 'Boost SDR video toward HDR'} checked={pic.boostSdrToHdr} onChange={(v) => update((s) => { s.playback.picture.boostSdrToHdr = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'playback-buffering') {
    const specs: Record<typeof p.bufferSize, { ahead: string; mem: string; wait: string }> = {
      auto: { ahead: '5 min', mem: '512 MiB', wait: '1 sec' },
      small: { ahead: '2 min', mem: '256 MiB', wait: '0.5 sec' },
      medium: { ahead: '5 min', mem: '1 GiB', wait: '1 sec' },
      large: { ahead: '12 min', mem: '2 GiB', wait: '1.5 sec' },
      max: { ahead: '30 min', mem: '4 GiB', wait: '2 sec' },
    };
    const cur = specs[p.bufferSize];
    return (
      <SettingSection title={ar ? 'التخزين المؤقت للفيديو' : 'Playback buffering'}>
        <SegmentedRow label={ar ? 'حجم المخزن المؤقت' : 'Buffer size'} value={p.bufferSize} options={[{ value: 'auto', label: 'Auto' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'max', label: 'Maximum' }]} onChange={(v) => update((s) => { s.playback.bufferSize = v; })} />
        <div className="grid grid-cols-3 gap-3 pt-4 text-center">
          <div className="rounded-xl bg-black/30 p-3"><div className="text-[11px] text-[var(--text-muted)]">Read-ahead</div><div dir="ltr" className="mt-1 font-mono text-sm font-bold text-[var(--accent)]">{cur.ahead}</div></div>
          <div className="rounded-xl bg-black/30 p-3"><div className="text-[11px] text-[var(--text-muted)]">Memory cap</div><div dir="ltr" className="mt-1 font-mono text-sm font-bold text-[var(--accent)]">{cur.mem}</div></div>
          <div className="rounded-xl bg-black/30 p-3"><div className="text-[11px] text-[var(--text-muted)]">Wait before playing</div><div dir="ltr" className="mt-1 font-mono text-sm font-bold text-[var(--accent)]">{cur.wait}</div></div>
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'mpv-conf') {
    return (
      <SettingSection title="Advanced mpv.conf" subtitle={ar ? 'إضافة أوامر libmpv مباشرة بصيغة key=value' : 'Raw key=value mpv options appended to player config'}>
        <textarea
          dir="ltr"
          rows={8}
          value={p.customMpvConf}
          onChange={(e) => update((s) => { s.playback.customMpvConf = e.target.value; })}
          className="w-full rounded-xl border border-[var(--border-strong)] bg-black/45 p-3 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <div className="pt-3">
          <button type="button" onClick={() => setShowGenConf((s) => !s)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
            <ChevronDown size={14} className={`transition-transform ${showGenConf ? 'rotate-180' : ''}`} />
            <span>{ar ? 'معاينة الإعدادات المولدة تلقائياً' : 'View generated mpv options'}</span>
          </button>
          {showGenConf ? (
            <pre dir="ltr" className="mt-2 overflow-x-auto rounded-xl bg-black/45 p-3 font-mono text-[11px] text-white/75 ring-1 ring-white/10">
              {generatedMpvConf}
            </pre>
          ) : null}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'anime-shaders' || pageId === 'image-shaders') {
    const isAnime = pageId === 'anime-shaders';
    const shaderCards = isAnime
      ? [
          { id: 'fsrcnnx', title: 'FSRCNNX', desc: 'Neural network shader for ultra-crisp anime lines.' },
          { id: 'ravu', title: 'RAVU-Lite', desc: 'Lightweight compute shader upscaler.' },
          { id: 'nnedi3', title: 'NNEDI3', desc: 'Deinterlacing & smooth edge anti-aliasing.' },
        ]
      : [
          { id: 'fsr', title: 'AMD FSR', desc: 'FidelityFX Super Resolution spatial upscaler.' },
          { id: 'nis', title: 'NVIDIA NIS', desc: 'Cross-platform spatial sharpening & scaling.' },
          { id: 'sgsr', title: 'Snapdragon SGSR', desc: 'Fast edge-aware mobile/desktop upscaler.' },
          { id: 'ssim', title: 'SSimSuperRes', desc: 'Structural detail recovery downscaler/upscaler.' },
          { id: 'krig', title: 'KrigBilateral', desc: 'Chroma upscaling using luma edge guidance.' },
          { id: 'adaptive', title: 'Adaptive Sharpen', desc: 'Smart edge sharpening without halos.' },
          { id: 'cas', title: 'Contrast Adaptive Sharpening', desc: 'Micro-contrast detail enhancement.' },
          { id: 'hdrtoys', title: 'hdr-toys tone-mapping', desc: 'Cinema HDR gamut & highlight mapping.' },
        ];
    return (
      <>
        {isAnime ? (
          <SettingSection title="Anime4K upscaling">
            <ToggleRow label={ar ? 'تفعيل Anime4K' : 'Enable Anime4K'} checked={p.anime4kEnabled} onChange={(v) => update((s) => { s.playback.anime4kEnabled = v; })} />
            <ToggleRow label={ar ? 'تطبيقه على الأنمي فقط' : 'Only on anime'} checked={p.anime4kOnlyAnime} onChange={(v) => update((s) => { s.playback.anime4kOnlyAnime = v; })} />
            <ToggleRow label={ar ? 'إظهار شارة Anime4K' : 'Show Anime4K indicator'} checked={p.anime4kIndicator} onChange={(v) => update((s) => { s.playback.anime4kIndicator = v; })} />
            <SegmentedRow label={ar ? 'الأولوية' : 'Preset tier'} value={p.anime4kTier} options={[{ value: 'quality', label: 'Quality' }, { value: 'performance', label: 'Performance' }]} onChange={(v) => update((s) => { s.playback.anime4kTier = v; })} />
            <RadioCardGroup
              columns={3}
              value={p.anime4kMode}
              onChange={(v) => update((s) => { s.playback.anime4kMode = v; })}
              options={['A', 'B', 'C', 'AA', 'BB', 'CA'].map((m) => ({
                value: m as typeof p.anime4kMode,
                title: `Mode ${m.replace('AA', 'A+A').replace('BB', 'B+B').replace('CA', 'C+A')}`,
                description: m.includes('A') ? 'Restore + Upscale balanced preset' : 'Smooth denoising & line restoration',
              }))}
            />
            <ActionRow
              label={ar ? 'مظللات Shader المحلية ومُحسّن الصورة المدمج' : 'Shader Pipeline & GLSL Status'}
              description={shaderInfo.count > 0
                ? (ar ? `${shaderInfo.count} ملف .glsl مكتشف (${shaderInfo.files.slice(0, 3).join(', ')})` : `${shaderInfo.count} .glsl shaders detected (${shaderInfo.files.slice(0, 3).join(', ')})`)
                : (ar ? 'يعمل تحسين الصورة المدمج (Deband + Sharpen) عبر GPU بدون ملفات خارجية' : 'Built-in GPU Deband & Sharpen active; optional .glsl files loaded from shaders folder if present')}
              buttonLabel={ar ? 'إعادة الفحص' : 'Rescan'}
              onClick={async () => {
                const res = await probesQ.refetch();
                const cnt = res.data?.shaders?.count || 0;
                update((s) => { s.playback.shadersInstalled = cnt > 0; });
                toast(ar ? `تم الفحص: ${cnt} ملف GLSL` : `Rescanned: ${cnt} GLSL files`);
              }}
            />
          </SettingSection>
        ) : null}

        <SettingSection title={isAnime ? 'Anime upscalers' : (ar ? 'مظللات الصورة والـ HDR' : 'Image & HDR shaders')}>
          {shaderCards.map((sc) => (
            <div key={sc.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles size={13} className="text-[var(--accent)]" />
                    <span>{sc.title}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{sc.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setShaderDiff(shaderDiff === sc.id ? null : sc.id)} className="rounded-full bg-white/8 px-3 py-1 text-[11px] hover:bg-white/15">
                    {ar ? 'معاينة الفرق' : 'See the difference'}
                  </button>
                  <button type="button" onClick={() => probesQ.refetch()} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] hover:bg-white/15">
                    <RefreshCw size={11} />{ar ? 'فحص' : 'Check'}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!p.enabledShaders[sc.id]}
                    onClick={() => update((s) => { s.playback.enabledShaders[sc.id] = !s.playback.enabledShaders[sc.id]; })}
                    className={`relative h-[22px] w-[40px] rounded-full transition ${p.enabledShaders[sc.id] ? 'bg-[var(--accent)]' : 'bg-white/15'}`}
                  >
                    <span className={`absolute top-[3px] size-4 rounded-full bg-white transition-all ${p.enabledShaders[sc.id] ? 'start-[21px]' : 'start-[3px]'}`} />
                  </button>
                </div>
              </div>
              {shaderDiff === sc.id ? (
                <div className="rounded-xl bg-black/35 p-3 text-xs text-[var(--text-secondary)]">
                  {sc.desc} — Sharpens micro-edges & reconstructs sub-pixel detail in GPU shader pass.
                </div>
              ) : null}
            </div>
          ))}
        </SettingSection>
      </>
    );
  }

  if (pageId === 'manga-shaders') {
    return (
      <SettingSection title={ar ? 'تحسين جودة المانجا' : 'Manga upscaling'}>
        <ToggleRow label="Fast 2x upscaler" description={ar ? 'ترشيح EWA Lanczos / GPU عالي النعومة لحواف النصوص والرسومات.' : 'GPU shader crisp halftone & line art enhancement.'} checked={p.mangaFast2x} onChange={(v) => update((s) => { s.playback.mangaFast2x = v; })} />
        <ActionRow
          label={ar ? 'حالة المظللات المثبتة' : 'Installed GLSL Shaders'}
          description={shaderInfo.count > 0 ? `${shaderInfo.count} .glsl` : (ar ? 'يستخدم مرشح GPU المدمج تلقائياً' : 'Uses built-in GPU scaling pipeline')}
          buttonLabel={ar ? 'إعادة الفحص' : 'Rescan'}
          onClick={() => probesQ.refetch()}
        />
      </SettingSection>
    );
  }

  if (pageId === 'motion-smoothing') {
    return (
      <SettingSection
        title={ar ? 'تنعيم الحركة (Interpolation)' : 'Motion smoothing'}
        rightAction={
          <button type="button" onClick={() => setMotionPaused((x) => !x)} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs">
            {motionPaused ? <Play size={12} /> : <Pause size={12} />}
            <span>{motionPaused ? (ar ? 'استئناف المعاينة' : 'Resume preview') : (ar ? 'إيقاف المعاينة' : 'Pause preview')}</span>
          </button>
        }
      >
        <ToggleRow label={ar ? 'تفعيل تنعيم الإطارات' : 'Motion interpolation'} checked={p.motionSmoothing} onChange={(v) => update((s) => { s.playback.motionSmoothing = v; })} />
        <div className="mt-4 grid grid-cols-2 gap-4">
          {['Smoothing off (24 fps)', 'Smoothing on (60 fps)'].map((lbl, idx) => (
            <div key={lbl} className="rounded-xl border border-[var(--border-subtle)] bg-black/45 p-3">
              <div className="mb-2 text-[11px] font-semibold text-white/70">{lbl}</div>
              <div className="relative h-12 overflow-hidden rounded-lg bg-white/5">
                <div
                  className="absolute top-2 h-8 w-8 rounded-lg bg-[var(--accent)]"
                  style={{
                    left: motionPaused ? '45%' : idx === 0 ? '25%' : '65%',
                    transition: motionPaused ? 'none' : idx === 0 ? 'left 0.42s steps(6)' : 'left 0.42s linear',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  // svp-interpolation
  return (
    <SettingSection title="SVP interpolation">
      <InfoBanner
        title={svpInstalled ? 'SVP Engine Detected' : 'SVP 4 Engine Not Installed'}
        body={svpInstalled ? 'VapourSynth / SVPflow active for real-time frame interpolation.' : (ar ? 'يتطلب محرك SVP 4 مثبتاً على الجهاز.' : 'Install SmoothVideo Project (SVP 4) locally for hardware motion vectors.')}
        action={
          <div className="flex gap-2">
            <button type="button" onClick={() => probesQ.refetch()} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/15">{ar ? 'إعادة الفحص' : 'Check again'}</button>
            <button type="button" onClick={() => invoke('open', 'https://www.svp-team.com').catch(() => {})} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Get SVP</button>
          </div>
        }
      />
      <ToggleRow label={ar ? 'تفعيل SVP' : 'Enable SVP'} checked={p.svpEnabled} onChange={(v) => update((s) => { s.playback.svpEnabled = v; })} />
      <SegmentedRow label={ar ? 'تطبيق على' : 'Apply SVP to'} value={p.svpTarget} options={[{ value: 'all', label: 'All content' }, { value: 'anime', label: 'Anime only' }, { value: 'movies-tv', label: 'Movies & TV' }]} onChange={(v) => update((s) => { s.playback.svpTarget = v; })} />
      <SegmentedRow label={ar ? 'معدل الإطارات المستهدف' : 'Smoothed frame rate'} value={p.svpRate} options={[{ value: 'double', label: 'Double' }, { value: '60', label: '60 fps' }, { value: '120', label: '120 fps' }, { value: 'display', label: 'Match display' }]} onChange={(v) => update((s) => { s.playback.svpRate = v; })} />
    </SettingSection>
  );
}

function VoiceChatAudioSection({ ar, toast }: { ar: boolean; toast: (m: string) => void }) {
  const [voice, setVoice] = useState<'off' | 'ptt' | 'open'>('ptt');
  const [pttKey, setPttKey] = useState('CapsLock');
  const [voiceVol, setVoiceVol] = useState(100);
  const [autoDuck, setAutoDuck] = useState(true);

  useEffect(() => {
    invoke<{ settings?: { voice?: 'off' | 'ptt' | 'open'; pttKey?: string; voiceVol?: number; autoDuck?: boolean } }>('state')
      .then((st) => {
        const s = st?.settings;
        if (!s) return;
        if (s.voice) setVoice(s.voice);
        if (s.pttKey) setPttKey(s.pttKey);
        if (typeof s.voiceVol === 'number') setVoiceVol(Math.round(s.voiceVol * 100));
        if (s.autoDuck !== undefined) setAutoDuck(s.autoDuck !== false);
      })
      .catch(() => {});
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    await invoke('settings', patch).catch(() => {});
    if (typeof patch.voice === 'string') (window as any).__majlisVoice?.setMode?.(patch.voice);
    toast(ar ? 'تم تحديث إعدادات الصوت الجماعي' : 'Voice chat updated');
  };

  return (
    <SettingSection title={ar ? 'الدردشة الصوتية والضغط للكلام (PTT)' : 'Watch Party Voice Chat & PTT'}>
      <SegmentedRow
        label={ar ? 'وضع الميكروفون' : 'Microphone mode'}
        value={voice}
        options={[
          { value: 'off', label: ar ? 'مغلق' : 'Off' },
          { value: 'ptt', label: ar ? 'ضغط للكلام (PTT)' : 'Push-to-Talk' },
          { value: 'open', label: ar ? 'مفتوح ذكي (VAD)' : 'Open Mic (RMS Gate)' },
        ]}
        onChange={(v) => { setVoice(v); save({ voice: v }); }}
      />
      <DropdownRow
        label={ar ? 'زر الضغط للكلام' : 'Push-to-Talk Key'}
        value={pttKey}
        options={[
          { value: 'CapsLock', label: 'CapsLock' },
          { value: 'KeyV', label: 'V' },
          { value: 'KeyT', label: 'T' },
          { value: 'Mouse4', label: 'Mouse Side 4' },
          { value: 'Mouse5', label: 'Mouse Side 5' },
        ]}
        onChange={(v) => { setPttKey(v); save({ pttKey: v }); }}
      />
      <SliderRow
        label={ar ? 'مستوى صوت الأصدقاء' : 'Voice chat volume'}
        value={voiceVol}
        min={20}
        max={200}
        step={5}
        unit="%"
        defaultValue={100}
        onChange={(v) => { setVoiceVol(v); save({ voiceVol: v / 100 }); }}
      />
      <ToggleRow
        label={ar ? 'خفض صوت الفلم تلقائياً عند الكلام (-40%)' : 'Auto-duck movie volume when peers talk (-40%)'}
        checked={autoDuck}
        onChange={(v) => { setAutoDuck(v); save({ autoDuck: v }); }}
      />
    </SettingSection>
  );
}
