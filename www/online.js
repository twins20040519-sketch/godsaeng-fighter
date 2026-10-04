/* =====================================================================
   GODSAENG FIGHTER 온라인 연결 (Supabase)
   - 로그인 없이 바로 시작 (익명 계정) → 닉네임 정하기
   - 친구방: 진짜 초대 코드로 만들고 들어가기
   - 랜덤 1:1 / 10인 난투: 서버가 같은 종목 사람끼리 짝지어 줘요
   - 내 오늘 기록을 서버에 올리고, 같은 방 사람들 기록을 8초마다 받아와요
   서버에 연결이 안 되면 앱은 예전처럼 '연습 모드'(가짜 상대)로 돌아가요.
   ===================================================================== */
const SUPA_URL = 'https://aygqavpuamuiilvagsrl.supabase.co';
const SUPA_KEY = 'sb_publishable_2VXsdDCPqCQpX7pRPNiwxA_wKOf47DE';   // 공개용 키 (앱에 들어가도 괜찮아요)
const POLL_MS = 8000;   // 같은 방 사람들 기록을 몇 ms마다 새로 받아올지

/* ---------- 닉네임 정하기 화면 ---------- */
SCREENS.hello = () => '<h2>반가워요, 도전자!</h2><div class="card">' +
  '<p style="margin-top:0">배틀에서 쓸 닉네임을 정해요. (1~12자)</p>' +
  '<input type="text" id="nick" maxlength="12" placeholder="예: 새벽늑대" autocomplete="off" value="' + esc(ON.nick || '') + '">' +
  '<button class="btn" data-act="nick">' + (ON.nick ? '닉네임 바꾸기' : '시작하기') + '</button>' +
  (S.msg ? '<p class="sub"><b style="color:var(--cyan)">' + S.msg + '</b></p>' : '') + '</div>' +
  '<p class="sub">가입 없이 바로 시작해요. 친구와 순위표에는 이 닉네임이 보여요.</p>';

/* ---------- 서버에서 내 방 목록 가져오기 ---------- */
async function syncRooms() {
  const {data, error} = await ON.sb.from('room_members')
    .select('room_id, joined_at, rooms(id, code, type, mode, day)')
    .eq('user_id', ON.uid).order('joined_at', {ascending: false});
  if (error) throw error;
  const today = todayKey(), rooms = {};
  (data || []).forEach(m => {
    const r = m.rooms;
    if (!r || (r.mode !== 'friend' && r.day !== today)) return;   // 랜덤 방은 그날만
    const keep = S.rooms[r.type] && S.rooms[r.type].id === r.id;     // 지금 보고 있던 방 우선
    if (!rooms[r.type] || keep) rooms[r.type] = {id: r.id, code: r.code || '', mode: r.mode, online: true, members: []};
  });
  S.rooms = rooms;
  await refreshAll();
}

/* ---------- 같은 방 사람들과 오늘 기록 가져오기 ---------- */
async function refreshAll() {
  const list = Object.entries(S.rooms).filter(([, r]) => r.online);
  if (!list.length) return;
  const {data: mem, error} = await ON.sb.from('room_members')
    .select('room_id, user_id, profiles(nickname, char)').in('room_id', list.map(([, r]) => r.id));
  if (error) throw error;
  const uids = [...new Set((mem || []).map(m => m.user_id))];
  const {data: recs} = await ON.sb.from('records').select('user_id, type, value').eq('day', todayKey()).in('user_id', uids);
  list.forEach(([k, r]) => {
    r.members = (mem || []).filter(m => m.room_id === r.id && m.user_id !== ON.uid).map(m => {
      const p = m.profiles || {}, n = p.nickname || '???';
      const rec = (recs || []).find(x => x.user_id === m.user_id && x.type === k);
      if (p.char) S.charOf[n] = p.char;
      return [n, rec ? rec.value : null];
    });
  });
}

/* ---------- 내 오늘 기록 올리기 (바뀐 것만) ---------- */
const sent = {};
let pushing = false;
async function pushRecords() {
  if (!ON.ready || !ON.nick || pushing) return;
  const cur = S.type, day = todayKey(), rows = [];
  Object.keys(CONFIG.types).forEach(k => {
    S.type = k;
    const v = myVal();
    if (v != null && sent[day + k] !== v) rows.push({user_id: ON.uid, day, type: k, value: v});
  });
  S.type = cur;
  if (!rows.length) return;
  pushing = true;
  try {
    const {error} = await ON.sb.from('records').upsert(rows, {onConflict: 'user_id,day,type'});
    if (!error) rows.forEach(r => sent[r.day + r.type] = r.value);
  } finally { pushing = false; }
}
ON.push = () => { pushRecords().catch(() => {}); };

/* ---------- 버튼 동작 (온라인일 때만 가로채요) ---------- */
const fail = (e, scr) => { S.msg = '서버 오류: ' + (e && e.message || e); go(scr); };
async function createFriendRoom(k) {
  for (let i = 0; i < 3; i++) {
    const code = newCode();
    const {data, error} = await ON.sb.from('rooms').insert({code, type: k, mode: 'friend', created_by: ON.uid}).select('id').single();
    if (error) { if (error.code === '23505') continue; throw error; }   // 코드가 겹치면 다시
    const j = await ON.sb.from('room_members').insert({room_id: data.id, user_id: ON.uid});
    if (j.error) throw j.error;
    S.rooms[k] = {id: data.id, code, mode: 'friend', online: true, members: []};
    return;
  }
  throw new Error('코드를 만들지 못했어요');
}
async function joinByCode(raw) {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^GS[A-Z0-9]{4}$/.test(c)) { S.msg = '코드를 정확히 적어 주세요 (예: GS-7K2P)'; return go('mode'); }
  const code = 'GS-' + c.slice(2);
  const {data: r, error} = await ON.sb.from('rooms').select('id, type, mode, code').eq('code', code).maybeSingle();
  if (error) throw error;
  if (!r) { S.msg = '없는 방 코드예요. 친구에게 다시 확인해 보세요'; return go('mode'); }
  const j = await ON.sb.from('room_members').insert({room_id: r.id, user_id: ON.uid});
  if (j.error && j.error.code !== '23505') throw j.error;   // 이미 들어가 있으면 괜찮아요
  if (r.type !== S.type) S.msg = CONFIG.types[r.type].ko + ' 방이라서 종목을 바꿨어요';
  S.type = r.type;
  S.rooms[r.type] = {id: r.id, code: r.code, mode: 'friend', online: true, members: []};
  await refreshAll();
  go('room');
}
async function joinRandom(k, mode) {
  S.matching = mode === 'duel'; go('mode');
  const {data: id, error} = await ON.sb.rpc('join_random', {p_type: k, p_mode: mode});
  S.matching = false;
  if (error) throw error;
  S.rooms[k] = {id, code: '', mode, online: true, members: []};
  await refreshAll();
  if (S.type === k) go('room');
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || !ON.ready) return;
  const act = a.dataset.act, k = S.type;
  const stop = () => { e.stopImmediatePropagation(); e.preventDefault(); };
  if (act === 'nick') {
    stop();
    const n = $('#nick').value.trim();
    if (!n || n === '나' || n.length > 12) { S.msg = '1~12자 닉네임을 적어 주세요'; return go('hello'); }
    ON.sb.from('profiles').upsert({id: ON.uid, nickname: n, char: S.char}).then(({error}) => {
      if (error) return fail(error, 'hello');
      const first = !ON.nick; ON.nick = n; ON.char = S.char;
      if (first) syncRooms().then(() => go('pick'), err => fail(err, 'pick')); else { S.msg = '닉네임을 바꿨어요'; go('my'); }
    });
    return;
  }
  if (act === 'delacc') {   // 서버에서 계정을 지운 뒤 기기 기록도 지워요
    stop();
    ON.sb.rpc('delete_my_account').then(async ({error}) => {
      if (error) return fail(error, 'my');
      try { await ON.sb.auth.signOut(); } catch (e) {}
      wipeLocal();
    });
    return;
  }
  if (!ON.nick) return;
  if (act === 'mfriend') { stop(); createFriendRoom(k).then(() => go('room'), err => fail(err, 'mode')); }
  else if (act === 'mjoin') { stop(); joinByCode($('#code').value).catch(err => fail(err, 'mode')); }
  else if (act === 'mduel') { stop(); joinRandom(k, 'duel').catch(err => { S.matching = false; fail(err, 'mode'); }); }
  else if (act === 'mroyale') { stop(); joinRandom(k, 'royale').catch(err => fail(err, 'mode')); }
  else if (act === 'leave' && S.rooms[k] && S.rooms[k].online) {
    stop();
    ON.sb.from('room_members').delete().eq('room_id', S.rooms[k].id).eq('user_id', ON.uid)
      .then(({error}) => { if (error) return fail(error, 'room'); delete S.rooms[k]; go('mode'); });
  }
}, true);   // true: 원래 앱의 버튼 처리보다 먼저 실행돼요

/* ---------- 주기적으로 기록 주고받기 ---------- */
setInterval(async () => {
  if (!ON.ready || !ON.nick || document.hidden) return;
  try {
    await pushRecords();
    if (ON.char !== S.char) { await ON.sb.from('profiles').update({char: S.char}).eq('id', ON.uid); ON.char = S.char; }
    await refreshAll();
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (['pick', 'room', 'result'].includes(S.scr) && !typing) go(S.scr);   // 배틀 화면은 스스로 갱신돼요
  } catch (e) { /* 잠깐 끊겨도 다음에 다시 시도해요 */ }
}, POLL_MS);

/* ---------- 시작: 익명 로그인 → 프로필 확인 → 내 방 불러오기 ---------- */
(async () => {
  if (!window.supabase) { ON.err = '서버 도구를 불러오지 못했어요'; return; }
  try {
    ON.sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    let {data: {session}} = await ON.sb.auth.getSession();
    if (!session) {
      const r = await ON.sb.auth.signInAnonymously();
      if (r.error) throw r.error;
      session = r.data.session;
    }
    ON.uid = session.user.id;
    const {data: prof, error} = await ON.sb.from('profiles').select('nickname, char').eq('id', ON.uid).maybeSingle();
    if (error) throw error;
    ON.ready = true;
    if (!prof) return go('hello');
    ON.nick = prof.nickname; ON.char = prof.char;
    await syncRooms();
    go(S.scr);
  } catch (e) {
    console.warn('[online] 연습 모드로 계속해요', e);
    ON.ready = false; ON.err = e.message || String(e);
    go(S.scr);
  }
})();
