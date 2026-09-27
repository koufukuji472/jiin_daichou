(() => {
'use strict';
const APP_VERSION = '0.9';
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const INCOME = ['密葬香資','密葬供花','密葬供物','本葬香資','本葬供花料','本葬供物料','問候','献香'];
const EXPENSE = ['密葬謝誼','密葬回心','中陰謝誼','本葬謝誼（案内有）','本葬謝誼（未案内）','本葬回心（案内有）','本葬回心（未案内）','路資','菓誼','内謝'];
const APP_HEADERS = ['No.','レコードID','親ID','受付区分','持参者ID','宗務所','教区','寺籍番号','寺号','役職','氏名','配役','備考',...INCOME,'プラス小計',...EXPENSE,'マイナス小計'];
const ROLE_BUTTONS=['住職','東堂','副住職','徒弟','寺族','御山内'];
const PERSON_COLS=['住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];
const state={screen:'home',records:[],draft:null,editId:null,mode:'income',baseName:'本葬受付台帳',sourceLoaded:false,addedDirectory:{temples:[],people:[]},deleted:[],fixedTemples:window.FIXED_TEMPLES||[],search:'',filters:{district:'',kind:'',guide:''},returnScreen:null,tableView:'normal',tableScroll:{top:0,left:0},searchScrollY:0};
let moneyTarget=null, moneyValue=null, saveTimer=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmt(n){if(n===null||n===undefined||n==='') return ''; const x=Number(n); return Number.isFinite(x)?x.toLocaleString('ja-JP'):''}
function hiraToKata(s=''){return s.replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));}
function norm(s=''){return hiraToKata(String(s).normalize('NFKC')).replace(/[\s　]/g,'').toUpperCase();}
function roleFromCol(c){return c.startsWith('寺族')?'寺族':c}
function blankMoney(){const o={};[...INCOME,...EXPENSE].forEach(k=>o[k]=null);return o}
function blankRecord(kind='本人', parent=null){return {no:null,id: kind==='本人'?nextParentId():nextChildId(parent?.id),parentId:parent?.id||'',kind,carrierId:parent?.id||'',office:'第1宗務所',district:'',templeNo:'',temple:'',role:'',name:'',assignment:'',note:'',money:blankMoney(),guide:{謝誼:'',回心:''}}}
function parentNum(id){const m=/^P(\d{3,})$/.exec(id||'');return m?Number(m[1]):0}
function nextParentId(){let m=0;state.records.forEach(r=>{if(!r.parentId)m=Math.max(m,parentNum(r.id))});if(state.draft&&!state.draft.parentId)m=Math.max(m,parentNum(state.draft.id));return 'P'+String(m+1).padStart(3,'0')}
function nextChildId(parentId){let m=0;state.records.forEach(r=>{const q=new RegExp('^'+parentId+'-(\\d+)$').exec(r.id||'');if(q)m=Math.max(m,Number(q[1]))});return parentId+'-'+String(m+1).padStart(2,'0')}
function sum(keys,r){return keys.reduce((a,k)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0)}
function displayPerson(r){return [r.district,r.temple,r.name,r.role,r.assignment].filter(Boolean).join(' / ')}
function templeReadingForRecord(r){
  const all=[...state.fixedTemples,...state.addedDirectory.temples];
  const t=all.find(x=>(r.templeNo&&String(x['寺籍番号'])===String(r.templeNo))||(!r.templeNo&&x['寺院名']===r.temple&&x['教区']===r.district));
  return t?.['フリガナ']||'';
}
function recordSearchText(r){
  return [r.id,r.parentId,r.name,r.temple,templeReadingForRecord(r),r.role,r.assignment,r.district,r.kind].join(' ');
}

// IndexedDB
const DB='templeReceptionApp', STORE='kv';
function db(){return new Promise((res,rej)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbGet(k){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(STORE,'readonly').objectStore(STORE).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbSet(k,v){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(STORE,'readwrite').objectStore(STORE).put(v,k);q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}
function autoSave(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{await dbSet('workspace',{records:state.records,draft:state.draft,baseName:state.baseName,sourceLoaded:state.sourceLoaded,deleted:state.deleted,search:state.search,filters:state.filters,tableView:state.tableView,updatedAt:new Date().toISOString()});await dbSet('addedDirectory',state.addedDirectory)},250)}

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
  bindHome();bindCurrent();
}

function homeView(){return `
<div class="card"><div class="row"><div class="grow"><label>保存時の基本ファイル名</label><input id="baseName" class="field" value="${esc(state.baseName)}"></div><button class="btn" id="openExcel">Excelを開く</button><input id="fileExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="muted" style="margin-top:8px">保存時は自動で _MMDD_HHMM.xlsx を付けます。元ファイルは上書きしません。</div></div>
<div class="menu"><button class="btn primary" data-go="new">＋ 新規入力</button><button class="btn" data-go="search">検索・修正</button><button class="btn" data-go="table">表一覧</button><button class="btn income" data-go="save">Excel保存</button></div>
<div class="card" style="margin-top:14px"><div class="row"><div class="grow"><strong>${state.records.length}件</strong> を作業中</div><span class="muted">自動退避：IndexedDB</span></div></div>
<div class="grid2"><button class="btn" data-go="settings">追加名簿・設定</button><button class="btn" data-go="deleted">削除履歴 (${state.deleted.length})</button></div>`}

function personHeader(r){const p=r.parentId?state.records.find(x=>x.id===r.parentId):null;return `<div class="person-head"><div class="row"><div class="grow"><strong>${esc(r.id)} ${esc(r.name||'氏名未入力')}</strong><div class="muted">${esc([r.district,r.temple,r.role,r.assignment].filter(Boolean).join(' / '))}</div></div><span class="pill ${r.kind==='預かり'?'child':''}">${esc(r.kind)}</span></div>${r.kind==='預かり'?`<div class="muted">持参者：${esc(p?.name||r.carrierId)}</div>`:''}</div>`}
function districtButtons(r){return `<div class="chips">${[1,2,3,4,5,6,7,8].map(n=>{const d=`第${n}教区`;return `<button class="chip ${r.district===d?'selected':''}" data-district="${d}">${d}</button>`}).join('')}<button class="chip ${!r.district?'selected':''}" data-district="">未指定</button></div>`}
function roleButtons(r){return `<div class="chips">${ROLE_BUTTONS.map(x=>`<button class="chip ${r.role===x?'selected':''}" data-role="${x}">${x}</button>`).join('')}</div>`}
function roleSelect(r){const opts=[];Object.entries(window.FUNERAL_ROLE_GROUPS||{}).forEach(([g,arr])=>{opts.push(`<optgroup label="${esc(g)}">`+arr.map(x=>`<option ${r.assignment===x?'selected':''}>${esc(x)}</option>`).join('')+'</optgroup>')});return `<select id="assignmentSelect" class="field"><option value="">配役を選択</option>${opts.join('')}<option value="未案内" ${r.assignment==='未案内'?'selected':''}>未案内</option><option value="__manual__">手入力</option></select>`}
function templeCandidates(r,q=''){const query=norm(q);let all=[...state.fixedTemples,...state.addedDirectory.temples];let list=all.filter(t=>(!r.district||t['教区']===r.district));if(query)list=list.filter(t=>norm(t['寺院名']).includes(query)||norm(t['フリガナ']).includes(query));return list.slice(0,30)}
function templeSuggestionsMarkup(r,q=''){const candidates=templeCandidates(r,q);return {candidates,html:candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}}
function bindTempleSuggestionButtons(){const r=state.draft;$$('[data-temple-no]').forEach(b=>b.onclick=()=>{const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>String(x['寺籍番号'])===b.dataset.templeNo);if(t){r.office=t['宗務所']||'第1宗務所';r.district=t['教区']||r.district;r.templeNo=String(t['寺籍番号']||'');r.temple=t['寺院名']||'';r._templeQuery=r.temple;autoSave();render()}})}
function updateTempleSuggestions(){const r=state.draft,box=$('#templeSuggestions');if(!r||!box)return;const {candidates,html}=templeSuggestionsMarkup(r,r._templeQuery??r.temple);box.innerHTML=html;box.classList.toggle('hidden',!candidates.length);bindTempleSuggestionButtons()}
function peopleForTemple(r){let out=[];const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>(r.templeNo&&x['寺籍番号']===r.templeNo)||(!r.templeNo&&x['寺院名']===r.temple&&x['教区']===r.district));if(t)PERSON_COLS.forEach(c=>{if(t[c])out.push({role:roleFromCol(c),name:t[c]})});state.addedDirectory.people.filter(p=>(r.templeNo&&p.templeNo===r.templeNo)||(!r.templeNo&&p.temple===r.temple&&p.district===r.district)).forEach(p=>out.push({role:p.role,name:p.name}));const seen=new Set();return out.filter(p=>{const k=norm(p.role+'|'+p.name);if(seen.has(k))return false;seen.add(k);return true})}

function formView(){const r=state.draft; if(!r)return '<div class="card error">入力データがありません。</div>';
const candidates=templeCandidates(r,r._templeQuery??r.temple);const people=peopleForTemple(r);
return `${formBackMarkup()}${state.editId?`<div class="edit-banner">編集モード：既存データを読み込んでいます</div>`:''}${r.kind==='預かり'?`<div class="parent-banner">預かり入力　持参者：${esc((state.records.find(x=>x.id===r.parentId)||{}).name||r.carrierId)}</div>`:''}${personHeader(r)}
<div class="card"><div class="section-title">① 教区</div>${districtButtons(r)}
<div class="section-title">② 寺号</div><input id="templeSearch" class="field field-lg" placeholder="漢字・ひらがな・カタカナ" value="${esc(r._templeQuery??r.temple)}"><div id="templeSuggestions" class="suggestions ${candidates.length?'':'hidden'}">${candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}</div><button class="btn small" id="useManualTemple" style="margin-top:8px">この寺号をそのまま使用</button>
<div class="section-title">③ 役職</div>${roleButtons(r)}<div style="margin-top:8px"><input id="roleManual" class="field" placeholder="役職を手入力" value="${ROLE_BUTTONS.includes(r.role)?'':esc(r.role)}"></div>
${people.length?`<div class="section-title">名簿登録人物</div><div class="grid2">${people.map((p,i)=>`<button class="btn" data-person-index="${i}">${esc(p.role)}　${esc(p.name)}</button>`).join('')}</div>`:''}
<div class="section-title">④ 氏名 <span style="color:#b42318">※必須</span></div><input id="nameField" class="field field-lg" value="${esc(r.name)}" placeholder="例：山田 太郎">
<div id="candidateAction" class="hidden notice" style="margin-top:10px"><div style="font-weight:800;margin-bottom:8px">名簿候補にない入力です</div><div class="row"><button class="btn small" id="addCandidate">今後の候補に追加</button><button class="btn small" id="onceCandidate">今回だけ使用</button></div></div>
<div class="section-title">⑤ 配役</div>${roleSelect(r)}<input id="assignmentManual" class="field ${r.assignment&&![].concat(...Object.values(window.FUNERAL_ROLE_GROUPS||{}),'未案内').includes(r.assignment)?'':'hidden'}" style="margin-top:8px" placeholder="例：尊宿兼先導師" value="${esc(r.assignment)}">
<div class="section-title">備考</div><textarea id="noteField" class="field" rows="2">${esc(r.note)}</textarea></div>
${moneyPanel(r)}
<div class="card"><div class="grid2">${r.kind==='本人'?'<button class="btn" id="addDeposit">＋ 預かりを追加</button>':''}<button class="btn primary" id="commitRecord">${state.editId?'更新':'登録'}</button></div>${state.editId?'<button class="btn danger wide" id="deleteRecord" style="margin-top:10px">削除</button>':''}</div>`}

function moneyPanel(r){const isI=state.mode==='income';const groups=isI?[['密葬',['密葬香資','密葬供花','密葬供物']],['本葬',['本葬香資','本葬供花料','本葬供物料']],['その他',['問候','献香']]]:[['密葬',['密葬謝誼']],['中陰',['密葬回心','中陰謝誼']],['本葬前',['本葬謝誼']],['本葬',['本葬回心']],['その他',['路資','菓誼','内謝']]];
return `<div class="card ${isI?'income-panel':'expense-panel'}"><h3 style="color:${isI?'var(--income)':'var(--expense)'}">${isI?'収入':'支出'}入力</h3>${groups.map(([g,items])=>`<div class="section-title">${g}</div>${items.map(item=>moneyRow(r,item)).join('')}`).join('')}<div class="sticky-summary"><span>${isI?'収入':'支出'}小計</span><span class="amount">${fmt(sum(isI?INCOME:EXPENSE,r))} 円</span></div></div>`}
function moneyRow(r,item){let key=item;if(item==='本葬謝誼'){const g=r.guide.謝誼||'有';key=`本葬謝誼（${g==='有'?'案内有':'未案内'}）`}if(item==='本葬回心'){const g=r.guide.回心||'有';key=`本葬回心（${g==='有'?'案内有':'未案内'}）`}
const guide=item==='本葬謝誼'?`<div class="chips" style="margin-top:6px"><button class="chip small ${r.guide.謝誼==='有'?'selected':''}" data-guide="謝誼:有">案内有</button><button class="chip small ${r.guide.謝誼==='無'?'selected':''}" data-guide="謝誼:無">未案内</button></div>`:item==='本葬回心'?`<div class="chips" style="margin-top:6px"><button class="chip small ${r.guide.回心==='有'?'selected':''}" data-guide="回心:有">案内有</button><button class="chip small ${r.guide.回心==='無'?'selected':''}" data-guide="回心:無">未案内</button></div>`:'';
return `<div class="money-item"><div><strong>${esc(item)}</strong>${guide}</div><button class="money-btn ${r.money[key]!==null?'filled':''}" data-money="${esc(key)}">${r.money[key]===null?'＋入力':fmt(r.money[key])+' 円'}</button></div>`}
function modeBar(){return `<div class="modebar"><button class="btn ${state.mode==='income'?'income':''}" data-mode="income">収入</button><button class="btn ${state.mode==='expense'?'expense':''}" data-mode="expense">支出</button></div>`}

function searchResultsMarkup(){const q=norm(state.search);const list=state.records.filter(r=>!q||norm(recordSearchText(r)).includes(q));return list.map(r=>`<button class="search-result ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}" style="width:100%;text-align:left"><div class="row"><div class="grow"><div class="title">${esc(r.id)}　${esc(r.name||'氏名なし')}</div><div class="meta">${esc([r.district,r.temple,r.role,r.assignment].filter(Boolean).join(' / '))}</div></div><span class="pill ${r.kind==='預かり'?'child':''}">${esc(r.kind)}</span></div></button>`).join('')||'<div class="card muted">該当データなし</div>'}
function searchView(){return `<div class="card"><label>氏名・寺号・役職・配役・IDから検索</label><input id="recordSearch" class="field field-lg" value="${esc(state.search)}" placeholder="例：山田 / 光明寺 / 尊宿"></div><div id="recordSearchResults">${searchResultsMarkup()}</div>`}

function tableView(){return `<div class="card"><div class="split"><div><label>検索</label><input id="tableSearch" class="field" value="${esc(state.search)}" placeholder="氏名・寺号・役職など"></div><div><label>教区</label><select id="tableDistrict" class="field"><option value="">すべて</option>${[1,2,3,4,5,6,7,8].map(n=>`<option ${state.filters.district===`第${n}教区`?'selected':''}>第${n}教区</option>`).join('')}</select></div><div><label>受付区分</label><select id="tableKind" class="field"><option value="">すべて</option><option ${state.filters.kind==='本人'?'selected':''}>本人</option><option ${state.filters.kind==='預かり'?'selected':''}>預かり</option></select></div><div><label>案内区分</label><select id="tableGuide" class="field"><option value="">すべて</option><option value="案内寺院" ${state.filters.guide==='案内寺院'?'selected':''}>案内寺院</option><option value="未案内寺院" ${state.filters.guide==='未案内寺院'?'selected':''}>未案内随喜寺院</option></select></div></div><div class="row" style="margin-top:12px"><span class="muted">表示列</span><button class="btn small ${state.tableView==='normal'?'selected':''}" data-table-view="normal">通常表示</button><button class="btn small ${state.tableView==='full'?'selected':''}" data-table-view="full">全列表示</button></div></div><div id="tableResults">${tableMarkup(filteredRecords())}</div>`}
function filteredRecords(){const q=norm(state.search);return state.records.filter(r=>{const textOk=!q||norm(recordSearchText(r)).includes(q);const districtOk=!state.filters.district||r.district===state.filters.district;const kindOk=!state.filters.kind||r.kind===state.filters.kind;const guideOk=!state.filters.guide||(state.filters.guide==='未案内寺院'?r.assignment==='未案内':state.filters.guide==='案内寺院'?!!r.assignment&&r.assignment!=='未案内':true);return textOk&&districtOk&&kindOk&&guideOk})}
function actualNo(r){const i=state.records.findIndex(x=>x.id===r.id);return i>=0?i+1:''}
function tableMarkup(rows){if(state.tableView==='full')return fullTableMarkup(rows);return normalTableMarkup(rows)}
function normalTableMarkup(rows){return `<div class="table-wrap table-normal" id="tableWrap"><table><thead><tr>${['No.','ID','区分','教区','寺号','役職','氏名','配役','収入小計','支出小計','親ID','持参者ID'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="clickable ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}"><td>${actualNo(r)}</td><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.district)}</td><td>${esc(r.temple)}</td><td>${esc(r.role)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.assignment)}</td><td>${fmt(sum(INCOME,r))}</td><td>${fmt(sum(EXPENSE,r))}</td><td>${esc(r.parentId)}</td><td>${esc(r.carrierId)}</td></tr>`).join('')}</tbody></table></div>`}
function fullTableMarkup(rows){const moneyHeaders=new Set([...INCOME,'プラス小計',...EXPENSE,'マイナス小計']);return `<div class="table-wrap table-full" id="tableWrap"><table><thead><tr>${APP_HEADERS.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const row=rowFromRecord(r,actualNo(r));return `<tr class="clickable ${r.kind==='預かり'?'child':''}" data-edit="${esc(r.id)}">${APP_HEADERS.map(h=>{const v=row[h];const shown=moneyHeaders.has(h)&&v!==''?fmt(v):v;return `<td>${h==='氏名'?`<strong>${esc(shown)}</strong>`:esc(shown)}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div>`}

function settingsView(){return `<div class="card"><h3>追加名簿</h3><p class="muted">追加寺院 ${state.addedDirectory.temples.length}件 / 追加人物 ${state.addedDirectory.people.length}件</p><div class="grid2"><button class="btn" id="backupDir">追加名簿JSONを書き出す</button><button class="btn" id="restoreDir">追加名簿JSONを読み込む</button></div><input id="dirFile" type="file" accept=".json" class="hidden"></div><div class="card"><h3>第1宗務所名簿</h3><p class="muted">アプリ内蔵：${state.fixedTemples.length}寺院。後から人物名を追記した最新版Excelを読み直すこともできます。</p><button class="btn" id="reloadDirectory">第1宗務所名簿.xlsx を読み込む</button><input id="directoryExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="card"><h3>作業状態</h3><button class="btn danger" id="clearWorkspace">作業データを全消去</button></div>`}
function deletedView(){return `<div class="card"><div class="muted">削除履歴はこの端末のIndexedDBに残します。</div></div>${state.deleted.map((d,i)=>`<div class="search-result"><div class="row"><div class="grow"><div class="title">${esc(d.record.id)}　${esc(d.record.name)}</div><div class="meta">削除：${esc(new Date(d.deletedAt).toLocaleString('ja-JP'))} / ${esc([d.record.district,d.record.temple,d.record.role].filter(Boolean).join(' / '))}</div></div><button class="btn small" data-restore="${i}">復元</button></div></div>`).join('')||'<div class="card muted">削除履歴はありません。</div>'}`}

function bindCurrent(){
  $$('[data-go]').forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(g==='new'){state.draft=blankRecord();state.editId=null;state.mode='income';state.returnScreen='home';state.screen='form'}if(g==='search'){state.returnScreen=null;state.screen='search'}if(g==='table'){state.returnScreen=null;state.screen='table'}if(g==='settings'){state.screen='settings'}if(g==='deleted'){state.screen='deleted'}if(g==='save'){exportExcel()}render();autoSave()});
  const bn=$('#baseName');if(bn)bn.oninput=()=>{state.baseName=bn.value||'本葬受付台帳';autoSave()};
  const ox=$('#openExcel'),fx=$('#fileExcel');if(ox&&fx){ox.onclick=()=>fx.click();fx.onchange=e=>importExcel(e.target.files[0])}
  if(state.screen==='form')bindForm();if(state.screen==='search')bindSearch();if(state.screen==='table')bindTable();if(state.screen==='settings')bindSettings();if(state.screen==='deleted')bindDeleted();
}

function bindForm(){const r=state.draft;
const back=$('#backToSource');if(back)back.onclick=backToSource;
$$('[data-district]').forEach(b=>b.onclick=()=>{r.district=b.dataset.district;r.temple='';r.templeNo='';r._templeQuery='';autoSave();render()});
const ts=$('#templeSearch');if(ts){ts.oninput=()=>{r._templeQuery=ts.value;r.temple=ts.value;r.templeNo='';autoSave();updateTempleSuggestions()}}
bindTempleSuggestionButtons();
const um=$('#useManualTemple');if(um)um.onclick=()=>{r.temple=(r._templeQuery||'').trim();r.templeNo='';showCandidateAction();autoSave();render()};
$$('[data-role]').forEach(b=>b.onclick=()=>{r.role=b.dataset.role;autoSave();render()});
const rm=$('#roleManual');if(rm)rm.oninput=()=>{if(rm.value.trim())r.role=rm.value.trim();autoSave();showCandidateAction()};
const people=peopleForTemple(r);$$('[data-person-index]').forEach(b=>b.onclick=()=>{const p=people[Number(b.dataset.personIndex)];if(p){r.role=p.role;r.name=p.name;autoSave();render()}});
const nf=$('#nameField');if(nf)nf.oninput=()=>{r.name=nf.value;autoSave();showCandidateAction()};
const as=$('#assignmentSelect');if(as)as.onchange=()=>{if(as.value==='__manual__'){r.assignment='';render()}else{r.assignment=as.value;autoSave();render()}};
const am=$('#assignmentManual');if(am)am.oninput=()=>{r.assignment=am.value;autoSave()};
const nt=$('#noteField');if(nt)nt.oninput=()=>{r.note=nt.value;autoSave()};
$$('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render()});
$$('[data-guide]').forEach(b=>b.onclick=()=>{const [k,v]=b.dataset.guide.split(':');const old=r.guide[k];if(old&&old!==v){const oldKey=`本葬${k}（${old==='有'?'案内有':'未案内'}）`;const newKey=`本葬${k}（${v==='有'?'案内有':'未案内'}）`;if(r.money[newKey]===null)r.money[newKey]=r.money[oldKey];r.money[oldKey]=null}r.guide[k]=v;autoSave();render()});
$$('[data-money]').forEach(b=>b.onclick=()=>openMoney(b.dataset.money));
const commit=$('#commitRecord');if(commit)commit.onclick=commitRecord;const dep=$('#addDeposit');if(dep)dep.onclick=()=>{if(!r.name.trim()){toast('先に持参者の氏名を入力してください');return}const parentId=r.id;const ok=commitRecord(false,false);if(!ok)return;const p=state.records.find(x=>x.id===parentId);if(!p){toast('親レコードを確認できませんでした');return}const child=blankRecord('預かり',p);state.draft=child;state.editId=null;state.mode='income';state.screen='form';autoSave();render();toast(`預かり ${child.id} の入力を開始しました`)};
const del=$('#deleteRecord');if(del)del.onclick=deleteRecord;
const add=$('#addCandidate');if(add)add.onclick=()=>{addCandidateFromDraft();$('#candidateAction')?.classList.add('hidden');toast('今後の候補に追加しました')};const once=$('#onceCandidate');if(once)once.onclick=()=>{$('#candidateAction')?.classList.add('hidden')};
showCandidateAction();
}
function showCandidateAction(){const box=$('#candidateAction');if(!box||!state.draft)return;const r=state.draft;const people=peopleForTemple(r);const known=people.some(p=>norm(p.role)===norm(r.role)&&norm(p.name)===norm(r.name));if(r.name.trim()&&!known)box.classList.remove('hidden');else box.classList.add('hidden')}
function addCandidateFromDraft(){const r=state.draft;if(r.temple&&!r.templeNo){const exists=[...state.fixedTemples,...state.addedDirectory.temples].some(t=>norm(t['寺院名'])===norm(r.temple)&&t['教区']===r.district);if(!exists)state.addedDirectory.temples.push({'宗務所':r.office||'第1宗務所','教区':r.district,'寺籍番号':'','寺院名':r.temple,'フリガナ':'','住所（数字）':'','住所（漢数字）':'','住職':'','東堂':'','副住職':'','徒弟':'','御山内':'','寺族1':'','寺族2':''})}if(r.name&&r.temple){const exists=state.addedDirectory.people.some(p=>norm(p.name)===norm(r.name)&&norm(p.role)===norm(r.role)&&((r.templeNo&&p.templeNo===r.templeNo)||p.temple===r.temple));if(!exists)state.addedDirectory.people.push({templeNo:r.templeNo,district:r.district,temple:r.temple,role:r.role,name:r.name})}autoSave()}

function openMoney(key){moneyTarget=key;moneyValue=state.draft.money[key]===null?0:Number(state.draft.money[key])||0;const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h3>${esc(key)}</h3><div class="big-amount" id="moneyDisplay">${fmt(moneyValue)} 円</div><div class="quick-grid">${[10000,20000,30000,50000,100000].map(n=>`<button class="btn" data-quick="${n}">${fmt(n)}</button>`).join('')}</div><div class="section-title">手動入力</div><input id="moneyManual" class="field field-lg" inputmode="numeric" placeholder="金額を直接入力"><div class="grid3" style="margin-top:12px"><button class="btn" id="moneyClear">クリア</button><button class="btn" id="moneyCancel">キャンセル</button><button class="btn primary" id="moneyOk">決定</button></div></div>`;document.body.append(back);const disp=()=>$('#moneyDisplay',back).textContent=fmt(moneyValue)+' 円';$$('[data-quick]',back).forEach(b=>b.onclick=()=>{moneyValue+=Number(b.dataset.quick);disp()});$('#moneyManual',back).oninput=e=>{const v=e.target.value.replace(/[^0-9]/g,'');if(v!==''){moneyValue=Number(v);disp()}};$('#moneyClear',back).onclick=()=>{moneyValue=0;disp();$('#moneyManual',back).value=''};$('#moneyCancel',back).onclick=()=>back.remove();$('#moneyOk',back).onclick=()=>{state.draft.money[moneyTarget]=moneyValue===0?0:moneyValue;back.remove();autoSave();render()};}
function commitRecord(goHome=true,renderAfter=true){const r=state.draft;if(!r||!r.name.trim()){toast('氏名は必須です');return false}delete r._templeQuery;const destination=state.returnScreen||'home';if(state.editId){const i=state.records.findIndex(x=>x.id===state.editId);if(i<0){toast('更新対象が見つかりません');return false}state.records[i]=JSON.parse(JSON.stringify(r));toast('更新しました')}else{if(state.records.some(x=>x.id===r.id)){toast('IDが重複しています');return false}state.records.push(JSON.parse(JSON.stringify(r)));toast('登録しました')}state.editId=null;state.draft=null;if(goHome){state.screen=destination;state.returnScreen=null}autoSave();if(renderAfter)render();return true}
function deleteRecord(){const r=state.draft;const destination=state.returnScreen||'home';const children=state.records.filter(x=>x.parentId===r.id);let msg=`${r.id} ${r.name} を削除しますか？`;if(children.length)msg+=`\n\n預かり ${children.length}件も一緒に削除されます。`;if(!confirm(msg))return;const ids=new Set([r.id,...children.map(x=>x.id)]);state.records=state.records.filter(x=>{if(ids.has(x.id)){state.deleted.unshift({record:JSON.parse(JSON.stringify(x)),deletedAt:new Date().toISOString()});return false}return true});state.draft=null;state.editId=null;state.screen=destination;state.returnScreen=null;autoSave();render();toast('削除しました')}

function snapshotTableScroll(){const w=$('#tableWrap');if(w)state.tableScroll={top:w.scrollTop,left:w.scrollLeft}}
function bindSearchEditButtons(root=document){$$('[data-edit]',root).forEach(b=>b.onclick=()=>editRecord(b.dataset.edit,state.screen))}
function bindSearch(){const f=$('#recordSearch');if(f)f.oninput=()=>{state.search=f.value;const box=$('#recordSearchResults');if(box){box.innerHTML=searchResultsMarkup();bindSearchEditButtons(box)}};bindSearchEditButtons();setTimeout(()=>window.scrollTo(0,state.searchScrollY||0),0)}
function refreshTableResults(){snapshotTableScroll();const box=$('#tableResults');if(box){box.innerHTML=tableMarkup(filteredRecords());bindSearchEditButtons(box);restoreTableScroll()}}
function restoreTableScroll(){const w=$('#tableWrap');if(w){w.scrollTop=state.tableScroll?.top||0;w.scrollLeft=state.tableScroll?.left||0}}
function bindTable(){const s=$('#tableSearch');if(s)s.oninput=()=>{state.search=s.value;state.tableScroll={top:0,left:0};refreshTableResults()};const d=$('#tableDistrict');if(d)d.onchange=()=>{state.filters.district=d.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const k=$('#tableKind');if(k)k.onchange=()=>{state.filters.kind=k.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const g=$('#tableGuide');if(g)g.onchange=()=>{state.filters.guide=g.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};$$('[data-table-view]').forEach(b=>b.onclick=()=>{snapshotTableScroll();state.tableView=b.dataset.tableView;render()});const w=$('#tableWrap');if(w)w.onscroll=()=>{state.tableScroll={top:w.scrollTop,left:w.scrollLeft}};bindSearchEditButtons();setTimeout(restoreTableScroll,0)}
function editRecord(id,source=state.screen){const r=state.records.find(x=>x.id===id);if(!r)return;if(source==='table')snapshotTableScroll();if(source==='search')state.searchScrollY=window.scrollY;state.draft=JSON.parse(JSON.stringify(r));state.editId=id;state.mode='income';state.returnScreen=source;state.screen='form';render();autoSave()}

function bindSettings(){const b=$('#backupDir');if(b)b.onclick=backupDirectory;const r=$('#restoreDir'),rf=$('#dirFile');if(r&&rf){r.onclick=()=>rf.click();rf.onchange=e=>restoreDirectory(e.target.files[0])}const rd=$('#reloadDirectory'),df=$('#directoryExcel');if(rd&&df){rd.onclick=()=>df.click();df.onchange=e=>reloadFixedDirectory(e.target.files[0])}const cw=$('#clearWorkspace');if(cw)cw.onclick=()=>{if(confirm('現在の入力データ・下書き・削除履歴を全て消去しますか？')){state.records=[];state.draft=null;state.deleted=[];state.sourceLoaded=false;state.baseName='本葬受付台帳';autoSave();render();toast('作業データを消去しました')}}}
function bindDeleted(){$$('[data-restore]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.restore);const d=state.deleted[i];if(!d)return;if(state.records.some(r=>r.id===d.record.id)){toast('同じIDが存在するため復元できません');return}state.records.push(d.record);state.deleted.splice(i,1);autoSave();render();toast('復元しました')})}
function backupDirectory(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state.addedDirectory},null,2)],{type:'application/json'});downloadBlob(blob,'追加名簿_'+stamp()+'.json')}
function restoreDirectory(file){if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);state.addedDirectory={temples:Array.isArray(j.temples)?j.temples:[],people:Array.isArray(j.people)?j.people:[]};autoSave();render();toast('追加名簿を読み込みました')}catch(e){alert('JSONを読み込めませんでした')}};fr.readAsText(file)}
function reloadFixedDirectory(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});const req=['宗務所','教区','寺籍番号','寺院名','フリガナ','住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];const miss=req.filter(h=>!(h in (rows[0]||{})));if(miss.length)throw new Error('不足列: '+miss.join('、'));state.fixedTemples=rows;dbSet('fixedTemplesOverride',rows);render();toast('第1宗務所名簿を更新しました')}catch(e){alert('名簿を読み込めませんでした。\n'+e.message)}};fr.readAsArrayBuffer(file)}

function rowFromRecord(r,no){const o={'No.':no,'レコードID':r.id,'親ID':r.parentId||'','受付区分':r.kind,'持参者ID':r.carrierId||'','宗務所':r.office||'第1宗務所','教区':r.district||'','寺籍番号':r.templeNo||'','寺号':r.temple||'','役職':r.role||'','氏名':r.name||'','配役':r.assignment||'','備考':r.note||''};INCOME.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['プラス小計']=sum(INCOME,r);EXPENSE.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['マイナス小計']=sum(EXPENSE,r);return o}
function recordFromRow(row){const money=blankMoney();INCOME.concat(EXPENSE).forEach(k=>{const v=row[k];money[k]=(v===undefined||v===null||v==='')?null:Number(v)});const id=String(row['レコードID']||'');return {no:row['No.']||null,id,parentId:String(row['親ID']||''),kind:row['受付区分']||'本人',carrierId:String(row['持参者ID']||''),office:row['宗務所']||'第1宗務所',district:row['教区']||'',templeNo:String(row['寺籍番号']||''),temple:row['寺号']||'',role:row['役職']||'',name:row['氏名']||'',assignment:row['配役']||'',note:row['備考']||'',money,guide:{謝誼:money['本葬謝誼（未案内）']!==null?'無':money['本葬謝誼（案内有）']!==null?'有':'',回心:money['本葬回心（未案内）']!==null?'無':money['本葬回心（案内有）']!==null?'有':''}}}
function importExcel(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)throw new Error('データがありません');const headers=Object.keys(rows[0]);const required=['レコードID','受付区分','氏名',...INCOME,...EXPENSE];const miss=required.filter(h=>!headers.includes(h));if(miss.length)throw new Error('必要列が見つかりません：'+miss.join('、'));const ids=new Set();const recs=rows.map(recordFromRow).filter(r=>r.id&&r.name);for(const r of recs){if(ids.has(r.id))throw new Error('レコードIDが重複しています：'+r.id);ids.add(r.id)}state.records=recs;state.baseName=file.name.replace(/\.xlsx?$/i,'').replace(/_\d{4}_\d{4}$/,'');state.sourceLoaded=true;state.draft=null;state.editId=null;autoSave();render();toast('Excelを読み込みました')}catch(e){alert('このExcelは読み込めません。\n\n'+e.message+'\n\n列構造を確認してください。')}};fr.readAsArrayBuffer(file)}
function exportExcel(){if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const data=state.records.map((r,i)=>rowFromRecord(r,i+1));const ws=XLSX.utils.json_to_sheet(data,{header:APP_HEADERS});ws['!cols']=APP_HEADERS.map(h=>({wch:['備考'].includes(h)?28:['氏名','配役','寺号'].includes(h)?18:14}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'受付台帳');const filename=safeName(state.baseName)+'_'+stamp()+'.xlsx';XLSX.writeFile(wb,filename,{compression:true});toast('Excel保存を開始しました')}
function stamp(){const d=new Date();return String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')}
function safeName(s){return (s||'本葬受付台帳').replace(/[\\/:*?"<>|]/g,'_')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function init(){try{const w=await dbGet('workspace');if(w){state.records=Array.isArray(w.records)?w.records:[];state.draft=w.draft||null;state.baseName=w.baseName||state.baseName;state.sourceLoaded=!!w.sourceLoaded;state.deleted=Array.isArray(w.deleted)?w.deleted:[];state.search=w.search||'';state.filters={district:'',kind:'',guide:'',...(w.filters||{})};state.tableView=w.tableView==='full'?'full':'normal'}const a=await dbGet('addedDirectory');if(a)state.addedDirectory=a;const f=await dbGet('fixedTemplesOverride');if(Array.isArray(f)&&f.length)state.fixedTemples=f}catch(e){console.warn(e)}if('serviceWorker' in navigator && location.protocol.startsWith('http')){
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
render()}
init();
})();