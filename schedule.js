// Galactic Camp 2026 — Schedule App
// Depends on: schedule-data.js (window.SCHEDULE_EVENTS)

// ─────────────────────────────────────────────────────────────
// CONFIG — set actual passphrase before publishing
// ─────────────────────────────────────────────────────────────
const BF_PASSPHRASE = 'diaper';

// ─────────────────────────────────────────────────────────────
// VENUE ORDER (canonical from AGENTS.md)
// ─────────────────────────────────────────────────────────────
const VENUE_ORDER = [
  'Main Stage',
  'Fantail',
  'Panel Room A',
  'Panel Room B',
  'Panel Room C',
  'Anime Room',
  'BabyFur Space',
  'Other',
];

const VENUE_FULL_LABELS = {
  'Panel Room A': 'Panel Room A (Adjacent to the Chief Petty Officer\'s Mess & Lounge)',
  'Panel Room B': 'Panel Room B (Chapel & Ship\'s Library)',
  'Panel Room C': 'Panel Room C (Officer\'s Wardroom)',
  'Anime Room':   'Anime Room (Ready Room 4)',
};

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let activeTab    = 'all';
let activeVenue  = 'all';
let bfUnlocked   = false;

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bfUnlocked = document.cookie.split(';').some(c => c.trim().startsWith('gc_unlock_bf='));
  renderVenueChips();
  renderSchedule();
  bindTabBar();
  bindVenueChips();
  bindHeaderNav();
  bindBabyfurUnlock();
  bindFavNotice();
  updateStickyOffset();
  window.addEventListener('resize', updateStickyOffset);
});

// ─────────────────────────────────────────────────────────────
// STICKY OFFSET
// --header-height is a fixed CSS value and must never be written
// by JS (doing so creates a feedback loop with the border-bottom).
// We only compute --header-offset (the real rendered height used
// for positioning the sticky controls bar).
// ─────────────────────────────────────────────────────────────
function updateStickyOffset() {
  const header = document.getElementById('site-header');
  if (header) {
    document.documentElement.style.setProperty('--header-offset', header.offsetHeight + 'px');
  }
}

// ─────────────────────────────────────────────────────────────
// DATA FILTERING
// ─────────────────────────────────────────────────────────────

// All ISO strings in schedule-data.js are in the form "2026-05-29T15:00:00-07:00".
// The time portion (HH:MM) is already in PDT, so we read it directly from the string
// rather than relying on the device's local timezone.

function getLocalHour(isoString) {
  return parseInt(isoString.substring(11, 13), 10);
}

function getLocalMinute(isoString) {
  return parseInt(isoString.substring(14, 16), 10);
}

function isInQuietWindow(startISO) {
  // Returns true if the start time falls within [02:00, 10:00) PDT
  const h = getLocalHour(startISO);
  return h >= 2 && h < 10;
}

function getFilteredEvents() {
  const now     = new Date();
  const favs    = getFavorites();
  const isAllTab = activeTab === 'all';

  return SCHEDULE_EVENTS.filter(evt => {
    // Never show placeholder events (already excluded from data, safety check)
    if (evt.status === 'placeholder') return false;

    // Never show past events
    if (new Date(evt.endISO) < now) return false;

    // Hide babyfur events unless unlocked
    if (evt.babyfur && !bfUnlocked) return false;

    // Quiet hours: suppress non-Anime-Room events during [02:00, 10:00) on Sat/Sun
    if (evt.venue !== 'Anime Room' && (evt.displayDay === 'Saturday' || evt.displayDay === 'Sunday')) {
      if (isInQuietWindow(evt.startISO)) return false;
    }

    // Favorites tab: only favorited events
    if (!isAllTab && !favs.includes(evt.id)) return false;

    // Venue filter — 'Everywhere' events appear under All and Other only
    if (activeVenue !== 'all') {
      if (evt.venue === 'Everywhere' && activeVenue !== 'Other') return false;
      if (evt.venue !== 'Everywhere' && evt.venue !== activeVenue) return false;
    }

    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// TIME HELPERS
// ─────────────────────────────────────────────────────────────
function formatTime(isoString) {
  const h = getLocalHour(isoString);
  const m = getLocalMinute(isoString);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mm = m > 0 ? ':' + String(m).padStart(2, '0') : '';
  return h12 + mm + ' ' + suffix;
}

function formatTimeRange(startISO, endISO) {
  return formatTime(startISO) + ' – ' + formatTime(endISO);
}

function getTimeBlock(isoString) {
  const h = getLocalHour(isoString);
  if (h >= 20 || h < 2)  return 'After Dark';
  if (h >= 18)            return 'Evening';
  if (h >= 12)            return 'Afternoon';
  return 'Morning';
}

function hourKey(isoString) {
  // Returns a zero-padded hour key for sorting (e.g. "15" for 3 PM)
  return String(getLocalHour(isoString)).padStart(2, '0');
}

function formatHourLabel(isoString) {
  const h = getLocalHour(isoString);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ':00 ' + suffix;
}

function dayDateLabel(displayDay) {
  const dates = { Friday: 'Friday, May 29', Saturday: 'Saturday, May 30', Sunday: 'Sunday, May 31' };
  return dates[displayDay] || displayDay;
}

// ─────────────────────────────────────────────────────────────
// GROUPING
// ─────────────────────────────────────────────────────────────
const DAY_ORDER   = ['Friday', 'Saturday', 'Sunday'];
const BLOCK_ORDER = ['Morning', 'Afternoon', 'Evening', 'After Dark'];

function groupEvents(events) {
  const byDay = {};
  for (const evt of events) {
    (byDay[evt.displayDay] = byDay[evt.displayDay] || []).push(evt);
  }
  return byDay;
}

function groupByBlock(events) {
  const blocks = {};
  for (const evt of events) {
    const block = getTimeBlock(evt.startISO);
    (blocks[block] = blocks[block] || []).push(evt);
  }
  return blocks;
}

function groupByHour(events) {
  const hours = {};
  for (const evt of events) {
    const key = hourKey(evt.startISO);
    (hours[key] = hours[key] || []).push(evt);
  }
  return hours;
}

// ─────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────
function renderSchedule() {
  const container = document.getElementById('schedule');
  const events    = getFilteredEvents();

  if (events.length === 0) {
    container.innerHTML = activeTab === 'favorites'
      ? '<p class="schedule-empty">No favorites yet — tap the ♡ on any event to save it here.</p>'
      : '<p class="schedule-empty">No upcoming events to show.</p>';
    return;
  }

  const byDay = groupEvents(events);
  const frag  = document.createDocumentFragment();

  DAY_ORDER.forEach(day => {
    if (!byDay[day]) return;

    const dayEvents = byDay[day].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    // Day section
    const section = document.createElement('div');
    section.className = 'day-section';

    const h2 = document.createElement('h2');
    h2.className = 'day-heading';
    h2.innerHTML = day;
    section.appendChild(h2);

    // Group by time block
    const byBlock = groupByBlock(dayEvents);
    BLOCK_ORDER.forEach(block => {
      if (!byBlock[block]) return;

      // Group by hour within block
      const byHour = groupByHour(byBlock[block]);
      const sortedHours = Object.keys(byHour).sort((a, b) => {
        // After Dark: hours 20-23 sort before 0-1
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        const ra = na < 2  ? na + 24 : na;
        const rb = nb < 2  ? nb + 24 : nb;
        return ra - rb;
      });

      sortedHours.forEach(hKey => {
        const hourGroup = document.createElement('div');
        hourGroup.className = 'hour-group';

        const label = document.createElement('div');
        label.className = 'hour-label';
        label.textContent = formatHourLabel(byHour[hKey][0].startISO);
        hourGroup.appendChild(label);

        byHour[hKey].forEach(evt => {
          hourGroup.appendChild(createCard(evt));
        });

        section.appendChild(hourGroup);
      });
    });

    frag.appendChild(section);
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

// ─────────────────────────────────────────────────────────────
// EVENT CARD
// ─────────────────────────────────────────────────────────────
function createCard(evt) {
  const favs      = getFavorites();
  const isFav     = favs.includes(evt.id);
  const isFeatured = evt.featured;
  const hasDetail  = !!(evt.description || (evt.panelists && evt.panelists.length) || evt.bio);

  const venueLabel = evt.locationDetail
    ? (VENUE_FULL_LABELS[evt.venue] || evt.venue) + ' — ' + evt.locationDetail
    : (VENUE_FULL_LABELS[evt.venue] || evt.venue);

  const card = document.createElement('article');
  card.className = 'event-card' + (isFeatured ? ' event-card--featured' : '');
  card.dataset.id = evt.id;

  // ── Row ──
  const row = document.createElement('div');
  row.className = 'event-card__row';

  // Left
  const left = document.createElement('div');
  left.className = 'event-card__left';

  const timeEl = document.createElement('div');
  timeEl.className = 'event-card__time';
  timeEl.textContent = formatTimeRange(evt.startISO, evt.endISO);
  left.appendChild(timeEl);

  const titleEl = document.createElement('h3');
  titleEl.className = 'event-card__title';
  titleEl.textContent = evt.title;
  left.appendChild(titleEl);

  const badges = document.createElement('div');
  badges.className = 'event-card__badges';

  const venueBadge = document.createElement('span');
  venueBadge.className = 'badge badge--venue';
  venueBadge.textContent = evt.venue === 'Other' && evt.locationDetail ? evt.locationDetail : (evt.venue);
  badges.appendChild(venueBadge);

  if (evt.category) {
    const catBadge = document.createElement('span');
    catBadge.className = 'badge badge--category';
    catBadge.textContent = evt.category;
    badges.appendChild(catBadge);
  }
  if (evt.status === 'tbc') {
    const tbcBadge = document.createElement('span');
    tbcBadge.className = 'badge badge--tbc';
    tbcBadge.textContent = 'TBC';
    badges.appendChild(tbcBadge);
  }
  left.appendChild(badges);

  // Right: actions
  const actions = document.createElement('div');
  actions.className = 'event-card__actions';

  const heartBtn = document.createElement('button');
  heartBtn.className = 'btn-heart';
  heartBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
  heartBtn.setAttribute('aria-pressed', String(isFav));
  heartBtn.innerHTML = `<svg class="heart-icon" viewBox="0 0 20 18" aria-hidden="true"><path d="M10 16.5S1.5 11 1.5 5.5A4.5 4.5 0 0 1 10 3.2 4.5 4.5 0 0 1 18.5 5.5C18.5 11 10 16.5 10 16.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  heartBtn.addEventListener('click', () => toggleFavorite(evt.id, card, heartBtn));
  actions.appendChild(heartBtn);

  const chevronBtn = document.createElement('button');
  chevronBtn.className = 'btn-chevron' + (hasDetail ? '' : ' is-hidden');
  chevronBtn.setAttribute('aria-label', 'Show details');
  chevronBtn.setAttribute('aria-expanded', 'false');
  chevronBtn.innerHTML = `<svg class="chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (hasDetail) {
    chevronBtn.addEventListener('click', () => toggleDetail(card, chevronBtn, detail));
  }
  actions.appendChild(chevronBtn);

  row.appendChild(left);
  row.appendChild(actions);
  card.appendChild(row);

  // ── Detail panel ──
  const detail = document.createElement('div');
  detail.className = 'event-card__detail';

  if (evt.locationDetail) {
    const locEl = document.createElement('p');
    locEl.className = 'event-card__location';
    locEl.textContent = 'Location: ' + venueLabel;
    detail.appendChild(locEl);
  }
  if (evt.description) {
    const desc = document.createElement('p');
    desc.className = 'event-card__desc';
    desc.textContent = evt.description;
    detail.appendChild(desc);
  }
  if (evt.bio) {
    const bio = document.createElement('p');
    bio.className = 'event-card__bio';
    bio.textContent = evt.bio;
    detail.appendChild(bio);
  }
  if (evt.panelists && evt.panelists.length > 0) {
    const p = document.createElement('p');
    p.className = 'event-card__panelists';
    p.innerHTML = '<strong>Presented by:</strong> ' + evt.panelists.join(', ');
    detail.appendChild(p);
  }
  if (evt.genre) {
    const g = document.createElement('p');
    g.className = 'event-card__panelists';
    g.innerHTML = '<strong>Genre:</strong> ' + evt.genre;
    detail.appendChild(g);
  }

  card.appendChild(detail);
  return card;
}

function toggleDetail(card, btn, detail) {
  const isOpen = detail.classList.contains('is-open');
  detail.classList.toggle('is-open', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
  btn.setAttribute('aria-label', isOpen ? 'Show details' : 'Hide details');
}

// ─────────────────────────────────────────────────────────────
// FAVORITES
// ─────────────────────────────────────────────────────────────
const LS_FAVS   = 'gc2026-favorites';
const LS_NOTICE = 'gc2026-fav-notice';

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(LS_FAVS) || '[]'); }
  catch { return []; }
}

function saveFavorites(arr) {
  localStorage.setItem(LS_FAVS, JSON.stringify(arr));
}

function toggleFavorite(id, card, heartBtn) {
  const favs = getFavorites();
  const idx  = favs.indexOf(id);
  const adding = idx === -1;

  if (adding) {
    favs.push(id);
    maybeShowFavNotice();
  } else {
    favs.splice(idx, 1);
    if (activeTab === 'favorites') {
      card.remove();
      const container = document.getElementById('schedule');
      if (!container.querySelector('.event-card')) {
        container.innerHTML = '<p class="schedule-empty">No favorites yet — tap the ♡ on any event to save it here.</p>';
      }
    }
  }

  saveFavorites(favs);
  heartBtn.setAttribute('aria-pressed', String(adding));
  heartBtn.setAttribute('aria-label', adding ? 'Remove from favorites' : 'Add to favorites');

  // Update favorites tab label count
  updateFavTabCount();
}

function updateFavTabCount() {
  const favs    = getFavorites();
  const labelEl = document.querySelector('#tab-favorites .tab-favorites__label');
  if (!labelEl) return;
  labelEl.textContent = favs.length > 0 ? favs.length + ' Favorites' : 'Favorites';
}

function maybeShowFavNotice() {
  if (localStorage.getItem(LS_NOTICE)) return;
  const notice = document.getElementById('fav-notice');
  if (notice) notice.hidden = false;
}

function bindFavNotice() {
  const btn = document.getElementById('fav-notice-dismiss');
  if (btn) {
    btn.addEventListener('click', () => {
      document.getElementById('fav-notice').hidden = true;
      localStorage.setItem(LS_NOTICE, '1');
    });
  }
  updateFavTabCount();
}

// ─────────────────────────────────────────────────────────────
// TAB BAR
// ─────────────────────────────────────────────────────────────
function bindTabBar() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('tab-btn--active', b.dataset.tab === activeTab);
        b.setAttribute('aria-pressed', String(b.dataset.tab === activeTab));
      });
      renderSchedule();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// VENUE CHIPS
// ─────────────────────────────────────────────────────────────
function renderVenueChips() {
  const container = document.getElementById('venue-chips');
  if (!container) return;

  // Base the chip list on currently visible events so that venue-specific
  // chips (e.g. BabyFur Space) only appear once the content is unlocked.
  const visibleVenues = new Set(getFilteredEvents().map(e => e.venue));
  const venues = VENUE_ORDER.filter(v => visibleVenues.has(v));

  container.innerHTML = '';

  // "All" chip
  const allChip = document.createElement('button');
  allChip.className = 'chip chip--active';
  allChip.dataset.venue = 'all';
  allChip.textContent = 'All';
  allChip.setAttribute('aria-pressed', 'true');
  container.appendChild(allChip);

  venues.forEach(v => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.venue = v;
    chip.textContent = v;
    chip.setAttribute('aria-pressed', 'false');
    container.appendChild(chip);
  });
}

function bindVenueChips() {
  const container = document.getElementById('venue-chips');
  if (!container) return;
  container.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    activeVenue = chip.dataset.venue;
    container.querySelectorAll('.chip').forEach(c => {
      const active = c.dataset.venue === activeVenue;
      c.classList.toggle('chip--active', active);
      c.setAttribute('aria-pressed', String(active));
    });
    renderSchedule();
  });
}

// ─────────────────────────────────────────────────────────────
// HEADER NAV (hamburger + dropdowns)
// ─────────────────────────────────────────────────────────────
function bindHeaderNav() {
  const hamburger = document.getElementById('hamburger-btn');
  const nav       = document.getElementById('main-nav');
  const backdrop  = document.getElementById('nav-backdrop');

  function openNav() {
    nav.classList.add('is-open');
    backdrop.classList.add('is-visible');
    hamburger.classList.add('is-open');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeNav() {
    nav.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
    hamburger.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', () => {
    nav.classList.contains('is-open') ? closeNav() : openNav();
  });
  backdrop.addEventListener('click', closeNav);

  // Folder dropdowns
  document.querySelectorAll('.nav-folder-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const folder = document.getElementById(btn.getAttribute('aria-controls'));
      if (!folder) return;
      const isOpen = folder.classList.contains('is-open');

      // Close all others
      document.querySelectorAll('.nav-folder.is-open').forEach(f => {
        f.classList.remove('is-open');
        f.previousElementSibling?.setAttribute('aria-expanded', 'false');
      });

      if (!isOpen) {
        folder.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-item--folder')) {
      document.querySelectorAll('.nav-folder.is-open').forEach(f => {
        f.classList.remove('is-open');
        f.previousElementSibling?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Escape key closes nav / dropdowns
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeNav();
      document.querySelectorAll('.nav-folder.is-open').forEach(f => {
        f.classList.remove('is-open');
        f.previousElementSibling?.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────
// BABYFUR UNLOCK — 2-second long-press anywhere on the header
// Trigger zone: the entire header, including the logo area.
// Only dedicated interactive controls (hamburger, nav buttons)
// are excluded so they still work normally.
// ─────────────────────────────────────────────────────────────
function bindBabyfurUnlock() {
  const header   = document.getElementById('site-header');
  const modal      = document.getElementById('bf-modal');
  const body       = document.getElementById('bf-body');
  const input      = document.getElementById('bf-input');
  const submit     = document.getElementById('bf-submit');
  const closeBtn   = document.getElementById('bf-close');
  const errorEl    = document.getElementById('bf-error');
  const successEl  = document.getElementById('bf-success');
  const successOk  = document.getElementById('bf-success-ok');

  let pressTimer = null;
  let startX     = 0;
  let startY     = 0;
  const HOLD_MS        = 2000;
  const MOVE_THRESHOLD = 100; // px — cancel if the finger drifts more than this

  function showInputState() {
    body.hidden     = false;
    successEl.hidden = true;
    input.value     = '';
    errorEl.hidden  = true;
  }
  function openModal() {
    showInputState();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 50);
  }
  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    showInputState();
  }

  function startHold(x, y) {
    clearTimeout(pressTimer);
    startX = x;
    startY = y;
    header.classList.add('is-pressing');
    pressTimer = setTimeout(() => {
      pressTimer = null;
      header.classList.remove('is-pressing');
      openModal();
    }, HOLD_MS);
  }
  function cancelHold() {
    clearTimeout(pressTimer);
    pressTimer = null;
    header.classList.remove('is-pressing');
  }
  function checkMove(x, y) {
    if (!pressTimer) return;
    const dx = x - startX;
    const dy = y - startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) cancelHold();
  }

  // ── Touch (mobile) ──────────────────────────────────────────
  // preventDefault() on touchstart blocks the browser's long-press
  // context menu and prevents pointercancel from firing, which is
  // the main reason the old pointer-event approach failed on mobile.
  header.addEventListener('touchstart', (e) => {
    // Exclude links and buttons so taps navigate/toggle normally
    if (e.target.closest('a, button')) return;
    e.preventDefault();
    startHold(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  header.addEventListener('touchend',    cancelHold);
  header.addEventListener('touchcancel', cancelHold);
  header.addEventListener('touchmove', (e) => {
    checkMove(e.touches[0].clientX, e.touches[0].clientY);
  });

  // ── Mouse (desktop) ──────────────────────────────────────────
  // Exclude links so normal header navigation still works on desktop.
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('a, button, input, select')) return;
    startHold(e.clientX, e.clientY);
  });
  header.addEventListener('mouseup',    cancelHold);
  header.addEventListener('mouseleave', cancelHold);
  header.addEventListener('mousemove',  (e) => {
    checkMove(e.clientX, e.clientY);
  });

  // Suppress the browser's native context menu during a long-press
  header.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Modal interactions ───────────────────────────────────────
  function attemptUnlock() {
    if (input.value.trim().toLowerCase() === BF_PASSPHRASE.toLowerCase()) {
      // Persist for 30 days so the unlock survives browser restarts
      document.cookie = 'gc_unlock_bf=1; path=/; SameSite=Lax; max-age=2592000';
      bfUnlocked = true;
      renderVenueChips();
      renderSchedule();
      // Swap to success state inside the modal
      body.hidden      = true;
      successEl.hidden = false;
    } else {
      errorEl.hidden = false;
      input.value = '';
      input.focus();
    }
  }

  successOk.addEventListener('click', closeModal);

  submit.addEventListener('click', attemptUnlock);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attemptUnlock(); });
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
}
