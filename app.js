/* ============ Learn Chinese — app logic ============ */
const CUR = window.CURRICULUM;
const LESSONS = [];
CUR.forEach(lv => lv.lessons.forEach(ls => { ls.levelId = lv.id; ls.levelBadge = lv.badge; LESSONS.push(ls); }));
const key = (lid,i) => lid+"#"+i;
const ALL = [];
LESSONS.forEach(ls => ls.cards.forEach((c,i)=> ALL.push({...c, key:key(ls.id,i), lid:ls.id})));

/* ---------- storage + SRS ---------- */
const KEY="learnChineseSRS_v3";
let store = loadStore() || initStore();
function initStore(){ return {cards:{}, streak:0, lastDay:null, seenGradeInfo:false}; }
function loadStore(){ try{return JSON.parse(localStorage.getItem(KEY));}catch(e){return null;} }
function save(){ localStorage.setItem(KEY, JSON.stringify(store)); }
function cd(k){ if(!store.cards[k]) store.cards[k]={ease:2.5,interval:0,due:0,reps:0}; return store.cards[k]; }

(function(){ const today=new Date().toDateString();
  if(store.lastDay!==today){ const y=new Date(Date.now()-864e5).toDateString();
    store.streak=(store.lastDay===y)?store.streak+1:1; store.lastDay=today; save(); }
})();

/* ---------- prefs ---------- */
let prefs={bopo:true,pin:true,trad:true,simp:false};

/* ---------- audio: device speech, implemented to iOS Safari's strict rules ----------
   iOS requires: speak() called INSIDE a tap handler, voices loaded via voiceschanged,
   and a kept reference to the utterance so it isn't garbage-collected mid-speech. */
let zhVoice=null, lastUtter=null, voicesReady=false;
function loadVoices(){
  if(!window.speechSynthesis) return;
  const vs=speechSynthesis.getVoices();
  if(vs && vs.length){
    voicesReady=true;
    zhVoice = vs.find(v=>/zh[-_]?TW/i.test(v.lang))      // prefer Taiwan
           || vs.find(v=>/zh[-_]?(HK|CN)/i.test(v.lang)) // then other Chinese
           || vs.find(v=>/^zh/i.test(v.lang)) || null;
  }
}
if(window.speechSynthesis){
  loadVoices();
  speechSynthesis.onvoiceschanged=loadVoices;
}
/* speak MUST be called synchronously from inside a user tap on iOS */
function speak(text){
  if(!text || !window.speechSynthesis) return;
  if(!voicesReady) loadVoices();
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang="zh-TW"; u.rate=0.78; u.pitch=1;
    if(zhVoice) u.voice=zhVoice;
    lastUtter=u;                 // keep reference alive (iOS GC bug)
    speechSynthesis.speak(u);
  }catch(e){}
}
/* prime the engine on the very first tap anywhere — iOS needs one gesture to "unlock" audio */
function primeAudio(){
  if(!window.speechSynthesis) return;
  try{ const u=new SpeechSynthesisUtterance(" "); u.volume=0; speechSynthesis.speak(u); }catch(e){}
  loadVoices();
  document.removeEventListener("touchend",primeAudio);
  document.removeEventListener("click",primeAudio);
}
document.addEventListener("touchend",primeAudio,{once:true});
document.addEventListener("click",primeAudio,{once:true});

/* ---------- lesson progress ---------- */
function lp(ls){ let learned=0; ls.cards.forEach((c,i)=>{ if(cd(key(ls.id,i)).reps>0) learned++; });
  return {learned,total:ls.cards.length,pct:Math.round(learned/ls.cards.length*100)}; }
function lessonDone(ls){ return lp(ls).learned===ls.cards.length; }
function unlocked(idx){ return idx===0 || lessonDone(LESSONS[idx-1]); }

/* ---------- views ---------- */
let view="map", session=[], current=null, revealed=false, activeLesson=null, exMode="card";
const $=id=>document.getElementById(id);
const mapView=$("mapView"), studyView=$("studyView"), syncView=$("syncView");

function setView(v){ view=v;
  mapView.style.display=v==="map"?"block":"none";
  studyView.classList.toggle("on",v==="study");
  syncView.classList.toggle("on",v==="sync");
  $("navMap").classList.toggle("active",v==="map");
  $("navSync").classList.toggle("active",v==="sync");
}
$("navMap").onclick=()=>{ renderMap(); setView("map"); };
$("navSync").onclick=()=>{ setView("sync"); };
$("navReview").onclick=startReview;
$("closeStudy").onclick=()=>{ renderMap(); setView("map"); };

function renderMap(){
  $("streak").textContent=store.streak;
  let html="", idx=0;
  CUR.forEach(lv=>{
    html+=`<div class="lvl"><div class="lvl-h"><span class="lvl-badge">${lv.badge}</span>
      <div><h2>${lv.title}</h2><div class="s">${lv.sub}</div></div></div><div class="lessons">`;
    lv.lessons.forEach(ls=>{
      const i=idx++, pg=lp(ls), un=unlocked(i), dn=lessonDone(ls);
      const st=!un?"🔒":dn?"✓":pg.learned>0?"▸":"";
      html+=`<div class="lesson ${un?"":"lock"} ${dn?"done":""}" data-i="${i}">
        <div class="l-ic">${ls.icon}</div>
        <div class="l-b"><div class="l-t">${ls.title}</div>
        <div class="l-m">${pg.learned}/${pg.total} words${un?"":" · locked"}</div>
        <div class="l-bar"><i style="width:${pg.pct}%"></i></div></div>
        <div class="l-st">${st}</div></div>`;
    });
    html+=`</div></div>`;
  });
  mapView.innerHTML=html;
  mapView.querySelectorAll(".lesson").forEach(el=>{
    el.onclick=()=>{ const i=+el.dataset.i; if(unlocked(i)) startLesson(LESSONS[i]); };
  });
}

/* ---------- session building: mix exercise types ---------- */
function startLesson(ls){
  activeLesson=ls;
  session = ls.cards.map((c,i)=>({...c, key:key(ls.id,i)}));
  session.sort((a,b)=> cd(a.key).due - cd(b.key).due);
  nextCard(); setView("study");
}
function startReview(){
  const now=Date.now();
  const due=ALL.filter(c=>cd(c.key).reps>0 && cd(c.key).due<=now).sort((a,b)=>cd(a.key).due-cd(b.key).due);
  if(!due.length){ renderMap(); setView("map"); flash("Nothing due — keep going with lessons 🎉"); return; }
  activeLesson={id:"__review__",cards:due}; session=due.slice(); nextCard(); setView("study");
}
function flash(m){ $("foot").textContent=m; setTimeout(renderFoot,3000); }

/* pick exercise mode: new cards = flashcard; seen cards = sometimes a quiz */
function pickMode(c){
  const r=cd(c.key);
  if(r.reps===0) return "card";          // first time: learn it
  if(ALL.length<4) return "card";
  return Math.random()<0.5 ? "listen" : "meaning";
}

function nextCard(){
  current = session.length ? session[0] : null;
  revealed=false;
  if(current) exMode=pickMode(current);
  renderEx();
}

/* ---------- SRS grade ---------- */
function grade(q){
  const c=cd(current.key);
  if(q===0){ c.interval=0; c.ease=Math.max(1.3,c.ease-0.2); }
  else { if(c.reps===0) c.interval=(q===1?1:q===2?1:3);
    else if(c.reps===1) c.interval=(q===1?2:q===2?3:6);
    else c.interval=Math.round(c.interval*c.ease*(q===1?0.6:q===3?1.3:1));
    c.ease=Math.min(3.0,c.ease+(q===3?0.1:q===1?-0.1:0)); }
  c.reps++; c.due=Date.now()+c.interval*864e5; save();
  session.shift();
  if(q===0) session.push(current);
  if(!session.length) finishSession(); else nextCard();
}
/* quiz auto-grade: right=Good, wrong=Again */
function quizResult(ok){ if(ok) celebrate(); setTimeout(()=>grade(ok?2:0), ok?550:900); }

function finishSession(){
  current=null; autoPush();
  $("sProg").style.width="100%";
  $("sKind").textContent="";
  $("card").innerHTML=`<div class="done-msg"><div class="big">🎉</div>
    <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px">Lesson complete</div>
    <div style="color:var(--ink2)">Streak: ${store.streak} day${store.streak===1?"":"s"} 🔥</div></div>`;
  $("controls").innerHTML=`<button class="big-btn" id="toMap">Back to lessons</button>`;
  $("toMap").onclick=()=>{ renderMap(); setView("map"); };
  $("toolbar").style.display="none";
}

/* ---------- progress bar ---------- */
function setProg(){
  const total=activeLesson&&activeLesson.cards?activeLesson.cards.length:1;
  const done=total-session.length-(current?1:0);
  $("sProg").style.width=Math.round(done/total*100)+"%";
}

/* ---------- render exercises ---------- */
function hzText(c){ return prefs.trad?c.t:c.s; }
function renderEx(){
  $("toolbar").style.display="flex";
  setProg();
  if(!current) return;
  if(exMode==="card") return renderCard();
  if(exMode==="listen") return renderListen();
  if(exMode==="meaning") return renderMeaning();
}

/* flashcard */
function renderCard(){
  $("sKind").textContent="New word — learn it";
  const c=current, hz=prefs.trad?c.t:(prefs.simp?c.s:c.t);
  const showSimp=prefs.trad&&prefs.simp&&c.t!==c.s;
  const egHtml=c.eg?(()=>{const[z,py,en]=c.eg.split("|");return `<div class="eg"><b>${z}</b><br>${py}<br>${en}</div>`;})():"";
  $("card").innerHTML=`
    <div class="hz">${hz}${showSimp?`<span class="simp">简 ${c.s}</span>`:""}</div>
    <button class="spk" id="spk" title="Play sound">🔊</button>
    <div class="phon ${revealed?"":"hidden"}">
      ${prefs.bopo?`<span class="bopo">${c.b}</span>`:""}
      ${prefs.pin?`<span class="pin">${c.p}</span>`:""}</div>
    <div class="mean ${revealed?"":"hidden"}">${c.m}</div>
    ${revealed?egHtml:""}
    ${revealed?"":`<div class="hint">tap 🔊 to hear · tap reveal to see</div>`}`;
  $("spk").onclick=()=>speak(hzText(c));
  if(!revealed){
    $("controls").innerHTML=`<button class="big-btn" id="rev">Reveal</button>`;
    $("rev").onclick=()=>{ revealed=true; renderCard(); speak(hzText(c)); };
  } else {
    $("controls").innerHTML=`<div class="grades">
      <button class="grade g0" data-q="0">Again<small>&lt;1m</small></button>
      <button class="grade g1" data-q="1">Hard<small>soon</small></button>
      <button class="grade g2" data-q="2">Good<small>days</small></button>
      <button class="grade g3" data-q="3">Easy<small>longer</small></button></div>`;
    $("controls").querySelectorAll(".grade").forEach(b=>b.onclick=()=>grade(+b.dataset.q));
    maybeGradeInfo();
  }
}

/* listening: hear audio, pick the right meaning */
function renderListen(){
  $("sKind").textContent="Listen — what does it mean?";
  const c=current;
  const opts=distractors(c,"m");
  $("card").innerHTML=`
    <button class="spk" id="spk" style="width:72px;height:72px;font-size:2rem">🔊</button>
    <div class="hint">tap to hear it again</div>
    <div class="choices" id="ch"></div>`;
  $("spk").onclick=()=>speak(hzText(c));
  const ch=$("ch");
  opts.forEach(o=>{ const b=document.createElement("button"); b.className="choice"; b.textContent=o.m;
    b.onclick=()=>handleChoice(b,o.m===c.m,ch,c.m); ch.appendChild(b); });
  $("controls").innerHTML="";
  speak(hzText(c));
}

/* meaning: see characters, pick the right English */
function renderMeaning(){
  $("sKind").textContent="What does this mean?";
  const c=current, hz=prefs.trad?c.t:c.s;
  const opts=distractors(c,"m");
  $("card").innerHTML=`<div class="hz">${hz}</div>
    <div class="phon"><span class="pin">${prefs.bopo?c.b:c.p}</span></div>
    <div class="choices" id="ch"></div>`;
  const ch=$("ch");
  opts.forEach(o=>{ const b=document.createElement("button"); b.className="choice"; b.textContent=o.m;
    b.style.fontSize="1rem"; b.onclick=()=>handleChoice(b,o.m===c.m,ch,c.m); ch.appendChild(b); });
  $("controls").innerHTML="";
}

function handleChoice(btn,ok,container,correctM){
  container.querySelectorAll(".choice").forEach(b=>{ b.style.pointerEvents="none";
    if(b.textContent===correctM) b.classList.add("right");
    else b.classList.add("dim"); });
  if(!ok){ btn.classList.remove("dim"); btn.classList.add("wrong"); }
  speak(hzText(current));
  quizResult(ok);
}

/* build 4 options: correct + 3 distractors from same/other lessons */
function distractors(c,field){
  const pool=ALL.filter(x=>x[field]&&x[field]!==c[field]);
  const picks=[];
  while(picks.length<3 && pool.length){ const i=Math.floor(Math.random()*pool.length);
    if(!picks.includes(pool[i])){ picks.push(pool[i]); } pool.splice(i,1); }
  const opts=[c,...picks];
  for(let i=opts.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [opts[i],opts[j]]=[opts[j],opts[i]]; }
  return opts;
}

function celebrate(){ const t=document.createElement("div"); t.className="tick show";
  $("card").appendChild(t); setTimeout(()=>t.remove(),600); }

/* first-time explainer for grade buttons */
function maybeGradeInfo(){
  if(store.seenGradeInfo) return;
  store.seenGradeInfo=true; save();
  const tip=document.createElement("div"); tip.className="info"; tip.style.marginTop="10px";
  tip.innerHTML="<b>Rate how well you knew it.</b> The app uses your answer to decide when to show this card again — Again brings it back in seconds, Easy pushes it far out. Be honest; it makes you learn faster.";
  $("controls").appendChild(tip);
}

/* ---------- toggles + keyboard ---------- */
function bindTg(id,k){ const el=$(id);
  el.onclick=()=>{ if((k==="trad"||k==="simp")&&prefs[k]){ const o=k==="trad"?"simp":"trad"; if(!prefs[o])return; }
    prefs[k]=!prefs[k]; el.classList.toggle("on",prefs[k]); if(current&&exMode==="card")renderCard(); }; }
bindTg("tBopo","bopo");bindTg("tPin","pin");bindTg("tTrad","trad");bindTg("tSimp","simp");
document.addEventListener("keydown",e=>{ if(view!=="study"||exMode!=="card")return;
  if(e.code==="Space"){e.preventDefault(); if(!revealed&&current){revealed=true;renderCard();speak(hzText(current));}}
  else if(revealed&&current&&["1","2","3","4"].includes(e.key)) grade(+e.key-1); });

function renderFoot(){ $("foot").innerHTML="TOCFL-aligned levels · mixed exercises (learn, listen, choose) · native-style audio · spaced repetition · auto-syncs when signed in."; }

/* ============ Firebase sync ============ */
let fbAuth=null,fbDb=null,fbUser=null;
function setSyncMsg(t,c){ const e=$("syncMsg"); e.textContent=t; e.className="msg "+(c||""); }
function setBackupMsg(t,c){ const e=$("backupMsg"); e.textContent=t; e.className="msg "+(c||""); }
function payload(){ return {cards:store.cards,streak:store.streak,lastDay:store.lastDay,seenGradeInfo:store.seenGradeInfo,v:3}; }
function applyPayload(p){ if(!p)return; store.cards=p.cards||store.cards; store.streak=p.streak??store.streak;
  store.lastDay=p.lastDay??store.lastDay; store.seenGradeInfo=p.seenGradeInfo??store.seenGradeInfo; save(); }
function initFirebase(){
  if(typeof firebase==="undefined"||!window.FIREBASE_CONFIG){ setSyncMsg("Sync unavailable. Use manual backup.","err"); return false; }
  try{ firebase.initializeApp(FIREBASE_CONFIG); fbAuth=firebase.auth(); fbDb=firebase.firestore();
    fbAuth.onAuthStateChanged(onAuth); return true; }
  catch(e){ setSyncMsg("Sync init failed: "+e.message,"err"); return false; }
}
function onAuth(u){ fbUser=u;
  $("signedOut").style.display=u?"none":"block"; $("signedIn").style.display=u?"block":"none";
  if(u){ $("userEmail").textContent=u.email||"your account"; setSyncMsg("Signed in — syncing ✓","ok"); pullNow(); }
}
async function signIn(){ if(!fbAuth&&!initFirebase())return;
  try{ await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch(e){ setSyncMsg("Sign-in failed: "+e.message,"err"); } }
async function signOutUser(){ if(fbAuth) await fbAuth.signOut(); setSyncMsg("Signed out.",""); }
async function pushNow(){ if(!fbUser||!fbDb)return;
  try{ await fbDb.collection("progress").doc(fbUser.uid).set(payload()); setSyncMsg("Synced ✓","ok"); }
  catch(e){ setSyncMsg("Sync up failed: "+e.message,"err"); } }
async function pullNow(){ if(!fbUser||!fbDb)return;
  try{ const d=await fbDb.collection("progress").doc(fbUser.uid).get();
    if(d.exists){ applyPayload(d.data()); renderMap(); setSyncMsg("Up to date ✓","ok"); } else await pushNow(); }
  catch(e){ setSyncMsg("Sync down failed: "+e.message,"err"); } }
function autoPush(){ if(fbUser&&fbDb) pushNow().catch(()=>{}); }
$("signInBtn").onclick=signIn; $("signOutBtn").onclick=signOutUser; $("pushNow").onclick=pushNow;

/* manual backup */
$("exportBtn").onclick=()=>{ const blob=new Blob([JSON.stringify(payload(),null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="chinese-progress-"+new Date().toISOString().slice(0,10)+".json"; a.click();
  setBackupMsg("Backup downloaded. Save to Google Drive.","ok"); };
$("importBtn").onclick=()=>$("fileInput").click();
$("fileInput").onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{ try{ applyPayload(JSON.parse(r.result)); renderMap(); autoPush(); setBackupMsg("Imported ✓","ok"); }
    catch(err){ setBackupMsg("Couldn't read that file.","err"); } }; r.readAsText(f); };

/* boot */
renderMap(); renderFoot(); setView("map"); initFirebase();
