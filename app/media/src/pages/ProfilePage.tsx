import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { cin, social, useSocialProfile } from '../api';
import { resolveProfileCssVars } from '../config/profileThemes';
import type { LeftCardId, RightCardId } from '../data/profileMockSeed';
import { useHost, useNav } from '../host';
import { translate } from '../i18n';
import { Img } from '../ui/Img';
import { SandboxedCanvas } from '../components/profile/SandboxedCanvas';
import { ProfileHero } from '../components/profile/ProfileHero';
import { AboutCard } from '../components/profile/cards/AboutCard';
import { BadgesCard } from '../components/profile/cards/BadgesCard';
import { CommentsCard } from '../components/profile/cards/CommentsCard';
import { FavoritesCard } from '../components/profile/cards/FavoritesCard';
import { FriendsCard } from '../components/profile/cards/FriendsCard';
import { GamingProfileCard } from '../components/profile/cards/GamingProfileCard';
import { GroupsCard } from '../components/profile/cards/GroupsCard';
import { ListsCard } from '../components/profile/cards/ListsCard';
import { MusicFavoritesCard } from '../components/profile/cards/MusicFavoritesCard';
import { ProfileSongCard } from '../components/profile/cards/ProfileSongCard';
import { RatingsCard } from '../components/profile/cards/RatingsCard';
import { RecentActivityCard } from '../components/profile/cards/RecentActivityCard';
import { SocialsCard } from '../components/profile/cards/SocialsCard';
import { TrackerProfileCard } from '../components/profile/cards/TrackerProfileCard';
import { EditProfileView } from '../components/profile/edit/EditProfileView';
import { AddFriendModal } from '../components/profile/modals/AddFriendModal';
import { CreateGroupModal } from '../components/profile/modals/CreateGroupModal';
import { FavoritesCollageModal } from '../components/profile/modals/FavoritesCollageModal';
import { FavoritesPickerModal } from '../components/profile/modals/FavoritesPickerModal';
import { FeaturedListsModal } from '../components/profile/modals/FeaturedListsModal';
import { GamingProfileModal } from '../components/profile/modals/GamingProfileModal';
import { HeroStatsModal } from '../components/profile/modals/HeroStatsModal';
import { ImportRatingsModal } from '../components/profile/modals/ImportRatingsModal';
import { ProfileCardsOrderModal } from '../components/profile/modals/ProfileCardsOrderModal';
import { ShareProfileModal } from '../components/profile/modals/ShareProfileModal';
import { SocialLinksModal } from '../components/profile/modals/SocialLinksModal';
import { friendDataToProfileState, useProfileStore } from '../store/useProfileStore';
import { CinemaDashboard } from '../components/profile/CinemaDashboard';
import { ProfileActivityView } from './ProfileActivityView';

export function ProfilePage({
  active = true,
  friendId,
}: {
  active?: boolean;
  friendId?: string;
}) {
  const { lang, toast } = useHost();
  const nav = useNav();
  const qc = useQueryClient();
  const ar = lang === 'ar';
  const isMe = !friendId;

  const store = useProfileStore();
  const friendQuery = useSocialProfile(friendId || null);

  const [friendActivityOpen, setFriendActivityOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [collageOpen, setCollageOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [favKind, setFavKind] = useState<'games' | 'books' | 'music' | null>(null);
  const [heroStatsOpen, setHeroStatsOpen] = useState(false);
  const [cardsOrderOpen, setCardsOrderOpen] = useState(false);
  const [gamingOpen, setGamingOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [importRatingsOpen, setImportRatingsOpen] = useState(false);
  const [cachedSongUrl, setCachedSongUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isMe) return;
    store.hydrateFromMajlis();
    cin<string | { dataUrl?: string; url?: string } | null>('song-get', {})
      .then((res) => {
        const u = typeof res === 'string' ? res : res?.dataUrl || res?.url || null;
        if (u) setCachedSongUrl(u);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMe]);

  const friendProfile = useMemo(
    () => (friendQuery.data ? friendDataToProfileState(friendQuery.data) : null),
    [friendQuery.data],
  );

  const profile = isMe ? (store.editing && store.draft ? store.draft : store.saved) : friendProfile;

  const isDirty = useMemo(() => {
    if (!store.editing || !store.draft) return false;
    try { return JSON.stringify(store.draft) !== JSON.stringify(store.saved); } catch { return true; }
  }, [store.editing, store.draft, store.saved]);

  const cssVars = useMemo(() => {
    if (!profile) return {};
    return resolveProfileCssVars({
      themeId: profile.look.themeId,
      customColors: profile.look.customColors,
      transparentCards: profile.look.transparentCards,
      gradientMode: profile.look.gradientMode,
      customPageBg: profile.customCanvas.enabled ? profile.customCanvas.pageBgColor : null,
    });
  }, [profile]);

  if (!isMe && friendQuery.isLoading && !profile) {
    return (
      <div className="grid h-full place-items-center bg-[#12100E] text-sm text-white/60">
        {ar ? 'جاري تحميل الملف الشخصي...' : 'Loading profile...'}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="grid h-full place-items-center bg-[#12100E] text-sm text-white/60">
        {ar ? 'تعذر تحميل هذا الملف الشخصي.' : 'Unable to load profile.'}
      </div>
    );
  }

  const showActivity = isMe ? store.activityView : friendActivityOpen;
  const [dashboardView, setDashboardView] = useState(false);
  const setShowActivity = (on: boolean) => {
    if (on) setDashboardView(false);
    if (isMe) store.setActivityView(on);
    else setFriendActivityOpen(on);
  };

  const isFriend = !isMe && store.saved.friends.some((f) => f.id === friendId);
  const toggleFriend = async () => {
    if (!friendId) return;
    try {
      if (isFriend) {
        await social('remove', { id: friendId });
        store.updateSaved((s) => { s.friends = s.friends.filter((f) => f.id !== friendId); });
        toast(ar ? 'تمت إزالة الصديق' : 'Friend removed');
      } else {
        await social('add', { idOrHandle: friendId });
        toast(ar ? 'تم إرسال طلب الصداقة' : 'Friend request sent');
      }
      qc.invalidateQueries({ queryKey: ['social-friends'] });
      qc.invalidateQueries({ queryKey: ['social-profile', friendId] });
      store.hydrateFromMajlis();
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const rawSong = (isMe && cachedSongUrl) ? cachedSongUrl : (profile.general.profileSongUrl || '');
  const isPlayableAudio = /^(data:audio\/|blob:|file:\/\/|\/)/i.test(rawSong);

  const renderLeftCard = (id: LeftCardId) => {
    const tCard = profile.look.transparentCards;
    const hideTitle = profile.customCanvas.hideCardTitles;
    switch (id) {
      case 'about':
        return <AboutCard key={id} about={profile.general.about} hideTitle={hideTitle} transparent={tCard} />;
      case 'lists':
        return (
          <ListsCard
            key={id}
            lists={profile.lists}
            featuredIds={profile.showcase.featuredListIds}
            isMe={isMe}
            hideTitle={hideTitle}
            transparent={tCard}
            onChooseLists={() => setListsOpen(true)}
            onViewAll={() => setListsOpen(true)}
          />
        );
      case 'ratings':
        return (
          <RatingsCard
            key={id}
            ratings={profile.ratings}
            isMe={isMe}
            hideTitle={hideTitle}
            transparent={tCard}
            onImportRatings={() => setImportRatingsOpen(true)}
            onViewAll={() => setShowActivity(true)}
          />
        );
      case 'games':
        return <FavoritesCard key={id} variant="games" items={profile.favorites.games} isMe={isMe} hideTitle={hideTitle} transparent={tCard} onEdit={() => setFavKind('games')} />;
      case 'books':
        return <FavoritesCard key={id} variant="books" items={profile.favorites.books} isMe={isMe} hideTitle={hideTitle} transparent={tCard} onEdit={() => setFavKind('books')} />;
      case 'music':
        return <MusicFavoritesCard key={id} items={profile.favorites.music} isMe={isMe} hideTitle={hideTitle} transparent={tCard} onEdit={() => setFavKind('music')} />;
      case 'badges':
        return <BadgesCard key={id} badges={profile.badges} hideTitle={hideTitle} transparent={tCard} />;
      case 'activity':
        return <RecentActivityCard key={id} activity={profile.activity} allowed={isMe || profile.privacy.shareWatchActivity} hideTitle={hideTitle} transparent={tCard} onViewAll={() => setShowActivity(true)} />;
      case 'comments':
        return (
          <CommentsCard
            key={id}
            comments={profile.comments}
            ratings={profile.ratings}
            myId={store.saved.id}
            isOwner={isMe}
            hideTitle={hideTitle}
            transparent={tCard}
            onPost={async (body) => {
              await store.addComment(body, isMe ? store.saved.id : friendId);
              if (!isMe && friendId) qc.invalidateQueries({ queryKey: ['social-profile', friendId] });
            }}
            onDelete={async (cid) => {
              await store.deleteComment(cid, isMe ? store.saved.id : friendId);
              if (!isMe && friendId) qc.invalidateQueries({ queryKey: ['social-profile', friendId] });
            }}
          />
        );
    }
  };

  const renderRightCard = (id: RightCardId) => {
    const tCard = profile.look.transparentCards;
    const hideTitle = profile.customCanvas.hideCardTitles;
    switch (id) {
      case 'song':
        if (!rawSong && !isMe) return null;
        return (
          <ProfileSongCard
            key={id}
            songTitle={profile.general.profileSongTitle || (ar ? 'أغنية الملف' : 'Profile Song')}
            songArtist={profile.general.profileSongArtist || ''}
            playableSrc={isPlayableAudio ? rawSong : null}
            externalUrl={!isPlayableAudio && rawSong ? rawSong : undefined}
            active={active && !store.editing && !showActivity}
            transparent={tCard}
          />
        );
      case 'tracker':
        if (!isMe && !profile.privacy.showExternalTrackerCard) return null;
        return (
          <TrackerProfileCard
            key={id}
            name={profile.tracker.name}
            handle={profile.tracker.handle}
            connected={profile.tracker.connected}
            filmsCount={profile.tracker.filmsCount}
            ratingsCount={profile.tracker.ratingsCount}
            publicLists={profile.tracker.publicLists}
            hideTitle={hideTitle}
            transparent={tCard}
          />
        );
      case 'gaming':
        if (!profile.showcase.gamingCard.enabled) return null;
        if (!isMe && !profile.privacy.showGamingCard) return null;
        return (
          <GamingProfileCard
            key={id}
            platform={profile.showcase.gamingCard.platform}
            gamertag={profile.showcase.gamingCard.gamertag}
            isMe={isMe}
            hideTitle={hideTitle}
            transparent={tCard}
            onEdit={() => setGamingOpen(true)}
          />
        );
      case 'friends':
        return (
          <FriendsCard
            key={id}
            friends={profile.friends}
            isMe={isMe}
            visibility={profile.privacy.friendsListVisibility}
            hideTitle={hideTitle}
            transparent={tCard}
            onAddFriend={() => setAddFriendOpen(true)}
            onRemoveFriend={isMe ? async (fid) => {
              await social('remove', { id: fid }).catch(() => {});
              store.updateSaved((s) => { s.friends = s.friends.filter((f) => f.id !== fid); });
            } : undefined}
          />
        );
      case 'groups':
        return <GroupsCard key={id} groups={profile.groups} isMe={isMe} hideTitle={hideTitle} transparent={tCard} onCreateGroup={() => setCreateGroupOpen(true)} />;
      case 'socials':
        return <SocialsCard key={id} links={profile.socials} isMe={isMe} hideTitle={hideTitle} transparent={tCard} onEdit={() => setSocialsOpen(true)} />;
    }
  };

  const customBgImage = profile.customCanvas.enabled && profile.customCanvas.pageBgImage ? profile.customCanvas.pageBgImage : '';
  const showCanvas = profile.customCanvas.enabled && (isMe || profile.customCanvas.showToVisitors);
  const bgStyle: React.CSSProperties = {
    ...(cssVars as React.CSSProperties),
    background: customBgImage
      ? `linear-gradient(rgba(18,16,14,0.72), rgba(18,16,14,0.88)), url("${customBgImage.replace(/"/g, '')}") center/cover fixed`
      : 'var(--pf-gradient)',
    color: 'var(--pf-text)',
    fontFamily: profile.customCanvas.enabled && profile.customCanvas.font ? `${profile.customCanvas.font}, inherit` : undefined,
  };

  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="profile-scope h-full overflow-y-auto pb-20" style={bgStyle}>
      {showActivity ? (
        <ProfileActivityView activity={profile.activity} alias={profile.general.alias} onBack={() => setShowActivity(false)} />
      ) : isMe && dashboardView ? (
        <div className="mx-auto max-w-[1120px] px-6 pt-28 sm:px-10">
          <CinemaDashboard onBack={() => setDashboardView(false)} />
        </div>
      ) : isMe && store.editing ? (
        <EditProfileView
          draft={profile}
          customiseView={store.customiseView}
          dirty={isDirty}
          onChange={store.updateDraft}
          onCancel={store.cancelEdit}
          onSave={async () => {
            await store.saveDraft();
            qc.invalidateQueries({ queryKey: ['social-me'] });
            qc.invalidateQueries({ queryKey: ['prefs'] });
            toast(ar ? 'تم حفظ الملف الشخصي' : 'Profile saved');
          }}
          onOpenCustomise={() => store.setCustomiseView(true)}
          onCloseCustomise={() => store.setCustomiseView(false)}
          onOpenFeaturedLists={() => setListsOpen(true)}
          onOpenFavorites={(k) => setFavKind(k)}
          onOpenHeroStats={() => setHeroStatsOpen(true)}
          onOpenCardsOrder={() => setCardsOrderOpen(true)}
          onOpenGaming={() => setGamingOpen(true)}
        />
      ) : (
        <>
          <ProfileHero
            profile={profile}
            isMe={isMe}
            isFriend={isFriend}
            onOpenActivity={() => setShowActivity(true)}
            onOpenDashboard={isMe ? () => setDashboardView(true) : undefined}
            onOpenShare={() => setShareOpen(true)}
            onStartEdit={store.startEdit}
            onToggleFriend={!isMe ? toggleFriend : undefined}
          />

          <div className="mx-auto max-w-[1120px] px-6 sm:px-10">
            {showCanvas ? (
              <SandboxedCanvas
                html={profile.customCanvas.customHtml}
                css={profile.customCanvas.customCss}
                font={profile.customCanvas.font}
                bgColor={profile.look.customColors.bg}
                accentColor={cssVars['--pf-accent'] || '#E5A93C'}
                textColor={profile.look.customColors.text}
                height={profile.customCanvas.canvasHeight}
                dir={ar ? 'rtl' : 'ltr'}
              />
            ) : null}

            {!isMe && friendQuery.data?.compatibility?.pct != null ? (
              <div className="mb-5 rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)] p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-full bg-[var(--pf-accent)]/20 px-3 py-1 font-mono text-sm font-bold text-[var(--pf-accent)] ring-1 ring-[var(--pf-accent)]/40">
                      {translate(lang, 'taste_compat_pct', { n: friendQuery.data.compatibility.pct })}
                    </span>
                    {friendQuery.data.compatibility.commonWatched > 0 ? (
                      <span className="text-xs text-[var(--pf-text-muted)]">
                        {translate(lang, 'taste_shared_watched', { n: friendQuery.data.compatibility.commonWatched })}
                      </span>
                    ) : null}
                  </div>
                  {friendQuery.data.compatibility.sharedGenres.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {friendQuery.data.compatibility.sharedGenres.map((g) => (
                        <span key={g} className="rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] text-[var(--pf-text-muted)]">{g}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {friendQuery.data.compatibility.sharedTopRated.length ? (
                  <div className="mt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--pf-text-muted)]">
                      {translate(lang, 'taste_shared_top')}
                    </div>
                    <div className="flex gap-2.5 overflow-x-auto pb-1">
                      {friendQuery.data.compatibility.sharedTopRated.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => nav.open({ kind: 'title', type: it.type, id: it.id })}
                          className="w-20 flex-none text-start group"
                        >
                          <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10 group-hover:ring-[var(--pf-accent)]">
                            <Img srcs={[it.poster]} className="h-full w-full object-cover" />
                          </div>
                          <div dir="auto" className="mt-1 truncate text-[11px] font-semibold text-[var(--pf-text)] group-hover:text-[var(--pf-accent)]">
                            {it.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isMe && profile.privacy.privateProfile ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)] px-6 py-16 text-center">
                <Lock size={28} className="mb-3 text-[var(--pf-accent)]" />
                <div className="text-base font-bold">{ar ? 'هذا الملف خاص' : 'This profile is private'}</div>
                <p className="mt-1 text-xs text-[var(--pf-text-muted)]">
                  {ar ? 'أخفى هذا العضو نشاطه وتفاصيل ملفه عن الزوار.' : 'This member has chosen to keep their lists and activity private.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-5">
                  {profile.showcase.leftCards.filter((c) => c.visible).map((c) => renderLeftCard(c.id))}
                </div>
                <aside className="space-y-5">
                  {profile.showcase.rightCards.filter((c) => c.visible).map((c) => renderRightCard(c.id))}
                </aside>
              </div>
            )}
          </div>
        </>
      )}

      {/* Profile Modals */}
      <ShareProfileModal
        open={shareOpen}
        profile={profile}
        onOpenCollage={() => { setShareOpen(false); setCollageOpen(true); }}
        onClose={() => setShareOpen(false)}
      />
      <FavoritesCollageModal open={collageOpen} profile={profile} onClose={() => setCollageOpen(false)} />

      {isMe ? (
        <>
          <FeaturedListsModal
            open={listsOpen}
            lists={profile.lists}
            featuredIds={profile.showcase.featuredListIds}
            onSave={(ids) => store.setFeaturedLists(ids)}
            onCreateList={(name, description) => {
              store.updateSaved((s) => {
                const nl = { id: `list-${Date.now()}`, name, description, items: [] };
                s.lists = [nl, ...s.lists];
                if (s.showcase.featuredListIds.length < 3) s.showcase.featuredListIds = [nl.id, ...s.showcase.featuredListIds].slice(0, 3);
              });
            }}
            onClose={() => setListsOpen(false)}
          />
          <FavoritesPickerModal
            open={!!favKind}
            variant={favKind}
            selectedGames={profile.favorites.games}
            selectedBooks={profile.favorites.books}
            selectedMusic={profile.favorites.music}
            onSaveGames={(g) => store.setFavoritesGames(g)}
            onSaveBooks={(b) => store.setFavoritesBooks(b)}
            onSaveMusic={(m) => store.setFavoritesMusic(m)}
            onClose={() => setFavKind(null)}
          />
          <HeroStatsModal
            open={heroStatsOpen}
            profile={profile}
            onSave={(stats) => store.setHeroStats(stats)}
            onClose={() => setHeroStatsOpen(false)}
          />
          <ProfileCardsOrderModal
            open={cardsOrderOpen}
            leftCards={profile.showcase.leftCards}
            rightCards={profile.showcase.rightCards}
            onSave={(l, r) => store.setCardPlacements(l, r)}
            onClose={() => setCardsOrderOpen(false)}
          />
          <GamingProfileModal
            open={gamingOpen}
            value={profile.showcase.gamingCard}
            onSave={(g) => store.setGamingCard(g)}
            onClose={() => setGamingOpen(false)}
          />
          <AddFriendModal
            open={addFriendOpen}
            myId={profile.id}
            friends={profile.friends}
            incomingRequests={profile.incomingRequests}
            onLocalFriendAdded={(f) => store.updateSaved((s) => { if (!s.friends.some((x) => x.id === f.id)) s.friends.push(f); })}
            onResolveRequest={(id, accept) => store.updateSaved((s) => {
              const req = s.incomingRequests.find((r) => r.id === id);
              s.incomingRequests = s.incomingRequests.filter((r) => r.id !== id);
              if (accept && req && !s.friends.some((x) => x.id === id)) {
                s.friends.push({ id: req.id, name: req.name, handle: req.handle, avatar: req.avatar, accent: '#E5A93C', online: true, statusText: 'Online' });
              }
            })}
            onSyncRefresh={() => { qc.invalidateQueries({ queryKey: ['social-friends'] }); store.hydrateFromMajlis(); }}
            onClose={() => setAddFriendOpen(false)}
          />
          <CreateGroupModal
            open={createGroupOpen}
            onCreate={(grp) => store.addGroup(grp)}
            onClose={() => setCreateGroupOpen(false)}
          />
          <SocialLinksModal
            open={socialsOpen}
            links={profile.socials}
            onSave={(links) => store.setSocialLinks(links)}
            onClose={() => setSocialsOpen(false)}
          />
          <ImportRatingsModal
            open={importRatingsOpen}
            onAddRating={(r) => store.addRating(r)}
            onImportCsvRows={(rows) => store.importRatingsCsv(rows)}
            onClose={() => setImportRatingsOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
