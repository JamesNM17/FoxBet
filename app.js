const config = window.FOXBET_CONFIG || {};
const supabaseConfigured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
let supabaseReady = false;
let supabaseLoadError = false;
let supabase = null;
if (supabaseConfigured) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    supabaseReady = true;
  } catch (error) {
    supabaseLoadError = true;
    console.error("Não foi possível carregar a biblioteca do Supabase:", error);
  }
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function makeLocalId() { return globalThis.crypto?.randomUUID?.() || `fox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
const DEFAULT_GAME_SETTINGS = {
  slots_triple_chance: 8,
  slots_jackpot_share: 10,
  crash_chance_2x: 49.5,
  mines_first_safe_chance: 80,
  mines_default_count: 5,
  mines_return_factor: 0.99,
  blackjack_natural_chance: 4.8,
  blackjack_natural_multiplier: 2.5,
  roulette_hit_chance: 48.65,
  plinko_left_chance: 50,
  plinko_return_factor: 1.0,
  ads_enabled: false,
  ads_frequency: 3,
};

const state = {
  session: null,
  profile: null,
  credits: Number(localStorage.getItem("foxbet_demo_credits") || 50),
  history: JSON.parse(localStorage.getItem("foxbet_demo_history") || "[]"),
  authMode: "login",
  currentGame: null,
  minesRound: null,
  crashRound: null,
  crashTimer: null,
  crashPollTimer: null,
  crashPollBusy: false,
  blackjackRound: null,
  busy: false,
  isAdmin: false,
  gameSettings: { ...DEFAULT_GAME_SETTINGS },
  adminDraft: null,
  adminLogs: [],
  adminPlayers: [],
  adminPlayersLoaded: false,
  adminPlayersLoading: false,
  adminSearch: "",
  adminSelectedPlayerId: null,
  adminPlayerHistory: [],
  adminPlayerHistoryLoading: false,
  adminOwnerId: null,
};

const GAME_INFO = {
  slots: { title: "Fox Slots", subtitle: "Três rolos, uma rodada e muita diversão.", icon: "🎰", reason: "Fox Slots" },
  crash: { title: "Fox Crash", subtitle: "Defina seu alvo e veja até onde o foguete chega.", icon: "🚀", reason: "Fox Crash" },
  mines: { title: "Fox Mines", subtitle: "Revele as gemas e evite as minas escondidas.", icon: "💎", reason: "Fox Mines" },
  blackjack: { title: "Fox Blackjack", subtitle: "Monte sua mão e tente chegar mais perto de 21 que a banca.", icon: "🃏", reason: "Fox Blackjack" },
  roulette: { title: "Fox Roulette", subtitle: "Escolha uma cor, paridade ou número na roda.", icon: "🎡", reason: "Fox Roulette" },
  plinko: { title: "Fox Plinko", subtitle: "Solte a bolinha e acompanhe o caminho entre os pinos.", icon: "🔻", reason: "Fox Plinko" },
};
const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "💎", "7️⃣", "🦊"];
const SLOT_MULTIPLIERS = { "🍒": 5, "🍋": 4, "🔔": 8, "💎": 12, "7️⃣": 25, "🦊": 40 };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function usernameFromSession() {
  return state.profile?.username || state.session?.user?.user_metadata?.username || "Visitante";
}
function currentCredits() {
  return supabaseReady ? Number(state.profile?.credits ?? 0) : state.credits;
}
function formatCredits(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
function authEmail(username) {
  return `${username.toLowerCase()}@foxbet.app`;
}
function validUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}
function setBusy(value) {
  state.busy = value;
  $$(".game-action").forEach((button) => { button.disabled = value; });
}
function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}
function showModal(id) { $(id).classList.remove("hidden"); }
function hideModal(id) { $(id).classList.add("hidden"); }
function setView(view) {
  if (view === "admin" && !state.isAdmin) {
    notify("A Central Admin exige uma conta autorizada.");
    if (!state.session) openAuth("login");
    return;
  }
  if (state.crashRound?.status === 'active' && state.currentGame === 'crash' && view !== 'game') {
    notify('Finalize a rodada do Fox Crash antes de sair da tela.');
    return;
  }
  $$('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${view}`));
  $$('.nav-link[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'wallet' || view === 'home') loadHistory();
  if (view === 'profile') updateProfileScreen();
  if (view === 'admin') renderAdminPage();
  closeNavigationMenu();
  updatePromotionalAd(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function updateHeader() {
  const username = usernameFromSession();
  $('#header-balance').textContent = formatCredits(currentCredits());
  $('#wallet-balance').textContent = formatCredits(currentCredits());
  $('#header-username').textContent = username;
  $('#welcome-name').textContent = username;
  $('#profile-username').textContent = username;
  $('#welcome-eyebrow').textContent = state.session ? 'BEM-VINDO DE VOLTA À FOXBET' : 'BEM-VINDO À FOXBET';
  $('#account-mode').textContent = state.session ? 'Conta conectada' : 'Entre para sincronizar sua conta';
  $('#signout-btn').classList.toggle('hidden', !state.session);
  $('#profile-auth-action').classList.toggle('hidden', Boolean(state.session));
  const canSeeAdmin = Boolean(state.isAdmin);
  $('#admin-nav-link')?.classList.toggle('hidden', !canSeeAdmin);
}
function closeNavigationMenu() {
  document.body.classList.remove('sidebar-open');
  document.body.classList.remove('sidebar-collapsed');
  $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
}
function toggleNavigationMenu() {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const className = mobile ? 'sidebar-open' : 'sidebar-collapsed';
  document.body.classList.toggle(className);
  $('#mobile-menu')?.setAttribute('aria-expanded', document.body.classList.contains(className) ? 'true' : 'false');
}
function updatePromotionalAd(view = 'home') {
  const slots = ['#foxbet-ad-slot', '#foxbet-games-ad-slot'];
  const frequency = Math.max(1, Number(state.gameSettings.ads_frequency || 3));
  let counter = Number(sessionStorage.getItem('foxbet_ad_views') || 0) + 1;
  sessionStorage.setItem('foxbet_ad_views', String(counter));
  const show = Boolean(state.gameSettings.ads_enabled) && counter % frequency === 0 && (view === 'home' || view === 'games');
  slots.forEach((selector) => {
    const root = $(selector);
    if (!root) return;
    root.classList.toggle('hidden', !show || (view === 'home' && selector !== '#foxbet-ad-slot') || (view === 'games' && selector !== '#foxbet-games-ad-slot'));
    if (show && ((view === 'home' && selector === '#foxbet-ad-slot') || (view === 'games' && selector === '#foxbet-games-ad-slot'))) {
      root.innerHTML = `<div class="foxbet-ad-copy"><span class="foxbet-ad-label">FOXBET RECOMENDA</span><strong>Descubra seu próximo jogo favorito.</strong><small>Explore o catálogo e encontre uma nova experiência.</small></div><button type="button" class="foxbet-ad-cta" data-go="games">VER JOGOS <span>↗</span></button><span class="foxbet-ad-mark">🦊</span>`;
    }
  });
}

function demoSave() {
  localStorage.setItem("foxbet_demo_credits", String(state.credits));
  localStorage.setItem("foxbet_demo_history", JSON.stringify(state.history.slice(0, 30)));
  updateHeader();
  renderHistory();
}
function demoHistory(reason, delta, details = {}) {
  state.history.unshift({ id: makeLocalId(), reason, delta, details, created_at: new Date().toISOString() });
  demoSave();
}
function makeHistoryRow(item) {
  const reason = item.reason || "Rodada";
  const isPositive = Number(item.delta) > 0;
  const lowerReason = reason.toLowerCase();
  const icon = lowerReason.includes("slot") ? "🎰" : lowerReason.includes("crash") ? "🚀" : lowerReason.includes("mines") ? "💎" : lowerReason.includes("blackjack") ? "🃏" : lowerReason.includes("roulette") ? "🎡" : lowerReason.includes("plinko") ? "🔻" : "◈";
  const date = item.created_at ? new Date(item.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Agora";
  let detail = date;
  if (item.details?.bet != null) detail += ` · aposta ${formatCredits(item.details.bet)} CR`;
  const deltaText = Number(item.delta) > 0 ? `+${formatCredits(item.delta)}` : formatCredits(item.delta);
  return `<div class="history-row"><div class="history-icon">${icon}</div><div class="history-main"><strong>${escapeHtml(reason)}</strong><small>${escapeHtml(detail)}</small></div><span class="history-delta ${isPositive ? "positive" : Number(item.delta) < 0 ? "negative" : ""}">${deltaText} CR</span></div>`;
}
function renderHistory() {
  const items = state.history || [];
  const html = items.length ? items.slice(0, 8).map(makeHistoryRow).join("") : '<div class="empty-state">Suas rodadas aparecerão aqui.</div>';
  $("#home-history").innerHTML = html;
  $("#wallet-history").innerHTML = items.length ? items.map(makeHistoryRow).join("") : '<div class="empty-state">Nenhuma movimentação ainda.</div>';
}
async function loadHistory() {
  if (!supabaseReady || !state.session) { renderHistory(); return; }
  const { data, error } = await supabase.from("wallet_transactions").select("id, delta, reason, details, created_at").eq("user_id", state.session.user.id).order("created_at", { ascending: false }).limit(30);
  if (error) { console.warn("Falha ao carregar histórico:", error.message); renderHistory(); return; }
  state.history = data || [];
  renderHistory();
}
async function refreshProfile() {
  if (!supabaseReady || !state.session) return;
  const { data, error } = await supabase.from("profiles").select("id, username, credits, is_banned, ban_reason, banned_at").eq("id", state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
  updateHeader();
  await loadHistory();
}


function sanitizeSettings(settings) {
  const next = { ...DEFAULT_GAME_SETTINGS, ...(settings || {}) };
  [
    'slots_triple_chance', 'slots_jackpot_share', 'crash_chance_2x', 'mines_first_safe_chance',
    'mines_return_factor', 'blackjack_natural_chance', 'blackjack_natural_multiplier',
    'roulette_hit_chance', 'plinko_left_chance', 'plinko_return_factor', 'ads_frequency'
  ].forEach((key) => { next[key] = Number(next[key]); });
  next.mines_default_count = Number(next.mines_default_count);
  next.ads_enabled = Boolean(next.ads_enabled);
  return next;
}
async function loadPublicGameSettings() {
  if (!supabaseReady) return;
  const { data, error } = await supabase.rpc('get_game_settings');
  if (error) {
    console.warn('Não foi possível carregar as configurações públicas:', error.message);
    return;
  }
  state.gameSettings = sanitizeSettings(data);
  refreshGameOddsDisclosure();
}

function applyRoundOdds(patch = {}) {
  const values = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) values[key] = Number(value);
  });
  if (!Object.keys(values).length) return;
  state.gameSettings = sanitizeSettings({ ...state.gameSettings, ...values });
  refreshGameOddsDisclosure();
}
function refreshGameOddsDisclosure() {
  const root = $('#game-odds-disclosure');
  if (root && state.currentGame) root.outerHTML = gameOddsDisclosure(state.currentGame);
}
async function loadAdminAccess() {
  state.isAdmin = false;
  state.adminLogs = [];
  const ownerId = state.session?.user?.id || null;
  if (state.adminOwnerId !== ownerId) {
    state.adminPlayers = [];
    state.adminPlayersLoaded = false;
    state.adminSearch = "";
    state.adminSelectedPlayerId = null;
    state.adminPlayerHistory = [];
    state.adminOwnerId = ownerId;
  }
  if (!supabaseReady || !state.session) { updateHeader(); return; }
  const { data, error } = await supabase.rpc('admin_get_game_settings');
  if (!error && data) {
    state.isAdmin = true;
    state.gameSettings = sanitizeSettings(data.settings || {});
    state.adminLogs = Array.isArray(data.logs) ? data.logs : [];
  } else {
    state.adminPlayers = [];
    state.adminPlayersLoaded = false;
    state.adminSelectedPlayerId = null;
    state.adminPlayerHistory = [];
  }
  updateHeader();
}

function prettySetting(value, suffix = "%") {
  const number = Number(value);
  return `${Number.isInteger(number) ? number : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",")}${suffix}`;
}
function adminRangeControl(key, label, value, min, max, step, suffix, hint) {
  const numeric = Number(value);
  const percentage = ((numeric - min) / (max - min)) * 100;
  return `<div class="admin-control">
    <div class="admin-control-head"><label class="admin-control-label" for="admin-${key}">${label}</label><output class="admin-control-value" id="value-${key}">${prettySetting(value, suffix)}</output></div>
    <input class="admin-range" type="range" id="admin-${key}" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${numeric}" style="background:linear-gradient(90deg,#f78a2c 0%,#ffb15e ${percentage}%,#394355 ${percentage}%,#394355 100%)">
    <p class="admin-control-hint">${hint}</p>
  </div>`;
}
function auditLabel(log) {
  const before = log.before_settings || {};
  const after = log.after_settings || {};
  const labels = {
    slots_triple_chance: 'Chance de trinca · Slots',
    slots_jackpot_share: 'Chance de Fox · Slots',
    crash_chance_2x: 'Chance de alcançar 2× · Crash',
    mines_first_safe_chance: 'Primeira casa segura · Mines',
    mines_default_count: 'Minas padrão · Mines',
    mines_return_factor: 'Pagamento · Mines',
    blackjack_natural_chance: 'Chance de 21 natural · Blackjack',
    blackjack_natural_multiplier: 'Pagamento de 21 · Blackjack',
    roulette_hit_chance: 'Chance de acerto · Roulette',
    plinko_left_chance: 'Direção dos pinos · Plinko',
    plinko_return_factor: 'Pagamento · Plinko',
    ads_enabled: 'Anúncios ativados/desativados',
    ads_frequency: 'Frequência dos anúncios',
  };
  const changed = Object.keys(labels).filter((key) => String(before[key]) !== String(after[key]));
  return changed.length ? changed.map((key) => labels[key]).join(' · ') : 'Configurações revisadas';
}

function renderAdminPage() {
  const root = $('#admin-content');
  if (!root) return;
  if (!state.isAdmin || !supabaseReady || !state.session) {
    root.innerHTML = `<div class="admin-loading"><span class="admin-loading-icon">🔒</span><strong>Acesso administrativo necessário</strong><small>Entre com uma conta FoxBet autorizada para abrir esta área.</small><button class="primary-button" id="admin-login-button">Entrar na FoxBet</button></div>`;
    $('#admin-login-button')?.addEventListener('click', () => openAuth('login'));
    return;
  }
  const values = sanitizeSettings(state.adminDraft || state.gameSettings);
  const logs = state.adminLogs.slice(0, 10);
  root.innerHTML = `
    <div class="admin-page-head"><div><p class="eyebrow">FOXBET CONTROL ROOM</p><h1>Central Admin <span class="wave">✦</span></h1><p>Controle de jogos, créditos e comunicação da plataforma.</p></div><span class="admin-live-pill"><i></i> ADMINISTRADOR CONECTADO</span></div>
    <section class="admin-hero"><div class="admin-hero-copy"><span class="admin-kicker">✦ PAINEL DO OPERADOR • FOXBET</span><h2>Controle total.<br><em>Experiência FoxBet.</em></h2><p>Consulte jogadores, acompanhe resultados, ajuste créditos e controle o acesso às contas, além das configurações dos jogos.</p></div><div class="admin-hero-art"><div class="admin-hero-ring"></div><div class="admin-hero-emblem">🦊</div></div></section>
    <div class="admin-stat-grid">
      <div class="admin-stat"><div class="admin-stat-top">JOGOS DISPONÍVEIS <span class="admin-stat-icon">🎮</span></div><strong>06</strong><small>Catálogo FoxBet</small></div>
      <div class="admin-stat"><div class="admin-stat-top">CHANCE DE TRINCA <span class="admin-stat-icon">🎰</span></div><strong id="admin-stat-slots">${prettySetting(values.slots_triple_chance)}</strong><small>Fox Slots · configuração publicada</small></div>
      <div class="admin-stat"><div class="admin-stat-top">CHANCE DE 21 NATURAL <span class="admin-stat-icon">🃏</span></div><strong id="admin-stat-blackjack">${prettySetting(values.blackjack_natural_chance)}</strong><small>Fox Blackjack · duas cartas iniciais</small></div>
      <div class="admin-stat"><div class="admin-stat-top">ANÚNCIOS <span class="admin-stat-icon">📣</span></div><strong id="admin-stat-ads">${values.ads_enabled ? 'ATIVOS' : 'OFF'}</strong><small>Exibição promocional</small></div>
    </div>

    <div class="admin-section-head admin-player-section-heading"><div><h2>👥 Jogadores cadastrados</h2><p>Consulte cada perfil, saldo, partidas, vitórias, derrotas e histórico.</p></div><button class="admin-reset-button" id="admin-players-refresh" type="button">ATUALIZAR LISTA ↻</button></div>
    <section class="admin-settings-wide admin-players-panel">
      <div class="admin-players-toolbar"><label class="admin-player-search"><span>⌕</span><input id="admin-player-search" type="search" value="${escapeHtml(state.adminSearch)}" placeholder="Buscar por nome de usuário..." autocomplete="off"></label><span class="admin-players-count" id="admin-players-count">Carregando jogadores...</span></div>
      <div id="admin-player-table" class="admin-player-table-wrap"><div class="admin-player-empty">Carregando perfis cadastrados...</div></div>
      <div id="admin-player-details" class="admin-player-details hidden"></div>
    </section>

    <div class="admin-section-head"><div><h2>🎛️ Probabilidades e regras</h2><p>Os percentuais publicados também são apresentados nas telas dos jogos.</p></div><span class="admin-save-state" id="admin-draft-state">Configurações atuais</span></div>
    <div class="admin-game-grid">
      <article class="admin-game-card" style="--game-glow:rgba(255,137,39,.22);--game-icon-bg:rgba(255,137,39,.15)">
        <div class="admin-card-head"><span class="admin-game-icon">🎰</span><div class="admin-game-title"><h3>Fox Slots</h3><small>Máquina clássica · três rolos</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('slots_triple_chance', 'Chance de trinca perfeita', values.slots_triple_chance, 0, 100, 1, '%', 'Probabilidade configurada de os três rolos mostrarem o mesmo símbolo.')}
        ${adminRangeControl('slots_jackpot_share', 'Chance de trinca Fox', values.slots_jackpot_share, 0, 100, 1, '%', 'Entre as trincas, define a chance condicional de sair o símbolo Fox e pagar o prêmio máximo.')}
        <div class="admin-probability-meter"><div class="admin-meter-track"><div class="admin-meter-fill" id="slots-meter" style="width:${values.slots_triple_chance}%"></div></div><span id="slots-meter-label">${prettySetting(values.slots_triple_chance)} de trinca</span></div>
      </article>
      <article class="admin-game-card" style="--game-glow:rgba(76,148,255,.2);--game-icon-bg:rgba(76,148,255,.14)">
        <div class="admin-card-head"><span class="admin-game-icon">🚀</span><div class="admin-game-title"><h3>Fox Crash</h3><small>Foguete · retirada manual</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('crash_chance_2x', 'Chance de alcançar 2,00×', values.crash_chance_2x, 0, 100, 1, '%', 'Probabilidade configurada de o voo alcançar 2,00× antes da queda.')}
        <div class="admin-probability-meter"><div class="admin-meter-track"><div class="admin-meter-fill" id="crash-meter" style="width:${values.crash_chance_2x}%"></div></div><span id="crash-meter-label">${prettySetting(values.crash_chance_2x)} até 2×</span></div>
      </article>
      <article class="admin-game-card" style="--game-glow:rgba(48,211,160,.18);--game-icon-bg:rgba(48,211,160,.13)">
        <div class="admin-card-head"><span class="admin-game-icon">💎</span><div class="admin-game-title"><h3>Fox Mines</h3><small>Tabuleiro 5 × 5 · gemas</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('mines_first_safe_chance', 'Chance da primeira casa ser segura', values.mines_first_safe_chance, 0, 100, 1, '%', 'A primeira escolha usa este percentual; depois dela, as chances seguem a quantidade de minas restante no tabuleiro.')}
        <div class="admin-control"><div class="admin-control-head"><label class="admin-control-label" for="admin-mines_default_count">Minas padrão por rodada</label><output class="admin-control-value" id="value-mines_default_count">${values.mines_default_count} minas</output></div><select class="admin-select" id="admin-mines_default_count" data-setting="mines_default_count">${[3, 5, 8, 10].map((n) => `<option value="${n}" ${values.mines_default_count === n ? 'selected' : ''}>${n} minas</option>`).join('')}</select></div>
        ${adminRangeControl('mines_return_factor', 'Fator de pagamento', values.mines_return_factor, 0.5, 2, 0.01, '×', 'Escala o multiplicador dos acertos seguros.')}
        <div class="admin-probability-meter"><div class="admin-meter-track"><div class="admin-meter-fill" id="mines-meter" style="width:${values.mines_first_safe_chance}%"></div></div><span id="mines-meter-label">${prettySetting(values.mines_first_safe_chance)} primeira casa segura</span></div>
      </article>
      <article class="admin-game-card" style="--game-glow:rgba(183,125,255,.2);--game-icon-bg:rgba(183,125,255,.14)">
        <div class="admin-card-head"><span class="admin-game-icon">🃏</span><div class="admin-game-title"><h3>Fox Blackjack</h3><small>Mesa 21 · duas cartas iniciais</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('blackjack_natural_chance', 'Chance de 21 perfeito (Blackjack)', values.blackjack_natural_chance, 0, 100, 1, '%', 'Define a chance de receber 21 nas duas cartas iniciais. O percentual ativo fica visível na mesa.')}
        ${adminRangeControl('blackjack_natural_multiplier', 'Pagamento do 21 natural', values.blackjack_natural_multiplier, 1, 5, 0.1, '×', 'Multiplicador total aplicado quando a mão inicial forma Blackjack natural.')}
      </article>
      <article class="admin-game-card" style="--game-glow:rgba(255,78,99,.15);--game-icon-bg:rgba(255,78,99,.12)">
        <div class="admin-card-head"><span class="admin-game-icon">🎡</span><div class="admin-game-title"><h3>Fox Roulette</h3><small>Roleta europeia · 0 a 36</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('roulette_hit_chance', 'Chance de acertar a aposta selecionada', values.roulette_hit_chance, 0, 100, 1, '%', 'Probabilidade personalizada de a seleção atual (cor, paridade ou número) vencer. A roda usa a regra publicada.')}
        <div class="admin-lock-note"><strong>Regra visível na mesa.</strong> A interface exibe o percentual ativo para que a experiência corresponda ao ajuste publicado.</div>
      </article>
      <article class="admin-game-card" style="--game-glow:rgba(71,160,255,.18);--game-icon-bg:rgba(71,160,255,.13)">
        <div class="admin-card-head"><span class="admin-game-icon">🔻</span><div class="admin-game-title"><h3>Fox Plinko</h3><small>8 fileiras · caminho da bolinha</small></div><span class="admin-game-chip">0–100%</span></div>
        ${adminRangeControl('plinko_left_chance', 'Chance de ir para a esquerda em cada pino', values.plinko_left_chance, 0, 100, 1, '%', 'O restante é a chance de ir para a direita. A probabilidade aparece na tela do Plinko.')}
        ${adminRangeControl('plinko_return_factor', 'Fator de pagamento', values.plinko_return_factor, 0.25, 2, 0.01, '×', 'Escala os valores da tabela de prêmios para cada nível de risco.')}
        <div class="admin-lock-note"><strong>Trajetória calculada por etapa.</strong> Cada desvio usa o percentual publicado nesta configuração.</div>
      </article>
    </div>

    <div class="admin-section-head"><div><h2>📣 Anúncios e frequência</h2><p>Controle os espaços promocionais internos exibidos na navegação.</p></div></div>
    <section class="admin-settings-wide">
      <div class="admin-toggle-row"><div class="admin-toggle-copy"><span class="admin-game-icon">📢</span><div><strong>Ativar anúncios</strong><small>Exibe banners promocionais FoxBet no início e no catálogo.</small></div></div><label class="admin-switch"><input type="checkbox" id="admin-ads_enabled" data-setting="ads_enabled" ${values.ads_enabled ? 'checked' : ''}><span></span></label></div>
      <div class="admin-control"><div class="admin-control-head"><label class="admin-control-label" for="admin-ads_frequency">Frequência de exibição</label><output class="admin-control-value" id="value-ads_frequency">A cada ${values.ads_frequency} navegações</output></div><select class="admin-select" id="admin-ads_frequency" data-setting="ads_frequency">${[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => `<option value="${n}" ${values.ads_frequency === n ? 'selected' : ''}>A cada ${n} navegações</option>`).join('')}</select><p class="admin-control-hint">A frequência vale por navegador e sessão. O conteúdo atual é um espaço promocional interno da FoxBet; nenhuma rede externa está conectada.</p></div>
    </section>

    <div class="admin-section-head"><div><h2>🪙 Adicionar créditos a um usuário</h2><p>Localize a conta pelo nome de usuário e envie créditos pelo painel.</p></div></div>
    <section class="admin-settings-wide admin-credit-panel">
      <div class="admin-credit-summary"><span class="admin-credit-coin">◈</span><div><strong>Envie créditos diretamente para uma conta</strong><small>Informe o username, a quantidade e um motivo opcional. A movimentação fica registrada.</small></div><button class="admin-save-button" id="admin-open-credits" type="button">ADICIONAR CRÉDITOS ↗</button></div>
      <div class="admin-credit-feedback" id="admin-credit-feedback">Nenhuma operação realizada nesta sessão.</div>
    </section>

    <div class="admin-actions"><div class="admin-actions-copy"><span>🛡️</span><div><b>Publicação com histórico</b><span>As alterações passam a valer nas próximas rodadas e ficam registradas.</span></div></div><div class="admin-action-buttons"><button class="admin-reset-button" id="admin-reset">Restaurar padrões</button><button class="admin-save-button" id="admin-save">PUBLICAR AJUSTES ↗</button></div></div>
    <div class="admin-section-head"><div><h2>📋 Registro de alterações</h2><p>Histórico das configurações publicadas.</p></div></div>
    <div class="admin-audit">${logs.length ? logs.map((log) => `<div class="admin-audit-row"><div class="admin-audit-main"><strong>${escapeHtml(auditLabel(log))}</strong><small>Por ${escapeHtml(log.actor_username || 'Administrador')} · registro no servidor</small></div><span class="admin-audit-date">${new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') : '<div class="admin-audit-empty">Nenhuma alteração publicada ainda.</div>'}</div>
    <div class="admin-disclaimer"><span>ⓘ</span><div><b>Transparência FoxBet:</b> percentuais e regras são apresentados na tela de cada jogo. As alterações são aplicadas no servidor e registradas no histórico administrativo.</div></div>`;
  state.adminDraft = { ...values };
  wireAdminControls();
  wireAdminPlayerControls();
  renderAdminPlayersTable();
  if (!state.adminPlayersLoaded && !state.adminPlayersLoading) loadAdminPlayers();
  else if (state.adminSelectedPlayerId) renderAdminPlayerDetails();
}
function adminFormatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}
function renderAdminPlayersTable() {
  const table = $('#admin-player-table');
  const count = $('#admin-players-count');
  if (!table) return;
  const query = String(state.adminSearch || '').trim().toLowerCase();
  const players = (state.adminPlayers || []).filter((player) => !query || String(player.username || '').toLowerCase().includes(query));
  if (count) count.textContent = `${players.length} de ${state.adminPlayers.length} jogador(es)`;
  if (state.adminPlayersLoading && !state.adminPlayersLoaded) {
    table.innerHTML = '<div class="admin-player-empty">Carregando perfis cadastrados...</div>';
    return;
  }
  if (!players.length) {
    table.innerHTML = `<div class="admin-player-empty">${query ? 'Nenhum jogador encontrado com esse nome.' : 'Ainda não há perfis cadastrados.'}</div>`;
    return;
  }
  table.innerHTML = `<table class="admin-player-table"><thead><tr><th>JOGADOR</th><th>SALDO</th><th>PARTIDAS</th><th>VITÓRIAS / DERROTAS / EMPATES</th><th>APOSTADO</th><th>RESULTADO LÍQUIDO</th><th>AÇÕES</th></tr></thead><tbody>${players.map((player) => {
    const banned = Boolean(player.is_banned);
    const net = Number(player.net_result || 0);
    const netClass = net > 0 ? 'positive' : net < 0 ? 'negative' : '';
    return `<tr>
      <td><div class="admin-player-name"><strong>@${escapeHtml(player.username || 'sem_nome')}</strong><span class="admin-player-status ${banned ? 'banned' : 'active'}">${banned ? 'BANIDO' : 'ATIVO'}</span><small>Cadastro: ${adminFormatDate(player.created_at)}</small></div></td>
      <td><strong>${formatCredits(player.credits)} CR</strong></td>
      <td><strong>${formatCredits(player.total_games)}</strong><small>jogadas</small></td>
      <td><strong><span class="admin-player-win">${formatCredits(player.wins)}</span> / <span class="admin-player-loss">${formatCredits(player.losses)}</span> / ${formatCredits(player.draws)}</strong><small>vitórias / derrotas / empates</small></td>
      <td><strong>${formatCredits(player.total_wagered)} CR</strong></td>
      <td><strong class="${netClass}">${net > 0 ? '+' : ''}${formatCredits(net)} CR</strong></td>
      <td><div class="admin-player-actions"><button type="button" class="admin-player-action" data-admin-player-details="${escapeHtml(player.id)}">VER PERFIL</button><button type="button" class="admin-player-action" data-admin-player-credit="${escapeHtml(player.username || '')}">+ CRÉDITOS</button><button type="button" class="admin-player-action ${banned ? 'unban' : 'ban'}" data-admin-player-ban="${escapeHtml(player.id)}" data-banned="${banned ? 'true' : 'false'}">${banned ? 'DESBANIR' : 'BANIR'}</button></div></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
async function loadAdminPlayers() {
  if (!state.isAdmin || !supabaseReady || !state.session || state.adminPlayersLoading) return;
  state.adminPlayersLoading = true;
  renderAdminPlayersTable();
  try {
    const { data, error } = await supabase.rpc('admin_list_players', { p_search: null });
    if (error) throw error;
    state.adminPlayers = Array.isArray(data) ? data : [];
    state.adminPlayersLoaded = true;
    renderAdminPlayersTable();
    if (state.adminSelectedPlayerId) await loadAdminPlayerHistory(state.adminSelectedPlayerId);
  } catch (error) {
    const table = $('#admin-player-table');
    if (table) table.innerHTML = `<div class="admin-player-empty error">${escapeHtml(error.message || 'Não foi possível carregar os jogadores. Execute o SQL de atualização incluído no projeto.')}</div>`;
    const count = $('#admin-players-count');
    if (count) count.textContent = 'Falha ao carregar';
  } finally {
    state.adminPlayersLoading = false;
  }
}
function wireAdminPlayerControls() {
  const root = $('#admin-content');
  if (!root || root.dataset.playerControlsBound === 'true') return;
  root.dataset.playerControlsBound = 'true';
  root.addEventListener('input', (event) => {
    if (event.target?.id === 'admin-player-search') {
      state.adminSearch = event.target.value;
      renderAdminPlayersTable();
    }
  });
  root.addEventListener('click', async (event) => {
    const refresh = event.target.closest('#admin-players-refresh');
    if (refresh) {
      state.adminPlayersLoaded = false;
      await loadAdminPlayers();
      return;
    }
    const detailsButton = event.target.closest('[data-admin-player-details]');
    if (detailsButton) {
      await loadAdminPlayerHistory(detailsButton.dataset.adminPlayerDetails);
      return;
    }
    const creditButton = event.target.closest('[data-admin-player-credit]');
    if (creditButton) {
      $('#admin-credit-username').value = creditButton.dataset.adminPlayerCredit || '';
      showModal('#admin-credit-modal');
      return;
    }
    const banButton = event.target.closest('[data-admin-player-ban]');
    if (banButton) {
      const currentlyBanned = banButton.dataset.banned === 'true';
      await adminSetPlayerBan(banButton.dataset.adminPlayerBan, !currentlyBanned);
    }
  });
}
async function loadAdminPlayerHistory(userId) {
  if (!state.isAdmin || !userId) return;
  state.adminSelectedPlayerId = userId;
  state.adminPlayerHistoryLoading = true;
  const details = $('#admin-player-details');
  if (details) {
    details.classList.remove('hidden');
    details.innerHTML = '<div class="admin-player-empty">Carregando histórico do jogador...</div>';
  }
  try {
    const { data, error } = await supabase.rpc('admin_get_player_history', { p_user_id: userId });
    if (error) throw error;
    state.adminPlayerHistory = Array.isArray(data) ? data : [];
    renderAdminPlayerDetails();
  } catch (error) {
    if (details) details.innerHTML = `<div class="admin-player-empty error">${escapeHtml(error.message || 'Não foi possível carregar o histórico.')}</div>`;
  } finally {
    state.adminPlayerHistoryLoading = false;
  }
}
function renderAdminPlayerDetails() {
  const root = $('#admin-player-details');
  if (!root || !state.adminSelectedPlayerId) return;
  const player = (state.adminPlayers || []).find((item) => String(item.id) === String(state.adminSelectedPlayerId));
  if (!player) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  const history = state.adminPlayerHistory || [];
  const total = Number(player.total_games || 0);
  const wins = Number(player.wins || 0);
  const losses = Number(player.losses || 0);
  const draws = Number(player.draws || 0);
  const net = Number(player.net_result || 0);
  root.innerHTML = `<div class="admin-player-detail-head"><div><span class="eyebrow">PERFIL DO JOGADOR</span><h3>@${escapeHtml(player.username || '')}</h3><p>${player.is_banned ? `Conta banida${player.ban_reason ? ` · ${escapeHtml(player.ban_reason)}` : ''}` : 'Conta ativa'} · Cadastro ${adminFormatDate(player.created_at)}</p></div><button type="button" class="admin-player-close" id="admin-player-details-close" aria-label="Fechar perfil">×</button></div>
    <div class="admin-player-detail-stats"><div><small>SALDO ATUAL</small><strong>${formatCredits(player.credits)} CR</strong></div><div><small>PARTIDAS</small><strong>${formatCredits(total)}</strong></div><div><small>VITÓRIAS</small><strong class="admin-player-win">${formatCredits(wins)}</strong></div><div><small>DERROTAS</small><strong class="admin-player-loss">${formatCredits(losses)}</strong></div><div><small>EMPATES</small><strong>${formatCredits(draws)}</strong></div><div><small>TOTAL APOSTADO</small><strong>${formatCredits(player.total_wagered)} CR</strong></div><div><small>RESULTADO LÍQUIDO</small><strong class="${net > 0 ? 'positive' : net < 0 ? 'negative' : ''}">${net > 0 ? '+' : ''}${formatCredits(net)} CR</strong></div></div>
    <div class="admin-player-history-head"><h4>Atividade e movimentações</h4><span>${history.length} registro(s) recentes</span></div>
    ${history.length ? `<div class="admin-player-history">${history.map((item) => {
      const details = item.details && typeof item.details === 'object' ? item.details : {};
      const bet = details.bet != null ? ` · aposta ${formatCredits(details.bet)} CR` : '';
      const payout = details.payout != null ? ` · prêmio ${formatCredits(details.payout)} CR` : '';
      const phase = details.phase ? ` · ${String(details.phase)}` : '';
      const delta = Number(item.delta || 0);
      return `<div class="admin-player-history-row"><div><strong>${escapeHtml(item.reason || 'Movimentação')}</strong><small>${adminFormatDate(item.created_at, true)}${bet}${payout}${escapeHtml(phase)}</small></div><b class="${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}">${delta > 0 ? '+' : ''}${formatCredits(delta)} CR</b></div>`;
    }).join('')}</div>` : '<div class="admin-player-empty">Este jogador ainda não possui movimentações de jogos.</div>'}
    <div class="admin-player-detail-actions"><button type="button" class="admin-player-action" id="admin-detail-credit">ADICIONAR CRÉDITOS</button><button type="button" class="admin-player-action ${player.is_banned ? 'unban' : 'ban'}" id="admin-detail-ban">${player.is_banned ? 'DESBANIR CONTA' : 'BANIR CONTA'}</button></div>`;
  $('#admin-player-details-close')?.addEventListener('click', () => { root.classList.add('hidden'); state.adminSelectedPlayerId = null; });
  $('#admin-detail-credit')?.addEventListener('click', () => {
    $('#admin-credit-username').value = player.username || '';
    showModal('#admin-credit-modal');
  });
  $('#admin-detail-ban')?.addEventListener('click', () => adminSetPlayerBan(player.id, !player.is_banned));
}
async function adminSetPlayerBan(userId, banned) {
  if (!state.isAdmin || !supabaseReady || !userId) return;
  const player = (state.adminPlayers || []).find((item) => String(item.id) === String(userId));
  const username = player?.username || 'este jogador';
  const action = banned ? 'banir' : 'desbanir';
  if (!window.confirm(`Deseja realmente ${action} a conta @${username}?`)) return;
  try {
    const { error } = await supabase.rpc('admin_set_player_ban', {
      p_user_id: userId,
      p_banned: banned,
      p_reason: banned ? 'Banimento administrativo' : null,
    });
    if (error) throw error;
    notify(banned ? `A conta @${username} foi banida.` : `A conta @${username} foi desbanida.`);
    state.adminPlayersLoaded = false;
    await loadAdminPlayers();
    if (String(state.adminSelectedPlayerId) === String(userId)) renderAdminPlayerDetails();
  } catch (error) {
    notify(error.message || `Não foi possível ${action} a conta.`);
  }
}

function wireAdminControls() {
  const root = $('#admin-content');
  if (!root) return;
  root.querySelectorAll('[data-setting]').forEach((control) => {
    const eventName = control.type === 'range' ? 'input' : 'change';
    control.addEventListener(eventName, () => {
      const key = control.dataset.setting;
      const value = control.type === 'checkbox' ? control.checked : Number(control.value);
      state.adminDraft[key] = value;
      const output = $(`#value-${key}`);
      if (output) {
        if (key === 'mines_default_count') output.textContent = `${value} minas`;
        else if (key === 'ads_frequency') output.textContent = `A cada ${value} navegações`;
        else {
          const suffix = key.includes('factor') || key.includes('multiplier') ? '×' : '%';
          output.textContent = prettySetting(value, suffix);
        }
      }
      if (control.type === 'range') {
        const min = Number(control.min), max = Number(control.max);
        const percent = ((value - min) / (max - min)) * 100;
        control.style.background = `linear-gradient(90deg,#f78a2c 0%,#ffb15e ${percent}%,#394355 ${percent}%,#394355 100%)`;
      }
      updateAdminPreviewMeters();
      const draftState = $('#admin-draft-state');
      if (draftState) draftState.textContent = 'Alterações pendentes';
    });
  });
  $('#admin-save')?.addEventListener('click', adminSaveSettings);
  $('#admin-reset')?.addEventListener('click', () => {
    state.adminDraft = { ...DEFAULT_GAME_SETTINGS };
    renderAdminPage();
    notify('Padrões carregados. Publique para aplicar.');
  });
  $('#admin-open-credits')?.addEventListener('click', () => showModal('#admin-credit-modal'));
  const creditForm = $('#admin-credit-form');
  if (creditForm && creditForm.dataset.bound !== 'true') {
    creditForm.addEventListener('submit', adminAddCredits);
    creditForm.dataset.bound = 'true';
  }
}
function updateAdminPreviewMeters() {
  const s = state.adminDraft || state.gameSettings;
  const setMeter = (id, width, label, text) => {
    const fill = $(`#${id}`); const output = $(`#${label}`);
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, width))}%`;
    if (output) output.textContent = text;
  };
  setMeter('slots-meter', s.slots_triple_chance, 'slots-meter-label', `${prettySetting(s.slots_triple_chance)} de trinca`);
  setMeter('crash-meter', s.crash_chance_2x, 'crash-meter-label', `${prettySetting(s.crash_chance_2x)} até 2×`);
  setMeter('mines-meter', s.mines_first_safe_chance, 'mines-meter-label', `${prettySetting(s.mines_first_safe_chance)} primeira casa segura`);
  const slots = $('#admin-stat-slots'); if (slots) slots.textContent = prettySetting(s.slots_triple_chance);
  const blackjack = $('#admin-stat-blackjack'); if (blackjack) blackjack.textContent = prettySetting(s.blackjack_natural_chance);
  const ads = $('#admin-stat-ads'); if (ads) ads.textContent = s.ads_enabled ? 'ATIVOS' : 'OFF';
}
async function adminSaveSettings() {
  if (!state.isAdmin || !supabaseReady || state.busy) return;
  const settings = sanitizeSettings(state.adminDraft);
  const save = $('#admin-save');
  if (save) { save.disabled = true; save.textContent = 'PUBLICANDO...'; }
  try {
    const { data, error } = await supabase.rpc('admin_update_game_settings', { p_settings: settings });
    if (error) throw error;
    state.gameSettings = sanitizeSettings(data.settings || settings);
    state.adminLogs = Array.isArray(data.logs) ? data.logs : state.adminLogs;
    state.adminDraft = { ...state.gameSettings };
    notify('Configurações publicadas com sucesso.');
    renderAdminPage();
  } catch (error) {
    notify(error.message || 'Não foi possível publicar as configurações.');
  } finally {
    const current = $('#admin-save'); if (current) { current.disabled = false; current.textContent = 'PUBLICAR AJUSTES ↗'; }
  }
}
async function adminAddCredits(event) {
  event.preventDefault();
  if (!state.isAdmin || !supabaseReady) return;
  const username = $('#admin-credit-username').value.trim().toLowerCase();
  const amount = Number($('#admin-credit-amount').value);
  const reason = $('#admin-credit-reason').value.trim();
  const feedback = $('#admin-credit-feedback');
  const button = $('#admin-credit-submit');
  if (!validUsername(username)) { feedback.textContent = 'Informe um nome de usuário válido.'; feedback.classList.add('error'); return; }
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) { feedback.textContent = 'Escolha uma quantidade entre 1 e 100.000 créditos.'; feedback.classList.add('error'); return; }
  button.disabled = true; button.textContent = 'PROCESSANDO...'; feedback.classList.remove('error');
  try {
    const { data, error } = await supabase.rpc('admin_add_user_credits', { p_username: username, p_amount: amount, p_reason: reason || 'Crédito administrativo' });
    if (error) throw error;
    feedback.textContent = `${formatCredits(data.amount)} créditos adicionados a @${data.username}. Novo saldo: ${formatCredits(data.credits)} CR.`;
    $('#admin-credit-form').reset();
    hideModal('#admin-credit-modal');
    notify('Créditos adicionados com sucesso.');
    if (state.profile?.id === data.user_id) await refreshProfile();
    state.adminPlayersLoaded = false;
    await loadAdminPlayers();
    if (String(state.adminSelectedPlayerId) === String(data.user_id)) await loadAdminPlayerHistory(data.user_id);
  } catch (error) {
    feedback.textContent = error.message || 'Não foi possível adicionar os créditos.';
    feedback.classList.add('error');
  } finally {
    button.disabled = false; button.textContent = 'ADICIONAR CRÉDITOS ↗';
  }
}

function gameOddsDisclosure(game) {
  const s = state.gameSettings;
  const copy = {
    slots: `Chance publicada de trinca: <b>${prettySetting(s.slots_triple_chance)}</b>. Entre as trincas, chance de símbolo Fox: <b>${prettySetting(s.slots_jackpot_share)}</b>.`,
    crash: `Chance publicada de alcançar 2,00×: <b>${prettySetting(s.crash_chance_2x)}</b>.`,
    mines: `Chance publicada de a primeira casa ser segura: <b>${prettySetting(s.mines_first_safe_chance)}</b>. Fator de pagamento: <b>${prettySetting(s.mines_return_factor, '×')}</b>. Depois da primeira escolha, a chance é calculada pelo tabuleiro restante.`,
    blackjack: `Chance publicada de receber 21 natural nas duas cartas iniciais: <b>${prettySetting(s.blackjack_natural_chance)}</b>. Pagamento atual: <b>${prettySetting(s.blackjack_natural_multiplier, '×')}</b>.`,
    roulette: `Chance publicada de acertar a seleção atual: <b>${prettySetting(s.roulette_hit_chance)}</b>. A mesma regra é aplicada ao tipo de aposta escolhido.`,
    plinko: `Chance de cada pino direcionar para a esquerda: <b>${prettySetting(s.plinko_left_chance)}</b>; para a direita: <b>${prettySetting(100 - s.plinko_left_chance)}</b>. Fator da tabela de pagamentos: <b>${prettySetting(s.plinko_return_factor, '×')}</b>.`,
  };
  return `<div class="odds-disclosure" id="game-odds-disclosure"><span>ⓘ</span><div><b>REGRAS E PROBABILIDADES ATIVAS</b><br>${copy[game] || ''}</div></div>`;
}

function openAuth(mode = "login") {
  if (!supabaseReady) {
    $("#auth-config-note").classList.remove("hidden");
    $("#auth-config-note").textContent = supabaseLoadError
      ? "A configuração foi encontrada, mas a biblioteca do Supabase não carregou. Verifique a conexão com a internet e recarregue a página."
      : "O Supabase ainda não foi configurado. Preencha a URL e a chave pública em config.js para ativar cadastro e login.";
    $("#auth-form").classList.add("hidden");
  } else {
    $("#auth-config-note").classList.add("hidden");
    $("#auth-form").classList.remove("hidden");
  }
  setAuthMode(mode);
  showModal("#auth-modal");
}
function setAuthMode(mode) {
  state.authMode = mode;
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
  $("#auth-title").textContent = mode === "login" ? "Entre para continuar" : "Crie sua conta";
  $("#auth-submit").innerHTML = mode === "login" ? 'Entrar <span>→</span>' : 'Criar conta <span>→</span>';
  $("#auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-error").textContent = "";
}
async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!supabaseReady) return;
  const username = $("#auth-username").value.trim().toLowerCase();
  const password = $("#auth-password").value;
  const errorBox = $("#auth-error");
  errorBox.textContent = "";
  if (!validUsername(username)) { errorBox.textContent = "Use 3–20 caracteres: letras minúsculas, números ou _."; return; }
  if (password.length < 8) { errorBox.textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
  const submit = $("#auth-submit");
  submit.disabled = true;
  submit.textContent = state.authMode === "login" ? "Entrando..." : "Criando conta...";
  try {
    if (state.authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail(username), password,
        options: { data: { username } }
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error("O Supabase não iniciou a sessão. Desative a confirmação de e-mail no provedor Email para usar cadastro somente com usuário e senha.");
      }
      state.session = data.session;
      await refreshProfile();
      if (state.profile?.is_banned) {
        await supabase.auth.signOut();
        state.session = null;
        state.profile = null;
        updateHeader();
        throw new Error('Esta conta está banida e não pode acessar os jogos.');
      }
      await loadAdminAccess();
      hideModal("#auth-modal");
      notify("Conta criada! Você recebeu 50 créditos para começar.");
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail(username), password });
      if (error) throw error;
      state.session = data.session;
      await refreshProfile();
      if (state.profile?.is_banned) {
        await supabase.auth.signOut();
        state.session = null;
        state.profile = null;
        updateHeader();
        throw new Error('Esta conta foi banida e não pode acessar a FoxBet.');
      }
      await loadAdminAccess();
      hideModal("#auth-modal");
      notify("Login realizado com sucesso.");
    }
    updateHeader();
  } catch (error) {
    errorBox.textContent = userFriendlyAuthError(error.message);
  } finally {
    submit.disabled = false;
    submit.innerHTML = state.authMode === "login" ? 'Entrar <span>→</span>' : 'Criar conta <span>→</span>';
  }
}
function userFriendlyAuthError(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("invalid login credentials")) return "Usuário ou senha incorretos.";
  if (lower.includes("duplicate key") || lower.includes("profiles_username_key") || lower.includes("already registered")) return "Este nome de usuário já está em uso.";
  if (lower.includes("fetch") || lower.includes("network")) return "Não foi possível conectar ao Supabase. Confira a URL e sua conexão.";
  return message || "Não foi possível concluir. Tente novamente.";
}
async function signOut() {
  if (!supabaseReady) return;
  const { error } = await supabase.auth.signOut();
  if (error) { notify(error.message); return; }
  state.session = null; state.profile = null; state.history = []; state.isAdmin = false; state.adminLogs = [];
  state.adminPlayers = []; state.adminPlayersLoaded = false; state.adminSelectedPlayerId = null; state.adminPlayerHistory = []; state.adminOwnerId = null;
  updateHeader(); renderHistory(); setView("home"); notify("Você saiu da conta.");
}
async function ensureCanPlay() {
  if (state.profile?.is_banned) {
    notify(`Esta conta está banida${state.profile.ban_reason ? `: ${state.profile.ban_reason}` : '.'}`);
    return false;
  }
  if (supabaseReady && !state.session) {
    openAuth("login");
    notify("Entre ou crie uma conta para jogar.");
    return false;
  }
  return true;
}

async function renderGame(game) {
  if (state.crashRound?.status === 'active' && state.currentGame === 'crash' && game !== 'crash') {
    notify('Finalize a rodada do Fox Crash antes de abrir outro jogo.');
    return;
  }
  if (supabaseReady) await loadPublicGameSettings();
  state.currentGame = game;
  state.minesRound = null;
  state.blackjackRound = null;
  const info = GAME_INFO[game];
  if (!info) return;
  const common = `<div class="game-topline"><button class="back-button" id="back-games">← Voltar</button><div><p class="eyebrow">JOGOS FOXBET</p><h1 class="game-title">${info.title}</h1><p class="game-subtitle">${info.subtitle}</p></div></div>`;
  let body = "";
  if (game === "slots") body = renderSlots();
  if (game === "crash") body = renderCrash();
  if (game === "mines") body = renderMines();
  if (game === "blackjack") body = renderBlackjack();
  if (game === "roulette") body = renderRoulette();
  if (game === "plinko") body = renderPlinko();
  $("#game-screen").innerHTML = common + body + gameOddsDisclosure(game);
  setView("game");
  wireBetShortcuts();
  $("#back-games").addEventListener("click", () => setView("games"));
  wireGameControls(game);
}
function betControls(prefix, extra = "") {
  return `<section class="game-controls">
    <div class="controls-heading"><span class="controls-icon">◈</span><div><h3>Configurar rodada</h3><p>Use seus créditos</p></div></div>
    <label class="control-label" for="${prefix}-bet">Valor da aposta</label>
    <div class="field-wrap"><input id="${prefix}-bet" type="number" min="1" max="5000" step="1" value="5" inputmode="numeric"><span>CR</span></div>
    <div class="bet-shortcuts"><button type="button" data-bet="1">1</button><button type="button" data-bet="5">5</button><button type="button" data-bet="10">10</button><button type="button" data-bet="25">25</button></div>
    ${extra}
  </section>`;
}
function renderSlots() {
  return `<div class="game-layout game-layout-slots">
    ${betControls("slot", `<div class="paytable"><div class="paytable-title">TABELA DE PRÊMIOS</div><div><span>🍒 🍒 🍒</span><strong>5×</strong></div><div><span>🍋 🍋 🍋</span><strong>4×</strong></div><div><span>🔔 🔔 🔔</span><strong>8×</strong></div><div><span>💎 💎 💎</span><strong>12×</strong></div><div><span>7️⃣ 7️⃣ 7️⃣</span><strong>25×</strong></div><div><span>🦊 🦊 🦊</span><strong>40×</strong></div></div><p class="control-footnote">Três símbolos iguais pagam o prêmio indicado. Dois iguais devolvem a aposta nesta versão demonstrativa.</p>`)}
    <section class="game-stage slot-stage">
      <span class="stage-label">FOX SLOTS • MÁQUINA CLÁSSICA</span>
      <div class="slot-cabinet" id="slot-cabinet">
        <div class="slot-marquee"><span class="marquee-bulb">✦</span><div><small>FOX CASINO</small><strong>LUCKY <em>FOX</em></strong></div><span class="marquee-bulb">✦</span></div>
        <div class="slot-jackpot"><span>PRÊMIO MÁXIMO</span><strong>40<span>×</span></strong></div>
        <div class="slot-reels-frame">
          <div class="reel-window"><div class="reel" id="reel-0">🦊</div></div>
          <div class="reel-window"><div class="reel" id="reel-1">💎</div></div>
          <div class="reel-window"><div class="reel" id="reel-2">7️⃣</div></div>
        </div>
        <div class="slot-payline"><span></span><b>LINHA PREMIADA</b><span></span></div>
        <button class="slot-lever-button game-action" id="spin-btn" type="button"><span class="lever-star">✦</span> PUXE PARA GIRAR <span class="lever-star">✦</span></button>
        <div class="slot-foot-lights"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="slot-handle" aria-hidden="true"><span></span><i></i></div>
        <div class="slot-coin-tray" aria-hidden="true">◉ <small>FOX COIN</small></div>
      </div>
      <div class="stage-result slot-result" id="slot-result">A máquina está pronta. Boa sorte!</div>
      <div class="stage-sub">Cada giro utiliza créditos da sua carteira.</div>
    </section>
  </div>`;
}
function renderCrash() {
  return `<div class="game-layout game-layout-crash">
    ${betControls("crash", `<div class="crash-how"><span>01</span><p>Inicie a rodada</p><span>02</span><p>Acompanhe o foguete</p><span>03</span><p>Retire antes da queda</p></div><p class="control-footnote">O multiplicador sobe enquanto o foguete voa. Toque em retirar quando quiser. Se o foguete cair primeiro, a rodada termina.</p>`)}
    <section class="game-stage crash-stage">
      <span class="stage-label">FOX CRASH • VOO AO VIVO</span>
      <div class="crash-hud"><span class="crash-live"><i></i> AO VIVO</span><span class="crash-round-label" id="crash-round-label">AGUARDANDO LANÇAMENTO</span></div>
      <div class="crash-multiplier" id="crash-multiplier">1,00<span>×</span></div>
      <div class="crash-world" id="crash-world">
        <div class="crash-stars stars-one">✦　·　　✧　　·　✦</div><div class="crash-stars stars-two">·　✧　　·　　✦</div>
        <div class="crash-moon"></div>
        <svg class="crash-chart" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="crash-line-gradient" x1="0" x2="1"><stop offset="0" stop-color="#ffb14f"/><stop offset="1" stop-color="#ff6728"/></linearGradient><linearGradient id="crash-fill-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a24" stop-opacity=".25"/><stop offset="1" stop-color="#ff8a24" stop-opacity="0"/></linearGradient></defs><path class="crash-grid" d="M20 55H580 M20 125H580 M20 195H580 M20 265H580 M100 20V280 M220 20V280 M340 20V280 M460 20V280"/><path class="crash-fill" d="M20 270 C130 267 145 245 220 226 S335 170 400 125 S500 55 580 25 V280 H20Z"/><path class="crash-route" d="M20 270 C130 267 145 245 220 226 S335 170 400 125 S500 55 580 25"/></svg>
        <div class="rocket-ship" id="rocket-ship">🚀</div><div class="crash-horizon"></div>
      </div>
      <div class="crash-status" id="crash-status">Faça sua aposta e lance o foguete.</div>
      <button class="primary-button game-action" id="crash-start">LANÇAR FOGUETE <span>↗</span></button>
      <button class="cashout-button game-action hidden" id="crash-cashout">RETIRAR <strong id="crash-cashout-value">1,00×</strong></button>
      <div class="crash-bottom-stats"><div><small>SUA APOSTA</small><strong id="crash-bet-display">5 CR</strong></div><div><small>MULTIPLICADOR</small><strong id="crash-stat-multiplier">1,00×</strong></div><div><small>PRÊMIO ATUAL</small><strong id="crash-current-payout">5 CR</strong></div></div>
    </section>
  </div>`;
}
function renderMines() {
  return `<div class="game-layout">
    ${betControls("mines", `<label class="control-label" for="mines-count">Quantidade de minas</label><select id="mines-count">${[3, 5, 8, 10].map((n) => `<option value="${n}" ${Number(state.gameSettings.mines_default_count) === n ? 'selected' : ''}>${n} minas</option>`).join('')}</select><button class="primary-button game-action" id="mines-start">INICIAR RODADA <span>↗</span></button><button class="secondary-button game-action hidden" id="mines-cashout">Retirar ganhos</button><p class="control-footnote">Encontre gemas e retire antes de revelar uma mina.</p>`)}
    <section class="game-stage mines-stage"><span class="stage-label">FOX MINES • TABULEIRO 5 × 5</span><div class="mines-meta"><span>Gemas: <strong id="mines-safe-count">0</strong></span><span>Multiplicador: <strong id="mines-multiplier">—</strong></span></div><div class="mines-board" id="mines-board">${Array.from({ length: 25 }, (_, index) => `<button class="mine-cell" data-cell="${index}" disabled aria-label="Casa ${index + 1}">?</button>`).join("")}</div><div class="mines-message" id="mines-message">Configure sua aposta para começar.</div></section>
  </div>`;
}
function renderBlackjack() {
  return `<div class="game-layout game-layout-blackjack">
    ${betControls("blackjack", `<button class="primary-button game-action" id="blackjack-start">DISTRIBUIR CARTAS <span>↗</span></button><div class="blackjack-actions"><button class="secondary-button game-action hidden" id="blackjack-hit">Pedir carta</button><button class="primary-button game-action hidden" id="blackjack-stand">Parar</button></div><p class="control-footnote">O objetivo é chegar o mais perto possível de 21 sem ultrapassar. A banca compra até alcançar 17.</p>`)}
    <section class="game-stage blackjack-stage"><span class="stage-label">FOX BLACKJACK • MESA 21</span><div class="blackjack-table"><div class="table-brand">FOX <span>21</span></div><div class="blackjack-hand dealer-hand"><div class="hand-label"><span>BANCA</span><strong id="dealer-total">—</strong></div><div class="playing-cards" id="dealer-cards"><div class="card-back">🦊</div></div></div><div class="table-divider"><span>♦</span><i></i><span>♠</span></div><div class="blackjack-hand player-hand"><div class="hand-label"><span>SUA MÃO</span><strong id="player-total">—</strong></div><div class="playing-cards" id="player-cards"><div class="card-placeholder">Suas cartas aparecerão aqui</div></div></div><div class="blackjack-message" id="blackjack-message">Faça sua aposta e distribua as cartas.</div></div></section>
  </div>`;
}
function renderRoulette() {
  return `<div class="game-layout game-layout-roulette">
    ${betControls("roulette", `<label class="control-label" for="roulette-type">Tipo de aposta</label><select id="roulette-type"><option value="red">Vermelho</option><option value="black">Preto</option><option value="even">Par</option><option value="odd">Ímpar</option><option value="number">Número exato</option></select><div class="field-wrap roulette-number-wrap hidden" id="roulette-number-wrap"><input id="roulette-number" type="number" min="0" max="36" value="17" inputmode="numeric"><span>0–36</span></div><button class="primary-button game-action" id="roulette-spin">GIRAR ROLETA <span>↗</span></button><p class="control-footnote">Vermelho, preto, par ou ímpar pagam 2×. Acertar o número exato paga 36×.</p>`)}
    <section class="game-stage roulette-stage"><span class="stage-label">FOX ROULETTE • EUROPEIA</span><div class="roulette-lights">✦　✧　✦　✧　✦</div><div class="roulette-wheel-wrap"><div class="roulette-pointer">▼</div><div class="roulette-wheel" id="roulette-wheel"><div class="roulette-number">0</div><div class="roulette-center">FOX<br><small>BET</small></div></div></div><div class="roulette-result" id="roulette-result">Escolha sua aposta e gire a roda.</div><div class="roulette-legend"><span><i class="legend-red"></i> Vermelho</span><span><i class="legend-black"></i> Preto</span><span><i class="legend-green"></i> Zero</span></div></section>
  </div>`;
}
function renderPlinko() {
  const pegs = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col <= row; col++) {
      const x = 210 + (col - row / 2) * 43;
      const y = 38 + row * 30;
      pegs.push(`<circle cx="${x}" cy="${y}" r="4.3" class="plinko-peg"/>`);
    }
  }
  return `<div class="game-layout game-layout-plinko">
    ${betControls("plinko", `<label class="control-label" for="plinko-risk">Nível de risco</label><select id="plinko-risk"><option value="low">Baixo · mais estável</option><option value="medium" selected>Médio · equilibrado</option><option value="high">Alto · extremos maiores</option></select><button class="primary-button game-action" id="plinko-drop">SOLTAR BOLINHA <span>↘</span></button><p class="control-footnote">A bolinha percorre 8 fileiras. O multiplicador depende da casa final e do risco escolhido.</p>`)}
    <section class="game-stage plinko-stage"><span class="stage-label">FOX PLINKO • 8 FILEIRAS</span><div class="plinko-board-wrap"><svg class="plinko-board" id="plinko-board" viewBox="0 0 420 330" role="img" aria-label="Tabuleiro Plinko com pinos e uma bolinha"><path d="M210 12V22" class="plinko-drop-line"/>${pegs.join("")}<circle id="plinko-ball" cx="210" cy="13" r="8" class="plinko-ball"/></svg></div><div class="plinko-bins" id="plinko-bins"></div><div class="plinko-result" id="plinko-result">Pronto para soltar a bolinha?</div></section>
  </div>`;
}
function wireBetShortcuts() {
  $$('[data-bet]').forEach((button) => button.addEventListener('click', () => {
    const input = $('#slot-bet') || $('#crash-bet') || $('#mines-bet') || $('#blackjack-bet') || $('#roulette-bet') || $('#plinko-bet');
    if (input) input.value = button.dataset.bet;
  }));
}
function wireGameControls(game) {
  if (game === 'slots') $('#spin-btn').addEventListener('click', playSlots);
  if (game === 'crash') {
    $('#crash-start').addEventListener('click', startCrash);
    $('#crash-cashout').addEventListener('click', cashoutCrash);
  }
  if (game === 'mines') {
    $('#mines-start').addEventListener('click', startMines);
    $('#mines-cashout').addEventListener('click', cashoutMines);
    $$('.mine-cell').forEach((cell) => cell.addEventListener('click', () => revealMine(Number(cell.dataset.cell))));
  }
  if (game === 'blackjack') {
    $('#blackjack-start').addEventListener('click', startBlackjack);
    $('#blackjack-hit').addEventListener('click', () => blackjackAction('hit'));
    $('#blackjack-stand').addEventListener('click', () => blackjackAction('stand'));
  }
  if (game === 'roulette') {
    $('#roulette-spin').addEventListener('click', playRoulette);
    $('#roulette-type').addEventListener('change', () => $('#roulette-number-wrap').classList.toggle('hidden', $('#roulette-type').value !== 'number'));
  }
  if (game === 'plinko') {
    $('#plinko-drop').addEventListener('click', playPlinko);
    drawPlinkoBins('medium', -1);
  }
}
function readBet(selector) {
  const bet = Number($(selector).value);
  if (!Number.isInteger(bet) || bet < 1 || bet > 5000) throw new Error("Escolha uma aposta entre 1 e 5.000 créditos.");
  if (bet > currentCredits()) throw new Error("Saldo insuficiente para esta aposta.");
  return bet;
}
async function updateAfterGame() {
  if (supabaseReady) {
    await refreshProfile();
  } else {
    demoSave();
  }
}
function randomSlotResult() {
  let symbols;
  if (Math.random() * 100 < Number(state.gameSettings.slots_triple_chance)) {
    const jackpot = Math.random() * 100 < Number(state.gameSettings.slots_jackpot_share);
    const symbol = jackpot ? "🦊" : SLOT_SYMBOLS[Math.floor(Math.random() * (SLOT_SYMBOLS.length - 1))];
    symbols = [symbol, symbol, symbol];
  } else {
    symbols = Array.from({ length: 3 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
    if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) symbols[2] = SLOT_SYMBOLS[(SLOT_SYMBOLS.indexOf(symbols[2]) + 1) % SLOT_SYMBOLS.length];
  }
  let multiplier = 0;
  if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) multiplier = SLOT_MULTIPLIERS[symbols[0]];
  else if (symbols[0] === symbols[1] || symbols[0] === symbols[2] || symbols[1] === symbols[2]) multiplier = 1;
  return { symbols, payout: Math.floor(Number($("#slot-bet").value) * multiplier), multiplier };
}
async function playSlots() {
  if (!(await ensureCanPlay()) || state.busy) return;
  let bet;
  try { bet = readBet("#slot-bet"); } catch (error) { notify(error.message); return; }
  setBusy(true);
  $("#slot-cabinet")?.classList.add("lever-pulled");
  $("#slot-result").textContent = "Os rolos estão girando...";
  $$(".reel").forEach((reel) => reel.classList.add("spinning"));
  try {
    await new Promise((resolve) => setTimeout(resolve, 1350));
    let result;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc("play_slots", { p_bet: bet });
      if (error) throw error;
      result = data;
      applyRoundOdds({ slots_triple_chance: data.triple_chance, slots_jackpot_share: data.jackpot_share });
    } else {
      result = randomSlotResult();
      state.credits -= bet;
      state.credits += Number(result.payout || 0);
      demoHistory("Fox Slots", Number(result.payout || 0) - bet, { bet, payout: result.payout, multiplier: result.multiplier });
    }
    result.symbols.forEach((symbol, index) => { $(`#reel-${index}`).textContent = symbol; $(`#reel-${index}`).classList.remove("spinning"); });
    const payout = Number(result.payout || 0);
    $("#slot-result").innerHTML = payout > bet ? `Você ganhou <strong>+${formatCredits(payout)} CR</strong> (${Number(result.multiplier).toFixed(0)}×)!` : payout > 0 ? `Aposta devolvida: <strong>${formatCredits(payout)} CR</strong>.` : "Não foi desta vez. Tente outra rodada.";
    if (supabaseReady) await updateAfterGame();
    notify(payout > bet ? `Boa! +${formatCredits(payout)} créditos.` : "Rodada finalizada.");
  } catch (error) {
    notify(error.message || "Não foi possível jogar agora.");
    $$(".reel").forEach((reel) => reel.classList.remove("spinning"));
  } finally {
    $("#slot-cabinet")?.classList.remove("lever-pulled");
    setBusy(false);
  }
}
function stopCrashTimers() {
  if (state.crashTimer) window.clearInterval(state.crashTimer);
  if (state.crashPollTimer) window.clearInterval(state.crashPollTimer);
  state.crashTimer = null;
  state.crashPollTimer = null;
  state.crashPollBusy = false;
}
function formatMultiplier(value) { return `${Number(value || 1).toFixed(2).replace('.', ',')}×`; }
function updateCrashVisual(multiplier) {
  if (!$('#crash-multiplier')) return;
  const m = Math.max(1, Number(multiplier || 1));
  $('#crash-multiplier').innerHTML = `${m.toFixed(2).replace('.', ',')}<span>×</span>`;
  $('#crash-stat-multiplier').textContent = formatMultiplier(m);
  const bet = Number(state.crashRound?.bet || 0);
  $('#crash-current-payout').textContent = `${formatCredits(Math.floor(bet * m))} CR`;
  const progress = Math.min(1, Math.log(m) / Math.log(12));
  $('#crash-world')?.style.setProperty('--flight-x', `${7 + progress * 78}%`);
  $('#crash-world')?.style.setProperty('--flight-y', `${80 - progress * 63}%`);
  $('#crash-cashout-value').textContent = formatMultiplier(m);
}
async function startCrash() {
  if (!(await ensureCanPlay()) || state.busy || state.crashRound?.status === 'active') return;
  let bet;
  try { bet = readBet('#crash-bet'); } catch (error) { notify(error.message); return; }
  setBusy(true);
  try {
    let round;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('start_crash', { p_bet: bet });
      if (error) throw error;
      round = { id: data.round_id, bet, status: 'active', mode: 'remote', startedAt: Date.parse(data.started_at) || Date.now() };
      applyRoundOdds({ crash_chance_2x: data.chance_2x });
      await updateAfterGame();
    } else {
      if (state.credits < bet) throw new Error('Saldo insuficiente para esta aposta.');
      const crashFactor = (2 * Number(state.gameSettings.crash_chance_2x)) / 100;
      const crashAt = Math.min(100, Math.max(1, Math.floor((crashFactor / Math.max(Math.random(), .0001)) * 100) / 100));
      state.credits -= bet;
      demoHistory('Fox Crash', -bet, { bet, phase: 'entrada' });
      round = { bet, status: 'active', mode: 'demo', crashAt, startedAt: Date.now() };
    }
    state.crashRound = round;
    $('#crash-bet-display').textContent = `${formatCredits(bet)} CR`;
    $('#crash-start').classList.add('hidden');
    $('#crash-cashout').classList.remove('hidden');
    $('#crash-status').className = 'crash-status in-flight';
    $('#crash-status').textContent = 'Foguete no ar! Retire quando quiser.';
    $('#crash-round-label').textContent = 'VOO EM ANDAMENTO';
    $('#crash-world').classList.add('in-flight');
    updateCrashVisual(1);
    setBusy(false);
    state.crashTimer = window.setInterval(() => {
      const elapsed = Math.max(0, (Date.now() - state.crashRound.startedAt) / 1000);
      const multiplier = Math.exp(elapsed * .34);
      updateCrashVisual(multiplier);
      if (state.crashRound.mode === 'demo' && multiplier >= state.crashRound.crashAt) {
        finishCrash({ crashed: true, crash_at: state.crashRound.crashAt });
      }
    }, 45);
    if (supabaseReady) state.crashPollTimer = window.setInterval(pollCrashStatus, 600);
  } catch (error) {
    notify(error.message || 'Não foi possível iniciar o voo.');
    setBusy(false);
  }
}
async function pollCrashStatus() {
  const round = state.crashRound;
  if (!round || round.status !== 'active' || round.mode !== 'remote' || state.crashPollBusy) return;
  state.crashPollBusy = true;
  try {
    const { data, error } = await supabase.rpc('check_crash', { p_round_id: round.id });
    if (error) throw error;
    if (data.crashed) finishCrash(data);
    else if (data.multiplier) updateCrashVisual(data.multiplier);
  } catch (error) {
    console.warn('Falha ao verificar Fox Crash:', error.message);
  } finally { state.crashPollBusy = false; }
}
async function cashoutCrash() {
  const round = state.crashRound;
  if (!round || round.status !== 'active' || state.busy) return;
  setBusy(true);
  try {
    let result;
    if (round.mode === 'remote') {
      const { data, error } = await supabase.rpc('cashout_crash', { p_round_id: round.id });
      if (error) throw error;
      result = data;
    } else {
      const elapsed = Math.max(0, (Date.now() - round.startedAt) / 1000);
      const multiplier = Math.floor(Math.exp(elapsed * .34) * 100) / 100;
      if (multiplier >= round.crashAt) result = { crashed: true, crash_at: round.crashAt };
      else {
        const payout = Math.floor(round.bet * multiplier);
        state.credits += payout;
        demoHistory('Fox Crash', payout, { bet: round.bet, payout, cashout: multiplier, phase: 'retirada' });
        result = { crashed: false, won: true, multiplier, payout };
      }
    }
    if (result.crashed) finishCrash(result);
    else finishCrash({ ...result, won: true });
    if (round.mode === 'remote') await updateAfterGame();
  } catch (error) {
    notify(error.message || 'Não foi possível retirar agora.');
  } finally { setBusy(false); }
}
function finishCrash(result) {
  const round = state.crashRound;
  if (!round || round.status !== 'active') return;
  round.status = result.crashed ? 'lost' : 'cashed_out';
  stopCrashTimers();
  $('#crash-start')?.classList.remove('hidden');
  $('#crash-cashout')?.classList.add('hidden');
  $('#crash-world')?.classList.remove('in-flight');
  if (result.crashed) {
    const crashAt = Number(result.crash_at || 1);
    updateCrashVisual(crashAt);
    $('#crash-round-label').textContent = 'VOO ENCERRADO';
    $('#crash-status').className = 'crash-status lose';
    $('#crash-status').textContent = `O foguete caiu em ${formatMultiplier(crashAt)}. A rodada terminou.`;
    notify('O foguete caiu. Tente novamente em outra rodada.');
  } else {
    const multiplier = Number(result.multiplier || 1);
    const payout = Number(result.payout || 0);
    updateCrashVisual(multiplier);
    $('#crash-round-label').textContent = 'RETIRADA REALIZADA';
    $('#crash-status').className = 'crash-status win';
    $('#crash-status').textContent = `Retirada em ${formatMultiplier(multiplier)} · +${formatCredits(payout)} créditos.`;
    notify(`Você retirou ${formatCredits(payout)} créditos.`);
  }
  if (round.mode === 'demo') demoSave();
}
const BLACKJACK_SUITS = ['♠', '♥', '♦', '♣'];
function drawCard() {
  const n = Math.floor(Math.random() * 13) + 1;
  const rank = n === 1 ? 'A' : n === 11 ? 'J' : n === 12 ? 'Q' : n === 13 ? 'K' : String(n);
  return { rank, suit: BLACKJACK_SUITS[Math.floor(Math.random() * 4)], value: n === 1 ? 11 : Math.min(n, 10) };
}
function handTotal(cards) {
  let total = cards.reduce((sum, card) => sum + Number(card.value), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function drawOpeningBlackjackHand() {
  const naturalChance = Number(state.gameSettings.blackjack_natural_chance);
  if (Math.random() * 100 < naturalChance) {
    return [
      { rank: 'A', suit: '♠', value: 11 },
      { rank: 'K', suit: '♥', value: 10 },
    ];
  }
  let cards;
  do { cards = [drawCard(), drawCard()]; } while (handTotal(cards) === 21);
  return cards;
}
function renderCards(selector, cards, hideHole = false) {
  const root = $(selector);
  if (!root) return;
  const visible = cards || [];
  root.innerHTML = visible.map((card, index) => {
    if (hideHole && index === 1) return '<div class="card-back">🦊</div>';
    const red = card.suit === '♥' || card.suit === '♦';
    return `<div class="playing-card ${red ? 'red-suit' : ''}"><span>${escapeHtml(card.rank)}</span><b>${escapeHtml(card.suit)}</b><small>${escapeHtml(card.rank)}</small></div>`;
  }).join('') || '<div class="card-placeholder">Aguardando cartas</div>';
  if (hideHole && visible.length === 1) root.insertAdjacentHTML('beforeend', '<div class="card-back">🦊</div>');
}
function updateBlackjackTable(round) {
  if (!round || !$('#player-cards')) return;
  renderCards('#player-cards', round.playerCards, false);
  renderCards('#dealer-cards', round.dealerCards, round.status === 'active');
  $('#player-total').textContent = String(handTotal(round.playerCards));
  $('#dealer-total').textContent = round.status === 'active' ? String(round.dealerCards[0]?.value === 11 ? 'A' : round.dealerCards[0]?.value || '—') : String(handTotal(round.dealerCards));
  $('#blackjack-start').classList.toggle('hidden', round.status === 'active');
  $('#blackjack-hit').classList.toggle('hidden', round.status !== 'active');
  $('#blackjack-stand').classList.toggle('hidden', round.status !== 'active');
  $('#blackjack-hit').disabled = handTotal(round.playerCards) >= 21 || state.busy;
  $('#blackjack-stand').disabled = state.busy;
}
async function startBlackjack() {
  if (!(await ensureCanPlay()) || state.busy || state.blackjackRound?.status === 'active') return;
  let bet;
  try { bet = readBet('#blackjack-bet'); } catch (error) { notify(error.message); return; }
  setBusy(true);
  try {
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('start_blackjack', { p_bet: bet });
      if (error) throw error;
      state.blackjackRound = { id: data.round_id, bet, playerCards: data.player_cards, dealerCards: [data.dealer_card], naturalChance: Number(data.natural_chance ?? state.gameSettings.blackjack_natural_chance), naturalMultiplier: Number(data.natural_multiplier ?? state.gameSettings.blackjack_natural_multiplier), status: data.status || 'active', mode: 'remote' };
      applyRoundOdds({ blackjack_natural_chance: data.natural_chance, blackjack_natural_multiplier: data.natural_multiplier });
      await updateAfterGame();
    } else {
      state.credits -= bet;
      const playerCards = drawOpeningBlackjackHand();
      const dealerCards = [drawCard(), drawCard()];
      demoHistory('Fox Blackjack', -bet, { bet, phase: 'entrada' });
      state.blackjackRound = { bet, playerCards, dealerCards, naturalChance: Number(state.gameSettings.blackjack_natural_chance), naturalMultiplier: Number(state.gameSettings.blackjack_natural_multiplier), status: 'active', mode: 'demo' };
      demoSave();
    }
    $('#blackjack-message').textContent = 'Sua vez! Peça uma carta ou pare para a banca jogar.';
    updateBlackjackTable(state.blackjackRound);
  } catch (error) { notify(error.message || 'Não foi possível distribuir as cartas.'); }
  finally { setBusy(false); updateBlackjackTable(state.blackjackRound); }
}
async function blackjackAction(action) {
  const round = state.blackjackRound;
  if (!round || round.status !== 'active' || state.busy) return;
  setBusy(true);
  try {
    let result;
    if (round.mode === 'remote') {
      const { data, error } = await supabase.rpc('blackjack_action', { p_round_id: round.id, p_action: action });
      if (error) throw error;
      result = data;
      round.playerCards = data.player_cards || round.playerCards;
      if (data.dealer_cards) round.dealerCards = data.dealer_cards;
      if (data.finished) round.status = data.status || (data.won ? 'cashed_out' : 'lost');
      if (data.finished) await updateAfterGame();
    } else {
      if (action === 'hit') {
        round.playerCards.push(drawCard());
        const total = handTotal(round.playerCards);
        if (total > 21) {
          round.status = 'lost';
          round.dealerVisible = true;
          result = { finished: true, won: false, payout: 0, player_cards: round.playerCards, dealer_cards: round.dealerCards };
        } else {
          result = { finished: false, player_cards: round.playerCards };
        }
      } else {
        while (handTotal(round.dealerCards) < 17) round.dealerCards.push(drawCard());
        const player = handTotal(round.playerCards);
        const dealer = handTotal(round.dealerCards);
        const push = player === dealer;
        const won = player > dealer || dealer > 21;
        const natural = player === 21 && round.playerCards.length === 2 && !push;
        const payout = push ? round.bet : won ? Math.floor(round.bet * (natural ? Number(round.naturalMultiplier || 2.5) : 2)) : 0;
        state.credits += payout;
        if (payout) demoHistory('Fox Blackjack', payout, { bet: round.bet, payout, result: push ? 'empate' : 'vitória' });
        round.status = push || won ? 'cashed_out' : 'lost';
        result = { finished: true, won, push, payout, player_cards: round.playerCards, dealer_cards: round.dealerCards };
      }
      demoSave();
    }
    updateBlackjackTable(round);
    if (result.finished) {
      const player = handTotal(round.playerCards);
      const dealer = handTotal(round.dealerCards);
      const payout = Number(result.payout || 0);
      $('#blackjack-message').textContent = player > 21 ? 'Estourou 21. A banca venceu esta rodada.' : result.push ? 'Empate! Sua aposta foi devolvida.' : result.won ? `Você venceu! +${formatCredits(payout)} créditos.` : `A banca venceu (${dealer} contra ${player}).`;
      $('#blackjack-message').className = `blackjack-message ${result.won || result.push ? 'win' : 'lose'}`;
      notify(result.push ? 'Empate: aposta devolvida.' : result.won ? `Vitória! +${formatCredits(payout)} créditos.` : 'A banca venceu esta rodada.');
    } else {
      $('#blackjack-message').textContent = `Você está com ${handTotal(round.playerCards)}. Pedir outra carta ou parar?`;
    }
  } catch (error) { notify(error.message || 'Não foi possível concluir a jogada.'); }
  finally { setBusy(false); updateBlackjackTable(round); }
}
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteColor(number) { return number === 0 ? 'green' : ROULETTE_RED.has(number) ? 'red' : 'black'; }
function rouletteBetWins(number, betType, betValue) {
  const color = rouletteColor(number);
  return betType === 'number' ? number === Number(betValue)
    : betType === 'red' || betType === 'black' ? color === betType
      : betType === 'even' ? number !== 0 && number % 2 === 0
        : number !== 0 && number % 2 === 1;
}
function drawRouletteOutcome(betType, betValue) {
  const hit = Math.random() * 100 < Number(state.gameSettings.roulette_hit_chance);
  const candidates = Array.from({ length: 37 }, (_, index) => index).filter((number) => rouletteBetWins(number, betType, betValue) === hit);
  const number = candidates[Math.floor(Math.random() * candidates.length)];
  return { number, color: rouletteColor(number), won: hit };
}
async function playRoulette() {
  if (!(await ensureCanPlay()) || state.busy) return;
  let bet;
  try { bet = readBet('#roulette-bet'); } catch (error) { notify(error.message); return; }
  const betType = $('#roulette-type').value;
  const betValue = betType === 'number' ? String(Number($('#roulette-number').value)) : '';
  if (betType === 'number' && (!Number.isInteger(Number(betValue)) || Number(betValue) < 0 || Number(betValue) > 36)) { notify('Escolha um número entre 0 e 36.'); return; }
  setBusy(true);
  $('#roulette-result').textContent = 'A roda está girando...';
  $('#roulette-wheel').classList.remove('spinning'); void $('#roulette-wheel').offsetWidth; $('#roulette-wheel').classList.add('spinning');
  try {
    let result;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('play_roulette', { p_bet: bet, p_bet_type: betType, p_bet_value: betValue });
      if (error) throw error; result = data;
      applyRoundOdds({ roulette_hit_chance: data.hit_chance });
    } else {
      const drawn = drawRouletteOutcome(betType, betValue);
      const { number, color, won } = drawn;
      const payout = won ? bet * (betType === 'number' ? 36 : 2) : 0;
      state.credits += payout - bet;
      demoHistory('Fox Roulette', payout - bet, { bet, payout, number, bet_type: betType });
      result = { number, color, won, payout };
    }
    await new Promise((resolve) => setTimeout(resolve, 1050));
    $('#roulette-wheel').classList.remove('spinning');
    $('#roulette-wheel .roulette-number').textContent = result.number;
    $('#roulette-wheel').style.setProperty('--result-color', result.color === 'red' ? '#e74c55' : result.color === 'black' ? '#151a25' : '#14976a');
    $('#roulette-result').className = `roulette-result ${result.won ? 'win' : 'lose'}`;
    $('#roulette-result').textContent = result.won ? `Saiu ${result.number} · +${formatCredits(result.payout)} créditos!` : `Saiu ${result.number}. Não foi desta vez.`;
    if (supabaseReady) await updateAfterGame(); else demoSave();
  } catch (error) { $('#roulette-wheel').classList.remove('spinning'); notify(error.message || 'Não foi possível girar a roleta.'); }
  finally { setBusy(false); }
}
const PLINKO_MULTIPLIERS = {
  low: [5.6, 2.1, 1.4, 1.1, 1, 1.1, 1.4, 2.1, 5.6],
  medium: [13, 3, 1.3, .7, .4, .7, 1.3, 3, 13],
  high: [40, 8, 2, .4, .2, .4, 2, 8, 40],
};
function drawPlinkoBins(risk, selected = -1) {
  const values = PLINKO_MULTIPLIERS[risk] || PLINKO_MULTIPLIERS.medium;
  const root = $('#plinko-bins');
  if (!root) return;
  root.innerHTML = values.map((value, index) => `<div class="plinko-bin ${index === selected ? 'selected' : ''} ${value >= 5 ? 'hot' : ''}"><strong>${value.toLocaleString('pt-BR')}×</strong></div>`).join('');
}
async function animatePlinko(path, risk, bin, payout) {
  const ball = $('#plinko-ball');
  if (!ball) return;
  let rights = 0;
  ball.setAttribute('cx', '210'); ball.setAttribute('cy', '13');
  for (let row = 0; row < path.length; row++) {
    rights += Number(path[row] || 0);
    const x = 210 + (rights - (row + 1) / 2) * 43;
    const y = 38 + row * 30;
    ball.setAttribute('cx', String(x)); ball.setAttribute('cy', String(y));
    await new Promise((resolve) => setTimeout(resolve, 135));
  }
  drawPlinkoBins(risk, bin);
  const multiplier = PLINKO_MULTIPLIERS[risk][bin];
  $('#plinko-result').className = `plinko-result ${payout ? 'win' : 'lose'}`;
  $('#plinko-result').textContent = `Casa ${bin + 1} · ${multiplier.toLocaleString('pt-BR')}× · ${formatCredits(payout)} créditos`;
}
async function playPlinko() {
  if (!(await ensureCanPlay()) || state.busy) return;
  let bet;
  try { bet = readBet('#plinko-bet'); } catch (error) { notify(error.message); return; }
  const risk = $('#plinko-risk').value;
  setBusy(true); drawPlinkoBins(risk, -1);
  $('#plinko-result').textContent = 'A bolinha está descendo...';
  try {
    let result;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('play_plinko', { p_bet: bet, p_risk: risk });
      if (error) throw error; result = data;
      applyRoundOdds({ plinko_left_chance: data.left_chance, plinko_return_factor: data.return_factor });
    } else {
      if (state.credits < bet) throw new Error('Saldo insuficiente para esta aposta.');
      const leftChance = Number(state.gameSettings.plinko_left_chance);
      const path = Array.from({ length: 8 }, () => Math.random() * 100 < leftChance ? 0 : 1);
      const bin = path.reduce((sum, value) => sum + value, 0);
      const multiplier = Math.round(PLINKO_MULTIPLIERS[risk][bin] * Number(state.gameSettings.plinko_return_factor) * 100) / 100;
      const payout = Math.floor(bet * multiplier);
      state.credits += payout - bet;
      demoHistory('Fox Plinko', payout - bet, { bet, payout, risk, bin, multiplier });
      result = { path, bin, multiplier, payout };
    }
    await animatePlinko(result.path || Array(8).fill(0), risk, Number(result.bin), Number(result.payout || 0));
    if (supabaseReady) await updateAfterGame(); else demoSave();
    notify(`Plinko finalizado em ${Number(result.multiplier).toLocaleString('pt-BR')}×.`);
  } catch (error) { notify(error.message || 'Não foi possível jogar Plinko.'); }
  finally { setBusy(false); }
}

function mineMultiplier(mines, reveals, firstSafeChance = state.gameSettings.mines_first_safe_chance, returnFactor = state.gameSettings.mines_return_factor) {
  if (reveals <= 0) return 0;
  let probability = Math.max(0.000001, Number(firstSafeChance) / 100);
  for (let index = 1; index < reveals; index++) {
    probability *= (25 - mines - index) / (25 - index);
  }
  return Math.round((Number(returnFactor) / probability) * 100) / 100;
}

function updateMinesBoard() {
  const round = state.minesRound;
  const cells = $$(".mine-cell");
  if (!round) return;
  cells.forEach((cell) => {
    const index = Number(cell.dataset.cell);
    const revealed = round.revealed.has(index);
    const isMine = Boolean(round.minePositions?.has(index) || round.hitCell === index);
    cell.disabled = round.status !== "active" || revealed;
    cell.classList.toggle("safe", revealed && !isMine);
    cell.classList.toggle("hit", revealed && isMine);
    if (revealed) { cell.textContent = isMine ? "💣" : "💎"; cell.classList.add("revealed"); }
    else if (round.status !== "active" && isMine) { cell.textContent = "💣"; cell.classList.add("hit"); }
    else { cell.textContent = "?"; cell.classList.remove("revealed", "safe", "hit"); }
  });
  $("#mines-safe-count").textContent = String(round.safeCount);
  $("#mines-multiplier").textContent = round.safeCount ? `${mineMultiplier(round.mines, round.safeCount, round.firstSafeChance, round.returnFactor).toFixed(2).replace(".", ",")}×` : "—";
  $("#mines-start").classList.toggle("hidden", round.status === "active");
  $("#mines-cashout").classList.toggle("hidden", round.status !== "active" || round.safeCount === 0);
  $("#mines-cashout").disabled = state.busy;
}
async function startMines() {
  if (!(await ensureCanPlay()) || state.busy) return;
  let bet;
  try { bet = readBet('#mines-bet'); } catch (error) { notify(error.message); return; }
  const mines = Number($('#mines-count').value);
  const firstSafeChance = Number(state.gameSettings.mines_first_safe_chance);
  setBusy(true);
  try {
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('start_mines', { p_bet: bet, p_mines: mines });
      if (error) throw error;
      state.minesRound = { id: data.round_id, bet, mines, firstSafeChance: Number(data.first_safe_chance ?? firstSafeChance), returnFactor: Number(data.return_factor ?? state.gameSettings.mines_return_factor), safeCount: 0, revealed: new Set(), status: 'active', minePositions: null };
      applyRoundOdds({ mines_first_safe_chance: data.first_safe_chance, mines_return_factor: data.return_factor });
    } else {
      if (state.credits < bet) throw new Error('Saldo insuficiente para esta aposta.');
      const positions = new Set();
      while (positions.size < mines) positions.add(Math.floor(Math.random() * 25));
      state.credits -= bet;
      demoHistory('Fox Mines', -bet, { bet, mines, first_safe_chance: firstSafeChance });
      state.minesRound = { id: makeLocalId(), bet, mines, firstSafeChance, returnFactor: Number(state.gameSettings.mines_return_factor), safeCount: 0, revealed: new Set(), status: 'active', minePositions: positions };
    }
    $('#mines-message').textContent = `Rodada iniciada. Chance da primeira casa segura: ${prettySetting(firstSafeChance)}.`;
    updateMinesBoard();
    if (supabaseReady) await updateAfterGame();
  } catch (error) { notify(error.message || 'Não foi possível iniciar a rodada.'); }
  finally { setBusy(false); updateMinesBoard(); }
}

async function revealMine(cell) {
  const round = state.minesRound;
  if (!round || round.status !== 'active' || round.revealed.has(cell) || state.busy) return;
  setBusy(true);
  try {
    let result;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc('reveal_mines', { p_round_id: round.id, p_cell: cell });
      if (error) throw error;
      result = data;
    } else {
      if (round.safeCount === 0) {
        const forceSafe = Math.random() * 100 < Number(round.firstSafeChance);
        if (forceSafe && round.minePositions.has(cell)) {
          round.minePositions.delete(cell);
          const options = Array.from({ length: 25 }, (_, index) => index).filter((index) => index !== cell && !round.minePositions.has(index));
          round.minePositions.add(options[Math.floor(Math.random() * options.length)]);
        } else if (!forceSafe && !round.minePositions.has(cell)) {
          const existing = [...round.minePositions];
          const remove = existing[Math.floor(Math.random() * existing.length)];
          round.minePositions.delete(remove);
          round.minePositions.add(cell);
        }
      }
      const safe = !round.minePositions.has(cell);
      result = { safe, status: safe ? 'active' : 'lost', multiplier: safe ? mineMultiplier(round.mines, round.safeCount + 1, round.firstSafeChance, round.returnFactor) : 0 };
    }
    round.revealed.add(cell);
    if (result.safe) {
      round.safeCount += 1;
      $('#mines-message').textContent = `Gema encontrada! Multiplicador atual: ${Number(result.multiplier).toFixed(2).replace('.', ',')}×.`;
    } else {
      round.status = 'lost';
      round.hitCell = cell;
      $('#mines-message').textContent = 'Você encontrou uma mina. A rodada terminou.';
    }
    updateMinesBoard();
    if (round.status === 'lost') notify('Mina encontrada. A rodada terminou.');
  } catch (error) { notify(error.message || 'Não foi possível revelar esta casa.'); }
  finally { setBusy(false); updateMinesBoard(); }
}

async function cashoutMines() {
  const round = state.minesRound;
  if (!round || round.status !== "active" || round.safeCount < 1 || state.busy) return;
  setBusy(true);
  try {
    let result;
    if (supabaseReady) {
      const { data, error } = await supabase.rpc("cashout_mines", { p_round_id: round.id });
      if (error) throw error;
      result = data;
    } else {
      const multiplier = mineMultiplier(round.mines, round.safeCount, round.firstSafeChance, round.returnFactor);
      const payout = Math.floor(round.bet * multiplier);
      state.credits += payout;
      demoHistory("Fox Mines", payout, { bet: round.bet, payout, multiplier });
      result = { payout, multiplier };
    }
    round.status = "cashed_out";
    $("#mines-message").textContent = `Você retirou ${formatCredits(result.payout)} créditos (${Number(result.multiplier).toFixed(2).replace(".", ",")}×).`;
    updateMinesBoard();
    if (supabaseReady) await updateAfterGame();
    else demoSave();
    notify(`Retirada concluída: +${formatCredits(result.payout)} créditos.`);
  } catch (error) { notify(error.message || "Não foi possível retirar os ganhos."); }
  finally { setBusy(false); updateMinesBoard(); }
}

function wireGlobalEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { setView(viewButton.dataset.view); return; }
    const gameButton = event.target.closest("[data-game]");
    if (gameButton) { renderGame(gameButton.dataset.game); return; }
    const goButton = event.target.closest("[data-go]");
    if (goButton) { setView(goButton.dataset.go); return; }
    if (event.target.closest('[data-close-modal]')) {
      ['#auth-modal', '#help-modal', '#bet-modal', '#admin-credit-modal'].forEach((selector) => { const node = $(selector); if (node) hideModal(selector); });
    }
  });
  $("#account-action").addEventListener("click", () => state.session ? setView("profile") : openAuth("login"));
  $("#profile-auth-action").addEventListener("click", () => openAuth("login"));
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $$(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
  $("#signout-btn").addEventListener("click", signOut);
  $("#help-btn").addEventListener("click", () => showModal("#help-modal"));
  $("#profile-help").addEventListener("click", () => showModal("#help-modal"));
  $("#home-play").addEventListener("click", () => setView("games"));
  $("#hero-slots").addEventListener("click", () => renderGame("slots"));
  $('#mobile-menu').addEventListener('click', toggleNavigationMenu);
  $('#sidebar-scrim')?.addEventListener('click', closeNavigationMenu);
  window.addEventListener('resize', () => { if (window.matchMedia('(min-width: 761px)').matches) document.body.classList.remove('sidebar-open'); });
  ['#auth-modal', '#help-modal', '#bet-modal', '#admin-credit-modal'].forEach((selector) => $(selector)?.addEventListener('click', (event) => {
    if (event.target === $(selector)) hideModal(selector);
  }));
}

async function init() {
  wireGlobalEvents();
  await loadPublicGameSettings();
  if (supabaseReady) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      state.session = data.session;
      if (state.session) {
        await refreshProfile();
        if (state.profile?.is_banned) {
          await supabase.auth.signOut();
          state.session = null;
          state.profile = null;
          notify('Esta conta foi banida e não pode acessar a FoxBet.');
        }
      }
      await loadAdminAccess();
      supabase.auth.onAuthStateChange(async (_event, session) => {
        state.session = session;
        if (!session) { state.profile = null; state.isAdmin = false; state.adminLogs = []; }
        else { try { await refreshProfile(); await loadAdminAccess(); } catch (error) { console.warn(error); } }
        updateHeader();
      });
    } catch (error) {
      console.error("Erro ao inicializar Supabase:", error);
      notify("Não foi possível conectar ao Supabase. Confira config.js.");
    }
  } else {
    state.isAdmin = Boolean(false);
    updateHeader();
  }
  updateHeader();
  renderHistory();
  updatePromotionalAd('home');
  if (!supabaseReady && supabaseLoadError) {
    notify("Não foi possível conectar ao serviço de conta. Confira a conexão e tente novamente.");
  }
}

init();