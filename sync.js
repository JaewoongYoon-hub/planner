// Firebase sync for the offline planner.
// Works offline first: edits go to the device right away and are sent when the internet is back.
// Each to-do line, goal line, timetable block and note is synced as its own item, so edits to
// different items on different devices merge. When the same item was changed on two devices,
// the newer edit wins and the other one is kept in 충돌 기록 (conflict log).
const V = "10.12.2";
const CFG = window.FIREBASE_CONFIG;
const DEV_KEY = "plandoPlanner.device", META_KEY = "plandoPlanner.meta", MODE_KEY = "plandoPlanner.syncMode";
const ls = { get(k){ try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(e){ return null; } },
             set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
let device = ls.get(DEV_KEY); if(!device){ device = Math.random().toString(36).slice(2,10); ls.set(DEV_KEY, device); }

/* ---------- app doc <-> items ---------- */
const INDEXED = new Set(["todos","forget","work","personal","study"]);
const KEYED = new Set(["blocks"]);
const MAPS = new Set(["plan","act"]);
function flatten(doc){
  const out = {};
  for(const k of Object.keys(doc || {})){
    if(k === "ym") continue;
    const v = doc[k];
    if(INDEXED.has(k) && Array.isArray(v)) v.forEach((x,i)=>{ if(x && String(x.t||"").trim()) out[`${k}_${i}`] = {t:x.t, s:x.s||0}; else if(x && x.s) out[`${k}_${i}`] = {t:"", s:x.s}; });
    else if(KEYED.has(k) && Array.isArray(v)) v.forEach(x=>{ if(x && x.id){ const {id, ...rest} = x; out[`${k}_${id}`] = rest; } });
    else if(MAPS.has(k) && v && typeof v === "object") Object.keys(v).forEach(h=>{ if(String(v[h]||"").trim()) out[`${k}_${h}`] = v[h]; });
    else if(typeof v === "string"){ if(v.trim()) out[k] = v; }
  }
  return out;
}
function unflatten(items){
  const doc = {};
  for(const key of Object.keys(items)){
    const v = items[key]; if(v == null) continue;
    const i = key.indexOf("_"), k = i < 0 ? key : key.slice(0,i), sub = i < 0 ? null : key.slice(i+1);
    if(INDEXED.has(k)){ (doc[k] = doc[k] || [])[+sub] = v; }
    else if(KEYED.has(k)){ (doc[k] = doc[k] || []).push({id:sub, ...v}); }
    else if(MAPS.has(k)){ (doc[k] = doc[k] || {})[sub] = v; }
    else doc[key] = v;
  }
  for(const k of INDEXED) if(doc[k]) for(let j=0;j<doc[k].length;j++) if(!doc[k][j]) doc[k][j] = {t:"",s:0};
  if(doc.blocks) doc.blocks.sort((a,b)=>((a.s ?? a.as) - (b.s ?? b.as)));
  return doc;
}
const J = v => JSON.stringify(v ?? null);

/* ---------- UI: sign-in panel, account and conflict tabs ---------- */
const css = document.createElement("style");
css.textContent = `
.sy-scrim{position:fixed;inset:0;z-index:60;background:rgba(20,22,25,.35);display:grid;place-items:center;padding:16px}
.sy-card{width:min(380px,100%);background:var(--paper);color:var(--ink);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.25);max-height:calc(100% - 16px);overflow:auto}
.sy-card h2{margin:0;font-size:17px}
.sy-card p{margin:0;font-size:13px;color:var(--sub);line-height:1.55}
.sy-card input{font-size:15px;height:40px;border:1px solid var(--line);border-radius:6px;padding:0 10px}
.sy-row{display:flex;gap:8px;flex-wrap:wrap}
.sy-btn{font-size:14px;padding:9px 14px;border-radius:6px;border:1px solid var(--line)}
.sy-btn.pri{background:var(--acc);border-color:var(--acc);color:var(--onacc)}
.sy-btn.link{border:0;color:var(--sub);text-decoration:underline;padding:6px 2px}
.sy-err{color:var(--red);font-size:13px;min-height:1em}
.sy-list{display:flex;flex-direction:column;gap:8px}
.sy-item{border:1px solid var(--faint);border-radius:6px;padding:8px 10px;font-size:13px;display:flex;flex-direction:column;gap:6px}
.sy-item small{color:var(--sub)}
.tab.sy-c{border-color:var(--red);color:var(--red)}`;
document.head.append(css);
function el(tag, attrs, ...kids){ const e = document.createElement(tag); for(const k in attrs||{}){ const v=attrs[k]; if(k.startsWith("on")) e.addEventListener(k.slice(2), v); else if(k==="class") e.className=v; else e.setAttribute(k,v); } kids.flat().forEach(c=>c!=null&&e.append(c)); return e; }
function modal(...kids){ const sc = el("div",{class:"sy-scrim"}, el("div",{class:"sy-card",role:"dialog"}, ...kids)); document.body.append(sc); return sc; }
const KO_ERR = {"auth/invalid-credential":"이메일 또는 비밀번호가 맞지 않습니다.","auth/wrong-password":"비밀번호가 맞지 않습니다.","auth/user-not-found":"이 이메일로 만든 계정이 없습니다. '계정 만들기'를 눌러 주세요.",
  "auth/email-already-in-use":"이미 있는 계정입니다. '로그인'을 눌러 주세요.","auth/weak-password":"비밀번호는 6자 이상으로 정해 주세요.","auth/invalid-email":"이메일 주소 형식을 확인해 주세요.",
  "auth/network-request-failed":"인터넷 연결이 없어 로그인할 수 없습니다. 연결된 뒤 다시 시도하거나 '이 기기에서만 쓰기'를 누르세요.","auth/too-many-requests":"잠시 후 다시 시도해 주세요."};

function askSignIn(auth, fns){
  return new Promise(resolve=>{
    const email = el("input",{type:"email",placeholder:"이메일",autocomplete:"username",id:"sy-email"});
    const pw = el("input",{type:"password",placeholder:"비밀번호 (6자 이상)",autocomplete:"current-password",id:"sy-pw"});
    const err = el("div",{class:"sy-err"});
    const go = async (create) => {
      err.textContent = "";
      try{ await (create ? fns.createUserWithEmailAndPassword : fns.signInWithEmailAndPassword)(auth, email.value.trim(), pw.value); sc.remove(); resolve("signed"); }
      catch(e){ err.textContent = KO_ERR[e.code] || ("로그인하지 못했습니다 (" + (e.code||e.message) + ")"); }
    };
    const sc = modal(
      el("h2",null,"기기 간 동기화"),
      el("p",null,"같은 계정으로 로그인한 태블릿·휴대폰·PC의 기록이 인터넷이 될 때 서로 맞춰집니다. 처음 한 번만 로그인하면, 그다음부터는 인터넷이 없어도 열립니다."),
      email, pw, err,
      el("div",{class:"sy-row"}, el("button",{class:"sy-btn pri",onclick:()=>go(false)},"로그인"), el("button",{class:"sy-btn",onclick:()=>go(true)},"계정 만들기")),
      el("button",{class:"sy-btn link",onclick:()=>{ ls.set(MODE_KEY,"local"); sc.remove(); resolve("local"); }},"동기화 없이 이 기기에서만 쓰기"));
    setTimeout(()=>email.focus(), 50);
  });
}

/* ---------- backend ---------- */
async function makeBackend(){
  if(!CFG || !CFG.apiKey) return null;
  if(ls.get(MODE_KEY) === "local" && !location.hash.includes("sync")) return null;
  const base = new URL("lib/", location.href).href;  // bundled copy, so it also loads offline
  const [{initializeApp}, A, F] = await Promise.all([import(base+"firebase-app.js"), import(base+"firebase-auth.js"), import(base+"firebase-firestore.js")]);
  const app = initializeApp(CFG);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, {localCache: F.persistentLocalCache({tabManager: F.persistentMultipleTabManager()})});
  const user = await new Promise(r=>{ const off = A.onAuthStateChanged(auth, u=>{ off(); r(u); }); });
  if(!user){
    const res = await askSignIn(auth, A);
    if(res !== "signed") return null;
  }
  ls.set(MODE_KEY, "sync");
  const uid = auth.currentUser.uid;
  const col = F.collection(db, "users", uid, "docs");
  const meta = ls.get(META_KEY) || {};          // meta[docId][key] = {u, b, h}  (h = value json)
  const saveMeta = () => ls.set(META_KEY, meta);
  let api = null, conflicts = {}, online = navigator.onLine, pending = false;

  function status(){
    if(!api) return;
    if(!online) api.setSave("오프라인 · 이 기기에 저장됨 (연결되면 동기화)");
    else if(pending) api.setSave("동기화 중…");
    else api.setSave("동기화됨 · " + (auth.currentUser.email || ""));
  }
  addEventListener("online", ()=>{ online = true; status(); });
  addEventListener("offline", ()=>{ online = false; status(); });

  async function putItems(id, changes){
    if(!Object.keys(changes).length) return;
    pending = true; status();
    const ref = F.doc(col, id);
    // merge write: only these items change on the server, so other devices' items are kept
    const p = F.setDoc(ref, {ym: id.slice(1,8), items: changes}, {merge: true});
    p.then(()=>{ pending = false; status(); }).catch(()=>{ api.setSave("동기화 실패 · 이 기기 사본은 남아 있습니다", true); });
    // offline, the promise waits for the server; the write is already queued on the device
  }
  function logConflict(id, key, lost, won){
    const cid = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const entry = {doc:id, key, lost: J(lost), won: J(won), at: Date.now(), dev: device};
    conflicts[cid] = entry;
    F.setDoc(F.doc(col, "zconflicts"), {items: {[cid]: entry}}, {merge: true}).catch(()=>{});
    renderTabs();
  }

  // synced items, plus anything on this device that has never been synced
  function mergedFlat(id){
    const m = meta[id] || {}, flat = flatten(api.getStore()[id] || {});
    for(const k in m){ const v = JSON.parse(m[k].h); if(v == null) delete flat[k]; else flat[k] = v; }
    return flat;
  }
  async function write(id, data){
    const now = flatten(data), m = meta[id] = meta[id] || {}, changes = {}, t = Date.now();
    const keys = new Set([...Object.keys(now), ...Object.keys(m)]);
    for(const k of keys){
      const h = J(now[k] ?? null);
      if(m[k] && m[k].h === h) continue;
      if(!m[k] && h === "null") continue;
      const item = {v: now[k] ?? null, u: t, b: m[k] ? m[k].u : 0, dev: device};
      changes[k] = item; m[k] = {u: t, b: item.b, h};
    }
    saveMeta();
    await putItems(id, changes);
  }

  function applyDoc(id, items){
    if(id === "zconflicts"){ conflicts = {}; for(const k in items||{}) if(items[k]) conflicts[k] = items[k]; renderTabs(); return false; }
    if(api.isDirty(id)) return false;          // typing in it right now; our write will follow
    const m = meta[id] = meta[id] || {}, reassert = {};
    let changed = false;
    for(const k of Object.keys(items || {})){
      const inc = items[k]; if(!inc || typeof inc !== "object") continue;
      const loc = m[k];
      if(loc && loc.u === inc.u) continue;      // already have it
      const incH = J(inc.v);
      if(!loc || inc.b === loc.u || loc.h === incH){            // normal edit on top of ours
        m[k] = {u: inc.u, b: inc.b, h: incH}; changed = true; continue;
      }
      // both devices changed this item since they last agreed
      if(inc.u >= loc.u){ logConflict(id, k, JSON.parse(loc.h), inc.v); m[k] = {u: inc.u, b: inc.b, h: incH}; changed = true; }
      else { logConflict(id, k, inc.v, JSON.parse(loc.h)); reassert[k] = {v: JSON.parse(loc.h), u: loc.u, b: inc.u, dev: device}; m[k] = {...loc, b: inc.u}; }
    }
    if(Object.keys(reassert).length) putItems(id, reassert);
    if(changed) api.setLocal(id, unflatten(mergedFlat(id)));
    return changed;
  }

  /* tabs: account + conflicts */
  function renderTabs(){
    const tabs = document.getElementById("tabs"); if(!tabs) return;
    let acc = document.getElementById("sy-acc");
    if(!acc){ acc = el("button",{id:"sy-acc",class:"tab today",title:"동기화 계정",onclick:showAccount},"계정"); tabs.append(acc); }
    let cf = document.getElementById("sy-cf");
    const n = Object.keys(conflicts).length;
    if(n){ if(!cf){ cf = el("button",{id:"sy-cf",class:"tab today sy-c",onclick:showConflicts}); tabs.append(cf); } cf.textContent = `충돌 ${n}`; }
    else if(cf) cf.remove();
  }
  new MutationObserver(()=>{ if(!document.getElementById("sy-acc")) renderTabs(); }).observe(document.getElementById("tabs"), {childList:true});
  function showAccount(){
    const sc = modal(el("h2",null,"동기화 계정"), el("p",null,(auth.currentUser.email||"") + " 으로 로그인되어 있습니다. 이 기기 ID: " + device),
      el("div",{class:"sy-row"}, el("button",{class:"sy-btn",onclick:()=>sc.remove()},"닫기"),
        el("button",{class:"sy-btn",onclick:async()=>{ await A.signOut(auth); ls.set(MODE_KEY,null); localStorage.removeItem(META_KEY); location.reload(); }},"로그아웃")));
  }
  const LABEL = {todos:"할 일", forget:"잊지 말 것", work:"업무 목표", personal:"개인 목표", study:"공부·독서", blocks:"시간표", note:"주간 메모", plan:"계획", act:"실적"};
  const show = v => { const x = JSON.parse(v); if(x==null) return "(지움)"; if(typeof x==="string") return x; return (x.t||"") + (x.s!=null&&x.d? ` (${Math.floor(x.s/60)}:${String(x.s%60).padStart(2,"0")})` : ""); };
  function showConflicts(){
    const list = el("div",{class:"sy-list"});
    Object.entries(conflicts).sort((a,b)=>b[1].at-a[1].at).forEach(([cid,c])=>{
      const k = c.key.split("_")[0], where = c.doc.startsWith("d") ? c.doc.slice(1) : c.doc.startsWith("g") ? c.doc.slice(1)+" 목표" : c.doc.slice(1)+" 주";
      list.append(el("div",{class:"sy-item"},
        el("small",null, `${where} · ${LABEL[k]||k} · ${new Date(c.at).toLocaleString("ko-KR")}`),
        el("div",null,"남은 내용: ", el("b",null,show(c.won))),
        el("div",null,"다른 기기 내용: ", el("b",null,show(c.lost))),
        el("div",{class:"sy-row"},
          el("button",{class:"sy-btn",onclick:()=>{ restore(c); dismiss(cid); sc.remove(); }},"다른 기기 내용으로 바꾸기"),
          el("button",{class:"sy-btn",onclick:()=>{ dismiss(cid); sc.remove(); showConflicts(); }},"확인, 지우기"))));
    });
    const sc = modal(el("h2",null,"충돌 기록"), el("p",null,"같은 칸을 두 기기에서 따로 고친 경우입니다. 나중에 고친 내용을 남겼고, 다른 쪽 내용은 여기 보관했습니다."), list,
      el("button",{class:"sy-btn",onclick:()=>sc.remove()},"닫기"));
  }
  function dismiss(cid){ delete conflicts[cid]; F.setDoc(F.doc(col,"zconflicts"), {items:{[cid]: F.deleteField()}}, {merge:true}).catch(()=>{}); renderTabs(); }
  function restore(c){
    const m = meta[c.doc] = meta[c.doc] || {}, t = Date.now(), v = JSON.parse(c.lost);
    const item = {v, u:t, b: m[c.key] ? m[c.key].u : 0, dev: device};
    m[c.key] = {u:t, b:item.b, h:J(v)}; saveMeta();
    api.setLocal(c.doc, unflatten(mergedFlat(c.doc))); api.changed();
    putItems(c.doc, {[c.key]: item});
  }

  return {
    async start(a){
      api = a; status(); renderTabs();
      let first = true;
      F.onSnapshot(col, {includeMetadataChanges: true}, qs => {
        let changed = false;
        qs.docChanges().forEach(ch => { if(ch.type !== "removed"){ const d = ch.doc.data(); if(applyDoc(ch.doc.id, d.items)) changed = true; } });
        saveMeta();
        if(first && !qs.metadata.fromCache){
          first = false;
          // anything written on this device before signing in goes up now
          const st = api.getStore();
          Object.keys(st).forEach(id => { if(/^[dgw]\d/.test(id)) write(id, st[id]); });
        }
        if(!qs.metadata.fromCache) online = true;
        pending = qs.metadata.hasPendingWrites; status();
        if(changed) api.changed();
      }, () => api.setSave("동기화 연결 오류 · 이 기기에 저장 중", true));
    },
    write
  };
}
if(window.__resolveBackend) window.__resolveBackend(makeBackend().catch(e => { console.warn("sync off", e); return null; }));
