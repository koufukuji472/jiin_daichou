(() => {
'use strict';
const APP_VERSION = '0.52';
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const INCOME = ['密葬香資','密葬供花','密葬供物','本葬香資','本葬供花料','本葬供物料','問候','献香'];
const EXPENSE = ['密葬謝誼','密葬回心','中陰謝誼','本葬謝誼（案内有）','本葬謝誼（未案内）','本葬回心（案内有）','本葬回心（未案内）','路資','菓誼','内謝'];
const APP_HEADERS = ['No.','レコードID','親ID','受付区分','持参者ID','宗務所','教区','寺籍番号','寺号','郵便番号','住所（数字）','住所（漢数字）','役職','氏名','配役','備考',...INCOME,'プラス小計',...EXPENSE,'マイナス小計'];
const FULL_COL_WIDTH={
  'No.':46,'寺号':64,'氏名':108,'レコードID':78,'親ID':78,'受付区分':64,'持参者ID':78,'宗務所':82,'教区':72,'寺籍番号':70,
  '郵便番号':84,'住所（数字）':190,'住所（漢数字）':220,'役職':72,'配役':112,'備考':150,'プラス小計':98,'マイナス小計':98
};
function fullColWidth(h){return FULL_COL_WIDTH[h]||([...INCOME,...EXPENSE].includes(h)?88:82)}
function fullColStyle(h){const w=fullColWidth(h);return `width:${w}px;min-width:${w}px;max-width:${w}px`}
const ROLE_BUTTONS=['住職','東堂','副住職','徒弟','寺族','御山内'];
const PERSON_COLS=['住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];
const NAME_USES=['ハガキ','封筒','領収書','可漏','謝誼袋','部屋','引き物','下足'];
const NAME_RULE_ROLES=['住職','東堂','副住職','徒弟','御山内','寺族'];
const NAME_MODE_LABELS={postal:'郵便',temple:'寺院名',person:'個人名'};
const state={screen:'home',records:[],draft:null,editId:null,mode:'income',baseName:'本葬受付台帳',sourceLoaded:false,addedDirectory:{temples:[],people:[]},deleted:[],fixedTemples:window.FIXED_TEMPLES||[],search:'',filters:{district:'',kind:'',guide:'',columns:{}},returnScreen:null,tableView:'normal',tableScroll:{top:0,left:0},searchScrollY:0,rules:null,rulePersonSearch:'',cashControl:null,editNav:{source:null,ids:[]},basicInfoExpanded:false,nameRules:null,nameRuleUse:'ハガキ',printKind:null,receiptSettings:null,receiptIssueMode:'本葬',receiptTargetMode:'一人',receiptSingleNo:1,receiptNoRange:'',postcardSettings:null,postcardTargetMode:'一人',postcardSingleNo:1,postcardNoRange:''};
let moneyTarget=null, moneyValue=null, saveTimer=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmt(n){if(n===null||n===undefined||n==='') return ''; const x=Number(n); return Number.isFinite(x)?x.toLocaleString('ja-JP'):''}
function hiraToKata(s=''){return s.replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));}
function norm(s=''){return hiraToKata(String(s).normalize('NFKC')).replace(/[\s　]/g,'').toUpperCase();}
function addressToKanji(s=''){const map={'0':'〇','1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'七','8':'八','9':'九'};return String(s||'').normalize('NFKC').replace(/[0-9]/g,d=>map[d]||d)}
function normalizePostalCode(s=''){const d=String(s||'').normalize('NFKC').replace(/[^0-9]/g,'').slice(0,7);return d.length>3?`${d.slice(0,3)}-${d.slice(3)}`:d}
function postalDigits(s=''){return String(s||'').normalize('NFKC').replace(/[^0-9]/g,'').slice(0,7)}
function lookupPostalAddress(zip){
  const digits=postalDigits(zip);
  if(digits.length!==7)return Promise.reject(new Error('郵便番号は7桁で入力してください'));
  return new Promise((resolve,reject)=>{
    const cb='__zipLookup_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const script=document.createElement('script');
    let done=false;
    const cleanup=()=>{if(done)return;done=true;try{delete window[cb]}catch(_){};script.remove();clearTimeout(timer)};
    window[cb]=(data)=>{cleanup();if(!data||Number(data.status)!==200){reject(new Error(data?.message||'住所を取得できませんでした'));return}const results=Array.isArray(data.results)?data.results:[];if(!results.length){reject(new Error('該当する住所がありません'));return}resolve(results)};
    script.onerror=()=>{cleanup();reject(new Error('住所検索APIへ接続できませんでした'))};
    script.src=`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${encodeURIComponent(digits)}&callback=${encodeURIComponent(cb)}`;
    document.head.appendChild(script);
    const timer=setTimeout(()=>{cleanup();reject(new Error('住所検索がタイムアウトしました'))},9000);
  });
}
function postalResultText(x){return [x?.address1,x?.address2,x?.address3].filter(Boolean).join('')}
function choosePostalResult(results){
  if(results.length===1)return Promise.resolve(results[0]);
  return new Promise(resolve=>{
    const back=document.createElement('div');back.className='modal-backdrop';
    back.innerHTML=`<div class="modal" style="max-width:620px"><h3>住所候補を選択</h3><div class="muted" style="margin-bottom:10px">同じ郵便番号に複数の町域があります。</div><div id="postalCandidates"></div><button class="btn wide" id="postalCandidateCancel" style="margin-top:12px">キャンセル</button></div>`;
    document.body.append(back);
    const box=$('#postalCandidates',back);
    results.forEach((x,i)=>{const b=document.createElement('button');b.className='btn wide';b.style.marginBottom='8px';b.textContent=postalResultText(x);b.onclick=()=>{back.remove();resolve(x)};box.appendChild(b)});
    $('#postalCandidateCancel',back).onclick=()=>{back.remove();resolve(null)};
  });
}
async function fillAddressFromPostal(r,{force=false}={}){
  const digits=postalDigits(r?.postalCode||'');
  if(digits.length!==7){toast('郵便番号を7桁で入力してください');return false}
  const status=$('#postalLookupStatus');if(status)status.textContent='住所を検索中…';
  try{
    const results=await lookupPostalAddress(digits);const picked=await choosePostalResult(results);if(!picked){if(status)status.textContent='';return false}
    const base=postalResultText(picked);if(!base)throw new Error('住所データが空です');
    if(force||!String(r.addressNumeric||'').trim()){
      r.addressNumeric=base;r.addressKanji=addressToKanji(base);
      const an=$('#addressNumericField');if(an)an.value=r.addressNumeric;const ak=$('#addressKanjiField');if(ak)ak.value=r.addressKanji;
    }
    r.postalCode=normalizePostalCode(digits);const pc=$('#postalCodeField');if(pc)pc.value=r.postalCode;
    if(status)status.textContent=`取得：${base}（番地以降を追記してください）`;
    autoSave();toast('郵便番号から住所を取得しました');return true;
  }catch(e){if(status)status.textContent='住所を取得できませんでした';toast(e.message||'住所を取得できませんでした');return false}
}
function ensureAddressFields(r){if(!r)return r;if(!Object.prototype.hasOwnProperty.call(r,'postalCode'))r.postalCode='';if(!Object.prototype.hasOwnProperty.call(r,'addressNumeric'))r.addressNumeric='';if(!Object.prototype.hasOwnProperty.call(r,'addressKanji'))r.addressKanji='';return r}
function applyTempleAddress(r,t){if(!r||!t)return;r.postalCode=String(t['郵便番号']||'');r.addressNumeric=String(t['住所（数字）']||'');r.addressKanji=String(t['住所（漢数字）']||'')||addressToKanji(r.addressNumeric)}
function roleFromCol(c){return c.startsWith('寺族')?'寺族':c}
function blankMoney(){const o={};[...INCOME,...EXPENSE].forEach(k=>o[k]=null);return o}

function defaultReceiptSettings(){return {phone:'',mobile:'',address:'',mountain:'',temple:'',sealEnabled:false,sealDataUrl:'',history:{},layoutVersion:3,layout:{recipientScale:1,recipientY:0,amountScale:1,amountY:0,detailScale:1,detailY:0,issuerScale:1,issuerY:0,sealScale:1,sealX:0,sealY:0}}}
function ensureReceiptSettings(){const d=defaultReceiptSettings();state.receiptSettings={...d,...(state.receiptSettings||{})};state.receiptSettings.layout={...d.layout,...(state.receiptSettings.layout||{})};state.receiptSettings.history=state.receiptSettings.history&&typeof state.receiptSettings.history==='object'?state.receiptSettings.history:{};if((Number(state.receiptSettings.layoutVersion)||0)<2){state.receiptSettings.layout.recipientScale=1;state.receiptSettings.layout.amountY=0;state.receiptSettings.layout.issuerScale=1;state.receiptSettings.layoutVersion=2}if((Number(state.receiptSettings.layoutVersion)||0)<3){state.receiptSettings.layout.sealY=0;state.receiptSettings.layoutVersion=3}return state.receiptSettings}

function defaultPostcardSettings(){return {layoutVersion:4,layout:{zipX:0,zipY:0,zipScale:1,zipDigitX:[0,0,0,0,0,0,0],addressX:5,addressY:-5,addressScale:2,titleX:0,titleY:-10,titleScale:1.4,nameX:0,nameY:0,nameScale:1.6,nameGap:1,gyojiX:-7,gyojiY:0}}}
function ensurePostcardSettings(){const d=defaultPostcardSettings();const old=state.postcardSettings||{};const oldVersion=Number(old.layoutVersion)||0;state.postcardSettings={...d,...old};state.postcardSettings.layout={...d.layout,...(old.layout||{})};const a=state.postcardSettings.layout.zipDigitX;if(!Array.isArray(a)||a.length!==7)state.postcardSettings.layout.zipDigitX=[0,0,0,0,0,0,0];if(typeof state.postcardSettings.layout.nameGap!=='number')state.postcardSettings.layout.nameGap=d.layout.nameGap;if(oldVersion<4){const keepZip={zipX:Number(state.postcardSettings.layout.zipX)||0,zipY:Number(state.postcardSettings.layout.zipY)||0,zipScale:Number(state.postcardSettings.layout.zipScale)||1,zipDigitX:[...(state.postcardSettings.layout.zipDigitX||[0,0,0,0,0,0,0])]};state.postcardSettings.layout={...d.layout,...keepZip};state.postcardSettings.layoutVersion=4}delete state.postcardSettings.layout.gyojiScale;return state.postcardSettings}

function defaultRules(){return {kaishinLine:null,noReturnDistricts:[],fullReturnPeople:[],honorarium:{},appliedCount:0}}
function ensureRules(){const d=defaultRules();state.rules={...d,...(state.rules||{})};state.rules.noReturnDistricts=Array.isArray(state.rules.noReturnDistricts)?state.rules.noReturnDistricts:[];state.rules.fullReturnPeople=Array.isArray(state.rules.fullReturnPeople)?state.rules.fullReturnPeople:[];state.rules.honorarium=state.rules.honorarium&&typeof state.rules.honorarium==='object'?state.rules.honorarium:{};state.rules.appliedCount=Number(state.rules.appliedCount)||0;return state.rules}
function defaultCashControl(){
  const defs={A:{name:'A 密葬',items:['密葬謝誼']},B:{name:'B 中陰',items:['密葬回心','中陰謝誼']},C:{name:'C 本葬前',items:['本葬謝誼（案内有）','路資']},D:{name:'D 本葬通夜',items:['本葬謝誼（未案内）','本葬回心（未案内）']},E:{name:'E 本葬葬儀',items:['本葬回心（案内有）','菓誼','内謝']}};
  const blocks={};Object.entries(defs).forEach(([id,d])=>blocks[id]={id,name:d.name,items:[...d.items],allocated:null,actualRemaining:null,closed:null});
  const incomeActual={};INCOME.forEach(k=>incomeActual[k]=null);return {totalInitial:null,blocks,incomeActual};
}
function ensureCashControl(){
  const d=defaultCashControl();
  if(!state.cashControl||typeof state.cashControl!=='object')state.cashControl=defaultCashControl();
  const c=state.cashControl;
  if(!Object.prototype.hasOwnProperty.call(c,'totalInitial'))c.totalInitial=null;
  if(!c.blocks||typeof c.blocks!=='object')c.blocks={};
  if(!c.incomeActual||typeof c.incomeActual!=='object')c.incomeActual={};
  for(const item of INCOME)if(!Object.prototype.hasOwnProperty.call(c.incomeActual,item))c.incomeActual[item]=null;
  for(const id of ['A','B','C','D','E']){
    let b=c.blocks[id];
    if(!b||typeof b!=='object'){b={...d.blocks[id],items:[...d.blocks[id].items]};c.blocks[id]=b}
    if(!b.id)b.id=id;
    if(!b.name)b.name=d.blocks[id].name;
    if(!Array.isArray(b.items))b.items=[...d.blocks[id].items];
    if(!Object.prototype.hasOwnProperty.call(b,'allocated'))b.allocated=null;
    if(!Object.prototype.hasOwnProperty.call(b,'actualRemaining'))b.actualRemaining=null;
    if(!Object.prototype.hasOwnProperty.call(b,'closed'))b.closed=null;
  }
  const assigned=new Set();
  for(const id of ['A','B','C','D','E'])c.blocks[id].items=c.blocks[id].items.filter(x=>EXPENSE.includes(x)&&!assigned.has(x)&&(assigned.add(x)||true));
  EXPENSE.forEach(item=>{if(!assigned.has(item)){c.blocks.E.items.push(item);assigned.add(item)}});
  return c;
}
function nameTitleChoices(role){
  const m={
    '住職':[['{寺号}尊董','○○寺尊董'],['{寺号}住職','○○寺住職']],
    '東堂':[['{寺号}東堂','○○寺東堂']],
    '副住職':[['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡'],['{寺号}副住職','○○寺副住職']],
    '徒弟':[['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡'],['{寺号}徒弟','○○寺徒弟']],
    '御山内':[['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡']],
    '寺族':[['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡'],['{寺号}寺族','○○寺寺族']]
  };return m[role]||[];
}
function nameHonorificChoices(role){if(role==='住職'||role==='東堂')return ['老宗師','老師','様'];if(['副住職','徒弟','御山内'].includes(role))return ['宗師','様'];if(role==='寺族')return ['様'];return []}
function nameShortChoices(role){
  const m={
    '住職':[['{寺号寺抜き}方丈','○○方丈'],['{寺号}方丈様','○○寺方丈様'],['{寺号}様','○○寺様'],['{氏名}様','氏名様']],
    '東堂':[['{寺号寺抜き}東堂','○○東堂'],['{寺号}東堂様','○○寺東堂様'],['{氏名}様','氏名様']],
    '副住職':[['{氏名}様','氏名様'],['{寺号}副住職','○○寺副住職'],['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡']],
    '徒弟':[['{氏名}様','氏名様'],['{寺号}徒弟','○○寺徒弟'],['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡']],
    '御山内':[['{氏名}様','氏名様'],['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡']],
    '寺族':[['{氏名}様','氏名様'],['{寺号}寺族','○○寺寺族'],['{寺号}御山内','○○寺御山内'],['{寺号}御山裡','○○寺御山裡']]
  };return m[role]||[];
}
function defaultNameRoleConfig(role){
  const title=nameTitleChoices(role)[0]?.[0]||'{寺号}{役職}';
  const honorific=role==='住職'||role==='東堂'?'老師':(['副住職','徒弟','御山内'].includes(role)?'宗師':'様');
  const gyoji=['住職','東堂','副住職','徒弟'].includes(role);
  const short=nameShortChoices(role)[0]?.[0]||'{氏名}様';
  return {titleTemplate:title,titleCustom:'',honorific,honorificCustom:'',gyoji,shortTemplate:short,shortCustom:''};
}
function defaultNameRules(){
  const modes={'ハガキ':'postal','封筒':'postal','領収書':'person','可漏':'temple','謝誼袋':'person','部屋':'temple','引き物':'temple','下足':'temple'};
  const uses={};
  for(const use of NAME_USES){
    const roles={};for(const role of NAME_RULE_ROLES)roles[role]=defaultNameRoleConfig(role);
    uses[use]={mode:modes[use]||'temple',roles,titlePreset:'oyamauchi',honorificPreset:'老師',gyojiPreset:'on',templeSuffixPreset:'noTemple',templeSubPreset:'name',templeSamaPreset:'off'};
  }
  // ハガキ・封筒：従来の郵便既定値。
  for(const use of ['ハガキ','封筒']){
    applyNameTitlePreset(uses[use],'oyamauchi');applyHonorificPreset(uses[use],'老師');applyGyojiPreset(uses[use],'on');
  }
  // 領収書・謝誼袋：個人名。○○寺住職/東堂/副住職、徒弟・御山内は御山内、寺族は寺族。全員「様」。
  for(const use of ['領収書','謝誼袋']){
    const u=uses[use];u.mode='person';
    const titles={'住職':'{寺号}住職','東堂':'{寺号}東堂','副住職':'{寺号}副住職','徒弟':'{寺号}御山内','御山内':'{寺号}御山内','寺族':'{寺号}寺族'};
    for(const role of NAME_RULE_ROLES){setTemplateChoice(u.roles[role],'titleTemplate',titles[role]);u.roles[role].honorific='様';u.roles[role].honorificCustom='';u.roles[role].gyoji=false}
    u.titlePreset='custom';u.honorificPreset='様';u.gyojiPreset='off';
  }
  // 可漏：寺院名。住職・東堂は寺を抜いた肩書、その他は氏名様。
  {
    const u=uses['可漏'];u.mode='temple';u.templeSamaPreset='off';
    setTemplateChoice(u.roles['住職'],'shortTemplate','{寺号寺抜き}方丈');setTemplateChoice(u.roles['東堂'],'shortTemplate','{寺号寺抜き}東堂');
    for(const role of ['副住職','徒弟','御山内','寺族'])setTemplateChoice(u.roles[role],'shortTemplate','{氏名}様');
    u.templeSuffixPreset='noTemple';u.templeSubPreset='name';u.templeSamaPreset='custom';
  }
  // 部屋：○○寺様 / ○○寺東堂様 / 副住職以下は氏名様。
  {
    const u=uses['部屋'];u.mode='temple';
    setTemplateChoice(u.roles['住職'],'shortTemplate','{寺号}様');setTemplateChoice(u.roles['東堂'],'shortTemplate','{寺号}東堂様');
    for(const role of ['副住職','徒弟','御山内','寺族'])setTemplateChoice(u.roles[role],'shortTemplate','{氏名}様');
    u.templeSuffixPreset='custom';u.templeSubPreset='name';u.templeSamaPreset='on';
  }
  // 引き物・下足：部屋と同じだが寺族だけ○○寺寺族様。
  for(const use of ['引き物','下足']){
    const u=uses[use];u.mode='temple';
    setTemplateChoice(u.roles['住職'],'shortTemplate','{寺号}様');setTemplateChoice(u.roles['東堂'],'shortTemplate','{寺号}東堂様');
    for(const role of ['副住職','徒弟','御山内'])setTemplateChoice(u.roles[role],'shortTemplate','{氏名}様');
    setTemplateChoice(u.roles['寺族'],'shortTemplate','{寺号}寺族様');
    u.templeSuffixPreset='custom';u.templeSubPreset='custom';u.templeSamaPreset='on';
  }
  // 寺院名モードの御侍史は基本OFF。必要な用途・役職だけ後からONにする。
  for(const use of NAME_USES){if(uses[use].mode==='temple'){for(const role of NAME_RULE_ROLES)uses[use].roles[role].gyoji=false;uses[use].gyojiPreset='off'}}
  return {version:4,uses};
}
function detectNameTitlePreset(u){
  const vals={副住職:effectiveNameTitle(u.roles['副住職']),徒弟:effectiveNameTitle(u.roles['徒弟']),御山内:effectiveNameTitle(u.roles['御山内']),寺族:effectiveNameTitle(u.roles['寺族'])};
  if(Object.values(vals).every(v=>v==='{寺号}御山内'))return 'oyamauchi';
  if(Object.values(vals).every(v=>v==='{寺号}御山裡'))return 'oyamazato';
  if(vals['副住職']==='{寺号}副住職'&&vals['徒弟']==='{寺号}徒弟'&&vals['御山内']==='{寺号}御山内'&&vals['寺族']==='{寺号}寺族')return 'actual';
  return 'custom';
}
function detectHonorificPreset(u){
  const h=role=>effectiveHonorific(u.roles[role]);
  if(NAME_RULE_ROLES.every(role=>h(role)==='様'))return '様';
  if(h('住職')==='老師'&&h('東堂')==='老師'&&['副住職','徒弟','御山内'].every(role=>h(role)==='宗師')&&h('寺族')==='様')return '老師';
  if(h('住職')==='老宗師'&&h('東堂')==='老宗師'&&['副住職','徒弟','御山内'].every(role=>h(role)==='宗師')&&h('寺族')==='様')return '老宗師';
  return 'custom';
}
function detectGyojiPreset(u){const eligible=['住職','東堂','副住職','徒弟'];if(NAME_RULE_ROLES.every(role=>!u.roles[role].gyoji))return 'off';if(eligible.every(role=>u.roles[role].gyoji)&&['御山内','寺族'].every(role=>!u.roles[role].gyoji))return 'on';return 'custom'}
function shortBase(cfg){return effectiveShortTemplate(cfg).replace(/様$/,'')}
function detectTempleSuffixPreset(u){const a=shortBase(u.roles['住職']),b=shortBase(u.roles['東堂']);if(a==='{寺号寺抜き}方丈'&&b==='{寺号寺抜き}東堂')return 'noTemple';if(a==='{寺号}方丈'&&b==='{寺号}東堂')return 'withTemple';return 'custom'}
function detectTempleSubPreset(u){const vals={副住職:shortBase(u.roles['副住職']),徒弟:shortBase(u.roles['徒弟']),御山内:shortBase(u.roles['御山内']),寺族:shortBase(u.roles['寺族'])};if(Object.values(vals).every(v=>v==='{氏名}'))return 'name';if(Object.values(vals).every(v=>v==='{寺号}御山内'))return 'oyamauchi';if(Object.values(vals).every(v=>v==='{寺号}御山裡'))return 'oyamazato';if(vals['副住職']==='{寺号}副住職'&&vals['徒弟']==='{寺号}徒弟'&&vals['御山内']==='{寺号}御山内'&&vals['寺族']==='{寺号}寺族')return 'actual';return 'custom'}
function detectTempleSamaPreset(u){const vals=NAME_RULE_ROLES.map(role=>effectiveShortTemplate(u.roles[role]));if(vals.every(v=>/様$/.test(v)))return 'on';if(vals.every(v=>!/様$/.test(v)))return 'off';return 'custom'}
function ensureNameRules(){
  const d=defaultNameRules();if(!state.nameRules||typeof state.nameRules!=='object')state.nameRules=d;
  if(!state.nameRules.uses||typeof state.nameRules.uses!=='object')state.nameRules.uses={};
  for(const use of NAME_USES){
    if(!state.nameRules.uses[use]||typeof state.nameRules.uses[use]!=='object')state.nameRules.uses[use]=d.uses[use];
    const u=state.nameRules.uses[use];if(!['postal','temple','person'].includes(u.mode))u.mode=d.uses[use].mode;if(!u.roles||typeof u.roles!=='object')u.roles={};for(const role of NAME_RULE_ROLES){u.roles[role]={...d.uses[use].roles[role],...(u.roles[role]||{})};}
    if(!['oyamauchi','oyamazato','actual','custom'].includes(u.titlePreset))u.titlePreset=detectNameTitlePreset(u);
    if(!['老宗師','老師','様','custom'].includes(u.honorificPreset))u.honorificPreset=detectHonorificPreset(u);
    if(!['on','off','custom'].includes(u.gyojiPreset))u.gyojiPreset=detectGyojiPreset(u);
    if(!['noTemple','withTemple','custom'].includes(u.templeSuffixPreset))u.templeSuffixPreset=detectTempleSuffixPreset(u);
    if(!['name','oyamauchi','oyamazato','actual','custom'].includes(u.templeSubPreset))u.templeSubPreset=detectTempleSubPreset(u);
    if(!['on','off','custom'].includes(u.templeSamaPreset))u.templeSamaPreset=detectTempleSamaPreset(u);
  }
  // v4: 寺院名モードでも御侍史を設定可能にした。旧版には設定UIが無かったため初回移行時はOFFにする。
  if(Number(state.nameRules.version||0)<4){for(const use of NAME_USES){const u=state.nameRules.uses[use];if(u.mode==='temple'){for(const role of NAME_RULE_ROLES)u.roles[role].gyoji=false;u.gyojiPreset='off'}}}
  state.nameRules.version=4;if(!NAME_USES.includes(state.nameRuleUse))state.nameRuleUse='ハガキ';return state.nameRules;
}
function setTemplateChoice(cfg,key,val){cfg[key]=val;const customKey=key==='titleTemplate'?'titleCustom':'shortCustom';cfg[customKey]=''}
function applyNameTitlePreset(u,preset){
  setTemplateChoice(u.roles['住職'],'titleTemplate','{寺号}尊董');setTemplateChoice(u.roles['東堂'],'titleTemplate','{寺号}東堂');
  const roles=['副住職','徒弟','御山内','寺族'];for(const role of roles){let t='{寺号}御山内';if(preset==='oyamazato')t='{寺号}御山裡';else if(preset==='actual')t=`{寺号}${role}`;setTemplateChoice(u.roles[role],'titleTemplate',t)}u.titlePreset=preset;
}
function applyHonorificPreset(u,preset){for(const role of NAME_RULE_ROLES){let v='様';if(preset!=='様'){if(role==='住職'||role==='東堂')v=preset;else if(['副住職','徒弟','御山内'].includes(role))v='宗師'}u.roles[role].honorific=v;u.roles[role].honorificCustom=''}u.honorificPreset=preset}
function applyGyojiPreset(u,preset){const eligible=['住職','東堂','副住職','徒弟'];for(const role of NAME_RULE_ROLES)u.roles[role].gyoji=preset==='on'&&eligible.includes(role);u.gyojiPreset=preset}
function withSama(t,on){return String(t||'').replace(/様$/,'')+(on?'様':'')}
function applyTempleSamaPreset(u,preset){for(const role of NAME_RULE_ROLES){const c=u.roles[role];if(c.shortTemplate==='__custom__')c.shortCustom=withSama(c.shortCustom,preset==='on');else c.shortTemplate=withSama(c.shortTemplate,preset==='on')}u.templeSamaPreset=preset}
function applyTempleSuffixPreset(u,preset){const on=u.templeSamaPreset==='on';setTemplateChoice(u.roles['住職'],'shortTemplate',withSama(preset==='withTemple'?'{寺号}方丈':'{寺号寺抜き}方丈',on));setTemplateChoice(u.roles['東堂'],'shortTemplate',withSama(preset==='withTemple'?'{寺号}東堂':'{寺号寺抜き}東堂',on));u.templeSuffixPreset=preset}
function applyTempleSubPreset(u,preset){const on=u.templeSamaPreset==='on';for(const role of ['副住職','徒弟','御山内','寺族']){let t='{氏名}';if(preset==='oyamauchi')t='{寺号}御山内';else if(preset==='oyamazato')t='{寺号}御山裡';else if(preset==='actual')t=`{寺号}${role}`;setTemplateChoice(u.roles[role],'shortTemplate',withSama(t,on))}u.templeSubPreset=preset}
function stripTempleSuffix(s=''){const x=String(s||'').trim();return x.endsWith('寺')?x.slice(0,-1):x}
function applyNameTemplate(tpl,r){return String(tpl||'').replaceAll('{寺号}',r.temple||'').replaceAll('{寺号寺抜き}',stripTempleSuffix(r.temple||'')).replaceAll('{氏名}',r.name||'').replaceAll('{役職}',r.role||'').trim()}
function effectiveNameTitle(cfg){return cfg.titleTemplate==='__custom__'?(cfg.titleCustom||''):cfg.titleTemplate}
function effectiveHonorific(cfg){return cfg.honorific==='__custom__'?(cfg.honorificCustom||''):cfg.honorific}
function effectiveShortTemplate(cfg){return cfg.shortTemplate==='__custom__'?(cfg.shortCustom||''):cfg.shortTemplate}
function nameRoleKey(role){return NAME_RULE_ROLES.includes(role)?role:''}
function generatedNameForUse(r,use){
  const role=nameRoleKey(r.role);if(!role)return String(r.name||r.temple||'').trim();
  const rules=ensureNameRules(),u=rules.uses[use]||rules.uses['ハガキ'],cfg=u.roles[role]||defaultNameRoleConfig(role);
  if(u.mode==='temple'){const first=applyNameTemplate(effectiveShortTemplate(cfg),r);return cfg.gyoji?[first,'御侍史'].filter(Boolean).join('\n'):first}
  const first=applyNameTemplate(effectiveNameTitle(cfg),r),hon=effectiveHonorific(cfg),second=[String(r.name||'').trim(),hon].filter(Boolean).join(' ');
  const lines=[first,second].filter(Boolean);if(u.mode==='postal'&&cfg.gyoji)lines.push('御侍史');return lines.join('\n');
}
function namePartsForUse(r,use){
  const role=nameRoleKey(r.role),rules=ensureNameRules(),u=rules.uses[use]||rules.uses['ハガキ'];
  if(!role){const free=String(r.name||r.temple||'').trim();return {line1:free,line2:'',honorific1:'',honorific2:'',complete:free}}
  const cfg=u.roles[role]||defaultNameRoleConfig(role);
  if(u.mode==='temple'){
    const line1=applyNameTemplate(effectiveShortTemplate(cfg),r);
    const honorific2=cfg.gyoji?'御侍史':'';
    return {line1,line2:'',honorific1:'',honorific2,complete:[line1,honorific2].filter(Boolean).join('\n')};
  }
  const line1=applyNameTemplate(effectiveNameTitle(cfg),r),line2=String(r.name||'').trim(),honorific1=effectiveHonorific(cfg),honorific2=(u.mode==='postal'&&cfg.gyoji)?'御侍史':'';
  const second=[line2,honorific1].filter(Boolean).join(' ');
  return {line1,line2,honorific1,honorific2,complete:[line1,second,honorific2].filter(Boolean).join('\n')};
}
function nameUseRows(use){return state.records.map((r,i)=>{ensureAddressFields(r);const p=namePartsForUse(r,use);return {'No.':i+1,'レコードID':r.id,'受付区分':r.kind,'教区':r.district||'','寺号':r.temple||'','郵便番号':r.postalCode||'','住所（数字）':r.addressNumeric||'','住所（漢数字）':r.addressKanji||'','役職':r.role||'','氏名':r.name||'','配役':r.assignment||'','表記1':p.line1,'表記2（氏名）':p.line2,'敬称1':p.honorific1,'敬称2':p.honorific2,'完成表記':p.complete}})}
function nameRulesSettingsRows(){const rows=[['用途','モード','役職','寺号＋役職表記','氏名敬称1','御侍史','寺院名モード表記','寺号役職一括','敬称一括','御侍史一括','寺院名寺号','寺院名副住職以下','様一括']];const n=ensureNameRules();for(const use of NAME_USES){const u=n.uses[use];for(const role of NAME_RULE_ROLES){const c=u.roles[role];rows.push([use,NAME_MODE_LABELS[u.mode]||u.mode,role,effectiveNameTitle(c),effectiveHonorific(c),c.gyoji?'ON':'OFF',effectiveShortTemplate(c),u.titlePreset,u.honorificPreset,u.gyojiPreset,u.templeSuffixPreset,u.templeSubPreset,u.templeSamaPreset])}}return rows}
function nameRulesFromSettingsSheet(ws){try{const rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)return null;const n=defaultNameRules();const rev={'郵便':'postal','寺院名':'temple','個人名':'person',postal:'postal',temple:'temple',person:'person'};for(const row of rows){const use=String(row['用途']||''),role=String(row['役職']||'');if(!NAME_USES.includes(use)||!NAME_RULE_ROLES.includes(role))continue;const u=n.uses[use],c=u.roles[role];u.mode=rev[String(row['モード']||'')]||u.mode;const title=String(row['寺号＋役職表記']||'');if(title){const vals=nameTitleChoices(role).map(x=>x[0]);if(vals.includes(title)){c.titleTemplate=title;c.titleCustom=''}else{c.titleTemplate='__custom__';c.titleCustom=title}}const hon=String(row['氏名敬称1']||'');if(hon){const vals=nameHonorificChoices(role);if(vals.includes(hon)){c.honorific=hon;c.honorificCustom=''}else{c.honorific='__custom__';c.honorificCustom=hon}}c.gyoji=String(row['御侍史']||'').toUpperCase()==='ON'||row['御侍史']===true;const short=String(row['寺院名モード表記']||'');if(short){const vals=nameShortChoices(role).map(x=>x[0]);if(vals.includes(short)){c.shortTemplate=short;c.shortCustom=''}else{c.shortTemplate='__custom__';c.shortCustom=short}}if(row['寺号役職一括'])u.titlePreset=String(row['寺号役職一括']);if(row['敬称一括'])u.honorificPreset=String(row['敬称一括']);if(row['御侍史一括'])u.gyojiPreset=String(row['御侍史一括']);if(row['寺院名寺号'])u.templeSuffixPreset=String(row['寺院名寺号']);if(row['寺院名副住職以下'])u.templeSubPreset=String(row['寺院名副住職以下']);if(row['様一括'])u.templeSamaPreset=String(row['様一括'])}state.nameRules=n;ensureNameRules();return n}catch(e){console.warn('名前ルール設定読込失敗',e);return null}}
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
function blankRecord(kind='本人', parent=null){return {no:null,id: kind==='本人'?nextParentId():nextChildId(parent?.id),parentId:parent?.id||'',kind,carrierId:parent?.id||'',office:'第1宗務所',district:'',templeNo:'',temple:'',postalCode:'',addressNumeric:'',addressKanji:'',role:'',name:'',assignment:'',note:'',money:blankMoney(),ruleMeta:{}}}
function parentNum(id){const m=/^P(\d{3,})$/.exec(id||'');return m?Number(m[1]):0}
function nextParentId(){let m=0;state.records.forEach(r=>{if(!r.parentId)m=Math.max(m,parentNum(r.id))});if(state.draft&&!state.draft.parentId)m=Math.max(m,parentNum(state.draft.id));return 'P'+String(m+1).padStart(3,'0')}
function nextChildId(parentId){let m=0;state.records.forEach(r=>{const q=new RegExp('^'+parentId+'-(\\d+)$').exec(r.id||'');if(q)m=Math.max(m,Number(q[1]))});return parentId+'-'+String(m+1).padStart(2,'0')}
function sum(keys,r){return keys.reduce((a,k)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0)}
function isUnannounced(r){return r?.assignment==='未案内'}
function guidedExpenseKey(base,r){return `${base}（${isUnannounced(r)?'未案内':'案内有'}）`}
function ensureRuleMeta(r){if(!r.ruleMeta||typeof r.ruleMeta!=='object')r.ruleMeta={};return r.ruleMeta}
function isRuleControlledMoneyKey(key){return key==='密葬回心'||key.startsWith('本葬回心（')||key.startsWith('本葬謝誼（')}
function setMoneyWithSource(r,key,value,source){r.money[key]=value;const meta=ensureRuleMeta(r);if(source)meta[key]=source;else delete meta[key]}
function syncGuidedExpenseColumns(r){
  if(!r?.money)return;
  const meta=ensureRuleMeta(r);
  for(const base of ['本葬謝誼','本葬回心']){
    const target=guidedExpenseKey(base,r);
    const other=`${base}（${isUnannounced(r)?'案内有':'未案内'}）`;
    const tv=r.money[target], ov=r.money[other];
    if(ov!==null&&ov!==undefined&&ov!==''){
      if(tv===null||tv===undefined||tv===''){
        r.money[target]=ov;
        if(meta[other])meta[target]=meta[other];
      }
      r.money[other]=null;delete meta[other];
    }
  }
}
function ruleValueForHonorarium(r){
  const rules=ensureRules();
  if(!r.assignment||!Object.prototype.hasOwnProperty.call(rules.honorarium,r.assignment))return null;
  const v=rules.honorarium[r.assignment];if(v===null||v===undefined||v==='')return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function applyRuleDefaultsToRecord(r,{honorarium=true,kaishin=true,force=false}={}){
  if(!r?.money)return {changed:0,skipped:0};
  syncGuidedExpenseColumns(r);const meta=ensureRuleMeta(r);let changed=0,skipped=0;
  const apply=(key,val)=>{
    if(!force&&meta[key]==='manual'){skipped++;return}
    if(val===null){if(meta[key]==='rule'){r.money[key]=null;delete meta[key];changed++}return}
    r.money[key]=val;meta[key]='rule';changed++;
  };
  if(kaishin){
    apply('密葬回心',calculateKaishin(r,r.money['密葬香資']));
    const hk=guidedExpenseKey('本葬回心',r), hkOther=`本葬回心（${isUnannounced(r)?'案内有':'未案内'}）`;
    apply(hk,calculateKaishin(r,r.money['本葬香資']));r.money[hkOther]=null;delete meta[hkOther];
  }
  if(honorarium){
    const sk=guidedExpenseKey('本葬謝誼',r), skOther=`本葬謝誼（${isUnannounced(r)?'案内有':'未案内'}）`;
    apply(sk,ruleValueForHonorarium(r));r.money[skOther]=null;delete meta[skOther];
  }
  return {changed,skipped};
}
function manualRuleOverrideSummary(){
  const people=new Set(), cells=[];
  for(const r of state.records){const meta=ensureRuleMeta(r);for(const [k,v] of Object.entries(meta)){if(v==='manual'&&isRuleControlledMoneyKey(k)){people.add(r.id);cells.push({id:r.id,key:k})}}}
  return {people:people.size,cells:cells.length};
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
function autoSave(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{await dbSet('workspace',{records:state.records,draft:state.draft,baseName:state.baseName,sourceLoaded:state.sourceLoaded,deleted:state.deleted,search:state.search,filters:state.filters,tableView:state.tableView,rules:ensureRules(),cashControl:ensureCashControl(),receiptSettings:ensureReceiptSettings(),receiptIssueMode:state.receiptIssueMode,receiptTargetMode:state.receiptTargetMode,receiptSingleNo:state.receiptSingleNo,receiptNoRange:state.receiptNoRange,postcardSettings:ensurePostcardSettings(),postcardTargetMode:state.postcardTargetMode,postcardSingleNo:state.postcardSingleNo,postcardNoRange:state.postcardNoRange,updatedAt:new Date().toISOString()});await dbSet('addedDirectory',state.addedDirectory);await dbSet('nameRules',ensureNameRules())},250)}

function toast(msg){let t=$('.toast');if(t)t.remove();t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),2200)}
function top(title, sub=''){return `<div class="topbar"><button class="btn small ghost" id="homeBtn" style="color:#fff;border-color:#698096">⌂</button><h1>${esc(title)}</h1><div class="small">v${APP_VERSION}${sub?` ・ ${esc(sub)}`:''}</div></div>`}
function shell(x){return `<div class="shell">${x}</div>`}
function navHome(){state.screen='home';state.editId=null;state.draft=null;state.returnScreen=null;state.editNav={source:null,ids:[]};state.basicInfoExpanded=false;render();autoSave()}
function formBackMarkup(){if(!state.returnScreen)return '';const label=state.returnScreen==='table'?'← 表一覧へ戻る':state.returnScreen==='search'?'← 検索結果へ戻る':'← トップへ戻る';return `<div style="margin-bottom:10px"><button class="btn small" id="backToSource">${label}</button></div>`}
function backToSource(){const dest=state.returnScreen||'home';state.draft=null;state.editId=null;state.returnScreen=null;state.editNav={source:null,ids:[]};state.basicInfoExpanded=false;state.screen=dest;render();autoSave()}
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
  if(state.screen==='nameRules') app.innerHTML=top('名前ルール')+shell(nameRulesView());
  if(state.screen==='printHub') app.innerHTML=top('プリント')+shell(printHubView());
  if(state.screen==='receiptPrint') app.innerHTML=top('領収書プリント')+shell(receiptPrintView());
  if(state.screen==='postcardPrint') app.innerHTML=top('ハガキプリント')+shell(postcardPrintView());
  if(state.screen==='printPlaceholder') app.innerHTML=top('プリント')+shell(printPlaceholderView());
  bindHome();bindCurrent();
}

function homeView(){return `
<div class="card"><div class="row"><div class="grow"><label>保存時の基本ファイル名</label><input id="baseName" class="field" value="${esc(state.baseName)}"></div><button class="btn" id="openExcel">Excelを開く</button><input id="fileExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="muted" style="margin-top:8px">保存時は自動で _MMDD_HHMM.xlsx を付けます。元ファイルは上書きしません。</div></div>
<div class="menu"><button class="btn primary" data-go="new">＋ 新規入力</button><button class="btn" data-go="search">検索・修正</button><button class="btn" data-go="table">表一覧</button><button class="btn" data-go="cash">現金照合・締め</button><button class="btn" data-go="nameRules">名前ルール</button><button class="btn" data-go="print">プリント</button><button class="btn income" data-go="save">Excel保存</button></div>
<div class="card" style="margin-top:14px"><div class="row"><div class="grow"><strong>${state.records.length}件</strong> を作業中</div><span class="muted">自動退避：IndexedDB</span></div></div>
<div class="grid2"><button class="btn" data-go="settings">追加名簿・設定</button><button class="btn" data-go="deleted">削除履歴 (${state.deleted.length})</button></div>`}

function personHeader(r){const p=r.parentId?state.records.find(x=>x.id===r.parentId):null;return `<div class="person-head"><div class="row"><div class="grow"><strong>${esc(r.id)} ${esc(r.name||'氏名未入力')}</strong><div class="muted">${esc([r.district,r.temple,r.role,r.assignment].filter(Boolean).join(' / '))}</div></div><span class="pill ${r.kind==='預かり'?'child':''}">${esc(r.kind)}</span></div>${r.kind==='預かり'?`<div class="muted">持参者：${esc(p?.name||r.carrierId)}</div>`:''}</div>`}
function districtButtons(r){return `<div class="chips">${[1,2,3,4,5,6,7,8].map(n=>{const d=`第${n}教区`;return `<button class="chip ${r.district===d?'selected':''}" data-district="${d}">${d}</button>`}).join('')}<button class="chip ${!r.district?'selected':''}" data-district="">未指定</button></div>`}
function roleButtons(r){return `<div class="chips">${ROLE_BUTTONS.map(x=>`<button class="chip ${r.role===x?'selected':''}" data-role="${x}">${x}</button>`).join('')}</div>`}
function roleSelect(r){const opts=[];Object.entries(window.FUNERAL_ROLE_GROUPS||{}).forEach(([g,arr])=>{opts.push(`<optgroup label="${esc(g)}">`+arr.map(x=>`<option ${r.assignment===x?'selected':''}>${esc(x)}</option>`).join('')+'</optgroup>')});return `<select id="assignmentSelect" class="field"><option value="">配役を選択</option>${opts.join('')}<option value="未案内" ${r.assignment==='未案内'?'selected':''}>未案内</option><option value="__manual__">手入力</option></select>`}
function templeCandidates(r,q=''){const query=norm(q);let all=[...state.fixedTemples,...state.addedDirectory.temples];let list=all.filter(t=>(!r.district||t['教区']===r.district));if(query)list=list.filter(t=>norm(t['寺院名']).startsWith(query)||norm(t['フリガナ']).startsWith(query));return list.slice(0,30)}
function templeSuggestionsMarkup(r,q=''){const candidates=templeCandidates(r,q);return {candidates,html:candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}}
function bindTempleSuggestionButtons(){const r=state.draft;$$('[data-temple-no]').forEach(b=>b.onclick=()=>{const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>String(x['寺籍番号'])===b.dataset.templeNo);if(t){r.office=t['宗務所']||'第1宗務所';r.district=t['教区']||r.district;r.templeNo=String(t['寺籍番号']||'');r.temple=t['寺院名']||'';r._templeQuery=r.temple;applyTempleAddress(r,t);autoSave();render()}})}
function updateTempleSuggestions(){const r=state.draft,box=$('#templeSuggestions');if(!r||!box)return;const {candidates,html}=templeSuggestionsMarkup(r,r._templeQuery??r.temple);box.innerHTML=html;box.classList.toggle('hidden',!candidates.length);bindTempleSuggestionButtons()}
function peopleForTemple(r){let out=[];const all=[...state.fixedTemples,...state.addedDirectory.temples];const t=all.find(x=>(r.templeNo&&x['寺籍番号']===r.templeNo)||(!r.templeNo&&x['寺院名']===r.temple&&x['教区']===r.district));if(t)PERSON_COLS.forEach(c=>{if(t[c])out.push({role:roleFromCol(c),name:t[c]})});state.addedDirectory.people.filter(p=>(r.templeNo&&p.templeNo===r.templeNo)||(!r.templeNo&&p.temple===r.temple&&p.district===r.district)).forEach(p=>out.push({role:p.role,name:p.name}));const seen=new Set();return out.filter(p=>{const k=norm(p.role+'|'+p.name);if(seen.has(k))return false;seen.add(k);return true})}

function currentEditNav(){
  if(!state.editId)return {ids:[],index:-1};
  const ids=Array.isArray(state.editNav?.ids)?state.editNav.ids:[];
  return {ids,index:ids.indexOf(state.editId)};
}
function editNavMarkup(){
  if(!state.editId)return '';
  const {ids,index}=currentEditNav();
  if(index<0||!ids.length)return '';
  return `<div class="card edit-nav"><div class="row"><button class="btn" id="editPrev" ${index<=0?'disabled':''}>← 前へ</button><div class="grow" style="text-align:center"><strong>${index+1} / ${ids.length}件</strong><div class="muted">${esc(state.returnScreen==='search'?'検索結果':'表一覧')}の順番</div></div><button class="btn" id="editNext" ${index>=ids.length-1?'disabled':''}>次へ →</button></div></div>`;
}
function compactBasicInfo(r){
  return `<div class="card compact-basic"><button class="btn wide" id="toggleBasicInfo">基本情報を編集</button></div>`;
}
function fullBasicInfo(r,candidates,people){
  return `<div class="card"><div class="section-title">① 教区</div>${districtButtons(r)}
<div class="section-title">② 寺号</div><input id="templeSearch" class="field field-lg" placeholder="漢字・ひらがな・カタカナ" value="${esc(r._templeQuery??r.temple)}"><div id="templeSuggestions" class="suggestions ${candidates.length?'':'hidden'}">${candidates.map(t=>`<button class="suggestion" data-temple-no="${esc(t['寺籍番号'])}"><span><strong>${esc(t['寺院名'])}</strong><br><span class="sub">${esc(t['教区'])} / ${esc(t['フリガナ'])}</span></span><span class="sub">${esc(t['寺籍番号'])}</span></button>`).join('')}</div><button class="btn small" id="useManualTemple" style="margin-top:8px">この寺号をそのまま使用</button>
<div class="section-title">③ 役職</div>${roleButtons(r)}<div style="margin-top:8px"><input id="roleManual" class="field" placeholder="役職を手入力" value="${ROLE_BUTTONS.includes(r.role)?'':esc(r.role)}"></div>
${people.length?`<div class="section-title">名簿登録人物</div><div class="grid2">${people.map((p,i)=>`<button class="btn" data-person-index="${i}">${esc(p.role)}　${esc(p.name)}</button>`).join('')}</div>`:''}
<div class="section-title">④ 氏名 <span style="color:#b42318">※必須</span></div><input id="nameField" class="field field-lg" value="${esc(r.name)}" placeholder="例：山田 太郎">
<div id="candidateAction" class="hidden notice" style="margin-top:10px"><div style="font-weight:800;margin-bottom:8px">名簿候補にない入力です</div><div class="row"><button class="btn small" id="addCandidate">今後の候補に追加</button><button class="btn small" id="onceCandidate">今回だけ使用</button></div></div>
<div class="section-title">⑤ 郵便・住所</div><div class="grid2"><div><label>郵便番号</label><input id="postalCodeField" class="field" inputmode="numeric" placeholder="例：041-0251" value="${esc(r.postalCode||'')}"></div><div style="display:flex;align-items:end"><button class="btn wide" id="lookupPostalAddress">郵便番号から住所取得</button></div></div><div id="postalLookupStatus" class="muted" style="margin-top:6px"></div><div style="margin-top:8px"><label>住所（数字）</label><input id="addressNumericField" class="field" placeholder="例：北海道函館市小安町472" value="${esc(r.addressNumeric||'')}"></div><div style="margin-top:8px"><label>住所（漢数字・縦書き用）</label><input id="addressKanjiField" class="field" placeholder="例：北海道函館市小安町四七二" value="${esc(r.addressKanji||'')}"><button class="btn small" id="generateKanjiAddress" style="margin-top:8px">数字住所から漢数字を生成</button></div>
<div class="section-title">⑥ 配役</div>${roleSelect(r)}<input id="assignmentManual" class="field ${r.assignment&&![].concat(...Object.values(window.FUNERAL_ROLE_GROUPS||{}),'未案内').includes(r.assignment)?'':'hidden'}" style="margin-top:8px" placeholder="例：尊宿兼先導師" value="${esc(r.assignment)}">
<div class="section-title">備考</div><textarea id="noteField" class="field" rows="2">${esc(r.note)}</textarea>${state.editId?'<button class="btn wide" id="toggleBasicInfo" style="margin-top:12px">基本情報を閉じる</button>':''}</div>`;
}
function formView(){const r=state.draft; if(!r)return '<div class="card error">入力データがありません。</div>';
const candidates=templeCandidates(r,r._templeQuery??r.temple);const people=peopleForTemple(r);
const basic=state.editId&&!state.basicInfoExpanded?compactBasicInfo(r):fullBasicInfo(r,candidates,people);
return `${formBackMarkup()}${editNavMarkup()}${state.editId?`<div class="edit-banner">編集モード：既存データを読み込んでいます</div>`:''}${r.kind==='預かり' && !state.editId?`<div class="parent-banner">預かり入力　持参者：${esc((state.records.find(x=>x.id===r.parentId)||{}).name||r.carrierId)}</div>`:''}${personHeader(r)}
${state.editId&&r.kind==='本人'?`<div class="card"><button class="btn wide" id="addDepositTop">＋ 預かりを追加</button></div>`:''}
${r.kind==='預かり'&&!state.editId?(()=>{const p=state.records.find(x=>x.id===r.parentId);return p?.temple?`<div class="card parent-temple-suggest"><div class="muted" style="margin-bottom:7px">親と同じ寺号を使う場合</div><button class="btn wide" id="useParentTemple">${esc(p.temple)} を使う</button></div>`:''})():''}
${basic}
${moneyPanel(r)}
<div class="card"><div class="grid2">${r.kind==='本人'&&!state.editId?'<button class="btn" id="addDeposit">＋ 預かりを追加</button>':''}<button class="btn primary" id="commitRecord">${state.editId?'更新':'登録'}</button></div>${state.editId?`${currentEditNav().index>=0&&currentEditNav().index<currentEditNav().ids.length-1?'<button class="btn wide" id="commitNext" style="margin-top:10px">更新して次へ →</button>':''}<button class="btn danger wide" id="deleteRecord" style="margin-top:10px">削除</button>`:''}</div>`}
function moneyPanel(r){const isI=state.mode==='income';
if(isI){
  const groups=[['密葬',['密葬香資','密葬供花','密葬供物']],['本葬',['本葬香資','本葬供花料','本葬供物料']]];
  return `<div class="card income-panel"><h3 style="color:var(--income)">収入入力</h3>${groups.map(([g,items])=>`<div class="section-title">${g}</div>${items.map(item=>moneyRow(r,item)).join('')}`).join('')}<div class="offering-print-area"><button class="btn wide offering-print-btn" id="offeringPrint">御供札プリント</button><div class="muted" style="margin-top:6px">現在の寺号・役職・氏名から札PDFを作成します</div></div><div class="section-title">その他</div>${['問候','献香'].map(item=>moneyRow(r,item)).join('')}<div class="sticky-summary"><span>収入小計</span><span class="amount">${fmt(sum(INCOME,r))} 円</span></div></div>`;
}
const groups=[['密葬',['密葬謝誼']],['中陰',['密葬回心','中陰謝誼']],['本葬前',['本葬謝誼']],['本葬',['本葬回心']],['その他',['路資','菓誼','内謝']]];
return `<div class="card expense-panel"><h3 style="color:var(--expense)">支出入力</h3>${groups.map(([g,items])=>`<div class="section-title">${g}</div>${items.map(item=>moneyRow(r,item)).join('')}`).join('')}<div class="sticky-summary"><span>支出小計</span><span class="amount">${fmt(sum(EXPENSE,r))} 円</span></div></div>`}
function moneyRow(r,item){let key=item;if(item==='本葬謝誼'||item==='本葬回心')key=guidedExpenseKey(item,r);const src=ensureRuleMeta(r)[key];const badge=src==='rule'?'<span class="muted" style="font-size:11px">ルール入力</span>':src==='manual'?'<span class="pill" style="font-size:11px">個別修正</span>':'';
return `<div class="money-item"><div><strong>${esc(item)}</strong>${badge?`<div style="margin-top:3px">${badge}</div>`:''}</div><button class="money-btn ${r.money[key]!==null?'filled':''}" data-money="${esc(key)}">${r.money[key]===null?'＋入力':fmt(r.money[key])+' 円'}</button></div>`}
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
function applyRulesToRecords(preserveManual=false){
  const rules=ensureRules();let kaishinCount=0,shagiCount=0,skipped=0;
  for(const r of state.records){
    syncGuidedExpenseColumns(r);const meta=ensureRuleMeta(r);
    const apply=(key,val,type)=>{
      if(preserveManual&&meta[key]==='manual'){skipped++;return}
      if(val===null){r.money[key]=null;delete meta[key];return}
      r.money[key]=val;meta[key]='rule';if(type==='k')kaishinCount++;else shagiCount++;
    };
    apply('密葬回心',calculateKaishin(r,r.money['密葬香資']),'k');
    const hk=guidedExpenseKey('本葬回心',r), hkOther=`本葬回心（${isUnannounced(r)?'案内有':'未案内'}）`;
    apply(hk,calculateKaishin(r,r.money['本葬香資']),'k');r.money[hkOther]=null;delete meta[hkOther];
    const sk=guidedExpenseKey('本葬謝誼',r), skOther=`本葬謝誼（${isUnannounced(r)?'案内有':'未案内'}）`;
    apply(sk,ruleValueForHonorarium(r),'s');r.money[skOther]=null;delete meta[skOther];
  }
  rules.appliedCount++;autoSave();return {kaishinCount,shagiCount,skipped}
}
function runRuleBulkApply(preserveManual){const x=applyRulesToRecords(preserveManual);render();toast(`一斉入力しました（回心 ${x.kaishinCount}件 / 本葬謝誼 ${x.shagiCount}件${x.skipped?` / 個別修正を保持 ${x.skipped}項目`:''}）`)}
function openRuleBulkApplyDialog(){
  const rules=ensureRules(),man=manualRuleOverrideSummary();
  if(man.people>0){
    const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h3>一斉入力の確認</h3><div class="notice" style="margin-bottom:14px"><strong>個別に手入力された方が ${man.people}名います。</strong><div class="muted" style="margin-top:5px">個別修正 ${man.cells}項目。今回の一斉入力で残すか、現在のルールで上書きするか選んでください。</div></div>${rules.appliedCount>0?'<div class="muted" style="margin-bottom:12px">この作業データには以前にも一斉入力が実行されています。</div>':''}<div class="grid2"><button class="btn" id="keepManualRules">手入力を残して反映</button><button class="btn danger" id="overwriteManualRules">手入力もルールで上書き</button></div><button class="btn wide ghost" id="cancelRuleApply" style="margin-top:10px">キャンセル</button></div>`;document.body.append(back);
    $('#keepManualRules',back).onclick=()=>{back.remove();runRuleBulkApply(true)};
    $('#overwriteManualRules',back).onclick=()=>{if(!confirm('個別修正した金額も現在のルール値で上書きします。よろしいですか？'))return;back.remove();runRuleBulkApply(false)};
    $('#cancelRuleApply',back).onclick=()=>back.remove();return;
  }
  if(rules.appliedCount>0&&!confirm('すでに回心・本葬謝誼が入力されています。\n\n現在のルールで再計算し、一括で上書きしますか？'))return;
  runRuleBulkApply(false);
}
function bindRules(){
  ensureRules();const back=$('#rulesBack');if(back)back.onclick=()=>{state.screen='table';state.rulePersonSearch='';render();autoSave()};
  const line=$('#kaishinLine');if(line)line.oninput=()=>{state.rules.kaishinLine=line.value===''?null:Number(line.value);autoSave()};
  $$('[data-no-return]').forEach(c=>c.onchange=()=>{const d=c.dataset.noReturn;const set=new Set(state.rules.noReturnDistricts);c.checked?set.add(d):set.delete(d);state.rules.noReturnDistricts=[...set];autoSave()});
  const search=$('#fullReturnSearch');if(search)search.oninput=()=>{state.rulePersonSearch=search.value;const box=$('#fullReturnResults');if(box){box.innerHTML=fullReturnResultsMarkup(rulePeopleMatches(search.value));bindFullReturnAdd(box)}};
  bindFullReturnAdd(document);$$('[data-remove-full]').forEach(b=>b.onclick=()=>{state.rules.fullReturnPeople.splice(Number(b.dataset.removeFull),1);autoSave();render()});
  $$('[data-honorarium]').forEach(inp=>inp.oninput=()=>{state.rules.honorarium[inp.dataset.honorarium]=inp.value===''?null:Number(inp.value);autoSave()});
  const all=$('#setHonorariumAll');if(all)all.onclick=()=>{const v=$('#honorariumAll')?.value;if(v===undefined||v===''){toast('一律金額を入力してください');return}const n=Number(v);allAssignments().forEach(role=>state.rules.honorarium[role]=n);autoSave();render();toast('全配役に一律金額をセットしました')};
  const apply=$('#applyRules');if(apply)apply.onclick=openRuleBulkApplyDialog;
  const ex=$('#rulesExport');if(ex)ex.onclick=backupRules;const im=$('#rulesImport'),file=$('#rulesFile');if(im&&file){im.onclick=()=>file.click();file.onchange=e=>restoreRules(e.target.files[0])}
}
function bindFullReturnAdd(root){$$('[data-add-full]',root).forEach(b=>b.onclick=()=>{const p=rulePeopleMatches(state.rulePersonSearch)[Number(b.dataset.addFull)];if(!p)return;if(!state.rules.fullReturnPeople.some(x=>personRuleKey(x)===personRuleKey(p)))state.rules.fullReturnPeople.push({...p});state.rulePersonSearch='';autoSave();render();toast('全返し対象に追加しました')})}
function backupRules(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),rules:ensureRules()},null,2)],{type:'application/json'});downloadBlob(blob,'回心謝誼ルール_'+stamp()+'.json')}
function restoreRules(file){if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);const x=j.rules||j;if(!x||typeof x!=='object')throw new Error('ルールデータがありません');state.rules={...defaultRules(),...x,appliedCount:0};ensureRules();autoSave();render();toast('ルールを読み込みました')}catch(e){alert('ルールJSONを読み込めませんでした。\n'+e.message)}};fr.readAsText(file)}

function nameSelectOptions(options,current){return options.map(([v,label])=>`<option value="${esc(v)}" ${current===v?'selected':''}>${esc(label)}</option>`).join('')}
function bulkOption(value,label,current){return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`}
function nameRulesView(){
  const n=ensureNameRules(),use=state.nameRuleUse,u=n.uses[use];
  const useButtons=NAME_USES.map(x=>`<button class="chip ${x===use?'selected':''}" data-name-use="${esc(x)}">${esc(x)}</button>`).join('');
  const modeButtons=[['postal','郵便'],['temple','寺院名'],['person','個人名']].map(([v,l])=>`<button class="btn small ${u.mode===v?'selected':''}" data-name-mode="${v}">${l}</button>`).join('');
  let bulk='';
  if(u.mode==='postal'||u.mode==='person'){
    bulk=`<div class="rule-block"><h3>一括設定</h3><div class="grid3"><label>副住職以下の寺号＋役職<select class="field" id="bulkNameTitle">${bulkOption('oyamauchi','御山内で統一',u.titlePreset)}${bulkOption('oyamazato','御山裡で統一',u.titlePreset)}${bulkOption('actual','実役職を使う',u.titlePreset)}${u.titlePreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label><label>氏名の敬称<select class="field" id="bulkNameHonorific">${bulkOption('老師','老師（住職・東堂）／宗師',u.honorificPreset)}${bulkOption('老宗師','老宗師（住職・東堂）／宗師',u.honorificPreset)}${bulkOption('様','全員「様」',u.honorificPreset)}${u.honorificPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label>${u.mode==='postal'?`<label>御侍史<select class="field" id="bulkNameGyoji">${bulkOption('on','対象役職を一括ON',u.gyojiPreset)}${bulkOption('off','全てOFF',u.gyojiPreset)}${u.gyojiPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label>`:''}</div><div class="muted" style="margin-top:8px">一括設定を変えると各役職へ連動します。その後、下の役職別設定で例外だけ個別修正できます。</div></div>`;
  }else{
    bulk=`<div class="rule-block"><h3>一括設定</h3><div class="grid3"><label>住職・東堂の寺号<select class="field" id="bulkTempleSuffix">${bulkOption('noTemple','寺を抜く（廣福方丈・廣福東堂）',u.templeSuffixPreset)}${bulkOption('withTemple','寺を付ける（廣福寺方丈・廣福寺東堂）',u.templeSuffixPreset)}${u.templeSuffixPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label><label>副住職以下<select class="field" id="bulkTempleSub">${bulkOption('name','氏名を使う',u.templeSubPreset)}${bulkOption('oyamauchi','御山内で統一',u.templeSubPreset)}${bulkOption('oyamazato','御山裡で統一',u.templeSubPreset)}${bulkOption('actual','実役職を使う',u.templeSubPreset)}${u.templeSubPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label><label>「様」<select class="field" id="bulkTempleSama">${bulkOption('off','全てOFF',u.templeSamaPreset)}${bulkOption('on','全てON',u.templeSamaPreset)}${u.templeSamaPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label><label>御侍史<select class="field" id="bulkNameGyoji">${bulkOption('off','全てOFF（基本）',u.gyojiPreset)}${bulkOption('on','対象役職を一括ON',u.gyojiPreset)}${u.gyojiPreset==='custom'?'<option value="custom" selected disabled>個別設定あり</option>':''}</select></label></div><div class="muted" style="margin-top:8px">例：寺なし＋氏名＋様OFF → 廣福方丈 / 廣福東堂 / 平賀芳徳。御侍史は基本OFFで、必要な場合だけONにできます。一括設定後も役職別に変更できます。</div></div>`;
  }
  const rows=NAME_RULE_ROLES.map(role=>{const c=u.roles[role];if(u.mode==='temple'){const opts=nameSelectOptions(nameShortChoices(role),c.shortTemplate)+`<option value="__custom__" ${c.shortTemplate==='__custom__'?'selected':''}>自由入力</option>`;return `<div class="name-role-card"><strong>${esc(role)}</strong><div class="name-rule-fields"><label>寺院名モード表記<select class="field" data-name-short="${esc(role)}">${opts}</select></label><label class="${c.shortTemplate==='__custom__'?'':'hidden'}" data-name-short-custom-wrap="${esc(role)}">自由テンプレート<input class="field" data-name-short-custom="${esc(role)}" value="${esc(c.shortCustom||'')}" placeholder="例：{寺号}副住職"></label><label class="name-toggle"><input type="checkbox" data-name-gyoji="${esc(role)}" ${c.gyoji?'checked':''}> 御侍史を付ける</label></div></div>`}
    const titleOpts=nameSelectOptions(nameTitleChoices(role),c.titleTemplate)+`<option value="__custom__" ${c.titleTemplate==='__custom__'?'selected':''}>自由入力</option>`;
    const honOpts=nameHonorificChoices(role).map(v=>`<option value="${esc(v)}" ${c.honorific===v?'selected':''}>${esc(v)}</option>`).join('')+`<option value="__custom__" ${c.honorific==='__custom__'?'selected':''}>自由入力</option>`;
    return `<div class="name-role-card"><strong>${esc(role)}</strong><div class="name-rule-fields"><label>寺号＋役職<select class="field" data-name-title="${esc(role)}">${titleOpts}</select></label><label class="${c.titleTemplate==='__custom__'?'':'hidden'}" data-name-title-custom-wrap="${esc(role)}">自由テンプレート<input class="field" data-name-title-custom="${esc(role)}" value="${esc(c.titleCustom||'')}" placeholder="例：{寺号}御山内"></label><label>氏名の敬称<select class="field" data-name-honorific="${esc(role)}">${honOpts}</select></label><label class="${c.honorific==='__custom__'?'':'hidden'}" data-name-honorific-custom-wrap="${esc(role)}">自由敬称<input class="field" data-name-honorific-custom="${esc(role)}" value="${esc(c.honorificCustom||'')}"></label>${u.mode==='postal'?`<label class="name-toggle"><input type="checkbox" data-name-gyoji="${esc(role)}" ${c.gyoji?'checked':''}> 御侍史を付ける</label>`:''}</div></div>`}).join('');
  const exampleRows=NAME_RULE_ROLES.map(role=>{const r={id:`example-${role}`,temple:'廣福寺',role,name:'平賀芳徳',district:'第1教区',assignment:''};return `<tr><td><strong>${esc(role)}の場合</strong><div class="muted">廣福寺 / 平賀芳徳</div></td><td class="name-preview" data-name-preview-role="${esc(role)}">${esc(generatedNameForUse(r,use)).replace(/\n/g,'<br>')}</td></tr>`}).join('');
  return `<div class="card"><h3>用途を選択</h3><div class="chips">${useButtons}</div><div class="muted" style="margin-top:8px">ハガキ・封筒・領収書・可漏・謝誼袋・部屋・引き物・下足をそれぞれ独立して設定します。</div></div><div class="card"><div class="row"><div class="grow"><h3 style="margin:0">${esc(use)} の表記</h3><div class="muted">現在：${esc(NAME_MODE_LABELS[u.mode])}モード</div></div><button class="btn small" id="resetNameUse">この用途を初期値に戻す</button></div><div class="row" style="margin:12px 0">${modeButtons}</div><div class="notice ${u.mode==='postal'?'':'hidden'}">郵便：寺号＋役職 / 氏名＋敬称 / 御侍史。まず一括設定し、必要な役職だけ個別変更します。</div><div class="notice ${u.mode==='person'?'':'hidden'}">個人名：郵便モードと同じ連動ルールで、御侍史だけ付けません。</div><div class="notice ${u.mode==='temple'?'':'hidden'}">寺院名：一括で「寺の有無」「副住職以下の表記」「様」「御侍史」を決め、その後に例外だけ修正できます。</div>${bulk}<div class="section-title">役職別の個別調整</div><div class="name-role-grid">${rows}</div><div class="muted" style="margin-top:10px">自由テンプレートでは {寺号} / {寺号寺抜き} / {氏名} / {役職} が使えます。役職なし・一般の方は氏名欄をそのまま自由表記として出力します。</div></div><div class="card"><h3>実例</h3><div class="muted" style="margin-bottom:10px">名簿が未入力でも確認できるよう、廣福寺・平賀芳徳を固定例として表示します。</div><div class="table-wrap name-preview-table"><table><thead><tr><th>役職</th><th>${esc(use)} 出力例</th></tr></thead><tbody>${exampleRows}</tbody></table></div></div>`;
}
function refreshNamePreview(){const use=state.nameRuleUse;$$('[data-name-preview-role]').forEach(el=>{const role=el.dataset.namePreviewRole;const r={id:`example-${role}`,temple:'廣福寺',role,name:'平賀芳徳',district:'第1教区',assignment:''};el.innerHTML=esc(generatedNameForUse(r,use)).replace(/\n/g,'<br>')})}
function bindNameRules(){const n=ensureNameRules();$$('[data-name-use]').forEach(b=>b.onclick=()=>{state.nameRuleUse=b.dataset.nameUse;render()});$$('[data-name-mode]').forEach(b=>b.onclick=()=>{n.uses[state.nameRuleUse].mode=b.dataset.nameMode;autoSave();render()});const u=n.uses[state.nameRuleUse];const bt=$('#bulkNameTitle');if(bt)bt.onchange=()=>{applyNameTitlePreset(u,bt.value);autoSave();render()};const bh=$('#bulkNameHonorific');if(bh)bh.onchange=()=>{applyHonorificPreset(u,bh.value);autoSave();render()};const bg=$('#bulkNameGyoji');if(bg)bg.onchange=()=>{applyGyojiPreset(u,bg.value);autoSave();render()};const bs=$('#bulkTempleSuffix');if(bs)bs.onchange=()=>{applyTempleSuffixPreset(u,bs.value);autoSave();render()};const bsub=$('#bulkTempleSub');if(bsub)bsub.onchange=()=>{applyTempleSubPreset(u,bsub.value);autoSave();render()};const bsa=$('#bulkTempleSama');if(bsa)bsa.onchange=()=>{applyTempleSamaPreset(u,bsa.value);autoSave();render()};$$('[data-name-title]').forEach(el=>el.onchange=()=>{const c=u.roles[el.dataset.nameTitle];c.titleTemplate=el.value;u.titlePreset='custom';const w=$(`[data-name-title-custom-wrap="${CSS.escape(el.dataset.nameTitle)}"]`);if(w)w.classList.toggle('hidden',el.value!=='__custom__');autoSave();refreshNamePreview()});$$('[data-name-title-custom]').forEach(el=>el.oninput=()=>{u.roles[el.dataset.nameTitleCustom].titleCustom=el.value;u.titlePreset='custom';autoSave();refreshNamePreview()});$$('[data-name-honorific]').forEach(el=>el.onchange=()=>{const c=u.roles[el.dataset.nameHonorific];c.honorific=el.value;u.honorificPreset='custom';const w=$(`[data-name-honorific-custom-wrap="${CSS.escape(el.dataset.nameHonorific)}"]`);if(w)w.classList.toggle('hidden',el.value!=='__custom__');autoSave();refreshNamePreview()});$$('[data-name-honorific-custom]').forEach(el=>el.oninput=()=>{u.roles[el.dataset.nameHonorificCustom].honorificCustom=el.value;u.honorificPreset='custom';autoSave();refreshNamePreview()});$$('[data-name-gyoji]').forEach(el=>el.onchange=()=>{u.roles[el.dataset.nameGyoji].gyoji=el.checked;u.gyojiPreset='custom';autoSave();refreshNamePreview()});$$('[data-name-short]').forEach(el=>el.onchange=()=>{const c=u.roles[el.dataset.nameShort];c.shortTemplate=el.value;u.templeSuffixPreset=detectTempleSuffixPreset(u);u.templeSubPreset=detectTempleSubPreset(u);u.templeSamaPreset=detectTempleSamaPreset(u);const w=$(`[data-name-short-custom-wrap="${CSS.escape(el.dataset.nameShort)}"]`);if(w)w.classList.toggle('hidden',el.value!=='__custom__');autoSave();refreshNamePreview()});$$('[data-name-short-custom]').forEach(el=>el.oninput=()=>{u.roles[el.dataset.nameShortCustom].shortCustom=el.value;u.templeSuffixPreset='custom';u.templeSubPreset='custom';u.templeSamaPreset='custom';autoSave();refreshNamePreview()});const reset=$('#resetNameUse');if(reset)reset.onclick=()=>{if(!confirm(`${state.nameRuleUse} の名前ルールを初期値に戻しますか？`))return;const d=defaultNameRules();state.nameRules.uses[state.nameRuleUse]=d.uses[state.nameRuleUse];if(d.uses[state.nameRuleUse].mode==='temple'){applyTempleSuffixPreset(state.nameRules.uses[state.nameRuleUse],'noTemple');applyTempleSubPreset(state.nameRules.uses[state.nameRuleUse],'name');applyTempleSamaPreset(state.nameRules.uses[state.nameRuleUse],'off')}else{applyNameTitlePreset(state.nameRules.uses[state.nameRuleUse],'oyamauchi');applyHonorificPreset(state.nameRules.uses[state.nameRuleUse],'老師');applyGyojiPreset(state.nameRules.uses[state.nameRuleUse],'on')}autoSave();render();toast('初期値に戻しました')}}

function settingsView(){return `<div class="card"><h3>追加名簿</h3><p class="muted">追加寺院 ${state.addedDirectory.temples.length}件 / 追加人物 ${state.addedDirectory.people.length}件</p><div class="grid2"><button class="btn" id="backupDir">追加名簿JSONを書き出す</button><button class="btn" id="restoreDir">追加名簿JSONを読み込む</button></div><input id="dirFile" type="file" accept=".json" class="hidden"></div><div class="card"><h3>第1宗務所名簿</h3><p class="muted">アプリ内蔵：${state.fixedTemples.length}寺院。後から人物名を追記した最新版Excelを読み直すこともできます。</p><button class="btn" id="reloadDirectory">第1宗務所名簿.xlsx を読み込む</button><input id="directoryExcel" type="file" accept=".xlsx,.xls" class="hidden"></div><div class="card"><h3>作業状態</h3><button class="btn danger" id="clearWorkspace">作業データを全消去</button></div>`}
function deletedView(){return `<div class="card"><div class="muted">削除履歴はこの端末のIndexedDBに残します。</div></div>${state.deleted.map((d,i)=>`<div class="search-result"><div class="row"><div class="grow"><div class="title">${esc(d.record.id)}　${esc(d.record.name)}</div><div class="meta">削除：${esc(new Date(d.deletedAt).toLocaleString('ja-JP'))} / ${esc([d.record.district,d.record.temple,d.record.role].filter(Boolean).join(' / '))}</div></div><button class="btn small" data-restore="${i}">復元</button></div></div>`).join('')||'<div class="card muted">削除履歴はありません。</div>'}`}


function printHubView(){return `<div class="card"><h3>印刷物を選択</h3><div class="muted">ハガキと領収書はPDF作成・プレビュー調整に対応しています。</div></div><div class="menu"><button class="btn primary" data-print-kind="postcard">ハガキ</button><button class="btn" data-print-kind="envelope">封筒（長形3号）</button><button class="btn primary" data-print-kind="receipt">領収書（A6）</button><button class="btn" data-print-kind="gift">引き物（A4分割）</button><button class="btn" data-print-kind="honorarium">謝誼袋</button></div>`}
function postcardPrintView(){ensurePostcardSettings();const eligible=state.records.filter(r=>postalDigits(r.postalCode).length===7&&(r.addressKanji||r.addressNumeric)&&r.name);const oneNo=Number(state.postcardSingleNo)||1;return `<div class="card"><h3>ハガキ（100×148mm・縦）</h3><div class="muted">郵便番号は既製ハガキの7桁枠へ合わせて配置します。住所は「住所（漢数字）」を優先します。</div></div><div class="card"><div class="section-title">印刷対象</div><div class="grid3">${['一人','No.指定','全員'].map(x=>`<button class="btn ${state.postcardTargetMode===x?'selected':''}" data-postcard-target="${x}">${x}</button>`).join('')}</div>${state.postcardTargetMode==='一人'?`<div style="margin-top:10px"><label>対象No.</label><input class="field" id="postcardSingleNo" inputmode="numeric" type="number" min="1" max="${Math.max(1,state.records.length)}" value="${oneNo}"></div>`:''}${state.postcardTargetMode==='No.指定'?`<div style="margin-top:10px"><label>No.指定</label><input class="field" id="postcardNoRange" value="${esc(state.postcardNoRange||'')}" placeholder="例：1-10, 12, 15-20"></div>`:''}<div class="notice" style="margin-top:12px">郵便番号・住所・氏名が揃っている候補：${eligible.length}件</div></div><div class="card"><h3>配置</h3><div class="muted">郵便番号の標準位置を基準にし、プレビューから全体の上下左右・サイズと、7桁それぞれの左右位置を微調整できます。HGRSKP.TTF が同じフォルダにあれば HG正楷書体-PRO を使用し、なければ明朝系で代替します。</div><button class="btn primary wide" id="postcardPreview" style="margin-top:12px">プレビュー・PDF作成</button><button class="btn wide" id="postcardResetLayout" style="margin-top:8px">標準配置に戻す</button></div><div class="card"><button class="btn wide" id="backPrintHub">← プリント一覧へ戻る</button></div>`}
function printPlaceholderView(){const labels={postcard:'ハガキ',envelope:'封筒（長形3号）',gift:'引き物（A4分割）',honorarium:'謝誼袋'};return `<div class="card"><h3>${esc(labels[state.printKind]||'印刷')}</h3><div class="notice warn">この印刷機能はこれから実装します。</div><button class="btn wide" id="backPrintHub" style="margin-top:14px">← プリント一覧へ戻る</button></div>`}
function receiptPrintView(){const r=ensureReceiptSettings();const eligible=state.records.filter(x=>receiptDataForRecord(x,state.receiptIssueMode).total>0);const oneNo=Number(state.receiptSingleNo)||1;return `<div class="card"><h3>領収書（A6・横）</h3><div class="muted">発行区分に応じて帳簿の金額を正式科目へまとめ、0円の内訳は表示しません。</div></div>
<div class="card"><div class="section-title">発行区分</div><div class="grid3">${['密葬','本葬','まとめて'].map(x=>`<button class="btn ${state.receiptIssueMode===x?'selected':''}" data-receipt-issue="${x}">${x}</button>`).join('')}</div><div class="section-title">印刷対象</div><div class="grid3">${['一人','No.指定','全員'].map(x=>`<button class="btn ${state.receiptTargetMode===x?'selected':''}" data-receipt-target="${x}">${x}</button>`).join('')}</div>${state.receiptTargetMode==='一人'?`<div style="margin-top:10px"><label>対象No.</label><input class="field" id="receiptSingleNo" inputmode="numeric" type="number" min="1" max="${Math.max(1,state.records.length)}" value="${oneNo}"><div class="muted" style="margin-top:5px">表一覧のNo.を指定します。現在の発行区分で金額がある人だけ印刷できます。</div></div>`:''}${state.receiptTargetMode==='No.指定'?`<div style="margin-top:10px"><label>No.指定</label><input class="field" id="receiptNoRange" value="${esc(state.receiptNoRange||'')}" placeholder="例：1-10, 12, 15-20"><div class="muted" style="margin-top:5px">カンマ区切り・範囲指定に対応。対象金額が0円の人は除外します。</div></div>`:''}<div class="notice" style="margin-top:12px">${state.receiptIssueMode}：印刷対象候補 ${eligible.length}件</div></div>
<div class="card"><h3>発行者情報</h3><div class="muted" style="margin-bottom:10px">電話番号・住所・山号・寺院名を領収書下部の1ブロックにまとめて表示します。</div><div><label>電話番号</label><input class="field" data-receipt-setting="phone" value="${esc(r.phone)}"></div><div style="margin-top:10px"><label>住所</label><input class="field" data-receipt-setting="address" value="${esc(r.address)}"></div><div class="grid2" style="margin-top:10px"><div><label>山号</label><input class="field" data-receipt-setting="mountain" value="${esc(r.mountain)}" placeholder="例：能化山"></div><div><label>寺院名</label><input class="field" data-receipt-setting="temple" value="${esc(r.temple)}" placeholder="例：廣福寺"></div></div></div>
<div class="card"><h3>印影</h3><label class="name-toggle"><input type="checkbox" id="receiptSealEnabled" ${r.sealEnabled?'checked':''}> 印影を使用する</label><div style="margin-top:10px"><input id="receiptSealFile" type="file" accept="image/png,image/jpeg" class="field"></div><div class="muted" style="margin-top:6px">PNG / JPEG対応。JPEGも文字より先に描画し、寺院名を前面に重ねます。</div>${r.sealDataUrl?'<div class="notice ok" style="margin-top:10px">印影画像を登録済み</div>':''}</div>
<div class="card"><h3>PDF</h3><div class="grid2"><button class="btn primary" id="receiptPreview">PDFプレビュー</button><button class="btn" id="receiptResetLayout">標準配置に戻す</button></div><div class="muted" style="margin-top:8px">プレビュー内の「編集」から文字サイズ・上下位置・印影位置を微調整できます。</div><div class="grid2" style="margin-top:12px"><button class="btn" id="receiptSettingsBackup">設定JSONを書き出す</button><button class="btn" id="receiptSettingsRestore">設定JSONを読み込む</button></div><input id="receiptSettingsFile" type="file" accept="application/json,.json" class="hidden"></div>
<div class="card"><button class="btn wide" id="backPrintHub">← プリント一覧へ戻る</button></div>`}

function receiptMoneyItems(r,mode){
  const val=k=>r.money?.[k]===null||r.money?.[k]===undefined?0:(Number(r.money[k])||0);
  const items=[];const add=(label,n)=>{if(n>0)items.push({label,amount:n})};
  if(mode==='密葬'){
    add('香資',val('密葬香資'));add('供物料',val('密葬供物'));add('供花料',val('密葬供花'));
  }else if(mode==='本葬'){
    add('香資',val('本葬香資'));add('供物料',val('本葬供物料'));add('供花料',val('本葬供花料'));add('問候',val('問候'));add('献香',val('献香'));
  }else{
    add('香資',val('密葬香資')+val('本葬香資'));add('供物料',val('密葬供物')+val('本葬供物料'));add('供花料',val('密葬供花')+val('本葬供花料'));add('問候',val('問候'));add('献香',val('献香'));
  }
  return items;
}

function selectedPostcardData(){let recs=[];if(state.postcardTargetMode==='全員')recs=[...state.records];else if(state.postcardTargetMode==='No.指定'){const nums=new Set(parseNoSpec(state.postcardNoRange));recs=state.records.filter(r=>nums.has(actualNo(r)))}else{const n=Math.max(1,Number(state.postcardSingleNo)||1);recs=state.records.filter(r=>actualNo(r)===n)}return recs.map(r=>{ensureAddressFields(r);return {record:r,no:actualNo(r),name:namePartsForUse(r,'ハガキ'),zip:postalDigits(r.postalCode),address:String(r.addressKanji||addressToKanji(r.addressNumeric)||'')}}).filter(x=>x.zip.length===7&&x.address&&x.record.name)}
function verticalGlyph(ch){return /[-ー―−－]/.test(ch)?'｜':ch}
const POSTCARD_FONT_FAMILY='HGSeikaishotaiPRO, HG正楷書体-PRO, HGRSKP, Hiragino Mincho ProN, Yu Mincho, YuMincho, serif';
async function ensurePostcardFontLoaded(){try{if(document.fonts&&document.fonts.load)await document.fonts.load('16px HGSeikaishotaiPRO')}catch(e){console.warn('正楷書体を読み込めないため代替フォントを使用します',e)}}
function postcardCanvasFont(ctx,sizePx,weight=500){ctx.font=`${weight} ${sizePx}px ${POSTCARD_FONT_FAMILY}`;ctx.fillStyle='#000';ctx.textBaseline='middle'}
function drawVerticalText(ctx,text,x,y,sizePx,gapPx=2,weight=500,maxChars=99){postcardCanvasFont(ctx,sizePx,weight);ctx.textAlign='center';ctx.textBaseline='middle';let i=0;for(const ch0 of [...String(text||'')]){if(i>=maxChars)break;const ch=verticalGlyph(ch0);ctx.fillText(ch,x,y+i*(sizePx+gapPx));i++}return i*(sizePx+gapPx)}
function drawVerticalWrapped(ctx,text,x,y,sizePx,gapPx,maxChars,colGapPx,weight=500){const chars=[...String(text||'')];let col=0;for(let start=0;start<chars.length;start+=maxChars){drawVerticalText(ctx,chars.slice(start,start+maxChars).join(''),x-col*colGapPx,y,sizePx,gapPx,weight,maxChars);col++}return col}
function postcardCanvas(data,layoutOverride=null,showGuides=false){const MM=8,W=100*MM,H=148*MM,c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);const L={...ensurePostcardSettings().layout,...(layoutOverride||{})};L.zipDigitX=Array.isArray(layoutOverride?.zipDigitX)?[...layoutOverride.zipDigitX]:[...(ensurePostcardSettings().layout.zipDigitX||[0,0,0,0,0,0,0])];const mm=v=>v*MM;
  // JIS/日本郵便の私製葉書用郵便番号枠を基準にした7桁の中心位置。既製ハガキへ数字だけ印字する。
  const zipCenters=[47.15,54.0,60.8,69.55,76.35,83.15,89.15],zipY=16+(Number(L.zipY)||0),zipX=Number(L.zipX)||0,zs=clamp(Number(L.zipScale)||1,.65,1.5);const digits=[...data.zip];
  if(showGuides){ctx.save();ctx.strokeStyle='rgba(220,30,30,.42)';ctx.lineWidth=mm(.18);for(const cx of zipCenters)ctx.strokeRect(mm(cx-2.85+zipX),mm(12+(Number(L.zipY)||0)),mm(5.7),mm(8));ctx.restore()}
  canvasFont(ctx,mm(5.0)*zs,600);ctx.textAlign='center';ctx.textBaseline='middle';digits.forEach((d,i)=>ctx.fillText(d,mm(zipCenters[i]+zipX+(Number(L.zipDigitX?.[i])||0)),mm(zipY)));
  // 住所：漢数字住所を右側から縦書き。長い住所は左へ折り返す。
  const ax=81+(Number(L.addressX)||0),ay=35+(Number(L.addressY)||0),as=clamp(Number(L.addressScale)||1,.65,1.5);drawVerticalWrapped(ctx,data.address,mm(ax),mm(ay),mm(3.6)*as,mm(.38)*as,24,mm(5.2)*as,500);
  // 宛名：氏名をハガキ中央に固定し、寺号＋役職を右側へ。敬称1は氏名の続き、御侍史はその横へ。
  const np=data.name,nx=50+(Number(L.nameX)||0),ny=45+(Number(L.nameY)||0),ns=clamp(Number(L.nameScale)||1,.65,2.4);const name=String(np.line2||data.record.name||'');const honor=String(np.honorific1||'');const nameSize=mm(6.2)*ns;const nameGap=mm((.55+(Number(L.nameGap)||0)))*ns;const nameStep=nameSize+nameGap;const nameHeight=drawVerticalText(ctx,name,mm(nx),mm(ny),nameSize,nameGap,600,20);const honorY=mm(ny)+nameHeight+mm(2.0);if(honor)drawVerticalText(ctx,honor,mm(nx),honorY,nameSize,nameGap,600,8);
  const tx=64+(Number(L.titleX)||0),ty=48+(Number(L.titleY)||0),ts=clamp(Number(L.titleScale)||1,.65,2.1);if(np.line1)drawVerticalText(ctx,np.line1,mm(tx),mm(ty),mm(4.15)*ts,mm(.38)*ts,500,24);
  // 御侍史は「侍」を敬称1の最後の文字（老師/老宗師の師、様の様）と自動で横並びにする。gyojiYはその自動位置からの微調整。
  if(np.honorific2){const gx=44+(Number(L.gyojiX)||0);const honorLastY=honor?honorY+Math.max(0,[...honor].length-1)*nameStep:honorY;const gyojiChars=[...String(np.honorific2)];const anchorIndex=Math.max(0,gyojiChars.indexOf('侍'));const gyPx=honorLastY-anchorIndex*nameStep+mm(Number(L.gyojiY)||0);drawVerticalText(ctx,np.honorific2,mm(gx),gyPx,nameSize,nameGap,600,8)}
  return c}
function postcardAdjRow(label,key,delta,isScale=false){return `<div class="offering-control"><span>${label}</span><div><button class="btn small" data-postcard-adj="${key}" data-delta="-${delta}">${isScale?'−':'←/↑'}</button><strong id="postcardAdj_${key}"></strong><button class="btn small" data-postcard-adj="${key}" data-delta="${delta}">${isScale?'＋':'→/↓'}</button></div></div>`}
function updatePostcardAdjustLabels(root,L){const B=defaultPostcardSettings().layout;const scaleKeys=['zipScale','addressScale','titleScale','nameScale'];for(const k of scaleKeys){const e=$('#postcardAdj_'+k,root);if(!e)continue;if(k==='zipScale'){e.textContent=`${Math.round(((Number(L[k])||1)-1)*100)}%`}else{const base=Number(B[k])||1,v=Number(L[k])||base;e.textContent=`${Math.round((v/base-1)*100)}%`}}for(const k of ['zipX','zipY','addressX','addressY','titleX','titleY','nameX','nameY','gyojiX','gyojiY']){const e=$('#postcardAdj_'+k,root);if(!e)continue;const base=Number(B[k])||0,v=(Number(L[k])||0)-base;e.textContent=`${v>0?'+':''}${v}mm`}const ng=$('#postcardAdj_nameGap',root);if(ng){const v=(Number(L.nameGap)||0)-(Number(B.nameGap)||0);ng.textContent=`${v>0?'+':''}${v.toFixed(2)}mm`}for(let i=0;i<7;i++){const e=$(`#postcardDigit_${i}`,root),v=Number(L.zipDigitX?.[i])||0;if(e)e.textContent=`${v>0?'+':''}${v}mm`}}
async function postcardPreviewModal(){const list=selectedPostcardData();if(!list.length){toast('郵便番号・住所・氏名が揃った対象がありません');return}await ensurePostcardFontLoaded();let L={...ensurePostcardSettings().layout,zipDigitX:[...(ensurePostcardSettings().layout.zipDigitX||[0,0,0,0,0,0,0])]};const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal" style="max-width:800px"><h3>ハガキプレビュー</h3><div class="offering-preview-wrap" id="postcardPreviewWrap" style="max-height:58dvh;background:#ddd"></div><div class="muted" style="margin:8px 0 12px">100×148mm / 対象 ${list.length}件（赤枠はプレビュー用。PDFには印刷しません）</div><div class="grid3"><button class="btn" id="postcardPreviewCancel">戻る</button><button class="btn" id="postcardPreviewEdit">編集</button><button class="btn primary" id="postcardMakePdf">PDFを作成</button></div><div class="offering-editor hidden" id="postcardEditor"><div class="section-title">郵便番号 全体</div>${postcardAdjRow('郵便番号 左右','zipX',.5)}${postcardAdjRow('郵便番号 上下','zipY',.5)}${postcardAdjRow('郵便番号 サイズ','zipScale',.05,true)}<div class="section-title">郵便番号 1桁ずつ左右</div><div id="postcardDigitControls">${[0,1,2,3,4,5,6].map(i=>`<div class="offering-control"><span>${i+1}桁目</span><div><button class="btn small" data-postcard-digit="${i}" data-delta="-.25">←</button><strong id="postcardDigit_${i}">0mm</strong><button class="btn small" data-postcard-digit="${i}" data-delta=".25">→</button></div></div>`).join('')}</div><div class="section-title">住所</div>${postcardAdjRow('住所 左右','addressX',1)}${postcardAdjRow('住所 上下','addressY',1)}${postcardAdjRow('住所 サイズ','addressScale',.05,true)}<div class="section-title">寺号・役職</div>${postcardAdjRow('寺号役職 左右','titleX',1)}${postcardAdjRow('寺号役職 上下','titleY',1)}${postcardAdjRow('寺号役職 サイズ','titleScale',.05,true)}<div class="section-title">氏名・敬称1</div>${postcardAdjRow('氏名 左右','nameX',1)}${postcardAdjRow('氏名 上下','nameY',1)}${postcardAdjRow('氏名 サイズ','nameScale',.05,true)}${postcardAdjRow('氏名 文字間隔','nameGap',.05)}<div class="section-title">敬称2（御侍史）</div><div class="muted" style="margin-bottom:6px">0mmで「侍」を敬称1の最後の文字へ自動整列します。</div>${postcardAdjRow('御侍史 左右','gyojiX',1)}${postcardAdjRow('御侍史 上下','gyojiY',1)}</div></div>`;document.body.append(back);const redraw=()=>{const canvas=postcardCanvas(list[0],L,true),w=$('#postcardPreviewWrap',back);w.innerHTML='';canvas.style.width='min(390px,78vw)';canvas.style.height='auto';w.append(canvas);updatePostcardAdjustLabels(back,L)};redraw();$('#postcardPreviewCancel',back).onclick=()=>back.remove();$('#postcardPreviewEdit',back).onclick=()=>$('#postcardEditor',back).classList.toggle('hidden');$$('[data-postcard-adj]',back).forEach(b=>b.onclick=()=>{const k=b.dataset.postcardAdj,d=Number(b.dataset.delta);if(k.endsWith('Scale')){const base=Number(defaultPostcardSettings().layout[k])||1;L[k]=Number(((L[k]??base)+Math.sign(d)*base*.05).toFixed(3))}else{L[k]=Number(((L[k]??0)+d).toFixed(2))}redraw()});$$('[data-postcard-digit]',back).forEach(b=>b.onclick=()=>{const i=Number(b.dataset.postcardDigit),d=Number(b.dataset.delta);L.zipDigitX[i]=Number(((L.zipDigitX[i]||0)+d).toFixed(2));redraw()});$('#postcardMakePdf',back).onclick=async()=>{ensurePostcardSettings().layout={...L,zipDigitX:[...L.zipDigitX]};autoSave();await makePostcardPdf(list);back.remove()}}
async function makePostcardPdf(list){const JSPDF=window.jspdf?.jsPDF;if(!JSPDF){alert('PDFライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}await ensurePostcardFontLoaded();try{const pdf=new JSPDF({orientation:'portrait',unit:'mm',format:[100,148],compress:true});for(let i=0;i<list.length;i++){if(i>0)pdf.addPage([100,148],'portrait');const canvas=postcardCanvas(list[i],null,false);pdf.addImage(canvas.toDataURL('image/jpeg',.96),'JPEG',0,0,100,148,undefined,'FAST')}const blob=pdf.output('blob'),url=URL.createObjectURL(blob),opened=window.open(url,'_blank');if(!opened){downloadBlob(blob,`ハガキ_${stamp()}.pdf`);toast('ハガキPDFを保存しました')}else setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){console.error(e);alert('ハガキPDFを作成できませんでした。\n'+e.message)}}
function receiptDataForRecord(r,mode){const items=receiptMoneyItems(r,mode);return {record:r,items,total:items.reduce((a,x)=>a+x.amount,0),name:namePartsForUse(r,'領収書'),no:actualNo(r)}}
function parseNoSpec(spec){const out=new Set();String(spec||'').split(/[、,\s]+/).filter(Boolean).forEach(part=>{const m=/^(\d+)\s*[-ー〜~]\s*(\d+)$/.exec(part);if(m){let a=Number(m[1]),b=Number(m[2]);if(a>b)[a,b]=[b,a];for(let n=a;n<=b;n++)out.add(n)}else if(/^\d+$/.test(part))out.add(Number(part))});return [...out].sort((a,b)=>a-b)}
function selectedReceiptData(){let recs=[];if(state.receiptTargetMode==='全員')recs=[...state.records];else if(state.receiptTargetMode==='No.指定'){const nums=new Set(parseNoSpec(state.receiptNoRange));recs=state.records.filter(r=>nums.has(actualNo(r)))}else{const n=Math.max(1,Number(state.receiptSingleNo)||1);recs=state.records.filter(r=>actualNo(r)===n)}return recs.map(r=>receiptDataForRecord(r,state.receiptIssueMode)).filter(x=>x.total>0)}
function reiwaDateString(d=new Date()){const y=d.getFullYear()-2018;return `令和${y}年${d.getMonth()+1}月${d.getDate()}日`}
function receiptHistoryKey(data){return `${data.record.id}|${state.receiptIssueMode}`}
function loadCanvasImage(src){return new Promise((resolve,reject)=>{if(!src){resolve(null);return}const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src})}
function canvasFont(ctx,sizePx,weight=500){ctx.font=`${weight} ${sizePx}px "Hiragino Mincho ProN","Yu Mincho","YuMincho",serif`;ctx.fillStyle='#000';ctx.textBaseline='middle'}
function spacedTextWidth(ctx,text,gapPx){const chars=[...String(text||'')];if(!chars.length)return 0;return chars.reduce((a,ch)=>a+ctx.measureText(ch).width,0)+Math.max(0,chars.length-1)*gapPx}
function drawSpacedText(ctx,text,x,y,gapPx,align='left'){const chars=[...String(text||'')];if(!chars.length)return 0;const total=spacedTextWidth(ctx,text,gapPx);let cur=align==='center'?x-total/2:align==='right'?x-total:x;const old=ctx.textAlign;ctx.textAlign='left';for(const ch of chars){const w=ctx.measureText(ch).width;ctx.fillText(ch,cur,y);cur+=w+gapPx}ctx.textAlign=old;return total}
function fitCanvasText(ctx,text,maxWidth,startPx,minPx=16,weight=500){let px=startPx;while(px>minPx){canvasFont(ctx,px,weight);if(ctx.measureText(String(text||'')).width<=maxWidth)return px;px-=2}return minPx}
function fitCanvasSpacedText(ctx,text,maxWidth,startPx,minPx=16,weight=500,gapPx=0){let px=startPx;while(px>minPx){canvasFont(ctx,px,weight);if(spacedTextWidth(ctx,String(text||''),gapPx)<=maxWidth)return px;px-=2}return minPx}
async function receiptCanvas(data,layoutOverride=null){
  const MM=8,W=Math.round(148*MM),H=Math.round(105*MM),c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#000';
  const st=ensureReceiptSettings(),L={...st.layout,...(layoutOverride||{})};const mm=v=>v*MM;
  // 見出し・番号
  canvasFont(ctx,mm(7.2),600);ctx.textAlign='center';ctx.fillText('領 収 書',mm(74),mm(13));
  canvasFont(ctx,mm(4.4),500);ctx.textAlign='left';ctx.fillText(`No.  ${data.no}`,mm(115),mm(14.2));ctx.lineWidth=mm(.25);ctx.beginPath();ctx.moveTo(mm(108),mm(18));ctx.lineTo(mm(137),mm(18));ctx.stroke();
  // 宛名：旧標準の -5mm を新しい 0mm 基準にする。
  const ry=Number(L.recipientY)||0,rs=clamp(Number(L.recipientScale)||1,.65,1.5);ctx.textAlign='left';
  const recipientBase=-5+ry;
  if(data.name.line1){let px=fitCanvasText(ctx,data.name.line1,mm(64),mm(4.68)*rs,mm(3.1),500);canvasFont(ctx,px,500);ctx.fillText(data.name.line1,mm(14),mm(24+recipientBase))}
  const second=[data.name.line2,data.name.honorific1].filter(Boolean).join(' ');if(second){const recipientGap=mm(0.22)*rs;let px=fitCanvasSpacedText(ctx,second,mm(63),mm(6.30)*rs,mm(3.4),600,recipientGap);canvasFont(ctx,px,600);drawSpacedText(ctx,second,mm(18),mm(32+recipientBase),recipientGap,'left')}
  // 氏名と下線が重ならないよう約2mmの余白を確保。
  ctx.lineWidth=mm(.2);ctx.beginPath();ctx.moveTo(mm(13),mm(37+recipientBase));ctx.lineTo(mm(78),mm(37+recipientBase));ctx.stroke();
  // 金額枠：高さを圧縮して内訳領域を確保。
  const ay=Number(L.amountY)||0,as=clamp(Number(L.amountScale)||1,.7,1.4);const boxY=35.5+ay,boxH=14.5;ctx.fillStyle='#e5e5e5';ctx.fillRect(mm(30),mm(boxY),mm(88),mm(boxH));ctx.strokeStyle='#000';ctx.lineWidth=mm(.55);ctx.strokeRect(mm(30),mm(boxY),mm(88),mm(boxH));ctx.fillStyle='#000';canvasFont(ctx,mm(4.0)*as,500);ctx.textAlign='left';ctx.fillText('金額',mm(37),mm(boxY+5.4));canvasFont(ctx,mm(8.1)*as,500);ctx.textAlign='center';ctx.fillText(`¥${fmt(data.total)}`,mm(75),mm(boxY+8.0));canvasFont(ctx,mm(5.8)*as,500);ctx.textAlign='center';ctx.fillText('円也',mm(106),mm(boxY+8.3));
  // 内訳：標準を旧位置より5mm上へ。5項目すべてある場合だけ問候・献香を右ブロックへ。
  const dy=Number(L.detailY)||0,ds=clamp(Number(L.detailScale)||1,.7,1.4);const detailTop=56+dy;canvasFont(ctx,mm(3.35)*ds,500);ctx.textAlign='left';ctx.fillText('内訳',mm(24),mm(detailTop));
  const drawDetailColumn=(items,labelX,amountX,startY)=>{let yy=startY;for(const item of items){canvasFont(ctx,mm(3.55)*ds,500);ctx.textAlign='left';ctx.fillText(item.label,mm(labelX),mm(yy));ctx.textAlign='right';ctx.fillText(`${fmt(item.amount)}円`,mm(amountX),mm(yy));yy+=4.3}};
  if(data.items.length===5){const left=data.items.filter(x=>!['問候','献香'].includes(x.label));const right=data.items.filter(x=>['問候','献香'].includes(x.label));drawDetailColumn(left,36,75,detailTop);drawDetailColumn(right,84,119,detailTop)}else{drawDetailColumn(data.items,36,75,detailTop)}
  // 日付・定型文：内訳との距離を詰め、日付はやや右へ寄せる。
  canvasFont(ctx,mm(3.5),500);ctx.textAlign='left';ctx.fillText(reiwaDateString(),mm(32),mm(75));ctx.fillText('上記正に領収いたしました',mm(70),mm(75));
  // 印影は寺院名より先に描く（JPEGの白背景でも文字を前面へ）
  if(st.sealEnabled&&st.sealDataUrl){try{const im=await loadCanvasImage(st.sealDataUrl);if(im){const ss=clamp(Number(L.sealScale)||1,.35,2),sx=Number(L.sealX)||0,sy=Number(L.sealY)||0;const w=mm(18*ss),h=w;ctx.drawImage(im,mm(120+sx),mm(78+sy),w,h)}}catch(e){console.warn('印影読込失敗',e)}}
  // 発行者情報：山号＋寺院名を同じ下端（文字ベースライン）で揃え、その下に住所→電話番号。
  // 寺院名と住所の間隔も、住所と電話番号の間隔とほぼ同じになるよう詰める。
  const iy=Number(L.issuerY)||0,is=clamp(Number(L.issuerScale)||1,.7,1.4);const issuerX=84;
  const baseY=85.2+iy;const addressY=89.2+iy,phoneY=94.2+iy;const mountainSize=mm(3.78)*is,templeSize=mm(7.20)*is,mountainGap=mm(1.15)*is,templeGap=mm(1.35)*is;
  let mountainW=0;if(st.mountain){canvasFont(ctx,mountainSize,500);mountainW=spacedTextWidth(ctx,st.mountain,mountainGap)}
  const between=st.mountain&&st.temple?mm(3.6)*is:0;let startX=mm(issuerX);
  const oldBaseline=ctx.textBaseline;ctx.textBaseline='alphabetic';
  if(st.mountain){canvasFont(ctx,mountainSize,500);ctx.textBaseline='alphabetic';drawSpacedText(ctx,st.mountain,startX,mm(baseY),mountainGap,'left');startX+=mountainW+between}
  if(st.temple){canvasFont(ctx,templeSize,600);ctx.textBaseline='alphabetic';drawSpacedText(ctx,st.temple,startX,mm(baseY),templeGap,'left')}
  ctx.textBaseline=oldBaseline;
  canvasFont(ctx,mm(3.48)*is,500);ctx.textAlign='left';if(st.address)ctx.fillText(st.address,mm(issuerX),mm(addressY));if(st.phone)ctx.fillText(`TEL：${st.phone}`,mm(issuerX),mm(phoneY));
  return c;
}
async function receiptPreviewModal(){const list=selectedReceiptData();if(!list.length){toast('選択した範囲に領収書対象の金額がありません');return}let L={...ensureReceiptSettings().layout};const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal" style="max-width:760px"><h3>領収書プレビュー</h3><div class="offering-preview-wrap" id="receiptPreviewWrap" style="max-height:55dvh"></div><div class="muted" style="margin:8px 0 12px">A6横 / ${esc(state.receiptIssueMode)} / 対象 ${list.length}件（プレビューは先頭の1件）</div><div class="grid3"><button class="btn" id="receiptPreviewCancel">戻る</button><button class="btn" id="receiptPreviewEdit">編集</button><button class="btn primary" id="receiptMakePdf">PDFを作成</button></div><div class="offering-editor hidden" id="receiptEditor"><div class="section-title">微調整</div>${receiptAdjustRow('宛名サイズ','recipientScale',.05,true)}${receiptAdjustRow('宛名上下','recipientY',1,false)}${receiptAdjustRow('金額サイズ','amountScale',.05,true)}${receiptAdjustRow('金額上下','amountY',1,false)}${receiptAdjustRow('内訳サイズ','detailScale',.05,true)}${receiptAdjustRow('内訳上下','detailY',1,false)}${receiptAdjustRow('発行者サイズ','issuerScale',.05,true)}${receiptAdjustRow('発行者上下','issuerY',1,false)}${receiptAdjustRow('印影サイズ','sealScale',.05,true)}${receiptAdjustRow('印影左右','sealX',1,false)}${receiptAdjustRow('印影上下','sealY',1,false)}</div></div>`;document.body.append(back);let canvas=null;const redraw=async()=>{canvas=await receiptCanvas(list[0],L);const w=$('#receiptPreviewWrap',back);w.innerHTML='';canvas.style.width='min(620px,92vw)';w.append(canvas);updateReceiptAdjustLabels(back,L)};await redraw();$('#receiptPreviewCancel',back).onclick=()=>back.remove();$('#receiptPreviewEdit',back).onclick=()=>$('#receiptEditor',back).classList.toggle('hidden');$$('[data-receipt-adj]',back).forEach(b=>b.onclick=async()=>{const k=b.dataset.receiptAdj,d=Number(b.dataset.delta);L[k]=Number(((L[k]??(k.endsWith('Scale')?1:0))+d).toFixed(2));await redraw()});$('#receiptMakePdf',back).onclick=async()=>{ensureReceiptSettings().layout={...L};autoSave();await makeReceiptPdf(list);back.remove()}}
function receiptAdjustRow(label,key,delta,isScale){return `<div class="offering-control"><span>${label}</span><div><button class="btn small" data-receipt-adj="${key}" data-delta="-${delta}">${isScale?'−':'↑/←'}</button><strong id="receiptAdj_${key}"></strong><button class="btn small" data-receipt-adj="${key}" data-delta="${delta}">${isScale?'＋':'↓/→'}</button></div></div>`}
function updateReceiptAdjustLabels(root,L){for(const k of ['recipientScale','amountScale','detailScale','issuerScale','sealScale']){const e=$('#receiptAdj_'+k,root);if(e)e.textContent=`${Math.round((Number(L[k])||1)*100)}%`}for(const k of ['recipientY','amountY','detailY','issuerY','sealX','sealY']){const e=$('#receiptAdj_'+k,root),v=Number(L[k])||0;if(e)e.textContent=`${v>0?'+':''}${v}mm`}}
async function makeReceiptPdf(list){const JSPDF=window.jspdf?.jsPDF;if(!JSPDF){alert('PDFライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}const st=ensureReceiptSettings();const already=list.filter(x=>st.history[receiptHistoryKey(x)]);if(already.length&&!confirm(`${already.length}件は印刷済みです。再度印刷しますか？`))return;try{const pdf=new JSPDF({orientation:'landscape',unit:'mm',format:[105,148],compress:true});for(let i=0;i<list.length;i++){if(i>0)pdf.addPage([105,148],'landscape');const canvas=await receiptCanvas(list[i]);pdf.addImage(canvas.toDataURL('image/jpeg',.95),'JPEG',0,0,148,105,undefined,'FAST')}const blob=pdf.output('blob'),url=URL.createObjectURL(blob),opened=window.open(url,'_blank');const now=new Date().toISOString();for(const x of list){const k=receiptHistoryKey(x),old=st.history[k]||{};st.history[k]={firstPrintedAt:old.firstPrintedAt||now,lastPrintedAt:now,count:(Number(old.count)||0)+1,no:x.no,mode:state.receiptIssueMode}}autoSave();if(!opened){downloadBlob(blob,`領収書_${state.receiptIssueMode}_${stamp()}.pdf`);toast('領収書PDFを保存しました')}else{setTimeout(()=>URL.revokeObjectURL(url),60000)}}catch(e){console.error(e);alert('領収書PDFを作成できませんでした。\n'+e.message)}}
function bindPrintHub(){$$('[data-print-kind]').forEach(b=>b.onclick=()=>{state.printKind=b.dataset.printKind;state.screen=state.printKind==='receipt'?'receiptPrint':state.printKind==='postcard'?'postcardPrint':'printPlaceholder';render();autoSave()})}
function bindPrintPlaceholder(){const b=$('#backPrintHub');if(b)b.onclick=()=>{state.screen='printHub';render()}}
function bindPostcardPrint(){ensurePostcardSettings();$$('[data-postcard-target]').forEach(b=>b.onclick=()=>{state.postcardTargetMode=b.dataset.postcardTarget;render();autoSave()});const sn=$('#postcardSingleNo');if(sn)sn.oninput=()=>{state.postcardSingleNo=Math.max(1,Number(sn.value)||1);autoSave()};const nr=$('#postcardNoRange');if(nr)nr.oninput=()=>{state.postcardNoRange=nr.value;autoSave()};const pv=$('#postcardPreview');if(pv)pv.onclick=()=>postcardPreviewModal();const reset=$('#postcardResetLayout');if(reset)reset.onclick=()=>{state.postcardSettings=defaultPostcardSettings();autoSave();toast('ハガキの標準配置に戻しました')};const b=$('#backPrintHub');if(b)b.onclick=()=>{state.screen='printHub';render()}}
function bindReceiptPrint(){ensureReceiptSettings();$$('[data-receipt-issue]').forEach(b=>b.onclick=()=>{state.receiptIssueMode=b.dataset.receiptIssue;render();autoSave()});$$('[data-receipt-target]').forEach(b=>b.onclick=()=>{state.receiptTargetMode=b.dataset.receiptTarget;render();autoSave()});const sn=$('#receiptSingleNo');if(sn)sn.oninput=()=>{state.receiptSingleNo=Math.max(1,Number(sn.value)||1);autoSave()};const nr=$('#receiptNoRange');if(nr)nr.oninput=()=>{state.receiptNoRange=nr.value;autoSave()};$$('[data-receipt-setting]').forEach(el=>el.oninput=()=>{ensureReceiptSettings()[el.dataset.receiptSetting]=el.value;autoSave()});const se=$('#receiptSealEnabled');if(se)se.onchange=()=>{ensureReceiptSettings().sealEnabled=se.checked;autoSave()};const sf=$('#receiptSealFile');if(sf)sf.onchange=()=>{const f=sf.files?.[0];if(!f)return;if(!/^image\/(png|jpeg)$/.test(f.type)){toast('PNGまたはJPEGを選択してください');return}const reader=new FileReader();reader.onload=()=>{ensureReceiptSettings().sealDataUrl=String(reader.result||'');autoSave();render();toast('印影画像を登録しました')};reader.readAsDataURL(f)};const pv=$('#receiptPreview');if(pv)pv.onclick=()=>receiptPreviewModal();const reset=$('#receiptResetLayout');if(reset)reset.onclick=()=>{ensureReceiptSettings().layout={...defaultReceiptSettings().layout};autoSave();toast('標準配置に戻しました')};const rb=$('#receiptSettingsBackup');if(rb)rb.onclick=()=>{const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),receiptSettings:ensureReceiptSettings()},null,2)],{type:'application/json'});downloadBlob(blob,'領収書設定_'+stamp()+'.json')};const rr=$('#receiptSettingsRestore'),rf=$('#receiptSettingsFile');if(rr&&rf){rr.onclick=()=>rf.click();rf.onchange=()=>{const f=rf.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const j=JSON.parse(String(rd.result||''));state.receiptSettings={...defaultReceiptSettings(),...(j.receiptSettings||j||{})};ensureReceiptSettings();autoSave();render();toast('領収書設定を読み込みました')}catch(e){alert('領収書設定JSONを読み込めませんでした')} };rd.readAsText(f)}}const b=$('#backPrintHub');if(b)b.onclick=()=>{state.screen='printHub';render()}}
function bindCurrent(){
  $$('[data-go]').forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(g==='new'){state.draft=blankRecord();state.editId=null;state.mode='income';state.returnScreen='home';state.screen='form'}if(g==='search'){state.returnScreen=null;state.screen='search'}if(g==='table'){state.returnScreen=null;state.screen='table'}if(g==='cash'){state.returnScreen=null;state.screen='cash'}if(g==='nameRules'){state.returnScreen=null;state.screen='nameRules'}if(g==='print'){state.returnScreen=null;state.screen='printHub'}if(g==='settings'){state.screen='settings'}if(g==='deleted'){state.screen='deleted'}if(g==='save'){exportExcel()}render();autoSave()});
  const bn=$('#baseName');if(bn)bn.oninput=()=>{state.baseName=bn.value||'本葬受付台帳';autoSave()};
  const ox=$('#openExcel'),fx=$('#fileExcel');if(ox&&fx){ox.onclick=()=>fx.click();fx.onchange=e=>importExcel(e.target.files[0])}
  if(state.screen==='form')bindForm();if(state.screen==='search')bindSearch();if(state.screen==='table')bindTable();if(state.screen==='settings')bindSettings();if(state.screen==='deleted')bindDeleted();if(state.screen==='rules')bindRules();if(state.screen==='cash')bindCash();if(state.screen==='nameRules')bindNameRules();if(state.screen==='printHub')bindPrintHub();if(state.screen==='printPlaceholder')bindPrintPlaceholder();if(state.screen==='postcardPrint')bindPostcardPrint();if(state.screen==='receiptPrint')bindReceiptPrint();
}

function bindForm(){const r=state.draft;
const back=$('#backToSource');if(back)back.onclick=backToSource;
const toggle=$('#toggleBasicInfo');if(toggle)toggle.onclick=()=>{state.basicInfoExpanded=!state.basicInfoExpanded;render();scrollPageTop()};
const prev=$('#editPrev');if(prev)prev.onclick=()=>navigateEdit(-1);const next=$('#editNext');if(next)next.onclick=()=>navigateEdit(1);const commitNext=$('#commitNext');if(commitNext)commitNext.onclick=()=>navigateEdit(1);
const upt=$('#useParentTemple');if(upt)upt.onclick=()=>{const p=state.records.find(x=>x.id===r.parentId);if(!p)return;r.office=p.office||'第1宗務所';r.district=p.district||'';r.templeNo=p.templeNo||'';r.temple=p.temple||'';r.postalCode=p.postalCode||'';r.addressNumeric=p.addressNumeric||'';r.addressKanji=p.addressKanji||'';r._templeQuery=r.temple;applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});autoSave();render();toast(`${r.temple} を引き継ぎました`)};
$$('[data-district]').forEach(b=>b.onclick=()=>{r.district=b.dataset.district;r.temple='';r.templeNo='';r.postalCode='';r.addressNumeric='';r.addressKanji='';r._templeQuery='';applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});autoSave();render()});
const ts=$('#templeSearch');if(ts){ts.oninput=()=>{r._templeQuery=ts.value;r.temple=ts.value;r.templeNo='';autoSave();updateTempleSuggestions()}}
bindTempleSuggestionButtons();
const um=$('#useManualTemple');if(um)um.onclick=()=>{r.temple=(r._templeQuery||'').trim();r.templeNo='';showCandidateAction();autoSave();render()};
$$('[data-role]').forEach(b=>b.onclick=()=>{r.role=b.dataset.role;autoSave();render()});
const rm=$('#roleManual');if(rm)rm.oninput=()=>{if(rm.value.trim())r.role=rm.value.trim();autoSave();showCandidateAction()};
const people=peopleForTemple(r);$$('[data-person-index]').forEach(b=>b.onclick=()=>{const p=people[Number(b.dataset.personIndex)];if(p){r.role=p.role;r.name=p.name;applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});autoSave();render()}});
const nf=$('#nameField');if(nf){nf.oninput=()=>{r.name=nf.value;autoSave();showCandidateAction()};nf.onchange=()=>{applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});autoSave();render()}};
const pc=$('#postalCodeField');if(pc)pc.oninput=()=>{r.postalCode=normalizePostalCode(pc.value);if(pc.value!==r.postalCode)pc.value=r.postalCode;autoSave();if(postalDigits(r.postalCode).length===7&&!String(r.addressNumeric||'').trim())fillAddressFromPostal(r,{force:false})};const pla=$('#lookupPostalAddress');if(pla)pla.onclick=()=>fillAddressFromPostal(r,{force:true});const an=$('#addressNumericField');if(an)an.oninput=()=>{const prevAuto=addressToKanji(r.addressNumeric||'');r.addressNumeric=an.value;if(!r.addressKanji||r.addressKanji===prevAuto){r.addressKanji=addressToKanji(r.addressNumeric);const ak=$('#addressKanjiField');if(ak)ak.value=r.addressKanji}autoSave()};const ak=$('#addressKanjiField');if(ak)ak.oninput=()=>{r.addressKanji=ak.value;autoSave()};const ga=$('#generateKanjiAddress');if(ga)ga.onclick=()=>{r.addressKanji=addressToKanji(r.addressNumeric);const f=$('#addressKanjiField');if(f)f.value=r.addressKanji;autoSave();toast('漢数字住所を生成しました')};
const as=$('#assignmentSelect');if(as)as.onchange=()=>{if(as.value==='__manual__'){r.assignment='';syncGuidedExpenseColumns(r);applyRuleDefaultsToRecord(r,{honorarium:true,kaishin:false});autoSave();render()}else{r.assignment=as.value;syncGuidedExpenseColumns(r);applyRuleDefaultsToRecord(r,{honorarium:true,kaishin:false});autoSave();render()}};
const am=$('#assignmentManual');if(am)am.oninput=()=>{r.assignment=am.value;syncGuidedExpenseColumns(r);applyRuleDefaultsToRecord(r,{honorarium:true,kaishin:false});autoSave()};
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
function addCandidateFromDraft(){const r=state.draft;if(r.temple&&!r.templeNo){const exists=[...state.fixedTemples,...state.addedDirectory.temples].some(t=>norm(t['寺院名'])===norm(r.temple)&&t['教区']===r.district);if(!exists)state.addedDirectory.temples.push({'宗務所':r.office||'第1宗務所','教区':r.district,'寺籍番号':'','寺院名':r.temple,'フリガナ':'','郵便番号':r.postalCode||'','住所（数字）':r.addressNumeric||'','住所（漢数字）':r.addressKanji||'','住職':'','東堂':'','副住職':'','徒弟':'','御山内':'','寺族1':'','寺族2':''})}if(r.name&&r.temple){const exists=state.addedDirectory.people.some(p=>norm(p.name)===norm(r.name)&&norm(p.role)===norm(r.role)&&((r.templeNo&&p.templeNo===r.templeNo)||p.temple===r.temple));if(!exists)state.addedDirectory.people.push({templeNo:r.templeNo,district:r.district,temple:r.temple,role:r.role,name:r.name})}autoSave()}

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

function openMoney(key){moneyTarget=key;moneyValue=state.draft.money[key]===null?0:Number(state.draft.money[key])||0;const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h3>${esc(key)}</h3><div class="big-amount" id="moneyDisplay">${fmt(moneyValue)} 円</div><div class="quick-grid">${[10000,20000,30000,50000,100000].map(n=>`<button class="btn" data-quick="${n}">${fmt(n)}</button>`).join('')}</div><div class="section-title">手動入力</div><input id="moneyManual" class="field field-lg" inputmode="numeric" placeholder="金額を直接入力"><div class="grid3" style="margin-top:12px"><button class="btn" id="moneyClear">クリア</button><button class="btn" id="moneyCancel">キャンセル</button><button class="btn primary" id="moneyOk">決定</button></div></div>`;document.body.append(back);const disp=()=>$('#moneyDisplay',back).textContent=fmt(moneyValue)+' 円';$$('[data-quick]',back).forEach(b=>b.onclick=()=>{moneyValue+=Number(b.dataset.quick);disp()});$('#moneyManual',back).oninput=e=>{const v=e.target.value.replace(/[^0-9]/g,'');if(v!==''){moneyValue=Number(v);disp()}};$('#moneyClear',back).onclick=()=>{moneyValue=0;disp();$('#moneyManual',back).value=''};$('#moneyCancel',back).onclick=()=>back.remove();$('#moneyOk',back).onclick=()=>{const r=state.draft;setMoneyWithSource(r,moneyTarget,moneyValue===0?0:moneyValue,isRuleControlledMoneyKey(moneyTarget)?'manual':null);if(moneyTarget==='密葬香資')applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});if(moneyTarget==='本葬香資')applyRuleDefaultsToRecord(r,{honorarium:false,kaishin:true});back.remove();autoSave();render()};}
function saveCurrentDraft(quiet=false){
  const r=state.draft;if(!r||!r.name.trim()){toast('氏名は必須です');return false}
  applyRuleDefaultsToRecord(r);syncGuidedExpenseColumns(r);delete r._templeQuery;
  if(state.editId){
    const i=state.records.findIndex(x=>x.id===state.editId);if(i<0){toast('更新対象が見つかりません');return false}
    state.records[i]=JSON.parse(JSON.stringify(r));if(!quiet)toast('更新しました');return true;
  }
  if(state.records.some(x=>x.id===r.id)){toast('IDが重複しています');return false}
  state.records.push(JSON.parse(JSON.stringify(r)));if(!quiet)toast('登録しました');return true;
}
function commitRecord(goHome=true,renderAfter=true){
  const destination=state.returnScreen||'home';if(!saveCurrentDraft(false))return false;
  state.editId=null;state.draft=null;state.editNav={source:null,ids:[]};state.basicInfoExpanded=false;
  if(goHome){state.screen=destination;state.returnScreen=null}autoSave();if(renderAfter)render();return true
}
function navigateEdit(delta){
  if(!state.editId)return;const {ids,index}=currentEditNav();const targetIndex=index+delta;if(index<0||targetIndex<0||targetIndex>=ids.length)return;
  if(!saveCurrentDraft(true))return;const target=state.records.find(x=>x.id===ids[targetIndex]);if(!target){toast('移動先が見つかりません');return}
  state.draft=JSON.parse(JSON.stringify(target));state.editId=target.id;state.basicInfoExpanded=false;state.mode='income';autoSave();render();scrollPageTop();toast('更新して移動しました');
}
function deleteRecord(){const r=state.draft;const destination=state.returnScreen||'home';const children=state.records.filter(x=>x.parentId===r.id);let msg=`${r.id} ${r.name} を削除しますか？`;if(children.length)msg+=`\n\n預かり ${children.length}件も一緒に削除されます。`;if(!confirm(msg))return;const ids=new Set([r.id,...children.map(x=>x.id)]);state.records=state.records.filter(x=>{if(ids.has(x.id)){state.deleted.unshift({record:JSON.parse(JSON.stringify(x)),deletedAt:new Date().toISOString()});return false}return true});state.draft=null;state.editId=null;state.editNav={source:null,ids:[]};state.basicInfoExpanded=false;state.screen=destination;state.returnScreen=null;autoSave();render();toast('削除しました')}

function snapshotTableScroll(){const w=$('#tableWrap');if(w)state.tableScroll={top:w.scrollTop,left:w.scrollLeft}}
function bindSearchEditButtons(root=document){$$('[data-edit]',root).forEach(b=>b.onclick=()=>editRecord(b.dataset.edit,state.screen))}
function bindSearch(){const f=$('#recordSearch');if(f)f.oninput=()=>{state.search=f.value;const box=$('#recordSearchResults');if(box){box.innerHTML=searchResultsMarkup();bindSearchEditButtons(box)}};bindSearchEditButtons();setTimeout(()=>window.scrollTo(0,state.searchScrollY||0),0)}
function refreshTableResults(){snapshotTableScroll();const box=$('#tableResults');if(box){box.innerHTML=tableMarkup(filteredRecords());bindSearchEditButtons(box);$$('[data-column-filter]',box).forEach(h=>h.onclick=e=>{e.stopPropagation();openColumnFilter(h.dataset.columnFilter)});restoreTableScroll()}}
function restoreTableScroll(){const w=$('#tableWrap');if(w){w.scrollTop=state.tableScroll?.top||0;w.scrollLeft=state.tableScroll?.left||0}}
function bindTable(){const or=$('#openRules');if(or)or.onclick=()=>{state.screen='rules';render();autoSave()};const cf=$('#clearColumnFilters');if(cf)cf.onclick=()=>{state.filters.columns={};state.tableScroll={top:0,left:0};render();autoSave()};$$('[data-column-filter]').forEach(h=>h.onclick=e=>{e.stopPropagation();openColumnFilter(h.dataset.columnFilter)});const s=$('#tableSearch');if(s)s.oninput=()=>{state.search=s.value;state.tableScroll={top:0,left:0};refreshTableResults()};const d=$('#tableDistrict');if(d)d.onchange=()=>{state.filters.district=d.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const k=$('#tableKind');if(k)k.onchange=()=>{state.filters.kind=k.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};const g=$('#tableGuide');if(g)g.onchange=()=>{state.filters.guide=g.value;state.tableScroll={top:0,left:0};refreshTableResults();autoSave()};$$('[data-table-view]').forEach(b=>b.onclick=()=>{snapshotTableScroll();state.tableView=b.dataset.tableView;render()});const w=$('#tableWrap');if(w)w.onscroll=()=>{state.tableScroll={top:w.scrollTop,left:w.scrollLeft}};bindSearchEditButtons();setTimeout(restoreTableScroll,0)}
function editRecord(id,source=state.screen){
  const r=state.records.find(x=>x.id===id);if(!r)return;
  if(source==='table')snapshotTableScroll();if(source==='search')state.searchScrollY=window.scrollY;
  const ids=source==='table'?filteredRecords().map(x=>x.id):source==='search'?state.records.filter(x=>recordMatchesPrefix(x,state.search)).map(x=>x.id):[id];
  state.editNav={source,ids};state.basicInfoExpanded=false;state.draft=JSON.parse(JSON.stringify(r));state.editId=id;state.mode='income';state.returnScreen=source;state.screen='form';render();scrollPageTop();autoSave()
}

function bindSettings(){const b=$('#backupDir');if(b)b.onclick=backupDirectory;const r=$('#restoreDir'),rf=$('#dirFile');if(r&&rf){r.onclick=()=>rf.click();rf.onchange=e=>restoreDirectory(e.target.files[0])}const rd=$('#reloadDirectory'),df=$('#directoryExcel');if(rd&&df){rd.onclick=()=>df.click();df.onchange=e=>reloadFixedDirectory(e.target.files[0])}const cw=$('#clearWorkspace');if(cw)cw.onclick=()=>{if(confirm('現在の入力データ・下書き・削除履歴を全て消去しますか？')){state.records=[];state.draft=null;state.deleted=[];state.sourceLoaded=false;state.baseName='本葬受付台帳';state.rules=defaultRules();state.cashControl=defaultCashControl();state.filters={district:'',kind:'',guide:'',columns:{}};autoSave();render();toast('作業データを消去しました')}}}
function bindDeleted(){$$('[data-restore]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.restore);const d=state.deleted[i];if(!d)return;if(state.records.some(r=>r.id===d.record.id)){toast('同じIDが存在するため復元できません');return}state.records.push(d.record);state.deleted.splice(i,1);autoSave();render();toast('復元しました')})}
function backupDirectory(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state.addedDirectory},null,2)],{type:'application/json'});downloadBlob(blob,'追加名簿_'+stamp()+'.json')}
function restoreDirectory(file){if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);state.addedDirectory={temples:Array.isArray(j.temples)?j.temples:[],people:Array.isArray(j.people)?j.people:[]};autoSave();render();toast('追加名簿を読み込みました')}catch(e){alert('JSONを読み込めませんでした')}};fr.readAsText(file)}
function reloadFixedDirectory(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回だけインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});const req=['宗務所','教区','寺籍番号','寺院名','フリガナ','住職','東堂','副住職','徒弟','御山内','寺族1','寺族2'];const miss=req.filter(h=>!(h in (rows[0]||{})));if(miss.length)throw new Error('不足列: '+miss.join('、'));state.fixedTemples=rows;dbSet('fixedTemplesOverride',rows);render();toast('第1宗務所名簿を更新しました')}catch(e){alert('名簿を読み込めませんでした。\n'+e.message)}};fr.readAsArrayBuffer(file)}

function rowFromRecord(r,no){syncGuidedExpenseColumns(r);const o={'No.':no,'レコードID':r.id,'親ID':r.parentId||'','受付区分':r.kind,'持参者ID':r.carrierId||'','宗務所':r.office||'第1宗務所','教区':r.district||'','寺籍番号':r.templeNo||'','寺号':r.temple||'','郵便番号':r.postalCode||'','住所（数字）':r.addressNumeric||'','住所（漢数字）':r.addressKanji||'','役職':r.role||'','氏名':r.name||'','配役':r.assignment||'','備考':r.note||''};INCOME.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['プラス小計']=sum(INCOME,r);EXPENSE.forEach(k=>o[k]=r.money[k]===null?'':r.money[k]);o['マイナス小計']=sum(EXPENSE,r);return o}
function recordFromRow(row){const money=blankMoney();INCOME.concat(EXPENSE).forEach(k=>{const v=row[k];money[k]=(v===undefined||v===null||v==='')?null:Number(v)});const id=String(row['レコードID']||'');const r={no:row['No.']||null,id,parentId:String(row['親ID']||''),kind:row['受付区分']||'本人',carrierId:String(row['持参者ID']||''),office:row['宗務所']||'第1宗務所',district:row['教区']||'',templeNo:String(row['寺籍番号']||''),temple:row['寺号']||'',postalCode:String(row['郵便番号']||''),addressNumeric:row['住所（数字）']||'',addressKanji:row['住所（漢数字）']||'',role:row['役職']||'',name:row['氏名']||'',assignment:row['配役']||'',note:row['備考']||'',money,ruleMeta:{}};syncGuidedExpenseColumns(r);return r}
function cashControlFromSheet(ws){try{const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});if(!rows.length)return null;const c=defaultCashControl();const totalRow=rows.find(r=>r[0]==='総初期資金');if(totalRow&&totalRow[1]!==''&&totalRow[1]!==null)c.totalInitial=Number(totalRow[1]);for(const row of rows){const name=String(row[0]||'');const m=/^([A-E])\s/.exec(name);if(m){const id=m[1],b=c.blocks[id];b.items=String(row[1]||'').split(/\s*\/\s*/).filter(x=>EXPENSE.includes(x));b.allocated=row[2]===''?null:Number(row[2]);b.actualRemaining=row[5]===''?null:Number(row[5]);if(row[7]){const d=new Date(row[7]);b.closed={at:Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(),allocated:row[2]===''?null:Number(row[2]),ledger:Number(row[3])||0,theoretical:row[4]===''?null:Number(row[4]),actual:row[5]===''?null:Number(row[5]),diff:row[8]===''?null:Number(row[8]),itemsKey:b.items.join('|')}}}if(INCOME.includes(name)){c.incomeActual[name]=row[2]===''?null:Number(row[2])}}state.cashControl=c;ensureCashControl();return c}catch(e){console.warn('残金シート読込失敗',e);return null}}
function importExcel(file){if(!file)return;if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)throw new Error('データがありません');const headers=Object.keys(rows[0]);const required=['レコードID','受付区分','氏名',...INCOME,...EXPENSE];const miss=required.filter(h=>!headers.includes(h));if(miss.length)throw new Error('必要列が見つかりません：'+miss.join('、'));const ids=new Set();const recs=rows.map(recordFromRow).filter(r=>r.id&&r.name);for(const r of recs){if(ids.has(r.id))throw new Error('レコードIDが重複しています：'+r.id);ids.add(r.id)}if(wb.Sheets['残金'])cashControlFromSheet(wb.Sheets['残金']);if(wb.Sheets['名前ルール設定'])nameRulesFromSettingsSheet(wb.Sheets['名前ルール設定']);state.records=recs;state.baseName=file.name.replace(/\.xlsx?$/i,'').replace(/_\d{4}_\d{4}$/,'');state.sourceLoaded=true;state.draft=null;state.editId=null;autoSave();render();toast('Excelを読み込みました')}catch(e){alert('このExcelは読み込めません。\n\n'+e.message+'\n\n列構造を確認してください。')}};fr.readAsArrayBuffer(file)}
function exportExcel(){if(typeof XLSX==='undefined'){alert('Excelライブラリを読み込めていません。初回起動時はインターネット接続が必要です。');return}const data=state.records.map((r,i)=>rowFromRecord(r,i+1));const subtotal={'氏名':'小計'};INCOME.forEach(k=>subtotal[k]=state.records.reduce((a,r)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0));subtotal['プラス小計']=INCOME.reduce((a,k)=>a+(subtotal[k]||0),0);EXPENSE.forEach(k=>subtotal[k]=state.records.reduce((a,r)=>a+(r.money[k]===null?0:Number(r.money[k])||0),0));subtotal['マイナス小計']=EXPENSE.reduce((a,k)=>a+(subtotal[k]||0),0);const ws=XLSX.utils.json_to_sheet([...data,subtotal],{header:APP_HEADERS});ws['!cols']=APP_HEADERS.map(h=>({wch:({'No.':6,'レコードID':11,'親ID':11,'受付区分':9,'持参者ID':11,'宗務所':11,'教区':9,'寺籍番号':9,'寺号':7,'郵便番号':11,'住所（数字）':26,'住所（漢数字）':30,'役職':9,'氏名':16,'配役':18,'備考':24,'プラス小計':13,'マイナス小計':13}[h]||([...INCOME,...EXPENSE].includes(h)?12:11))}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'受付台帳');const c=ensureCashControl();const cashRows=[['現金照合・残金'],['総初期資金',c.totalInitial??''],['配分合計',totalAllocated()],['未配分',unallocatedCash()??''],[],['支出ブロック','構成科目','用意資金','帳簿上支出','理論残金','実査残金','差額','締め日時','締め時差額']];for(const id of ['A','B','C','D','E']){const b=c.blocks[id],x=cashBlockCalc(id);cashRows.push([b.name,b.items.join(' / '),x.allocated??'',x.ledger,x.theoretical??'',x.actual??'',x.diff??'',b.closed?.at?new Date(b.closed.at).toLocaleString('ja-JP'):'',b.closed?.diff??''])}cashRows.push([],['収入科目','帳簿合計','実査現金','差額']);INCOME.forEach(item=>{const ledger=incomeLedger(item),actual=c.incomeActual[item],diff=actual===null||actual===''?'':(Number(actual)||0)-ledger;cashRows.push([item,ledger,actual??'',diff])});const wsCash=XLSX.utils.aoa_to_sheet(cashRows);wsCash['!cols']=[{wch:22},{wch:55},{wch:16},{wch:16},{wch:16},{wch:16},{wch:16},{wch:24},{wch:16}];XLSX.utils.book_append_sheet(wb,wsCash,'残金');const useHeaders=['No.','レコードID','受付区分','教区','寺号','郵便番号','住所（数字）','住所（漢数字）','役職','氏名','配役','表記1','表記2（氏名）','敬称1','敬称2','完成表記'];for(const use of NAME_USES){const wsUse=XLSX.utils.json_to_sheet(nameUseRows(use),{header:useHeaders});wsUse['!cols']=useHeaders.map(h=>({wch:({'No.':6,'レコードID':11,'受付区分':9,'教区':9,'寺号':12,'郵便番号':11,'住所（数字）':26,'住所（漢数字）':30,'役職':10,'氏名':16,'配役':18,'表記1':24,'表記2（氏名）':16,'敬称1':10,'敬称2':10,'完成表記':32}[h]||12)}));XLSX.utils.book_append_sheet(wb,wsUse,`名前_${use}`)}const wsNameSettings=XLSX.utils.aoa_to_sheet(nameRulesSettingsRows());wsNameSettings['!cols']=[{wch:12},{wch:10},{wch:10},{wch:24},{wch:16},{wch:10},{wch:26},{wch:16},{wch:16},{wch:14},{wch:16},{wch:18},{wch:12}];XLSX.utils.book_append_sheet(wb,wsNameSettings,'名前ルール設定');const filename=safeName(state.baseName)+'_'+stamp()+'.xlsx';XLSX.writeFile(wb,filename,{compression:true});toast('Excel保存を開始しました')}
function stamp(){const d=new Date();return String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')}
function safeName(s){return (s||'本葬受付台帳').replace(/[\\/:*?"<>|]/g,'_')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function init(){try{const w=await dbGet('workspace');if(w){state.records=Array.isArray(w.records)?w.records:[];state.records.forEach(r=>{ensureAddressFields(r);ensureRuleMeta(r);syncGuidedExpenseColumns(r)});state.draft=w.draft||null;if(state.draft){ensureAddressFields(state.draft);ensureRuleMeta(state.draft);syncGuidedExpenseColumns(state.draft)};state.baseName=w.baseName||state.baseName;state.sourceLoaded=!!w.sourceLoaded;state.deleted=Array.isArray(w.deleted)?w.deleted:[];state.search=w.search||'';state.filters={district:'',kind:'',guide:'',columns:{},...(w.filters||{})};state.filters.columns=state.filters.columns&&typeof state.filters.columns==='object'?state.filters.columns:{};state.tableView=w.tableView==='full'?'full':'normal';state.rules=w.rules||defaultRules();state.cashControl=w.cashControl||defaultCashControl();state.receiptSettings=w.receiptSettings||defaultReceiptSettings();state.receiptIssueMode=w.receiptIssueMode||'本葬';state.receiptTargetMode=w.receiptTargetMode||'一人';state.receiptSingleNo=Number(w.receiptSingleNo)||1;state.receiptNoRange=w.receiptNoRange||'';state.postcardSettings=w.postcardSettings||defaultPostcardSettings();state.postcardTargetMode=w.postcardTargetMode||'一人';state.postcardSingleNo=Number(w.postcardSingleNo)||1;state.postcardNoRange=w.postcardNoRange||'';ensureRules();ensureCashControl();ensureReceiptSettings();ensurePostcardSettings()}else{state.rules=defaultRules();state.cashControl=defaultCashControl();state.nameRules=defaultNameRules();state.receiptSettings=defaultReceiptSettings();state.postcardSettings=defaultPostcardSettings()}const a=await dbGet('addedDirectory');if(a)state.addedDirectory=a;const nr=await dbGet('nameRules');if(nr)state.nameRules=nr;ensureNameRules();ensureReceiptSettings();ensurePostcardSettings();const f=await dbGet('fixedTemplesOverride');if(Array.isArray(f)&&f.length)state.fixedTemples=f}catch(e){console.warn(e)}if('serviceWorker' in navigator && location.protocol.startsWith('http')){
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
ensureRules();ensureCashControl();ensureNameRules();render()}
init();
})();