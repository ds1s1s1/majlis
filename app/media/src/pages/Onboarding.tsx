import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin } from '../api';
import { useT } from '../host';
import { Icon } from '../ui/Icon';
import { AccountsSection, KeysSection, LookSection, ProfilesSection, PlaybackSection } from './Profile';

// First visit to Cinema: who you are, how it looks, what to bring in, optional keys. Every step
// can be skipped; all of it stays changeable on the profile page.
export function Onboarding() {
  const t = useT(), qc = useQueryClient();
  const [step, setStep] = useState(0);
  const steps = [
    { title: t('ob_welcome'), sub: t('ob_welcome_sub'), body: <><ProfilesSection /><LookSection /></> },
    { title: t('ob_bring'), sub: t('ob_bring_sub'), body: <AccountsSection /> },
    { title: t('ob_watch'), sub: t('ob_watch_sub'), body: <><PlaybackSection /><KeysSection /></> },
  ];
  const done = async () => { await cin('prefs-set', { cinemaOnboarded: true }); qc.invalidateQueries({ queryKey: ['prefs'] }); };
  const s = steps[step];
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg/97 backdrop-blur-xl fade-in">
      <div className="flex items-center gap-3 px-10 pb-4 pt-8">
        {steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-10 bg-acc' : i < step ? 'w-5 bg-acc/50' : 'w-5 bg-white/15'}`} />)}
        <span className="flex-1" />
        <button onClick={done} className="text-sm text-fg3 hover:text-fg">{t('ob_skip_all')}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-10">
        <div key={step} className="mx-auto max-w-4xl py-6 fade-in">
          <h1 className="mb-2 text-4xl font-bold">{s.title}</h1>
          <p className="mb-10 text-[15px] text-fg2">{s.sub}</p>
          {s.body}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-10 py-5">
        {step > 0 ? <button onClick={() => setStep(step - 1)} className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-fg2 hover:bg-white/8 hover:text-fg"><Icon n="chevl" s={18} className="flip" />{t('back')}</button> : null}
        <span className="flex-1" />
        {step < steps.length - 1
          ? <button onClick={() => setStep(step + 1)} className="flex items-center gap-1.5 rounded-full bg-fg px-7 py-2.5 font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('next')}<Icon n="chevr" s={18} className="flip" /></button>
          : <button onClick={done} className="rounded-full bg-acc px-7 py-2.5 font-semibold text-acc-ink hover:brightness-110">{t('ob_start')}</button>}
      </div>
    </div>
  );
}
