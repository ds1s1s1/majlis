export interface ComponentItem {
  id: string;
  sizeMb: number;
  required?: boolean;
  defaultEnabled?: boolean;
  skipped?: boolean;
}

export const INSTALLER_CONFIG = {
  appNameAr: 'مجلس',
  appNameEn: 'Majlis',
  version: '0.1.2beta',
  links: [
    { key: 'source', url: 'https://github.com/ds1s1s1/majlis' },
    { key: 'bugs', url: 'https://github.com/ds1s1s1/majlis/issues' },
    { key: 'releases', url: 'https://github.com/ds1s1s1/majlis/releases' },
  ] as const,
  changelog: {
    beta: {
      version: '0.1.2beta',
      sections: [
        {
          titleAr: 'طور اللعب — العب',
          titleEn: 'Co-op Gaming Mode',
          bulletsAr: [
            'محرك بث منخفض التأخير بالعتاد مع دعم كامل ليد التحكم عن بُعد بدون تقطيع.',
            'إدارة الصلاحيات والأدوار لأصحابك داخل المجلس مع حماية فورية بضغطة زر.',
          ],
          bulletsEn: [
            'Hardware-accelerated ultra-low-latency streaming with remote gamepad handoff.',
            'Granular guest slot permissions and instant host panic-mute isolation.',
          ],
        },
        {
          titleAr: 'السينما والسهرة',
          titleEn: 'Cinema & Watch Party',
          bulletsAr: [
            'مشغل libmpv أصلي بعتاد D3D11 مدمج مع خادم stremio-server و FFmpeg و yt-dlp وخطوط عربية مرفقة تلقائياً.',
            'صفحة ملف شخصي كاملة ونظام إعدادات متكامل وتصويت على الأفلام.',
          ],
          bulletsEn: [
            'Native D3D11 libmpv theater stage with bundled stremio-server, FFmpeg, yt-dlp & Arabic ASS/SRT fonts.',
            'Complete community profiles, Watch Party voting wheel, and fast addon fan-out.',
          ],
        },
        {
          titleAr: 'الشبكة و IPv6',
          titleEn: 'Network & IPv6 Relay',
          bulletsAr: [
            'تجاوز تلقائي للراوترات المغلقة عبر QUIC و IPv6 و TURN بتشفير طرف لطرف.',
          ],
          bulletsEn: [
            'Zero-config NAT traversal over QUIC, IPv6, and encrypted TURN relay fallback.',
          ],
        },
      ],
    },
    stable: {
      version: '0.1.2-beta',
      sections: [
        {
          titleAr: 'الاستقرار والأداء',
          titleEn: 'Core Stability & Startup',
          bulletsAr: [
            'تشغيل فوري لواجهة السينما وتقليل زمن الإقلاع.',
            'دعم الإغلاق التام لصينية النظام وإيقاف المشغل بدون أي صوت عالق.',
          ],
          bulletsEn: [
            'Cinema-first instant cold boot with lazy background helpers.',
            'Optional system tray residence & clean teardown preventing phantom player audio.',
          ],
        },
      ],
    },
  },
  coreComponents: [
    { id: 'core', sizeMb: 145, required: true, defaultEnabled: true },
    { id: 'engine', sizeMb: 118, required: true, defaultEnabled: true },
    { id: 'media', sizeMb: 94, required: true, defaultEnabled: true },
    { id: 'network', sizeMb: 18, required: true, defaultEnabled: true },
    { id: 'webview2', sizeMb: 0, required: true, defaultEnabled: true, skipped: true },
    { id: 'shortcuts', sizeMb: 0, required: true, defaultEnabled: true },
  ] as ComponentItem[],
  optionalComponents: [
    { id: 'opt_gamepad', sizeMb: 24, defaultEnabled: true },
    { id: 'opt_metadata', sizeMb: 42, defaultEnabled: true },
    { id: 'opt_discord', sizeMb: 8, defaultEnabled: false },
  ] as ComponentItem[],
  multilingualContinue: [
    'متابعة',
    'CONTINUE',
    'CONTINUAR',
    'WEITER',
    'CONTINUER',
    'ПРОДОЛЖИТЬ',
    '続行',
    '계속',
  ],
};
