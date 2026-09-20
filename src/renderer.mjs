import { AudioCapture, PCMPlayer } from './audio.mjs';
import { selection, signature, changed } from './region.mjs';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const api = window.lingo;
const langs = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ru: 'Русский' };
let config, boot, toastTimer, hasKey = false, overlayShown = false;
let sourceId = '', sourceTitle = '', previewImage, region = { x: 0, y: 0, w: 1, h: 1 }, dragStart = null;
let watching = false, screenBusy = false, screenTimer, screenEpoch = 0, lastSignature, lastScreenCheck = 0, screenText = '', chatResult = '', chatEpoch = 0, chatBusy = false;
let audioDevices = [], history = [], lanes = { incoming: null, outgoing: null };
const call = (name, payload) => api.call(name, payload);
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 7000 : 3500); }
function notify(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function problem(e) { toast(e.message || String(e), true); }
function showUsage(usage) {
  if (!usage) return;
  const dollars = `$${usage.usd.toFixed(4)}`;
  $('#sessionStats').textContent = `이번 실행 · 예상 ${dollars}${usage.unpriced ? ' + 미산정' : ''} ↗`;
  $('#usageTotal').textContent = dollars;
  $('#usageSummary').textContent = `번역 재사용 ${usage.cacheHits}회 · 재사용한 결과에는 API를 호출하지 않아요.`;
  $('#usageRows').replaceChildren();
  const labels = { text: '문장 번역', screen: '화면 번역', transcription: '음성 인식', live: '실시간 번역', speech: '번역 음성 생성' };
  for (const row of usage.rows) {
    const el = document.createElement('div'); el.className = 'usage-row';
    const label = document.createElement('div'), detail = document.createElement('small'), value = document.createElement('strong');
    label.textContent = labels[row.kind] || row.kind;
    detail.textContent = `${row.requests}회${row.seconds ? ` · ${(row.seconds / 60).toFixed(1)}분 전송` : ''}`;
    value.textContent = row.kind === 'speech' ? '합계에서 제외' : `$${row.usd.toFixed(4)}`;
    label.append(detail); el.append(label, value); $('#usageRows').append(el);
  }
  $('#usageUnpriced').hidden = !usage.unpriced;
  $('#usageUnpriced').textContent = `음성 생성 또는 사용량을 확인할 수 없는 요청 ${usage.unpriced}건이 합계에 포함되지 않았어요. 정확한 금액은 공식 사용량에서 확인하세요.`;
}
function applyVoiceMode() {
  $('#voiceMode').value = config.voiceMode;
  $('#voiceModeHint').textContent = config.voiceMode === 'economy'
    ? '음성 인식 약 $0.18/시간 + 문장 번역비. 말이 끝나면 번역해요.'
    : '약 $2.04/시간 · 보낸 오디오 기준. 기존 실시간 번역을 사용해요.';
}
function requireKey() { if (hasKey) return true; $('#settingsDialog').showModal(); toast('먼저 OpenAI API 키를 연결해 주세요.'); return false; }
function setKeyState(result) { hasKey = result.hasKey; $('#apiDot').classList.toggle('ready', hasKey); $('#apiStatus').textContent = hasKey ? 'API 키 준비됨' : 'API 키 연결 필요'; $('#keyHint').textContent = result.keySource === 'environment' ? '현재 개발 환경의 키를 사용합니다. Finder에서 다시 실행할 때는 키를 따로 저장해 주세요.' : hasKey ? 'API 키가 이 기기에 암호화되어 저장되어 있어요. API 사용료가 발생합니다.' : '키는 이 기기의 운영체제 암호화로 저장됩니다. API 사용료가 발생합니다.'; }
function fillLanguages() { for (const id of ['targetLanguage', 'outgoingLanguage', 'chatTarget']) for (const [code, name] of Object.entries(langs)) { const o = document.createElement('option'); o.value = code; o.textContent = name; $(`#${id}`).append(o); } }
function applySettings() {
  $('#targetLanguage').value = config.target; $('#outgoingLanguage').value = config.outgoing; $('#chatTarget').value = config.outgoing;
  $('#sideTarget').textContent = langs[config.target]; $('#sideOutgoing').textContent = langs[config.outgoing]; $('#screenLanguage').textContent = langs[config.target]; $('#incomingLanguage').textContent = `${langs[config.target]} 자막`;
  $('#voiceOutputLanguage').textContent = `${langs[config.outgoing]} 음성`;
  $('#translationProfile').value = config.translationProfile; applyVoiceMode();
  $('#gameName').value = config.game; $('#glossary').value = config.glossary; $('#interval').value = config.interval; $('#overlaySize').value = config.overlaySize;
}
function setPage(page) { $$('.page').forEach(el => el.hidden = el.id !== `page-${page}`); $$('.nav-button').forEach(b => { b.classList.toggle('active', b.dataset.page === page); if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); $('#pageLabel').textContent = { screen: '화면 번역', voice: 'Discord 음성', chat: '채팅 번역' }[page]; }
function setScreenStatus(label, live = false) { $('#screenStatus').replaceChildren(); const dot = document.createElement('i'); $('#screenStatus').append(dot, document.createTextNode(label)); $('#screenStatus').classList.toggle('live', live); }
function renderPreview() {
  if (!previewImage) return;
  const canvas = $('#preview'); canvas.width = previewImage.naturalWidth; canvas.height = previewImage.naturalHeight;
  const ctx = canvas.getContext('2d'); ctx.drawImage(previewImage, 0, 0);
  const { x, y, w, h } = region, width = canvas.width, height = canvas.height;
  if (w < .999 || h < .999) {
    ctx.fillStyle = '#09140eb0'; ctx.fillRect(0, 0, width, height); ctx.drawImage(previewImage, x * width, y * height, w * width, h * height, x * width, y * height, w * width, h * height);
    ctx.strokeStyle = '#8ee5be'; ctx.lineWidth = Math.max(2, width / 350); ctx.strokeRect(x * width, y * height, w * width, h * height);
  }
}
async function preview() {
  if (!sourceId) return; const epoch = screenEpoch, id = sourceId;
  const frame = await call('capture', id); if (id !== sourceId || epoch !== screenEpoch) return false;
  const img = new Image(); img.src = frame.image; await img.decode(); if (id !== sourceId || epoch !== screenEpoch) return false;
  previewImage = img; $('#captureEmpty').hidden = true; $('#preview').hidden = false; renderPreview(); return true;
}
async function loadSources() {
  $('#sourceList').textContent = '화면 목록을 가져오는 중…';
  try { const sources = await call('list-sources'); $('#sourceList').replaceChildren();
    if (!sources.length) $('#sourceList').textContent = '화면이 없어요. 화면 기록 권한을 확인하고 다시 시도해 주세요.';
    for (const source of sources) { const b = document.createElement('button'); b.className = 'source-option'; const img = new Image(); img.src = source.thumbnail; img.alt = ''; const span = document.createElement('span'); span.textContent = source.name; b.append(img, span); b.onclick = async () => {
      stopScreen(); sourceId = source.id; sourceTitle = source.name; region = { x: 0, y: 0, w: 1, h: 1 }; lastSignature = null; screenText = ''; $('#copyScreen').disabled = true; $('#screenResults').textContent = '영역을 지정하고 번역을 시작하세요.'; call('overlay-content', { screen: '' }).catch(problem);
      $('#sourceName').textContent = sourceTitle; $('#sourceDialog').close();
      try { if (await preview()) { for (const id of ['screenOnce', 'screenStart', 'resetRegion', 'refreshPreview']) $(`#${id}`).disabled = false; toast('미리보기에서 번역할 부분을 드래그하세요.'); } } catch (e) { problem(e); }
    }; $('#sourceList').append(b); }
  } catch (e) { $('#sourceList').textContent = e.message; }
}
function stopScreen() { if (screenBusy) call('cancel-screen').catch(() => {}); watching = false; screenEpoch++; clearTimeout(screenTimer); $('#screenStart').textContent = '▶ 자동 번역'; $('#screenStart').classList.remove('active'); setScreenStatus('대기 중'); }
function renderBlocks(blocks) {
  $('#screenResults').replaceChildren(); if (!blocks.length) { $('#screenResults').textContent = '읽을 수 있는 글자가 없어요. 대사 영역을 더 크게 선택해 보세요.'; return; }
  for (const b of blocks) { const row = document.createElement('div'); row.className = 'translation-block'; const original = document.createElement('div'); original.className = 'original'; original.textContent = b.original; const translated = document.createElement('div'); translated.className = 'translated'; translated.textContent = b.translated; row.append(original, translated); $('#screenResults').append(row); }
}
async function translateScreen(force = false) {
  if (!sourceId || screenBusy || !requireKey()) return;
  screenBusy = true; $('#screenOnce').disabled = true; const epoch = screenEpoch, start = performance.now();
  try {
    if (!await preview() || epoch !== screenEpoch) return;
    const image = previewImage, canvas = document.createElement('canvas');
    const naturalWidth = Math.max(1, Math.round(image.naturalWidth * region.w)), naturalHeight = Math.max(1, Math.round(image.naturalHeight * region.h));
    const scale = Math.min(1, 1920 / naturalWidth, 1440 / naturalHeight); canvas.width = Math.round(naturalWidth * scale); canvas.height = Math.round(naturalHeight * scale);
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, image.naturalWidth * region.x, image.naturalHeight * region.y, naturalWidth, naturalHeight, 0, 0, canvas.width, canvas.height);
    const sig = signature(ctx, canvas.width, canvas.height);
    if (!force && performance.now() - lastScreenCheck < 30000 && !changed(lastSignature, sig)) { setScreenStatus('화면 변화 기다리는 중', watching); return; }
    setScreenStatus('번역 중…', true);
    const result = await call('translate-screen', { image: canvas.toDataURL('image/jpeg', .9), target: config.target, game: config.game, glossary: config.glossary });
    if (epoch !== screenEpoch) return;
    lastSignature = sig; lastScreenCheck = performance.now(); renderBlocks(result.blocks); screenText = result.blocks.map(x => x.translated).join('\n\n'); $('#copyScreen').disabled = !screenText;
    $('#screenTiming').textContent = result.cached ? '이전 번역 재사용' : `${((performance.now() - start) / 1000).toFixed(1)}초 · ${result.blocks.length}개 문단`;
    await call('overlay-content', { screen: screenText.replace(/\n\n+/g, '\n') }); setScreenStatus(watching ? '자동 번역 중' : '번역 완료', watching);
  } catch (e) { if (epoch === screenEpoch) { stopScreen(); setScreenStatus('확인 필요'); problem(e); } }
  finally { screenBusy = false; $('#screenOnce').disabled = !sourceId; if (watching && epoch === screenEpoch) screenTimer = setTimeout(() => translateScreen(false), config.interval); }
}
function resetSelection() { region = { x: 0, y: 0, w: 1, h: 1 }; lastSignature = null; renderPreview(); }
function point(event) { const r = $('#preview').getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) }; }
$('#preview').onpointerdown = event => { stopScreen(); dragStart = point(event); $('#preview').setPointerCapture(event.pointerId); };
$('#preview').onpointermove = event => { if (dragStart) { region = selection(dragStart, point(event)); renderPreview(); } };
$('#preview').onpointerup = event => { if (!dragStart) return; region = selection(dragStart, point(event)); dragStart = null; if (region.w < .02 || region.h < .02) resetSelection(); lastSignature = null; renderPreview(); };
$('#preview').onpointercancel = () => { dragStart = null; resetSelection(); };
async function refreshDevices(requestAccess = true) {
  let permissionStream;
  try {
    if (requestAccess) { permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); permissionStream.getTracks().forEach(t => t.stop()); }
    audioDevices = await navigator.mediaDevices.enumerateDevices();
    for (const [id, kind, key, empty] of [['micDevice','audioinput','mic','내 마이크 선택'], ['incomingDevice','audioinput','incoming','Discord 수신 장치 선택'], ['outputDevice','audiooutput','output','출력 없음 · 자막만']]) {
      const el = $(`#${id}`), previous = el.value || config[key]; el.replaceChildren(new Option(empty, ''));
      audioDevices.filter(d => d.kind === kind && d.deviceId).forEach((d, i) => el.append(new Option(d.label || `오디오 장치 ${i + 1}`, d.deviceId)));
      el.value = [...el.options].some(o => o.value === previous) ? previous : '';
    }
    if (requestAccess) toast('입력과 출력 장치를 선택해 주세요.');
  } catch (e) { permissionStream?.getTracks().forEach(t => t.stop()); problem(new Error('오디오 장치를 읽지 못했어요. 시스템 설정에서 마이크 권한을 확인해 주세요.')); }
}
function renderLane(lane, state = 'idle') {
  const incoming = lane === 'incoming', button = $(incoming ? '#listenButton' : '#talkButton');
  button.disabled = state === 'connecting' || state === 'draining'; button.classList.toggle('active', state === 'streaming'); $(`#${lane}Wave`).classList.toggle('running', state === 'streaming');
  button.textContent = state === 'connecting' ? '연결하는 중…' : state === 'draining' ? '남은 번역을 마무리하는 중…' : state === 'streaming' ? incoming ? '■ 상대방 번역 중지' : '■ 말하기 끝' : incoming ? '▶ 상대방 번역 시작' : '● 말하기 시작';
  $(`#${lane}Status`).textContent = { idle: incoming ? '수신을 시작하면 번역 자막이 표시돼요.' : '한 번 눌러 말하고, 다시 눌러 번역하세요. (최대 20초)', connecting: '오디오와 번역 API를 연결하고 있어요.', streaming: incoming ? (config.voiceMode === 'economy' ? '듣는 중 · 말이 끝나면 문장 단위로 번역해요.' : '듣는 중 · 실시간으로 번역하고 있어요.') : '말소리를 받고 있어요. 끝나면 말하기 끝을 누르세요.', draining: '녹음은 끝났어요. 인식·번역을 기다려 주세요.' }[state];
  ['micDevice','incomingDevice','outputDevice','enableSend','monitorOriginal','deviceRefresh','voiceMode'].forEach(id => $(`#${id}`).disabled = Boolean(lanes.incoming || lanes.outgoing));
}
function createTranscript(lane) { if (!$('#transcripts').querySelector('.transcript-row')) $('#transcripts').replaceChildren(); const row = document.createElement('div'); row.className = 'transcript-row'; const speaker = document.createElement('span'); speaker.className = 'speaker'; speaker.textContent = lane === 'incoming' ? '상대방' : '나 → 외국어'; const content = document.createElement('div'), source = document.createElement('div'), target = document.createElement('div'); source.className = 'source'; target.className = 'target'; source.textContent = '음성을 기다리는 중…'; content.append(source, target); row.append(speaker, content); $('#transcripts').append(row); while ($('#transcripts').children.length > 20) $('#transcripts').firstChild.remove(); return { row, source, target, original: '', translated: '' }; }
async function endLane(lane, immediate = false) {
  const session = lanes[lane]; if (!session) return;
  if (session.stopping && !immediate) return;
  if (immediate) { lanes[lane] = null; clearTimeout(session.closeTimer); session.player?.stop(); }
  session.stopping = true; renderLane(lane, immediate ? 'idle' : 'draining');
  try { await session.capture?.stop(!immediate); } catch (e) { problem(e); }
  session.state = 'draining';
  try { await call('voice-stop', { lane, token: session.token, immediate }); } catch (e) { problem(e); }
  if (lanes[lane] === session) renderLane(lane, 'draining'); else if (!lanes[lane]) renderLane(lane);
}
function cleanupLane(lane, session, drain = false) {
  if (lanes[lane] !== session) return;
  session.capture?.stop().catch(() => {});
  const finish = () => { if (lanes[lane] !== session) return; session.player?.stop(); lanes[lane] = null; renderLane(lane); };
  if (drain && session.player?.remaining() > 0) { renderLane(lane, 'draining'); session.closeTimer = setTimeout(finish, session.player.remaining() + 150); } else finish();
}
async function startLane(lane) {
  if (lanes[lane]) return endLane(lane, lanes[lane].state !== 'streaming');
  if (!requireKey()) return;
  const incoming = lane === 'incoming', device = $(incoming ? '#incomingDevice' : '#micDevice').value;
  if (!device) return toast(incoming ? '오디오 장치를 연결하고 Discord 수신 장치를 선택하세요.' : '오디오 장치를 연결하고 내 마이크를 선택하세요.', true);
  if ($('#incomingDevice').value && $('#incomingDevice').value === $('#micDevice').value) return toast('내 마이크와 Discord 수신 장치는 서로 다르게 선택해 주세요.', true);
  const send = !incoming && $('#enableSend').checked, output = $('#outputDevice').value;
  if (send && !output) return toast('번역 음성을 보낼 출력 장치를 선택하세요.', true);
  const s = { token: crypto.randomUUID(), capture: new AudioCapture(), player: null, caption: createTranscript(lane), captions: new Map(), state: 'connecting', drained: false, stopping: false };
  lanes[lane] = s; renderLane(lane, 'connecting');
  try {
    // Initialize capture before opening the paid stream; initial chunks are discarded until ready.
    await s.capture.start(device, bytes => { if (lanes[lane] === s && s.state === 'streaming') api.audio(lane, s.token, bytes); }, incoming && $('#monitorOriginal').checked);
    if (lanes[lane] !== s) { await s.capture.stop(); return; }
    if (send) { s.player = new PCMPlayer(); await s.player.start(output); }
    if (lanes[lane] !== s) { s.player?.stop(); return; }
    await call('voice-start', { lane, target: incoming ? config.target : config.outgoing, token: s.token, synthesize: send });
    if (lanes[lane] !== s) { await call('voice-stop', { lane, token: s.token, immediate: true }); return; }
    await call('voice-bind', { lane, token: s.token }); if (lanes[lane] !== s) return; s.state = 'streaming'; renderLane(lane, 'streaming');
  } catch (e) { await endLane(lane, true); if (lanes[lane] === s) cleanupLane(lane, s); problem(e); }
}
api.on('voice-event', e => {
  const s = lanes[e.lane]; if (!s || s.token !== e.token) return;
  if (e.type === 'error') { problem(new Error(e.message)); cleanupLane(e.lane, s); }
  if (e.type === 'turn') {
    const caption = s.captions.size ? createTranscript(e.lane) : s.caption;
    s.captions.set(e.segmentId, caption); s.caption = caption;
    while (s.captions.size > 20) s.captions.delete(s.captions.keys().next().value);
  }
  if (e.type === 'listening' && !s.stopping) $(`#${e.lane}Status`).textContent = '듣는 중 · 다음 문장을 기다리고 있어요.';
  if (e.type === 'processing') $(`#${e.lane}Status`).textContent = e.stage;
  if (e.type === 'empty') { const c = s.captions.get(e.segmentId); if (c) c.source.textContent = '말소리를 인식하지 못해 이 구간은 건너뛰었어요.'; }
  if (e.type === 'drained') s.drained = true;
  if (e.type === 'closed') cleanupLane(e.lane, s, s.drained);
  if (e.type === 'audio') { try { s.player?.append(e.data); } catch (error) { problem(error); endLane(e.lane, true); } }
  if (e.type === 'transcript' || e.type === 'translation') {
    const c = e.segmentId ? s.captions.get(e.segmentId) : s.caption; if (!c) return; if (e.type === 'transcript') { c.original = (c.original + e.delta).slice(-4000); c.source.textContent = c.original; } else { c.translated = (c.translated + e.delta).slice(-4000); c.target.textContent = c.translated; if (!c.original) c.source.textContent = '실시간 번역 · 원문이 제공되면 함께 표시됩니다.'; }
    $('#transcripts').scrollTop = $('#transcripts').scrollHeight;
    if (e.lane === 'incoming') call('overlay-content', { voice: c.translated.slice(-400), original: c.original.slice(-200) }).catch(() => {});
  }
});
function stopEverything() { const wasActive = watching || screenBusy || chatBusy || lanes.incoming || lanes.outgoing; stopScreen(); chatEpoch++; chatBusy = false; $('#chatTranslate').disabled = false; for (const lane of ['incoming', 'outgoing']) { const s = lanes[lane]; if (s) { lanes[lane] = null; clearTimeout(s.closeTimer); s.capture?.stop().catch(() => {}); s.player?.stop(); } renderLane(lane); } if (wasActive) toast('화면 번역과 음성 전송을 모두 중지했어요.'); }
async function translateChat() {
  if (chatBusy || !requireKey()) return; const text = $('#chatInput').value.trim(); if (!text) return toast('번역할 문장을 입력해 주세요.');
  const epoch = ++chatEpoch, start = performance.now(); chatBusy = true; $('#chatTranslate').disabled = true; $('#chatOutput').textContent = '번역하는 중…'; $('#chatOutput').classList.add('empty'); $('#chatCopy').disabled = true;
  try { const result = await call('translate-text', { text, target: $('#chatTarget').value, game: config.game, glossary: config.glossary }); if (epoch !== chatEpoch) return;
    chatResult = result.translated; $('#chatOutput').textContent = chatResult; $('#chatOutput').classList.remove('empty'); $('#chatCopy').disabled = false; $('#chatTiming').textContent = result.cached ? '이전 번역 재사용' : `${((performance.now() - start) / 1000).toFixed(1)}초`; history.unshift({ original: text, translated: chatResult }); history = history.slice(0, 30); renderHistory();
  } catch (e) { if (epoch === chatEpoch) { $('#chatOutput').textContent = '번역하지 못했어요. 연결 상태를 확인해 주세요.'; problem(e); } }
  finally { if (epoch === chatEpoch) { chatBusy = false; $('#chatTranslate').disabled = false; } }
}
function cancelChat() { if (!chatBusy) return; chatEpoch++; chatBusy = false; $('#chatTranslate').disabled = false; $('#chatOutput').textContent = '설정이 바뀌었어요. 다시 번역해 주세요.'; call('cancel-chat').catch(() => {}); }
function renderHistory() { $('#chatHistory').replaceChildren(); if (!history.length) $('#chatHistory').textContent = '최근 번역이 여기에 쌓여요.'; for (const entry of history) { const row = document.createElement('div'); row.className = 'history-row'; const text = document.createElement('div'), original = document.createElement('small'), translated = document.createElement('span'), button = document.createElement('button'); original.textContent = entry.original; translated.textContent = entry.translated; button.textContent = '복사'; button.className = 'text-button'; button.onclick = () => copy(entry.translated); text.append(original, translated); row.append(text, button); $('#chatHistory').append(row); } }
async function copy(text) { try { await call('copy', text); toast('복사했어요. 채팅창에 붙여넣으세요.'); } catch (e) { problem(e); } }
$$('.nav-button').forEach(b => b.onclick = () => setPage(b.dataset.page));
$$('[data-close]').forEach(b => b.onclick = () => $(`#${b.dataset.close}`).close());
$('#settingsOpen').onclick = () => $('#settingsDialog').showModal();
$('#settingsForm').onsubmit = async event => { event.preventDefault(); if (lanes.incoming || lanes.outgoing) return toast('음성 번역을 마친 뒤 설정을 변경해 주세요.', true); try { stopScreen(); cancelChat(); config = await call('save-settings', { ...config, target: $('#targetLanguage').value, outgoing: $('#outgoingLanguage').value, game: $('#gameName').value, glossary: $('#glossary').value, interval: Number($('#interval').value), overlaySize: Number($('#overlaySize').value), translationProfile: $('#translationProfile').value, mic: $('#micDevice').value, incoming: $('#incomingDevice').value, output: $('#outputDevice').value }); applySettings(); lastSignature = null; $('#settingsDialog').close(); toast('설정을 저장했어요.'); } catch (e) { problem(e); } };
$('#saveKey').onclick = async () => { try { if (!$('#apiKey').value.trim()) return toast('저장할 키를 입력해 주세요.'); setKeyState(await call('save-key', $('#apiKey').value)); $('#apiKey').value = ''; $('#apiCheckResult').textContent = ''; toast('API 키를 저장했어요. 연결을 확인할게요.'); await checkConnection(); } catch (e) { problem(e); } };
$('#removeKey').onclick = async () => { try { setKeyState(await call('save-key', '')); toast('앱에 저장한 API 키를 지웠어요.'); } catch (e) { problem(e); } };
async function checkConnection() {
  $('#checkApi').disabled = true; $('#apiCheckResult').textContent = '연결 확인 중…';
  try {
    const result = await call('check-api');
    const labels = { text: '채팅', screen: '화면', incoming: '상대방 음성', outgoing: '내 음성' };
    const missing = Object.keys(labels).filter(k => !result[k]).map(k => labels[k]);
    $('#apiCheckResult').textContent = missing.length ? `키 연결됨 · ${missing.join('·')} 모델 접근 확인 필요` : '키 연결됨 · 선택한 모델 목록 확인 완료';
    $('#apiCheckResult').title = '모델 목록 확인은 무료입니다. 실제 번역 요청에서 잔액·권한에 따른 오류가 발생할 수 있어요. 음성 생성 권한은 송출 시 확인합니다.';
  } catch (e) { $('#apiCheckResult').textContent = '연결 실패'; problem(e); }
  finally { $('#checkApi').disabled = false; }
}
$('#checkApi').onclick = checkConnection;
for (const id of ['sourceOpen', 'sourceOpenEmpty']) $(`#${id}`).onclick = () => { $('#sourceDialog').showModal(); loadSources(); };
$('#reloadSources').onclick = loadSources; $('#refreshPreview').onclick = () => preview().catch(problem); $('#resetRegion').onclick = () => { stopScreen(); resetSelection(); };
$('#screenOnce').onclick = () => { stopScreen(); translateScreen(true); };
$('#screenStart').onclick = () => { if (watching) return stopScreen(); if (screenBusy) return toast('현재 번역이 끝난 뒤 시작해 주세요.'); if (!sourceId || !requireKey()) return; watching = true; screenEpoch++; $('#screenStart').textContent = '■ 자동 번역 중지'; $('#screenStart').classList.add('active'); translateScreen(false); };
$('#interval').onchange = () => { config.interval = Number($('#interval').value); call('save-settings', config).catch(problem); };
$('#copyScreen').onclick = () => copy(screenText);
$('#overlayToggle').onclick = async () => { try { await call('overlay', !overlayShown); } catch (e) { problem(e); } };
$('#unlockOverlay').onclick = async () => { await call('unlock-overlay'); $('#unlockOverlay').hidden = true; };
api.on('overlay-visible', visible => { overlayShown = visible; $('#overlayToggle').textContent = visible ? '▱ 자막 창 숨기기' : '▱ 자막 창 열기'; });
api.on('overlay-locked', locked => $('#unlockOverlay').hidden = !locked);
$('#voiceMode').onchange = async () => {
  const mode = $('#voiceMode').value;
  try { config = await call('save-settings', { ...config, voiceMode: mode }); applyVoiceMode(); }
  catch (e) { applyVoiceMode(); problem(e); }
};
$('#sessionStats').onclick = async () => { try { showUsage(await call('usage')); $('#usageDialog').showModal(); } catch (e) { problem(e); } };
$('#billingOpen').onclick = () => call('open-billing').catch(problem);
api.on('usage-update', showUsage);
$('#deviceRefresh').onclick = () => refreshDevices(true);
for (const [id, key] of [['micDevice','mic'],['incomingDevice','incoming'],['outputDevice','output']]) $(`#${id}`).onchange = () => { config[key] = $(`#${id}`).value; call('save-settings', config).catch(problem); };
$('#listenButton').onclick = () => startLane('incoming'); $('#talkButton').onclick = () => startLane('outgoing');
$('#cableGuide').onclick = () => call('open-guide').catch(problem);
$('#stopAll').onclick = () => { stopEverything(); call('stop-all').catch(problem); };
api.on('emergency-stop', stopEverything);
api.on('hotkey', action => { if ($$('dialog').some(d => d.open)) return; if (action === 'talk') startLane('outgoing'); if (action === 'screen') { stopScreen(); translateScreen(true); } });
api.on('app-warning', notify);
$('#chatInput').oninput = () => $('#charCount').textContent = `${$('#chatInput').value.length.toLocaleString()} / 6,000`;
$('#chatInput').onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); translateChat(); } };
$('#chatTarget').onchange = cancelChat;
$('#chatTranslate').onclick = translateChat; $('#chatCopy').onclick = () => copy(chatResult);
$$('[data-phrase]').forEach(b => b.onclick = () => { $('#chatInput').value = b.dataset.phrase; $('#chatInput').dispatchEvent(new Event('input')); $('#chatInput').focus(); });
$('#clearHistory').onclick = () => { history = []; renderHistory(); };
window.addEventListener('unhandledrejection', event => { event.preventDefault(); problem(event.reason); });
navigator.mediaDevices.addEventListener('devicechange', () => { if (lanes.incoming || lanes.outgoing) { call('stop-all').catch(() => {}); notify('오디오 장치가 변경되어 전송을 중지했어요. 장치를 다시 선택해 주세요.'); } refreshDevices(false); });
fillLanguages();
try { boot = await call('bootstrap'); config = boot.config; showUsage(boot.usage); setKeyState(boot); applySettings(); $('#version').textContent = boot.version; if (boot.warning) notify(boot.warning); if (!hasKey) notify('설정에서 OpenAI API 키를 연결하면 번역을 시작할 수 있어요.'); if (boot.platform !== 'darwin') { $$('.hotkey-talk').forEach(e => e.textContent = 'Ctrl ⇧ Space'); $$('.hotkey-overlay').forEach(e => e.textContent = 'Ctrl ⇧ O'); } await refreshDevices(false); }
catch (e) { notify(`앱 초기화 오류: ${e.message}`); }
