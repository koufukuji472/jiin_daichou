(() => {
'use strict';
const APP_VERSION = '0.25';
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const INCOME = ['密葬香資','密葬供花','密葬供物','本葬香資','本葬供花料','本葬供物料','問候','献香'];
const EXPENSE = ['密葬謝誼','密葬回心','中陰謝誼','本葬謝誼（案内有）','本葬謝誼（未案内）','本葬回心（案内有）','本葬回心（未案内）','路資','菓誼','内謝'];
const APP_HEADERS = ['No.','レコードID','親ID','受付区分','持参者ID','宗務所','教区','寺籍番号','寺号','役職','氏名','配役','備考',...INCOME,'プラス小計',...EXPENSE,'マイナス小計'];
const FULL_COL_WIDTH={
  'No.':46,'寺号':64,'氏名':108,'レコードID':78,'親ID':78,'受付区分':64,'持参者ID':78,'宗務所':82,'教区':72,'寺籍番号':70,
  '役職':72,'配役':112,'備考':150,'プラス小計':98,'マイナス小計':98
};
function fullColWidth(h){return FULL_COL_WIDTH[h]||([...INCOME,...EXPENSE].includes(h)?88:82)}
function fullColStyle(h){const w=fullColWidth(h);return `width:${w}px;min-width:${w}px;max-width:${w}px`}
const ROLE_BUTTONS=['住職','東堂','副住職','徒弟','寺族','御山内'];
const PERSON_COLS=['住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];
const state={screen:'home',records:[],draft:null,editId:null,mode:'income',baseName:'本葬受付台帳',sourceLoaded:false,addedDirectory:{temples:[],people:[]},deleted:[],fixedTemples:window.FIXED_TEMPLES||[],search:'',filters:{district:'',kind:'',guide:'',columns:{}},returnScreen:null,tableView:'normal',tableScroll:{top:0,left:0},searchScrollY:0,rules:null,rulePersonSearch:'',cashControl:null};
let moneyTarget=null, moneyValue=null, saveTimer=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmt(n){if(n===null||n===undefined||n==='') return ''; const x=Number(n); return Number.isFinite(x)?x.toLocaleString('ja-JP'):''}
function hiraToKata(s=''){return s.replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));}
function norm(s=''){return hiraToKata(String(s).normalize('NFKC')).replace(/[\s　]/g,'').toUpperCase();}
function roleFromCol(c){return c.startsWith('寺族')?'寺族':c}
function blankMoney(){const o={};[...INCOME,...EXPENSE].forEach(k=>o[k]=null);return o}
function defaultRules(){return {kaishinLine:null,noReturnDistricts:[],fullReturnPeople:[],honorarium:{},appliedCount:0}}
function ensureRules(){const d=defaultRules();state.rules={...d,...(state.rules||{})};state.rules.noReturnDistricts=Array.isArray(state.rules.noReturnDistricts)?state.rules.noReturnDistricts:[];state.rules.fullReturnPeople=Array.isArray(state.rules.fullReturnPeople)?state.rules.fullReturnPeople:[];state.rules.honorarium=state.rules.honorarium&&typeof state.rules.honorarium==='object'?state.rules.honorarium:{};state.rules.appliedCount=Number(state.rules.appliedCount)||0;return state.rules}
function defaultCashControl(){
  const defs={A:{name:'A 密葬',items:['密葬謝誼']},B:{name:'B 中陰',items:['密葬回心','中陰謝誼']},C:{name:'C 本葬前',items:['本葬謝誼（案内有）','路資']},D:{name:'D 本葬通夜',items:['本葬謝誼（未案内）','本葬回心（未案内）']},E:{name:'E 本葬葬儀',items:['本葬回心（案内有）','菓誼','内謝']}};
  const blocks={};Object.entries(defs).forEach(([id,d])=>blocks[id]={id,name:d.name,items:[...d.items],allocated:null,actualRemaining:null,closed:null});
  const incomeActual={};INCOME.forEach(k=>incomeActual[k]=null);return {totalInitial:null,blocks,incomeActual};
}
function ensureCashControl(){const d=defaultCashControl(),c=state.cashControl||{};state.cashControl={...d,...c,blocks:{},incomeActual:{...d.incomeActual,...(c.incomeActual||{})}};for(const id of ['A','B','C','D','E']){const old=c.blocks?.[id]||{};state.cashControl.blocks[id]={...d.blocks[id],...old,items:Array.isArray(old.items)?old.items:[...d.blocks[id].items]}}const assigned=new Set();for(const id of ['A','B','C','D','E'])state.cashControl.blocks[id].items=state.cashControl.blocks[id].items.filter(x=>EXPENSE.includes(x)&&!assigned.has(x)&&(assigned.add(x)||true));EXPENSE.forEach(item=>{if(!assigned.has(item))state.cashControl.blocks.E.items.push(item)});return state.cashControl}
function expenseBlockForItem(item){const c=ensureCashControl();return ['A','B','C','D','E'].find(id=>c.blocks[id].items.includes(item))||'E'}
function expenseLedgerForBlock(id){const b=ensureCashControl().blocks[id];return state.records.reduce((sum,r)=>sum+b.items.reduce((a,k)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0),0)}
function cashBlockCalc(id){const b=ensureCashControl().blocks[id],allocated=b.allocated===null?null:Number(b.allocated)||0,ledger=expenseLedgerForBlock(id),theoretical=allocated===null?null:allocated-ledger,actual=b.actualRemaining===null?null:Number(b.actualRemaining)||0,diff=(theoretical===null||actual===null)?null:actual-theoretical;return {allocated,ledger,theoretical,actual,diff}}
function totalAllocated(){return ['A','B','C','D','E'].reduce((a,id)=>a+(ensureCashControl().blocks[id].allocated===null?0:Number(ensureCashControl().blocks[id].allocated)||0),0)}
function unallocatedCash(){const c=ensureCashControl();return c.totalInitial===null?null:(Number(c.totalInitial)||0)-totalAllocated()}
function blockChangedSinceClose(id){const b=ensureCashControl().blocks[id],cl=b.closed;if(!cl)return false;const now=cashBlockCalc(id);return Number(cl.allocated)!==Number(now.allocated)||Number(cl.ledger)!==Number(now.ledger)||Number(cl.actual)!==Number(now.actual)||cl.itemsKey!==b.items.join('|')}
function incomeLedger(item){return state.records.reduce((a,r)=>a+(r.money[item]===null?0:Number(r.money[item])||0),0)}
function allAssignments(){const fixed=[].concat(...Object.values(window.FUNERAL_ROLE_GROUPS||{}),'未案内');const used=state.records.map(r=>r.assignment).filter(Boolean);return [...new Set([...fixed,...used])]}
function personRuleKey(p){return [p.templeNo||'',p.district||'',p.temple||'',p.name||''].map(norm).join('|')}
function isFullReturnPerson(r){const key=personRuleKey(r);return ensureRules().fullReturnPeople.some(p=>personRuleKey(p)===key)}
function templeReadingByPerson(p){
  const all=[...state.fixedTemples,...state.addedDirectory.temples];
  const t=all.find(x=>(p.templeNo&&String(x['寺籍番号']||'')===String(p.templeNo))||(!p.templeNo&&x['寺院名']===p.temple&&x['教区']===p.district));
  return t?.['フリガナ']||'';
}
function rulePeople(){
  const out=[];
  for(const t of [...state.fixedTemples,...state.addedDirectory.temples]){
    for(const col of PERSON_COLS){const name=String(t[col]||'').trim();if(name)out.push({templeNo:String(t['寺籍番号']||''),district:t['教区']||'',temple:t['寺院名']||'',templeReading:t['フリガナ']||'',role:roleFromCol(col),name})}
  }
  for(const p of state.addedDirectory.people||[])out.push({templeNo:String(p.templeNo||''),district:p.district||'',temple:p.temple||'',templeReading:templeReadingByPerson(p),role:p.role||'',name:p.name||''});
  for(const r of state.records)if(r.name)out.push({templeNo:r.templeNo||'',district:r.district||'',temple:r.temple||'',templeReading:templeReadingForRecord(r),role:r.role||'',name:r.name||''});
  const seen=new Set();return out.filter(p=>{const k=personRuleKey(p);if(!p.name||seen.has(k))return false;seen.add(k);return true})
}
function rulePeopleMatches(q){const n=norm(q);if(!n)return[];return rulePeople().filter(p=>[p.name,p.temple,p.templeReading,p.role,p.district].map(norm).some(v=>v.startsWith(n))).slice(0,40)}
function blankRecord(kind='本人', parent=null){return {no:null,id: kind==='本人'?nextParentId():nextChildId(parent?.id),parentId:parent?.id||'',kind,carrierId:parent?.id||'',office:'第1宗務所',district:'',templeNo:'',temple:'',role:'',name:'',assignment:'',note:'',money:blankMoney()}}
function parentNum(id){const m=/^P(\d{3,})$/.exec(id||'');return m?Number(m[1]):0}
function nextParentId(){let m=0;state.records.forEach(r=>{if(!r.parentId)m=Math.max(m,parentNum(r.id))});if(state.draft&&!state.draft.parentId)m=Math.max(m,parentNum(state.draft.id));return 'P'+String(m+1).padStart(3,'0')}
function nextChildId(parentId){let m=0;state.records.forEach(r=>{const q=new RegExp('^'+parentId+'-(\\d+)$').exec(r.id||'');if(q)m=Math.max(m,Number(q[1]))});return parentId+'-'+String(m+1).padStart(2,'0')}
function sum(keys,r){return keys.reduce((a,k)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0)}
function isUnannounced(r){return r?.assignment==='未案内'}
function guidedExpenseKey(base,r){return `${base}（${isUnannounced(r)?'未案内':'案内有'}）`}
function syncGuidedExpenseColumns(r){
  if(!r?.money)return;
  for(const base of ['本葬謝誼','本葬回心']){
    const target=guidedExpenseKey(base,r);
    const other=`${base}（${isUnannounced(r)?'案内有':'未案内'}）`;
    const tv=r.money[target], ov=r.money[other];
    if(ov!==null&&ov!==undefined&&ov!==''){
      if(tv===null||tv===undefined||tv==='')r.money[target]=ov;
      // 新仕様では案内/未案内は配役で一意に決まるため、反対側は空欄に戻す。
      r.money[other]=null;
    }
  }
}
function displayPerson(r){return [r.district,r.temple,r.name,r.role,r.assignment].filter(Boolean).join(' / ')}
function templeReadingForRecord(r){
  const all=[...state.fixedTemples,...state.addedDirectory.temples];
  const t=all.find(x=>(r.templeNo&&String(x['寺籍番号'])===String(r.templeNo))||(!r.templeNo&&x['寺院名']===r.temple&&x['教区']===r.district));
  return t?.['フリガナ']||'';
}
function recordSearchText(r){
  return [r.id,r.parentId,r.name,r.temple,templeReadingForRecord(r),r.role,r.assignment,r.district,r.kind].join(' ');
}
function recordSearchFields(r){
  return [r.id,r.parentId,r.name,r.temple,templeReadingForRecord(r),r.role,r.assignment,r.district,r.kind].map(norm).filter(Boolean);
}
function recordMatchesPrefix(r,query){
  const q=norm(query);
  return !q || recordSearchFields(r).some(v=>v.startsWith(q));
}
function scrollPageTop(){
  const go=()=>{window.scrollTo(0,0);const se=document.scrollingElement;if(se)se.scrollTop=0;document.documentElement.scrollTop=0;document.body.scrollTop=0};
  go();
  requestAnimationFrame(()=>{go();requestAnimationFrame(go)});
  setTimeout(go,80);
}

// IndexedDB
const DB='templeReceptionApp', STORE='kv';
function db(){return new Promise((res,rej)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbGet(k){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(STORE,'readonly').objectStore(STORE).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbSet(k,v){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(STORE,'readwrite').objectStore(STORE).put(v,k);q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}
function autoSave(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{await dbSet('workspace',{records:state.records,draft:state.draft,baseName:state.baseName,sourceLoaded:state.sourceLoaded,deleted:state.deleted,search:state.search,filters:state.filters,tableView:state.tableView,rules:ensureRules(),cashControl:ensureCashControl(),updatedAt:new Date().toISOString()});await dbSet('addedDirectory',state.addedDirectory)},250)}

function toast(msg){let t=$('.toast');if(t)t.remove();t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),2200)}
function top(title, sub=''){return `<div class="topbar"><button class="btn small ghost" id="homeBtn" style="color:#fff;border-color:#698096">⌂</button><h1>${esc(title)}</h1><div class="small">v${APP_VERSION}${sub?` ・ ${esc(sub)}`:''}</div></div>`}
function shell(x){return `<div class="shell">${x}</div>`}
function navHome(){state.screen='home';state.editId=null;state.draft=null;state.returnScreen=null;render();autoSave()}
function formBackMarkup(){if(!state.returnScreen)return '';const label=state.returnScreen==='table'?'← 表一覧へ戻る':state.returnScreen==='search'?'← 検索結果へ戻る':'← トップへ戻る';return `<div style="margin-bottom:10px"><button class="btn small" id="backToSource">${label}</button></div>`}
function backToSource(){const dest=state.returnScreen||'home';state.draft=null;state.editId=null;state.returnScreen=null;state.screen=dest;render();autoSave()}
function bindHome(){const b=$('#homeBtn');if(b)b.onclick=()=>navHome()}

function render(){
  const app=$('#app');
  if(state.screen==='home') app.innerHTML=top('本葬受付台帳',state.sourceLoaded?'Excel読込済み':'作業中')+shell(homeView());
  if(state.screen==='form') app.innerHTML=top(state.editId?'受付を修正':'新規入力')+shell(formView())+modeBar();
  if(state.screen==='search') app.innerHTML=top('検索・修正')+shell(searchView());
  if(state.screen==='table') app.innerHTML=top('表一覧')+shell(tableView());
  if(state.screen==='settings') app.innerHTML=top('設定・バックアップ')+shell(settingsView());
  if(state.screen==='deleted') app.innerHTML=top('削除履歴')+shell(deletedView());
  if(state.screen==='rules') app.innerHTML=top('回心・本葬謝誼ルール')+shell(rulesView());
  if(state.screen==='cash') app.innerHTML=top('現金照合・締め')+shell(cashView());
  bindHome();bindCurrent();
}

function homeView(){return `
<div class="card"><div class="row"><div class="grow"><label>保存時の基本ファイル名</label><input id="baseName" class="field" value="${esc(state.baseName)}"></div><button class="btn" id="openExcel">Excelを開く</button><input id="fileExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="muted" style="margin-top:8px">保存時は自動で _MMDD_HHMM.xlsx を付けます。元ファイルは上書きしません。</div></div>
<div class="menu"><button class="btn primary" data-go="new">＋ 新規入力</button><button class="btn" data-go="search">検索・修正</button><button class="btn" data-go="table">表一覧</button><button class="btn" data-go="cash">現金照合・締め</button><button class="btn income" data-go="save">Excel保存</button></div>
<div class="card" style="margin-top:14px"><div class="row"><div class="grow"><strong>${state.records.length}件</strong> を作業中</div><span class="muted">自動退避：IndexedDB</span></div></div>
<div class="grid2"><button class="btn" data-go="settings">追加名簿・設定</button><button class="btn" data-go="deleted">削除履歴 (${state.deleted.length})</button></div>`}

function personHeader(r){const p=r.parentId?state.records.find(x=>x.id===r.parentId):null;return `<div class="person-head"><div class="row"><div class="grow"><strong>${esc(r.id)} ${esc(r.name||'氏名未入力')}</strong><div class="muted">${esc([r.district,r.temple,r.role,r.assignment].filter(Boolean).join(' / '))}</div></div><span class="pill ${r.kind==='預かり'?'child':''}">${esc(r.kind)}</span></div>${r.kind==='預かり'?`<div class="muted">持参者：${esc(p?.name||r.carrierId)}</div>`:''}</div>`}
function districtButtons(r){return `<div class="chips">${[1,2,3,4,5,6,7,8].map(n=>{const d=`第${n}教区`;return `<button class="chip ${r.district===d?'selected':''}" data-district="${d}">${d}</button>`}).join('')}<button class="chip ${!r.district?'selected':''}" data-district="">未指定</button></div>`}
function roleButtons(r){return `<div class="chips">${ROLE_BUTTONS.map(x=>`<button class="chip ${r.role===x?'selected':''}" data-role="${x}">${x}</button>`).join('')}</div>`}
function roleSelect(r){const opts=[];Object.entries(window.FUNERAL_ROLE_GROUPS||{}).forEach(([g,arr])=>{opts.push(`<optgroup label="${esc(g)}">`+arr.map(x=>`<option ${r.assignment===x?'selected':''}>${esc(x)}</option>`).join('')+'</optgroup>')});return `<select id="assignmentSelect" class="field"><option value="">配役を選択</option>${opts.join('')}<option value="未案内" ${r.assignment==='未案内'?'selected':''}>未案内</option><option value="__manual__">手入力</option></select>`}
function templeCandidates(r,q=''){const query=norm(q);let all=[...state.fixedTemples,...state.addedDirectory.temples];let list=all.filter(t=>(!r.district||t['教区']===r.district));if(query)list=list.filter(t=>norm(t['寺院名']).startsWith(query)||norm(t['フリガナ']).startsWith(query));return list.slice(0,30)}
function templeSuggestionsMarkup(r,q=''){const candidates=templeCandidates(r,q);return {candidates,html:candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}}
function bindTempleSuggestionButtons(){const r=state.draft;$$('[data-temple-no]').forEach(b=>b.onclick=()=>{const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>String(x['寺籍番号'])===b.dataset.templeNo);if(t){r.office=t['宗務所']||'第1宗務所';r.district=t['教区']||r.district;r.templeNo=String(t['寺籍番号']||'');r.temple=t['寺院名']||'';r._templeQuery=r.temple;autoSave();render()}})}
function updateTempleSuggestions(){const r=state.draft,box=$('#templeSuggestions');if(!r||!box)return;const {candidates,html}=templeSuggestionsMarkup(r,r._templeQuery??r.temple);box.innerHTML=html;box.classList.toggle('hidden',!candidates.length);bindTempleSuggestionButtons()}
function peopleForTemple(r){let out=[];const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>(r.templeNo&&x['寺籍番号']===r.templeNo)||(!r.templeNo&&x['寺院名']===r.temple&&x['教区']===r.district));if(t)PERSON_COLS.forEach(c=>{if(t[c])out.push({role:roleFromCol(c),name:t[c]})});state.addedDirectory.people.filter(p=>(r.templeNo&&p.templeNo===r.templeNo)||(!r.templeNo&&p.temple===r.temple&&p.district===r.district)).forEach(p=>out.push({role:p.role,name:p.name}));const seen=new Set();return out.filter(p=>{const k=norm(p.role+'|'+p.name);if(seen.has(k))return false;seen.add(k);return true})}

function formView(){const r=state.draft; if(!r)return '<div class="card error">入力データがありません。</div>';
const candidates=templeCandidates(r,r._templeQuery??r.temple);const people=peopleForTemple(r);
return `${formBackMarkup()}${state.editId?`<div class="edit-banner">編集モード：既存データを読み込んでいます</div>`:''}${r.kind==='預かり'?`<div class="parent-banner">預かり入力　持参者：${esc((state.records.find(x=>x.id===r.parentId)||{}).name||r.carrierId)}</div>`:''}${personHeader(r)}
${state.editId&&r.kind==='本人'?`<div class="card"><button class="btn wide" id="addDepositTop">＋ 預かりを追加</button></div>`:''}
${r.kind==='預かり'?(()=>{const p=state.records.find(x=>x.id===r.parentId);return p?.temple?`<div class="card parent-temple-suggest"><div class="muted" style="margin-bottom:7px">親と同じ寺号を使う場合</div><button class="btn wide" id="useParentTemple">${esc(p.temple)} を使う</button></div>`:''})():''}
<div class="card"><div class="section-title">① 教区</div>${districtButtons(r)}
<div class="section-title">② 寺号</div><input id="templeSearch" class="field field-lg" placeholder="漢字・ひらがな・カタカナ" value="${esc(r._templeQuery??r.temple)}"><div id="templeSuggestions" class="suggestions ${candidates.length?'':'hidden'}">${candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}</div><button class="btn small" id="useManualTemple" style="margin-top:8px">この寺号をそのまま使用</button>
<div class="section-title">③ 役職</div>${roleButtons(r)}<div style="margin-top:8px"><input id="roleManual" class="field" placeholder="役職を手入力" value="${ROLE_BUTTONS.includes(r.role)?'':esc(r.role)}"></div>
${people.length?`<div class="section-title">名簿登録人物</div><div class="grid2">${people.map((p,i)=>`<button class="btn" data-person-index="${i}">${esc(p.role)}　${esc(p.name)}</button>`).join('')}</div>`:''}
<div class="section-title">④ 氏名 <span style="color:#b42318">※必須</span></div><input id="nameField" class="field field-lg" value="${esc(r.name)}" placeholder="例：山田 太郎">
<div id="candidateAction" class="hidden notice" style="margin-top:10px"><div style="font-weight:800;margin-bottom:8px">名簿候補にない入力です</div><div class="row"><button class="btn small" id="addCandidate">今後の候補に追加</button><button class="btn small" id="onceCandidate">今回だけ使用</button></div></div>
<div class="section-title">⑤ 配役</div>${roleSelect(r)}<input id="assignmentManual" class="field ${r.assignment&&![].concat(...Object.values(window.FUNERAL_ROLE_GROUPS||{}),'未案内').includes(r.assignment)?'':'hidden'}" style="margin-top:8px" placeholder="例：尊宿兼先導師" value="${esc(r.assignment)}">
<div class="section-title">備考</div><textarea id="noteField" class="field" rows="2">${esc(r.note)}</textarea></div>
${moneyPanel(r)}
<div class="card"><div class="grid2">${r.kind==='本人'&&!state.editId?'<button class="btn" id="addDeposit">＋ 預かりを追加</button>':''}<button class="btn primary" id="commitRecord">${state.editId?'更新':'登録'}</button></div>${state.editId?'<button class="btn danger wide" id="deleteRecord" style="margin-top:10px">削除</button>':''}</div>`}

function moneyPanel(r){const isI=state.mode==='income';
if(isI){
  const groups=[['密葬',['密葬香資','密葬供花','密葬供物']],['本葬',['本葬香資','本葬供花料','本葬供物料']]];
  return `<div class="card income-panel"><h3 style="color:var(--income)">収入入力</h3>${groups.map(([g,items])=>`<div class="section-title">${g}</div>${items.map(item=>moneyRow(r,item)).join('')}`).join('')}<div class="offering-print-area"><button class="btn wide offering-print-btn" id="offeringPrint">御供札プリント</button><div class="muted" style="margin-top:6px">現在の寺号・役職・氏名から札PDFを作成します</div></div><div class="section-title">その他</div>${['問候','献香'].map(item=>moneyRow(r,item)).join('')}<div class="sticky-summary"><span>収入小計</span><span class="amount">${fmt(sum(INCOME,r))} 円</span></div></div>`;
}
const groups=[['密葬',['密葬謝誼']],['中陰',['密葬回心','中陰謝誼']],['本葬前',['本葬謝誼']],['本葬',['本葬回心']],['その他',['路資','菓誼','内謝']]];
return `<div class="card expense-panel"><h3 style="color:var(--expense)">支出入力</h3>${groups.map(([g,items])=>`<div class="section-title">${g}</div>${items.map(item=>moneyRow(r,item)).join('')}`).join('')}<div class="sticky-summary"><span>支出小計</span><span class="amount">${fmt(sum(EXPENSE,r))} 円</span></div></div>`}
function moneyRow(r,item){let key=item;if(item==='本葬謝誼'||item==='本葬回心')key=guidedExpenseKey(item,r);
return `<div class="money-item"><div><strong>${esc(item)}</strong></div><button class="money-btn ${r.money[key]!==null?'filled':''}" data-money="${esc(key)}">${r.money[key]===null?'＋入力':fmt(r.money[key])+' 円'}</button></div>`}
function modeBar(){return `<div class="modebar"><button class="btn ${state.mode==='income'?'income':''}" data-mode="income">収入</button><button class="btn ${state.mode==='expense'?'expense':''}" data-mode="expense">支出</button></div>`}

function searchResultsMarkup(){const list=state.records.filter(r=>recordMatchesPrefix(r,state.search));return list.map(r=>`<button class="search-result ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}" style="width:100%;text-align:left"><div class="row"><div class="grow"><div class="title">${esc(r.id)}　${esc(r.name||'氏名なし')}</div><div class="meta">${esc([r.district,r.temple,r.role,r.assignment].filter(Boolean).join(' / '))}</div></div><span class="pill ${r.kind==='預かり'?'child':''}">${esc(r.kind)}</span></div></button>`).join('')||'<div class="card muted">該当データなし</div>'}
function searchView(){return `<div class="card"><label>氏名・寺号・役職・配役・IDから検索</label><input id="recordSearch" class="field field-lg" value="${esc(state.search)}" placeholder="例：山田 / 光明寺 / 尊宿"></div><div id="recordSearchResults">${searchResultsMarkup()}</div>`}

function tableView(){return `<div class="card"><div class="row"><div class="grow"><strong>回心・本葬謝誼ルール</strong><div class="muted">教区・個人・配役のルールを編集し、必要な時に一斉入力します。</div></div><button class="btn" id="openRules">ルール編集</button></div></div><div class="card"><div class="split"><div><label>検索</label><input id="tableSearch" class="field" value="${esc(state.search)}" placeholder="氏名・寺号・役職など"></div><div><label>教区</label><select id="tableDistrict" class="field"><option value="">すべて</option>${[1,2,3,4,5,6,7,8].map(n=>`<option ${state.filters.district===`第${n}教区`?'selected':''}>第${n}教区</option>`).join('')}</select></div><div><label>受付区分</label><select id="tableKind" class="field"><option value="">すべて</option><option ${state.filters.kind==='本人'?'selected':''}>本人</option><option ${state.filters.kind==='預かり'?'selected':''}>預かり</option></select></div><div><label>案内区分</label><select id="tableGuide" class="field"><option value="">すべて</option><option value="案内寺院" ${state.filters.guide==='案内寺院'?'selected':''}>案内寺院</option><option value="未案内寺院" ${state.filters.guide==='未案内寺院'?'selected':''}>未案内随喜寺院</option></select></div></div><div class="row" style="margin-top:12px"><span class="muted">表示列</span><button class="btn small ${state.tableView==='normal'?'selected':''}" data-table-view="normal">通常表示</button><button class="btn small ${state.tableView==='full'?'selected':''}" data-table-view="full">全列表示</button>${Object.keys(state.filters.columns||{}).length?`<span class="pill cash-warn">列フィルタ ${Object.keys(state.filters.columns).length}件</span><button class="btn small" id="clearColumnFilters">解除</button>`:''}</div></div><div id="tableResults">${tableMarkup(filteredRecords())}</div>`}
function filteredRecords(){return state.records.filter(r=>{const textOk=recordMatchesPrefix(r,state.search);const districtOk=!state.filters.district||r.district===state.filters.district;const kindOk=!state.filters.kind||r.kind===state.filters.kind;const guideOk=!state.filters.guide||(state.filters.guide==='未案内寺院'?r.assignment==='未案内':state.filters.guide==='案内寺院'?!!r.assignment&&r.assignment!=='未案内':true);const cols=state.filters.columns||{};const colOk=Object.entries(cols).every(([k,v])=>{if(!v)return true;const val=r.money?.[k];const has=val!==null&&val!==undefined&&val!=='';return v==='filled'?has:!has});return textOk&&districtOk&&kindOk&&guideOk&&colOk})}
function actualNo(r){const i=state.records.findIndex(x=>x.id===r.id);return i>=0?i+1:''}
function subtotalForRows(rows){
  const money={};[...INCOME,...EXPENSE].forEach(k=>money[k]=rows.reduce((a,r)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0));
  return {money,incomeTotal:INCOME.reduce((a,k)=>a+money[k],0),expenseTotal:EXPENSE.reduce((a,k)=>a+money[k],0)};
}
function tableMarkup(rows){if(state.tableView==='full')return fullTableMarkup(rows);return normalTableMarkup(rows)}
function normalTableMarkup(rows){const sub=subtotalForRows(rows);return `<div class="table-wrap table-normal" id="tableWrap"><table><thead><tr>${['No.','ID','区分','教区','寺号','役職','氏名','配役','収入小計','支出小計','親ID','持参者ID'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="clickable ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}"><td>${actualNo(r)}</td><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.district)}</td><td>${esc(r.temple)}</td><td>${esc(r.role)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.assignment)}</td><td>${fmt(sum(INCOME,r))}</td><td>${fmt(sum(EXPENSE,r))}</td><td>${esc(r.parentId)}</td><td>${esc(r.carrierId)}</td></tr>`).join('')}</tbody><tfoot><tr class="subtotal-row"><td></td><td></td><td></td><td></td><td></td><td></td><td><strong>小計</strong></td><td></td><td>${fmt(sub.incomeTotal)}</td><td>${fmt(sub.expenseTotal)}</td><td></td><td></td></tr></tfoot></table></div>`}
function fullTableColClass(h){if(h==='プラス小計')return 'income-subtotal';if(h==='マイナス小計')return 'expense-subtotal';if(INCOME.includes(h))return 'income-col';if(EXPENSE.includes(h))return 'expense-col';return ''}
function fullTableMarkup(rows){const moneyHeaders=new Set([...INCOME,'プラス小計',...EXPENSE,'マイナス小計']);const filterable=new Set([...INCOME,...EXPENSE]);const fixed=['No.','寺号','氏名'];const displayHeaders=[...fixed,...APP_HEADERS.filter(h=>!fixed.includes(h))];const totalWidth=displayHeaders.reduce((a,h)=>a+fullColWidth(h),0);const sub=subtotalForRows(rows);const subtotalRow={'氏名':'小計'};INCOME.forEach(k=>subtotalRow[k]=sub.money[k]);subtotalRow['プラス小計']=sub.incomeTotal;EXPENSE.forEach(k=>subtotalRow[k]=sub.money[k]);subtotalRow['マイナス小計']=sub.expenseTotal;return `<div class="table-wrap table-full" id="tableWrap"><table style="width:${totalWidth}px;min-width:${totalWidth}px"><colgroup>${displayHeaders.map(h=>`<col style="width:${fullColWidth(h)}px">`).join('')}</colgroup><thead><tr>${displayHeaders.map(x=>{const active=state.filters.columns?.[x];return `<th class="${fullTableColClass(x)} ${active?'column-filter-active':''}" ${filterable.has(x)?`data-column-filter="${esc(x)}"`:''}>${esc(x)}${filterable.has(x)?` <span class="filter-mark">${active==='filled'?'●':active==='empty'?'○':'▾'}</span>`:''}</th>`}).join('')}</tr></thead><tbody>${rows.map(r=>{const row=rowFromRecord(r,actualNo(r));return `<tr class="clickable ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}">${displayHeaders.map(h=>{const v=row[h];const shown=moneyHeaders.has(h)&&v!==''?fmt(v):v;return `<td class="${fullTableColClass(h)}" title="${esc(shown)}">${h==='氏名'?`<strong>${esc(shown)}</strong>`:esc(shown)}</td>`}).join('')}</tr>`}).join('')}</tbody><tfoot><tr class="subtotal-row">${displayHeaders.map(h=>{const v=subtotalRow[h]??'';const shown=moneyHeaders.has(h)?fmt(v):v;return `<td class="${fullTableColClass(h)}" title="${esc(shown)}">${h==='氏名'?`<strong>${esc(shown)}</strong>`:esc(shown)}</td>`}).join('')}</tr></tfoot></table></div>`}
function openColumnFilter(item){const current=state.filters.columns?.[item]||'';const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h3>${esc(item)} のフィルタ</h3><div class="muted" style="margin-bottom:12px">この列が入力済みか未入力かで表を絞り込みます。</div><div class="grid2"><button class="btn ${current==='filled'?'selected':''}" data-col-choice="filled">入力あり</button><button class="btn ${current==='empty'?'selected':''}" data-col-choice="empty">入力なし</button></div><button class="btn wide" data-col-choice="" style="margin-top:10px">この列のフィルタを解除</button><button class="btn wide ghost" id="colFilterClose" style="margin-top:10px">閉じる</button></div>`;document.body.append(back);$$('[data-col-choice]',back).forEach(b=>b.onclick=()=>{state.filters.columns=state.filters.columns||{};if(b.dataset.colChoice)state.filters.columns[item]=b.dataset.colChoice;else delete state.filters.columns[item];back.remove();state.tableScroll={top:0,left:state.tableScroll?.left||0};refreshTableResults();autoSave()});$('#colFilterClose',back).onclick=()=>back.remove()}

function rulesView(){
  const rules=ensureRules();const roles=allAssignments();const q=state.rulePersonSearch||'';const matches=rulePeopleMatches(q);
  return `<div class="card"><div class="row"><button class="btn" id="rulesBack">← 表一覧へ戻る</button><div class="grow"></div><button class="btn" id="rulesExport">ルールJSONを書き出す</button><button class="btn" id="rulesImport">ルールJSONを読み込む</button><input id="rulesFile" type="file" accept=".json" class="hidden"></div></div>
  <div class="card"><h3>回心ルール</h3><div class="muted">密葬回心・本葬回心の両方に適用します。全返し ＞ 回心なし教区 ＞ 通常回心 の順で優先します。</div>
    <div class="rule-block"><label>通常回心：香資としていただく上限（ライン）</label><div class="row"><input id="kaishinLine" class="field rule-money" inputmode="numeric" type="number" min="0" step="1000" value="${rules.kaishinLine??''}" placeholder="例：10000"><span>円</span></div><div class="muted">例：10,000円に設定し、20,000円の香資を受けた場合は回心10,000円。</div></div>
    <div class="rule-block"><label>回心なし教区</label><div class="chips">${[1,2,3,4,5,6,7,8].map(n=>{const d=`第${n}教区`;return `<label class="rule-check"><input type="checkbox" data-no-return="${d}" ${rules.noReturnDistricts.includes(d)?'checked':''}> ${d}</label>`}).join('')}</div><div class="muted">選択した教区は香資を全額いただき、回心は0円になります。未選択の教区には通常回心ルールを適用します。</div></div>
    <div class="rule-block"><label>回心（全返し）対象者</label><input id="fullReturnSearch" class="field" value="${esc(q)}" placeholder="寺号・寺号よみ・氏名・役職から検索"><div id="fullReturnResults">${fullReturnResultsMarkup(matches)}</div><div class="rule-selected">${rules.fullReturnPeople.map((p,i)=>`<div class="rule-person"><div><strong>${esc(p.temple)}　${esc(p.name)}</strong><div class="muted">${esc([p.district,p.role].filter(Boolean).join(' / '))}</div></div><button class="btn small danger" data-remove-full="${i}">削除</button></div>`).join('')||'<div class="muted">全返し対象者は未設定です。</div>'}</div></div>
  </div>
  <div class="card"><h3>本葬謝誼ルール</h3><div class="muted">配役と金額を紐付けます。受付フォームでは通常どおり個別修正も可能です。</div>
    <div class="rule-block"><label>一律金額を全配役にセット</label><div class="row"><input id="honorariumAll" class="field rule-money" inputmode="numeric" type="number" min="0" step="1000" placeholder="例：30000"><span>円</span><button class="btn" id="setHonorariumAll">全配役にセット</button></div></div>
    <div class="rule-role-grid">${roles.map(role=>`<label class="rule-role"><span>${esc(role)}</span><div><input class="field" data-honorarium="${esc(role)}" inputmode="numeric" type="number" min="0" step="1000" value="${rules.honorarium[role]??''}" placeholder="未設定"><span>円</span></div></label>`).join('')}</div>
  </div>
  <div class="card rule-apply-card"><h3>ルールを台帳へ一斉入力</h3><div class="muted">回心は香資額・教区・全返し指定から計算し、本葬謝誼は配役ルールから入力します。2回目以降は既存値を上書きする前に確認します。</div><button class="btn primary wide" id="applyRules" style="margin-top:12px">ルールに基づき一斉自動入力</button>${rules.appliedCount?`<div class="muted" style="margin-top:8px">この作業データには ${rules.appliedCount} 回、一斉入力を実行済みです。</div>`:''}</div>`
}
function fullReturnResultsMarkup(matches){if(!state.rulePersonSearch)return'';return `<div class="suggestions">${matches.map((p,i)=>`<button class="suggestion" data-add-full="${i}"><span><strong>${esc(p.temple)}　${esc(p.name)}</strong><span class="sub">${esc([p.district,p.role].filter(Boolean).join(' / '))}</span></span><span>追加</span></button>`).join('')||'<div class="suggestion muted">該当者なし</div>'}</div>`}
function calculateKaishin(r,incense){if(incense===null||incense===undefined||incense==='')return null;const amount=Number(incense)||0;const rules=ensureRules();if(isFullReturnPerson(r))return amount;if(rules.noReturnDistricts.includes(r.district))return 0;const line=rules.kaishinLine;if(line===null||line===undefined||line==='')return null;return Math.max(0,amount-(Number(line)||0))}
function applyRulesToRecords(){
  const rules=ensureRules();let kaishinCount=0,shagiCount=0;
  for(const r of state.records){
    const mKaishin=calculateKaishin(r,r.money['密葬香資']);r.money['密葬回心']=mKaishin;if(mKaishin!==null)kaishinCount++;
    const hKaishin=calculateKaishin(r,r.money['本葬香資']);const hk=guidedExpenseKey('本葬回心',r);const hkOther=`本葬回心（${isUnannounced(r)?'案内有':'未案内'}）`;r.money[hk]=hKaishin;r.money[hkOther]=null;if(hKaishin!==null)kaishinCount++;
    const sk=guidedExpenseKey('本葬謝誼',r);const skOther=`本葬謝誼（${isUnannounced(r)?'案内有':'未案内'}）`;const hv=Object.prototype.hasOwnProperty.call(rules.honorarium,r.assignment)&&rules.honorarium[r.assignment]!==''&&rules.honorarium[r.assignment]!==null?Number(rules.honorarium[r.assignment]):null;r.money[sk]=Number.isFinite(hv)?hv:null;r.money[skOther]=null;if(r.money[sk]!==null)shagiCount++;
  }
  rules.appliedCount++;autoSave();return {kaishinCount,shagiCount}
}
function bindRules(){
  ensureRules();const back=$('#rulesBack');if(back)back.onclick=()=>{state.screen='table';state.rulePersonSearch='';render();autoSave()};
  const line=$('#kaishinLine');if(line)line.oninput=()=>{state.rules.kaishinLine=line.value===''?null:Number(line.value);autoSave()};
  $$('[data-no-return]').forEach(c=>c.onchange=()=>{const d=c.dataset.noReturn;const set=new Set(state.rules.noReturnDistricts);c.checked?set.add(d):set.delete(d);state.rules.noReturnDistricts=[...set];autoSave()});
  const search=$('#fullReturnSearch');if(search)search.oninput=()=>{state.rulePersonSearch=search.value;const box=$('#fullReturnResults');if(box){box.innerHTML=fullReturnResultsMarkup(rulePeopleMatches(search.value));bindFullReturnAdd(box)}};
  bindFullReturnAdd(document);$$('[data-remove-full]').forEach(b=>b.onclick=()=>{state.rules.fullReturnPeople.splice(Number(b.dataset.removeFull),1);autoSave();render()});
  $$('[data-honorarium]').forEach(inp=>inp.oninput=()=>{state.rules.honorarium[inp.dataset.honorarium]=inp.value===''?null:Number(inp.value);autoSave()});
  const all=$('#setHonorariumAll');if(all)all.onclick=()=>{const v=$('#honorariumAll')?.value;if(v===undefined||v===''){toast('一律金額を入力してください');return}const n=Number(v);allAssignments().forEach(role=>state.rules.honorarium[role]=n);autoSave();render();toast('全配役に一律金額をセットしました')};
  const apply=$('#applyRules');if(apply)apply.onclick=()=>{if(state.rules.appliedCount>0&&!confirm('すでに回心・本葬謝誼が入力されています。\n\n現在のルールで再計算し、一括で上書きしますか？'))return;const x=applyRulesToRecords();render();toast(`一斉入力しました（回心 ${x.kaishinCount}件 / 本葬謝誼 ${x.shagiCount}件）`)};
  const ex=$('#rulesExport');if(ex)ex.onclick=backupRules;const im=$('#rulesImport'),file=$('#rulesFile');if(im&&file){im.onclick=()=>file.click();file.onchange=e=>restoreRules(e.target.files[0])}
}
function bindFullReturnAdd(root){$$('[data-add-full]',root).forEach(b=>b.onclick=()=>{const p=rulePeopleMatches(state.rulePersonSearch)[Number(b.dataset.addFull)];if(!p)return;if(!state.rules.fullReturnPeople.some(x=>personRuleKey(x)===personRuleKey(p)))state.rules.fullReturnPeople.push({...p});state.rulePersonSearch='';autoSave();render();toast('全返し対象に追加しました')})}
function backupRules(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),rules:ensureRules()},null,2)],{type:'application/json'});downloadBlob(blob,'回心謝誼ルール_'+stamp()+'.json')}
function restoreRules(file){if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);const x=j.rules||j;if(!x||typeof x!=='object')throw new Error('ルールデータがありません');state.rules={...defaultRules(),...x,appliedCount:0};ensureRules();autoSave();render();toast('ルールを読み込みました')}catch(e){alert('ルールJSONを読み込めませんでした。\n'+e.message)}};fr.readAsText(file)}

function settingsView(){return `<div class="card"><h3>追加名簿</h3><p class="muted">追加寺院 ${state.addedDirectory.temples.length}件 / 追加人物 ${state.addedDirectory.people.length}件</p><div class="grid2"><button class="btn" id="backupDir">追加名簿JSONを書き出す</button><button class="btn" id="restoreDir">追加名簿JSONを読み込む</button></div><input id="dirFile" type="file" accept=".json" class="hidden"></div><div class="card"><h3>第1宗務所名簿</h3><p class="muted">アプリ内蔵：${state.fixedTemples.length}寺院。後から人物名を追記した最新版Excelを読み直すこともできます。</p><button class="btn" id="reloadDirectory">第1宗務所名簿.xlsx を読み込む</button><input id="directoryExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="card"><h3>作業状態</h3><button class="btn danger" id="clearWorkspace">作業データを全消去</button></div>`}
function deletedView(){return `<div class="card"><div class="muted">削除履歴はこの端末のIndexedDBに残します。</div></div>${state.deleted.map((d,i)=>`<div class="search-result"><div class="row"><div class="grow"><div class="title">${esc(d.record.id)}　${esc(d.record.name)}</div><div class="meta">削除：${esc(new Date(d.deletedAt).toLocaleString('ja-JP'))} / ${esc([d.record.district,d.record.temple,d.record.role].filter(Boolean).join(' / '))}</div></div><button class="btn small" data-restore="${i}">復元</button></div></div>`).join('')||'<div class="card muted">削除履歴はありません。</div>'}`}

function cashView(){const c=ensureCashControl(),ua=unallocatedCash();const blockCards=['A','B','C','D','E'].map(id=>{const b=c.blocks[id],x=cashBlockCalc(id),changed=blockChangedSinceClose(id);return `<div class="cash-block"><div class="row"><div class="grow"><strong>${esc(b.name)}</strong><div class="muted">${esc(b.items.join(' / ')||'科目なし')}</div></div>${b.closed?`<span class="pill ${changed?'cash-warn':''}">${changed?'締め後変更あり':'締め済'}</span>`:'<span class="pill">未締め</span>'}</div><div class="cash-grid"><div><label>用意資金</label><input class="field" type="number" step="10000" data-block-allocated="${id}" value="${b.allocated??''}" placeholder="0"></div><div><label>帳簿上支出</label><div class="cash-readonly">${fmt(x.ledger)} 円</div></div><div><label>理論残金</label><div class="cash-readonly">${x.theoretical===null?'—':fmt(x.theoretical)+' 円'}</div></div><div><label>実査残金</label><input class="field" type="number" step="10000" data-block-actual="${id}" value="${b.actualRemaining??''}" placeholder="実際に数えた残金"></div><div><label>差額（実査−理論）</label><div class="cash-readonly ${x.diff===0?'cash-ok':x.diff===null?'':'cash-bad'}">${x.diff===null?'—':(x.diff>0?'+':'')+fmt(x.diff)+' 円'}</div></div></div><div class="row" style="margin-top:10px"><button class="btn small" data-close-block="${id}">${b.closed?'再締め':'このブロックを締める'}</button>${b.closed?`<span class="muted">${esc(new Date(b.closed.at).toLocaleString('ja-JP'))} / 締め時差額 ${fmt(b.closed.diff)}円</span>`:''}</div></div>`}).join('');const incomeRows=INCOME.map(item=>{const ledger=incomeLedger(item),actual=c.incomeActual[item],diff=actual===null||actual===''?null:(Number(actual)||0)-ledger;return `<tr><td><strong>${esc(item)}</strong></td><td class="num">${fmt(ledger)}円</td><td><input class="field cash-income-input" type="number" step="10000" data-income-actual="${esc(item)}" value="${actual??''}" placeholder="実査現金"></td><td class="num ${diff===0?'cash-ok':diff===null?'':'cash-bad'}">${diff===null?'—':(diff>0?'+':'')+fmt(diff)+'円'}</td></tr>`}).join('');return `<div class="card"><h3>初期資金の配分</h3><div class="split"><div><label>総初期資金</label><input id="totalInitialCash" class="field field-lg" type="number" step="10000" value="${c.totalInitial??''}" placeholder="例：15000000"></div><div><label>現在の配分合計</label><div class="cash-readonly big">${fmt(totalAllocated())} 円</div></div><div><label>未配分</label><div class="cash-readonly big ${ua===0?'cash-ok':ua===null?'':'cash-bad'}">${ua===null?'—':(ua>0?'+':'')+fmt(ua)+' 円'}</div></div></div><div class="muted" style="margin-top:8px">総初期資金とA〜Eへの配分が一致すると未配分が0円になります。</div></div><div class="card"><h3>支出ブロック設定</h3><div class="muted">初期設定はシミュレーター準拠。菓誼・内謝はEです。科目の所属先は変更できます。</div><div class="cash-assign-grid">${EXPENSE.map(item=>`<label class="cash-assign"><span>${esc(item)}</span><select class="field" data-expense-block="${esc(item)}">${['A','B','C','D','E'].map(id=>`<option value="${id}" ${expenseBlockForItem(item)===id?'selected':''}>${esc(c.blocks[id].name)}</option>`).join('')}</select></label>`).join('')}</div></div><div class="card"><h3>支出ブロック照合</h3>${blockCards}</div><div class="card"><h3>収入科目照合</h3><div class="muted" style="margin-bottom:10px">帳簿の科目別小計と、実際に数えた現金を比較します。</div><div class="table-wrap cash-table"><table><thead><tr><th>科目</th><th>帳簿合計</th><th>実査現金</th><th>差額（実査−帳簿）</th></tr></thead><tbody>${incomeRows}</tbody></table></div></div>`}
function bindCash(){const c=ensureCashControl();const total=$('#totalInitialCash');if(total)total.onchange=()=>{c.totalInitial=total.value===''?null:Number(total.value);autoSave();render()};$$('[data-block-allocated]').forEach(el=>el.onchange=()=>{c.blocks[el.dataset.blockAllocated].allocated=el.value===''?null:Number(el.value);autoSave();render()});$$('[data-block-actual]').forEach(el=>el.onchange=()=>{c.blocks[el.dataset.blockActual].actualRemaining=el.value===''?null:Number(el.value);autoSave();render()});$$('[data-income-actual]').forEach(el=>el.onchange=()=>{c.incomeActual[el.dataset.incomeActual]=el.value===''?null:Number(el.value);autoSave();render()});$$('[data-expense-block]').forEach(el=>el.onchange=()=>{const item=el.dataset.expenseBlock,target=el.value;for(const id of ['A','B','C','D','E'])c.blocks[id].items=c.blocks[id].items.filter(x=>x!==item);c.blocks[target].items.push(item);autoSave();render();toast(`${item} を ${c.blocks[target].name} へ移動しました`)});$$('[data-close-block]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.closeBlock,b=c.blocks[id],x=cashBlockCalc(id);if(x.allocated===null){toast('用意資金を入力してください');return}if(x.actual===null){toast('実査残金を入力してください');return}if(b.closed&&!confirm(`${b.name} はすでに締め済みです。現在値で再締めしますか？`))return;b.closed={at:new Date().toISOString(),allocated:x.allocated,ledger:x.ledger,theoretical:x.theoretical,actual:x.actual,diff:x.diff,itemsKey:b.items.join('|')};autoSave();render();toast(`${b.name} を締めました`)})}

function bindCurrent(){
  $$('[data-go]').forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(g==='new'){state.draft=blankRecord();state.editId=null;state.mode='income';state.returnScreen='home';state.screen='form'}if(g==='search'){state.returnScreen=null;state.screen='search'}if(g==='table'){state.returnScreen=null;state.screen='table'}if(g==='cash'){state.returnScreen=null;state.screen='cash'}if(g==='settings'){state.screen='settings'}if(g==='deleted'){state.screen='deleted'}if(g==='save'){exportExcel()}render();autoSave()});
  const bn=$('#baseName');if(bn)bn.oninput=()=>{state.baseName=bn.value||'本葬受付台帳';autoSave()};
  const ox=$('#openExcel'),fx=$('#fileExcel');if(ox&&fx){ox.onclick=()=>fx.click();fx.onchange=e=>importExcel(e.target.files[0])}
  if(state.screen==='form')bindForm();if(state.screen==='search')bindSearch();if(state.screen==='table')bindTable();if(state.screen==='settings')bindSettings();if(state.screen==='deleted')bindDeleted();if(state.screen==='rules')bindRules();if(state.screen==='cash')bindCash();
}

function bindForm(){const r=state.draft;
const back=$('#backToSource');if(back)back.onclick=backToSource;
const upt=$('#useParentTemple');if(upt)upt.onclick=()=>{const p=state.records.find(x=>x.id===r.parentId);if(!p)return;r.office=p.office||'第1宗務所';r.district=p.district||'';r.templeNo=p.templeNo||'';r.temple=p.temple||'';r._templeQuery=r.temple;autoSave();render();toast(`${r.temple} を引き継ぎました`)};
$$('[data-district]').forEach(b=>b.onclick=()=>{r.district=b.dataset.district;r.temple='';r.templeNo='';r._templeQuery='';autoSave();render()});
const ts=$('#templeSearch');if(ts){ts.oninput=()=>{r._templeQuery=ts.value;r.temple=ts.value;r.templeNo='';autoSave();updateTempleSuggestions()}}
bindTempleSuggestionButtons();
const um=$('#useManualTemple');if(um)um.onclick=()=>{r.temple=(r._templeQuery||'').trim();r.templeNo='';showCandidateAction();autoSave();render()};
$$('[data-role]').forEach(b=>b.onclick=()=>{r.role=b.dataset.role;autoSave();render()});
const rm=$('#roleManual');if(rm)rm.oninput=()=>{if(rm.value.trim())r.role=rm.value.trim();autoSave();showCandidateAction()};
const people=peopleForTemple(r);$$('[data-person-index]').forEach(b=>b.onclick=()=>{const p=people[Number(b.dataset.personIndex)];if(p){r.role=p.role;r.name=p.name;autoSave();render()}});
const nf=$('#nameField');if(nf)nf.oninput=()=>{r.name=nf.value;autoSave();showCandidateAction()};
const as=$('#assignmentSelect');if(as)as.onchange=()=>{if(as.value==='__manual__'){r.assignment='';syncGuidedExpenseColumns(r);autoSave();render()}else{r.assignment=as.value;syncGuidedExpenseColumns(r);autoSave();render()}};
const am=$('#assignmentManual');if(am)am.oninput=()=>{r.assignment=am.value;syncGuidedExpenseColumns(r);autoSave()};
const nt=$('#noteField');if(nt)nt.oninput=()=>{r.note=nt.value;autoSave()};
$$('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render()});
$$('[data-money]').forEach(b=>b.onclick=()=>openMoney(b.dataset.money));
const op=$('#offeringPrint');if(op)op.onclick=()=>openOfferingPrint(r);
const commit=$('#commitRecord');if(commit)commit.onclick=commitRecord;
const startDeposit=()=>{if(!r.name.trim()){toast('先に持参者の氏名を入力してください');return}const parentId=r.id;const ok=commitRecord(false,false);if(!ok)return;const p=state.records.find(x=>x.id===parentId);if(!p){toast('親レコードを確認できませんでした');return}const child=blankRecord('預かり',p);state.draft=child;state.editId=null;state.mode='income';state.screen='form';autoSave();render();scrollPageTop();toast(`預かり ${child.id} の入力を開始しました`)};
const dep=$('#addDeposit');if(dep)dep.onclick=startDeposit;const depTop=$('#addDepositTop');if(depTop)depTop.onclick=startDeposit;
const del=$('#deleteRecord');if(del)del.onclick=deleteRecord;
const add=$('#addCandidate');if(add)add.onclick=()=>{addCandidateFromDraft();$('#candidateAction')?.classList.add('hidden');toast('今後の候補に追加しました')};const once=$('#onceCandidate');if(once)once.onclick=()=>{$('#candidateAction')?.classList.add('hidden')};
showCandidateAction();
}
function showCandidateAction(){const box=$('#candidateAction');if(!box||!state.draft)return;const r=state.draft;const people=peopleForTemple(r);const known=people.some(p=>norm(p.role)===norm(r.role)&&norm(p.name)===norm(r.name));if(r.name.trim()&&!known)box.classList.remove('hidden');else box.classList.add('hidden')}
function addCandidateFromDraft(){const r=state.draft;if(r.temple&&!r.templeNo){const exists=[...state.fixedTemples,...state.addedDirectory.temples].some(t=>norm(t['寺院名'])===norm(r.temple)&&t['教区']===r.district);if(!exists)state.addedDirectory.temples.push({'宗務所':r.office||'第1宗務所','教区':r.district,'寺籍番号':'','寺院名':r.temple,'フリガナ':'','住所（数字）':'','住所（漢数字）':'','住職':'','東堂':'','副住職':'','徒弟':'','御山内':'','寺族1':'','寺族2':''})}if(r.name&&r.temple){const exists=state.addedDirectory.people.some(p=>norm(p.name)===norm(r.name)&&norm(p.role)===norm(r.role)&&((r.templeNo&&p.templeNo===r.templeNo)||p.temple===r.temple));if(!exists)state.addedDirectory.people.push({templeNo:r.templeNo,district:r.district,temple:r.temple,role:r.role,name:r.name})}autoSave()}

function offeringLabelData(r){
  return {temple:(r.temple||'').trim(),role:(r.role||'').trim(),name:(r.name||'').trim()};
}
function drawSpacedHorizontal(ctx,text,cx,y,fontPx,gapPx){
  const chars=[...text];ctx.font=`600 ${fontPx}px \"Hiragino Mincho ProN\",\"Yu Mincho\",\"YuMincho\",serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const widths=chars.map(ch=>ctx.measureText(ch).width);const total=widths.reduce((a,b)=>a+b,0)+gapPx*Math.max(0,chars.length-1);let x=cx-total/2;
  chars.forEach((ch,i)=>{const w=widths[i];ctx.fillText(ch,x+w/2,y);x+=w+gapPx});
}
function drawVerticalChars(ctx,text,x,startY,fontPx,stepPx,weight=600){
  const chars=[...String(text||'').replace(/[\s　]/g,'')];ctx.font=`${weight} ${fontPx}px \"Hiragino Mincho ProN\",\"Yu Mincho\",\"YuMincho\",serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  chars.forEach((ch,i)=>ctx.fillText(ch,x,startY+i*stepPx));
}
function defaultOfferingAdjust(){
  return {mainScale:1,mainGapScale:1.4,mainOffsetMm:0,sideScale:1,sideOffsetMm:12,headingScale:1};
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function fitVerticalText(text,opts){
  const chars=[...String(text||'').replace(/[\s　]/g,'')];
  const n=Math.max(1,chars.length);
  const maxFont=opts.maxFontMm*(opts.scale||1);
  const gapRatio=Math.max(0.03,opts.gapRatio*(opts.gapScale||1));
  const available=Math.max(1,opts.bottomMm-opts.topMm);
  // total height = n*font + (n-1)*(font*gapRatio)
  const fitFont=available/(n+(n-1)*gapRatio);
  const fontMm=Math.min(maxFont,fitFont);
  const gapMm=fontMm*gapRatio;
  const stepMm=fontMm+gapMm;
  const totalMm=n*fontMm+(n-1)*gapMm;
  const centerMm=(opts.topMm+opts.bottomMm)/2+(opts.offsetMm||0);
  const startMm=centerMm-totalMm/2+fontMm/2;
  return {fontMm,gapMm,stepMm,totalMm,startMm,n,wasFitted:fitFont<maxFont};
}
function offeringCanvas(r,adjust=defaultOfferingAdjust()){
  const MM=8, W=Math.round(148.5*MM), H=Math.round(420*MM);const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#000';
  // 見出しは最大サイズを基準にし、ユーザー調整は安全な範囲に制限する。
  const headingScale=clamp(adjust.headingScale||1,.7,1.45);
  drawSpacedHorizontal(ctx,'御供',W/2,44*MM,26.4*headingScale*MM,20*headingScale*MM);
  const {temple,role,name}=offeringLabelData(r);
  if(role==='住職'){
    // 主文字安全領域を固定し、文字数に応じて最大限の大きさへ自動フィット。
    const lay=fitVerticalText(temple,{topMm:92,bottomMm:373,maxFontMm:63,gapRatio:.22,scale:clamp(adjust.mainScale||1,.65,1.35),gapScale:clamp(adjust.mainGapScale||1,.45,1.8),offsetMm:clamp(adjust.mainOffsetMm||0,-30,30)});
    drawVerticalChars(ctx,temple,W/2,lay.startMm*MM,lay.fontMm*MM,lay.stepMm*MM,600);
    c._offeringLayout={main:lay,side:null};
  }else{
    const lay=fitVerticalText(name,{topMm:90,bottomMm:375,maxFontMm:52.92,gapRatio:.22,scale:clamp(adjust.mainScale||1,.65,1.35),gapScale:clamp(adjust.mainGapScale||1,.45,1.8),offsetMm:clamp(adjust.mainOffsetMm||0,-30,30)});
    drawVerticalChars(ctx,name,W/2,lay.startMm*MM,lay.fontMm*MM,lay.stepMm*MM,600);
    const side=[temple,role].filter(Boolean).join('');
    const sn=[...side.replace(/[\s　]/g,'')].length||1;
    const sideBaseFont=sn<=6?19.8:sn<=8?17.05:14.85;
    const sideBaseStep=sn<=6?27:sn<=8?23:20;
    const sideScale=clamp(adjust.sideScale||1,.7,1.45);
    const sideOffset=clamp(adjust.sideOffsetMm||0,-35,35);
    drawVerticalChars(ctx,side,120*MM,(81+sideOffset)*MM,sideBaseFont*sideScale*MM,sideBaseStep*sideScale*MM,500);
    c._offeringLayout={main:lay,side:{fontMm:sideBaseFont*sideScale,startMm:81+sideOffset,xMm:120}};
  }
  return c;
}
function offeringPreviewModal(r){
  const data=offeringLabelData(r);if(!data.name){toast('氏名を入力してください');return null}if(data.role==='住職'&&!data.temple){toast('住職の御供札には寺号が必要です');return null}
  let adjust=defaultOfferingAdjust();
  const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal offering-modal"><h3>御供札プレビュー</h3><div class="offering-preview-wrap" id="offeringPreviewWrap"></div><div class="muted" style="margin:8px 0 12px">148.5 × 420mm / 下方向へ拡張した安全領域内で文字数に応じて自動フィット / 敬称なし</div><div class="grid3 offering-actions"><button class="btn" id="offeringCancel">戻る</button><button class="btn" id="offeringEdit">編集</button><button class="btn primary" id="offeringPdf">PDFを開く</button></div><div class="offering-editor hidden" id="offeringEditor"><div class="section-title">微調整</div><div class="offering-control"><span>主文字サイズ</span><div><button class="btn small" data-adj="mainScale" data-delta="-0.05">−</button><strong id="mainScaleLabel">100%</strong><button class="btn small" data-adj="mainScale" data-delta="0.05">＋</button></div></div><div class="offering-control"><span>主文字の字間</span><div><button class="btn small" data-adj="mainGapScale" data-delta="-0.10">狭く</button><strong id="mainGapScaleLabel">100%</strong><button class="btn small" data-adj="mainGapScale" data-delta="0.10">広く</button></div></div><div class="offering-control"><span>主文字の上下位置</span><div><button class="btn small" data-adj="mainOffsetMm" data-delta="-3">↑</button><strong id="mainOffsetMmLabel">0mm</strong><button class="btn small" data-adj="mainOffsetMm" data-delta="3">↓</button></div></div>${data.role==='住職'?'':`<div class="offering-control"><span>寺号＋役職サイズ</span><div><button class="btn small" data-adj="sideScale" data-delta="-0.05">−</button><strong id="sideScaleLabel">100%</strong><button class="btn small" data-adj="sideScale" data-delta="0.05">＋</button></div></div><div class="offering-control"><span>寺号＋役職の上下位置</span><div><button class="btn small" data-adj="sideOffsetMm" data-delta="-3">↑</button><strong id="sideOffsetMmLabel">0mm</strong><button class="btn small" data-adj="sideOffsetMm" data-delta="3">↓</button></div></div>`}<div class="offering-control"><span>「御供」サイズ</span><div><button class="btn small" data-adj="headingScale" data-delta="-0.05">−</button><strong id="headingScaleLabel">100%</strong><button class="btn small" data-adj="headingScale" data-delta="0.05">＋</button></div></div><button class="btn wide" id="offeringReset" style="margin-top:12px">自動配置に戻す</button></div></div>`;
  document.body.append(back);
  let canvas=null;
  const labels=()=>{
    const pct=k=>`${Math.round((adjust[k]||1)*100)}%`;
    const set=(id,v)=>{const el=$('#'+id,back);if(el)el.textContent=v};
    set('mainScaleLabel',pct('mainScale'));set('mainGapScaleLabel',pct('mainGapScale'));set('mainOffsetMmLabel',`${adjust.mainOffsetMm>0?'+':''}${adjust.mainOffsetMm}mm`);set('sideScaleLabel',pct('sideScale'));set('sideOffsetMmLabel',`${adjust.sideOffsetMm>0?'+':''}${adjust.sideOffsetMm}mm`);set('headingScaleLabel',pct('headingScale'));
  };
  const redraw=()=>{canvas=offeringCanvas(r,adjust);const wrap=$('#offeringPreviewWrap',back);wrap.innerHTML='';wrap.append(canvas);labels()};
  redraw();
  $('#offeringCancel',back).onclick=()=>back.remove();
  $('#offeringEdit',back).onclick=()=>{$('#offeringEditor',back).classList.toggle('hidden')};
  $$('[data-adj]',back).forEach(b=>b.onclick=()=>{const k=b.dataset.adj;const d=Number(b.dataset.delta);adjust[k]=Number(((adjust[k]??(k.includes('Offset')?0:1))+d).toFixed(2));redraw()});
  $('#offeringReset',back).onclick=()=>{adjust=defaultOfferingAdjust();redraw();toast('自動配置に戻しました')};
  $('#offeringPdf',back).onclick=()=>{makeOfferingPdf(r,canvas);back.remove()};
  return back;
}
function openOfferingPrint(r){offeringPreviewModal(r)}
function makeOfferingPdf(r,canvas){
  const JSPDF=window.jspdf?.jsPDF;if(!JSPDF){alert('PDFライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}
  try{
    const pdf=new JSPDF({orientation:'portrait',unit:'mm',format:[148.5,420],compress:true});const img=canvas.toDataURL('image/jpeg',0.96);pdf.addImage(img,'JPEG',0,0,148.5,420,undefined,'FAST');
    const blob=pdf.output('blob');const url=URL.createObjectURL(blob);const opened=window.open(url,'_blank');if(!opened){downloadBlob(blob,offeringPdfName(r));toast('PDFを保存しました')}else{setTimeout(()=>URL.revokeObjectURL(url),60000)}
  }catch(e){console.error(e);alert('御供札PDFを作成できませんでした。\n'+e.message)}
}
function offeringPdfName(r){const d=offeringLabelData(r);const who=d.role==='住職'?d.temple:d.name;return safeName(`御供札_${who||'札'}`)+'.pdf'}

function openMoney(key){moneyTarget=key;moneyValue=state.draft.money[key]===null?0:Number(state.draft.money[key])||0;const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h3>${esc(key)}</h3><div class="big-amount" id="moneyDisplay">${fmt(moneyValue)} 円</div><div class="quick-grid">${[10000,20000,30000,50000,100000].map(n=>`<button class="btn" data-quick="${n}">${fmt(n)}</button>`).join('')}</div><div class="section-title">手動入力</div><input id="moneyManual" class="field field-lg" inputmode="numeric" placeholder="金額を直接入力"><div class="grid3" style="margin-top:12px"><button class="btn" id="moneyClear">クリア</button><button class="btn" id="moneyCancel">キャンセル</button><button class="btn primary" id="moneyOk">決定</button></div></div>`;document.body.append(back);const disp=()=>$('#moneyDisplay',back).textContent=fmt(moneyValue)+' 円';$$('[data-quick]',back).forEach(b=>b.onclick=()=>{moneyValue+=Number(b.dataset.quick);disp()});$('#moneyManual',back).oninput=e=>{const v=e.target.value.replace(/[^0-9]/g,'');if(v!==''){moneyValue=Number(v);disp()}};$('#moneyClear',back).onclick=()=>{moneyValue=0;disp();$('#moneyManual',back).value=''};$('#moneyCancel',back).onclick=()=>back.remove();$('#moneyOk',back).onclick=()=>{state.draft.money[moneyTarget]=moneyValue===0?0:moneyValue;back.remove();autoSave();render()};}
function commitRecord(goHome=true,renderAfter=true){const r=state.draft;if(!r||!r.name.trim()){toast('氏名は必須です');return false}syncGuidedExpenseColumns(r);delete r._templeQuery;const destination=state.returnScreen||'home';if(state.editId){const i=state.records.findIndex(x=>x.id===state.editId);if(i<0){toast('更新対象が見つかりません');return false}state.records[i]=JSON.parse(JSON.stringify(r));toast('更新しました')}else{if(state.records.some(x=>x.id===r.id)){toast('IDが重複しています');return false}state.records.push(JSON.parse(JSON.stringify(r)));toast('登録しました')}state.editId=null;state.draft=null;if(goHome){state.screen=destination;state.returnScreen=null}autoSave();if(renderAfter)render();return true}
function deleteRecord(){const r=state.draft;const destination=state.returnScreen||'home';const children=state.records.filter(x=>x.parentId===r.id);let msg=`${r.id} ${r.name} を削除しますか？`;if(children.length)msg+=`\n\n預かり ${children.length}件も一緒に削除されます。`;if(!confirm(msg))return;const ids=new Set([r.id,...children.map(x=>x.id)]);state.records=state.records.filter(x=>{if(ids.has(x.id)){state.deleted.unshift({record:JSON.parse(JSON.stringify(x)),deletedAt:new Date().toISOString()});return false}return true});state.draft=null;state.editId=null;state.screen=destination;state.returnScreen=null;autoSave();render();toast('削除しました')}

function snapshotTableScroll(){const w=$('#tableWrap');if(w)state.tableScroll={top:w.scrollTop,left:w.scrollLeft}}
function bindSearchEditButtons(root=document){$$('[data-edit]',root).forEach(b=>b.onclick=()=>editRecord(b.dataset.edit,state.screen))}
function bindSearch(){const f=$('#recordSearch');if(f)f.oninput=()=>{state.search=f.value;const box=$('#recordSearchResults');if(box){box.innerHTML=searchResultsMarkup();bindSearchEditButtons(box)}};bindSearchEditButtons();setTimeout(()=>window.scrollTo(0,state.searchScrollY||0),0)}
function refreshTableResults(){snapshotTableScroll();const box=$('#tableResults');if(box){box.innerHTML=tableMarkup(filteredRecords());bindSearchEditButtons(box);$$('[data-column-filter]',box).forEach(h=>h.onclick=e=>{e.stopPropagation();openColumnFilter(h.dataset.columnFilter)});restoreTableScroll()}}
function restoreTableScroll(){const w=$('#tableWrap');if(w){w.scrollTop=state.tableScroll?.top||0;w.scrollLeft=state.tableScroll?.left||0}}
function bindTable(){const or=$('#openRules');if(or)or.onclick=()=>{state.screen='rules';render();autoSave()};const cf=$('#clearColumnFilters');if(cf)cf.onclick=()=>{state.filters.columns={};state.tableScroll={top:0,left:0};render();autoSave()};$$('[data-column-filter]').forEach(h=>h.onclick=e=>{e.stopPropagation();openColumnFilter(h.dataset.columnFilter)});const s=$('#tableSearch');if(s)s.oninput=()=>{state.search=s.value;state.tableScroll={top:0,left:0};refreshTableResults()};const d=$('#tableDistrict');if(d)d.onchange=()=>{state.filters.district=d.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const k=$('#tableKind');if(k)k.onchange=()=>{state.filters.kind=k.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const g=$('#tableGuide');if(g)g.onchange=()=>{state.filters.guide=g.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};$$('[data-table-view]').forEach(b=>b.onclick=()=>{snapshotTableScroll();state.tableView=b.dataset.tableView;render()});const w=$('#tableWrap');if(w)w.onscroll=()=>{state.tableScroll={top:w.scrollTop,left:w.scrollLeft}};bindSearchEditButtons();setTimeout(restoreTableScroll,0)}
function editRecord(id,source=state.screen){const r=state.records.find(x=>x.id===id);if(!r)return;if(source==='table')snapshotTableScroll();if(source==='search')state.searchScrollY=window.scrollY;state.draft=JSON.parse(JSON.stringify(r));state.editId=id;state.mode='income';state.returnScreen=source;state.screen='form';render();scrollPageTop();autoSave()}

function bindSettings(){const b=$('#backupDir');if(b)b.onclick=backupDirectory;const r=$('#restoreDir'),rf=$('#dirFile');if(r&&rf){r.onclick=()=>rf.click();rf.onchange=e=>restoreDirectory(e.target.files[0])}const rd=$('#reloadDirectory'),df=$('#directoryExcel');if(rd&&df){rd.onclick=()=>df.click();df.onchange=e=>reloadFixedDirectory(e.target.files[0])}const cw=$('#clearWorkspace');if(cw)cw.onclick=()=>{if(confirm('現在の入力データ・下書き・削除履歴を全て消去しますか？')){state.records=[];state.draft=null;state.deleted=[];state.sourceLoaded=false;state.baseName='本葬受付台帳';state.rules=defaultRules();state.cashControl=defaultCashControl();state.filters={district:'',kind:'',guide:'',columns:{}};autoSave();render();toast('作業データを消去しました')}}}
function bindDeleted(){$$('[data-restore]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.restore);const d=state.deleted[i];if(!d)return;if(state.records.some(r=>r.id===d.record.id)){toast('同じIDが存在するため復元できません');return}state.records.push(d.record);state.deleted.splice(i,1);autoSave();render();toast('復元しました')})}
function backupDirectory(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state.addedDirectory},null,2)],{type:'application/json'});downloadBlob(blob,'追加名簿_'+stamp()+'.json')}
function restoreDirectory(file){if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);state.addedDirectory={temples:Array.isArray(j.temples)?j.temples:[],people:Array.isArray(j.people)?j.people:[]};autoSave();render();toast('追加名簿を読み込みました')}catch(e){alert('JSONを読み込めませんでした')}};fr.readAsText(file)}
function reloadFixedDirectory(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});const req=['宗務所','教区','寺籍番号','寺院名','フリガナ','住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];const miss=req.filter(h=>!(h in (rows[0]||{})));if(miss.length)throw new Error('不足列: '+miss.join('、'));state.fixedTemples=rows;dbSet('fixedTemplesOverride',rows);render();toast('第1宗務所名簿を更新しました')}catch(e){alert('名簿を読み込めませんでした。\n'+e.message)}};fr.readAsArrayBuffer(file)}

function rowFromRecord(r,no){syncGuidedExpenseColumns(r);const o={'No.':no,'レコードID':r.id,'親ID':r.parentId||'','受付区分':r.kind,'持参者ID':r.carrierId||'','宗務所':r.office||'第1宗務所','教区':r.district||'','寺籍番号':r.templeNo||'','寺号':r.temple||'','役職':r.role||'','氏名':r.name||'','配役':r.assignment||'','備考':r.note||''};INCOME.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['プラス小計']=sum(INCOME,r);EXPENSE.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['マイナス小計']=sum(EXPENSE,r);return o}
function recordFromRow(row){const money=blankMoney();INCOME.concat(EXPENSE).forEach(k=>{const v=row[k];money[k]=(v===undefined||v===null||v==='')?null:Number(v)});const id=String(row['レコードID']||'');const r={no:row['No.']||null,id,parentId:String(row['親ID']||''),kind:row['受付区分']||'本人',carrierId:String(row['持参者ID']||''),office:row['宗務所']||'第1宗務所',district:row['教区']||'',templeNo:String(row['寺籍番号']||''),temple:row['寺号']||'',role:row['役職']||'',name:row['氏名']||'',assignment:row['配役']||'',note:row['備考']||'',money};syncGuidedExpenseColumns(r);return r}
function cashControlFromSheet(ws){try{const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});if(!rows.length)return null;const c=defaultCashControl();const totalRow=rows.find(r=>r[0]==='総初期資金');if(totalRow&&totalRow[1]!==''&&totalRow[1]!==null)c.totalInitial=Number(totalRow[1]);for(const row of rows){const name=String(row[0]||'');const m=/^([A-E])\s/.exec(name);if(m){const id=m[1],b=c.blocks[id];b.items=String(row[1]||'').split(/\s*\/\s*/).filter(x=>EXPENSE.includes(x));b.allocated=row[2]===''?null:Number(row[2]);b.actualRemaining=row[5]===''?null:Number(row[5]);if(row[7]){const d=new Date(row[7]);b.closed={at:Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(),allocated:row[2]===''?null:Number(row[2]),ledger:Number(row[3])||0,theoretical:row[4]===''?null:Number(row[4]),actual:row[5]===''?null:Number(row[5]),diff:row[8]===''?null:Number(row[8]),itemsKey:b.items.join('|')}}}if(INCOME.includes(name)){c.incomeActual[name]=row[2]===''?null:Number(row[2])}}state.cashControl=c;ensureCashControl();return c}catch(e){console.warn('残金シート読込失敗',e);return null}}
function importExcel(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)throw new Error('データがありません');const headers=Object.keys(rows[0]);const required=['レコードID','受付区分','氏名',...INCOME,...EXPENSE];const miss=required.filter(h=>!headers.includes(h));if(miss.length)throw new Error('必要列が見つかりません：'+miss.join('、'));const ids=new Set();const recs=rows.map(recordFromRow).filter(r=>r.id&&r.name);for(const r of recs){if(ids.has(r.id))throw new Error('レコードIDが重複しています：'+r.id);ids.add(r.id)}if(wb.Sheets['残金'])cashControlFromSheet(wb.Sheets['残金']);state.records=recs;state.baseName=file.name.replace(/\.xlsx?$/i,'').replace(/_\d{4}_\d{4}$/,'');state.sourceLoaded=true;state.draft=null;state.editId=null;autoSave();render();toast('Excelを読み込みました')}catch(e){alert('このExcelは読み込めません。\n\n'+e.message+'\n\n列構造を確認してください。')}};fr.readAsArrayBuffer(file)}
function exportExcel(){if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const data=state.records.map((r,i)=>rowFromRecord(r,i+1));const subtotal={'氏名':'小計'};INCOME.forEach(k=>subtotal[k]=state.records.reduce((a,r)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0));subtotal['プラス小計']=INCOME.reduce((a,k)=>a+(subtotal[k]||0),0);EXPENSE.forEach(k=>subtotal[k]=state.records.reduce((a,r)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0));subtotal['マイナス小計']=EXPENSE.reduce((a,k)=>a+(subtotal[k]||0),0);const ws=XLSX.utils.json_to_sheet([...data,subtotal],{header:APP_HEADERS});ws['!cols']=APP_HEADERS.map(h=>({wch:({'No.':6,'レコードID':11,'親ID':11,'受付区分':9,'持参者ID':11,'宗務所':11,'教区':9,'寺籍番号':9,'寺号':7,'役職':9,'氏名':16,'配役':18,'備考':24,'プラス小計':13,'マイナス小計':13}[h]||([...INCOME,...EXPENSE].includes(h)?12:11))}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'受付台帳');const c=ensureCashControl();const cashRows=[['現金照合・残金'],['総初期資金',c.totalInitial??''],['配分合計',totalAllocated()],['未配分',unallocatedCash()??''],[],['支出ブロック','構成科目','用意資金','帳簿上支出','理論残金','実査残金','差額','締め日時','締め時差額']];for(const id of ['A','B','C','D','E']){const b=c.blocks[id],x=cashBlockCalc(id);cashRows.push([b.name,b.items.join(' / '),x.allocated??'',x.ledger,x.theoretical??'',x.actual??'',x.diff??'',b.closed?.at?new Date(b.closed.at).toLocaleString('ja-JP'):'',b.closed?.diff??''])}cashRows.push([],['収入科目','帳簿合計','実査現金','差額']);INCOME.forEach(item=>{const ledger=incomeLedger(item),actual=c.incomeActual[item],diff=actual===null||actual===''?'':(Number(actual)||0)-ledger;cashRows.push([item,ledger,actual??'',diff])});const wsCash=XLSX.utils.aoa_to_sheet(cashRows);wsCash['!cols']=[{wch:22},{wch:55},{wch:16},{wch:16},{wch:16},{wch:16},{wch:16},{wch:24},{wch:16}];XLSX.utils.book_append_sheet(wb,wsCash,'残金');const filename=safeName(state.baseName)+'_'+stamp()+'.xlsx';XLSX.writeFile(wb,filename,{compression:true});toast('Excel保存を開始しました')}
function stamp(){const d=new Date();return String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')}
function safeName(s){return (s||'本葬受付台帳').replace(/[\\/:*?"<>|]/g,'_')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function init(){try{const w=await dbGet('workspace');if(w){state.records=Array.isArray(w.records)?w.records:[];state.records.forEach(syncGuidedExpenseColumns);state.draft=w.draft||null;if(state.draft)syncGuidedExpenseColumns(state.draft);state.baseName=w.baseName||state.baseName;state.sourceLoaded=!!w.sourceLoaded;state.deleted=Array.isArray(w.deleted)?w.deleted:[];state.search=w.search||'';state.filters={district:'',kind:'',guide:'',columns:{},...(w.filters||{})};state.filters.columns=state.filters.columns&&typeof state.filters.columns==='object'?state.filters.columns:{};state.tableView=w.tableView==='full'?'full':'normal';state.rules=w.rules||defaultRules();state.cashControl=w.cashControl||defaultCashControl();ensureRules();ensureCashControl()}else{state.rules=defaultRules();state.cashControl=defaultCashControl()}const a=await dbGet('addedDirectory');if(a)state.addedDirectory=a;const f=await dbGet('fixedTemplesOverride');if(Array.isArray(f)&&f.length)state.fixedTemples=f}catch(e){console.warn(e)}if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    // GitHub Pagesを更新した直後でも新版確認を促す。
    reg.update().catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      // 新Service Workerへ切り替わったら一度だけ再読込して新版UIへ移る。
      if(sessionStorage.getItem('sw-reloaded-'+APP_VERSION)) return;
      sessionStorage.setItem('sw-reloaded-'+APP_VERSION,'1');
      location.reload();
    });
  }catch(_){}
}
ensureRules();ensureCashControl();render()}
init();
})();