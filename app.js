// 状態とエンジン
let dxfLines = [];
let stepIdCounter = 0;
let simSnapshots = [];
let simTrailerSnapshots = [];
let simPathPoints = [[], [], [], []];
let simTrailerPathPoints = [[], [], [], []];
let simDirMeta = []; 
let roads = []; 
let opMode = 'sim';
let isDragging = false;       
let isDraggingRoad = false;   
let isDraggingDim = false;    
let draggedRoadIndex = -1;
let hoveredTarget = null;     
let dragStartG = null;
let dragCurrentG = null;
let lastDragG = null;         
let viewScale = 1;
let viewCx = 0;
let viewCy = 0;
let resultHtml = 'ステップを設定して「描画更新」を押してください';
let currentMinR = 0;
let currentMinTR = 0;
let cgError = false;
let isDirty = false;

// テンキー
let activeInput = null;
let isDraggingNumpad = false;
let numpadDragStart = {x: 0, y: 0};
let numpadInitialPos = {x: 0, y: 0};

// 長押しコンテキストメニュー用
let touchStartX = 0, touchStartY = 0;
let longPressTimer = null;
let contextTarget = null;
const LONG_PRESS_DELAY = 500;

function toggleSilhouette(){
  const box = document.getElementById('silhouetteBox');
  const btn = document.getElementById('silToggleBtn');
  if (box.style.display === 'none'){
    box.style.display = '';
    btn.textContent = '形状プレビューを隠す';
  } else {
    box.style.display = 'none';
    btn.textContent = '形状プレビューを表示';
  }
}

// 通知制御
let toastTimer = null;
function showToast(msg, duration = 0) {
  const toast = document.getElementById('toast');
  toast.innerHTML = msg;
  toast.classList.add('show');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (duration > 0) {
    toastTimer = setTimeout(hideToast, duration);
  }
}
function hideToast() {
  document.getElementById('toast').classList.remove('show');
}
function setButtonsEnabled(enabled) {
  document.querySelectorAll('.btn-draw, .btn-dxf, .btn-img').forEach(btn => btn.disabled = !enabled);
}
function validateInputs() {
  if (opMode === 'road') {
    setButtonsEnabled(true);
    hideToast();
    return;
  }
  const R = Number(document.getElementById('R').value);
  const TR = Number(document.getElementById('TR').value);
  const WB = Number(document.getElementById('WB').value);
  const steerModeEl = document.getElementById('steerMode');
  const steerMode = steerModeEl ? steerModeEl.value : '2ws';
  const isTractor = currentSvgType === 'tractor';
  let twb = 0, troh = 0;
  if (isTractor) {
    twb = Number(document.getElementById('trailerWB').value);
    troh = Number(document.getElementById('trailerROH').value);
  }
  let errMsg = null;
  // 4WSは車体中心=WB/2基準
  const effWB = (steerMode === '4ws') ? WB / 2 : WB;
  const rcCheck = Math.sqrt(Math.max(0, R * R - effWB * effWB)) - TR / 2;

  if (cgError) errMsg = "重心エラー：車両寸法（L, WB, FOH）が破綻しています。修正してください。";
  else if (isTractor && twb < 1000) errMsg = "荷台設定エラー：TWB（軸中心までの距離）は1000mm以上に設定してください。";
  else if (isTractor && troh < 0) errMsg = "荷台設定エラー：TROH（後端オーバーハング）は0以上に設定してください。";
  else if (isTractor && troh > twb * 1.2) errMsg = "荷台設定エラー：TROHが長すぎます。重心が破綻し、転倒の危険があります。";
  else if (R <= effWB) errMsg = `旋回性能エラー：R(${R})がホイールベース基準値(${effWB.toFixed(0)}${steerMode === '4ws' ? '=WB/2' : '=WB'})以下です。寸法を見直してください。`;
  else if (rcCheck <= 0) errMsg = "旋回性能エラー：この寸法の組み合わせでは理論上その場旋回できません。R・WB・TRを見直してください。";
  else if (R < currentMinR) errMsg = `旋回性能エラー：最小回転半径(R)は ${currentMinR} 以上に設定してください。`;
  else if (TR < currentMinTR) errMsg = `旋回性能エラー：トレッド幅(TR)は ${currentMinTR} 以上に設定してください。`;

  if (errMsg) {
    setButtonsEnabled(false);
    showToast(errMsg);
  } else {
    setButtonsEnabled(true);
    hideToast(); 
  }
}
function markAsChanged() {
  if (opMode !== 'sim' || document.querySelector('.btn-draw').disabled) return;
  isDirty = true;
  document.getElementById('resultBox').innerHTML = '<span style="color:#ffcc00; font-weight:bold;">⚠ 値が変更されました。描画更新（軌跡再計算）ボタンを押してください。</span>';
}

// テンキー処理
function showNumpad(inputEl) {
  if (activeInput && activeInput !== inputEl) {
    if (activeInput.value.toString().endsWith('.')) activeInput.value = activeInput.value.toString().slice(0, -1);
  }
  activeInput = inputEl;
  document.getElementById('numpad').style.display = 'flex';
}
function hideNumpad() {
  document.getElementById('numpad').style.display = 'none';
  if (activeInput) {
    if (activeInput.value.toString().endsWith('.')) activeInput.value = activeInput.value.toString().slice(0, -1);
    activeInput = null;
  }
}
function inputNumpad(key) {
  if (!activeInput) return;
  let val = activeInput.value.toString();
  if (key === 'C') val = '';
  else if (key === 'BS') val = val.slice(0, -1);
  else val += key;
  activeInput.value = val;
  activeInput.dispatchEvent(new Event('input', { bubbles: true }));
}
function initNumpadDrag() {
  const header = document.getElementById('numpadHeader');
  const np = document.getElementById('numpad');
  header.addEventListener('pointerdown', (e) => {
    isDraggingNumpad = true;
    numpadInitialPos = { x: np.offsetLeft, y: np.offsetTop };
    numpadDragStart = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!isDraggingNumpad) return;
    np.style.left = (numpadInitialPos.x + e.clientX - numpadDragStart.x) + 'px';
    np.style.top = (numpadInitialPos.y + e.clientY - numpadDragStart.y) + 'px';
    np.style.bottom = 'auto'; 
    np.style.right = 'auto';
  });
  window.addEventListener('pointerup', () => isDraggingNumpad = false);
}

// コンテキストメニュー処理
function showContextMenu(x, y, target) {
  const menu = document.getElementById('contextMenu');
  contextTarget = target;
  const btnDim = document.getElementById('ctx-btn-dim');
  if (roads[target.index].dim) btnDim.style.display = 'block';
  else btnDim.style.display = 'none';
  
  menu.style.display = 'flex';
  const rect = menu.getBoundingClientRect();
  let posX = x, posY = y;
  if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 10;
  if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 10;
  menu.style.left = posX + 'px';
  menu.style.top = posY + 'px';
}
function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
  contextTarget = null;
}
function ctxActionDeleteDim() {
  if (contextTarget) {
    roads[contextTarget.index].dim = null;
    hoveredTarget = null;
    document.getElementById('canvas').style.cursor = 'crosshair';
    redraw();
  }
  hideContextMenu();
}
function ctxActionDeleteRoad() {
  if (contextTarget) {
    roads.splice(contextTarget.index, 1);
    hoveredTarget = null;
    document.getElementById('canvas').style.cursor = 'crosshair';
    updateViewBox();
    redraw();
  }
  hideContextMenu();
}

// モード切替
function onModeChange() {
  opMode = document.querySelector('input[name="opMode"]:checked').value;
  document.querySelectorAll('.sim-only').forEach(el => {
    if (el.id === 'trailerSectionWrap') return; 
    el.style.display = (opMode === 'sim') ? 'block' : 'none';
  });
  document.querySelectorAll('.road-only').forEach(el => el.style.display = (opMode === 'road') ? 'block' : 'none');
  document.getElementById('tab-sim').classList.toggle('active', opMode === 'sim');
  document.getElementById('tab-road').classList.toggle('active', opMode === 'road');
  
  const silBox = document.getElementById('silhouetteBox');
  const silBtn = document.getElementById('silToggleBtn');
  const canvas = document.getElementById('canvas');
  if (opMode === 'road') {
    silBox.style.display = 'none';
    silBtn.style.display = 'none';
    canvas.style.cursor = 'crosshair';
    hideContextMenu();
  } else {
    silBox.style.display = '';
    silBtn.style.display = '';
    silBtn.textContent = '形状プレビューを隠す';
    canvas.style.cursor = 'default';
    hoveredTarget = null;
    redraw();
  }
  const isTractor = currentSvgType === 'tractor';
  document.getElementById('trailerSectionWrap').style.display = (opMode === 'sim' && isTractor) ? 'block' : 'none';
  validateInputs();
}

// 車両データ関連処理
let currentSvgType = 'truck';
let cgRatio = 0.5;

function getExportFilename(ext) {
  const idx = Number(document.getElementById('vehiclePreset').value) || 0;
  const shortName = VEHICLE_PRESETS[idx].short || "Custom";
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}_${hh}${min}_${shortName}.${ext}`;
}

function onInputVehicle() {
  renderSilhouette();
  markAsChanged();
}
function initTrailerPresets(){
  const sel = document.getElementById('trailerPreset');
  TRAILER_PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  applyTrailerPreset();
}
function applyTrailerPreset(){
  const idx = Number(document.getElementById('trailerPreset').value) || 0;
  const p = TRAILER_PRESETS[idx];
  document.getElementById('hitchOffset').value = p.hitchOffset;
  document.getElementById('trailerW').value = p.TW;
  document.getElementById('trailerWB').value = p.TWB;
  document.getElementById('trailerROH').value = p.TROH;
  renderSilhouette();
  markAsChanged();
}
function initVehiclePresets(){
  const sel = document.getElementById('vehiclePreset');
  VEHICLE_PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  applyVehiclePreset();
}
function applyVehiclePreset(){
  const idx = Number(document.getElementById('vehiclePreset').value) || 0;
  const p = VEHICLE_PRESETS[idx];
  document.getElementById('L').value = p.L;
  document.getElementById('W').value = p.W;
  document.getElementById('WB').value = p.WB;
  document.getElementById('FOH').value = p.FOH;
  
  currentMinR = p.R;
  currentMinTR = p.TR;
  const steerModeGroup = document.getElementById('steerModeGroup');
  if (p.type === 'roughter') {
    steerModeGroup.style.display = 'flex';
    document.getElementById('R').value = (document.getElementById('steerMode').value === '4ws' && p.R4ws) ? p.R4ws : p.R;
  } else {
    steerModeGroup.style.display = 'none';
    document.getElementById('steerModeNote').style.display = 'none';
    document.getElementById('steerMode').value = '2ws';
    document.getElementById('R').value = p.R;
  }
  document.getElementById('TR').value = p.TR;
  currentSvgType = p.type || 'truck';
  let defL = p.L; let defWB = p.WB; let defFOH = p.FOH;
  let defROH = defL - defWB - defFOH;
  cgRatio = (defROH + defWB / 2) / defL; 

  const isTractor = currentSvgType === 'tractor';
  document.getElementById('trailerSectionWrap').style.display = (opMode === 'sim' && isTractor) ? 'block' : 'none';
  ['car', 'truck', 'dump', 'mixer', 'tractor', 'roughter'].forEach(type => {
    const el = document.getElementById('layer-' + type);
    if(el) {
       if(type === currentSvgType) el.classList.remove('hide');
       else el.classList.add('hide');
    }
  });
  document.querySelectorAll('.step-row .s-steer').forEach(sel => updateStepRowUI(sel));
  renderSilhouette();
  markAsChanged();
}
function onSteerModeChange(){
  const mode = document.getElementById('steerMode').value;
  document.getElementById('steerModeNote').style.display = (mode === '4ws') ? '' : 'none';
  const idx = Number(document.getElementById('vehiclePreset').value) || 0;
  const p = VEHICLE_PRESETS[idx];
  if (p && p.R4ws){
    document.getElementById('R').value = (mode === '4ws') ? p.R4ws : p.R;
    currentMinR = (mode === '4ws') ? p.R4ws : p.R;
  }
  validateInputs();
  markAsChanged();
}
function addStep(dir='forward', steer='right', value=90){
  stepIdCounter++;
  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.id = stepIdCounter;
  row.innerHTML = `
    <div style="display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; width: 100%;">
      <span class="step-num"></span>
      <select class="s-dir step-sel" onchange="updateStepRowUI(this)">
        <option value="forward" ${dir==='forward'?'selected':''}>前進</option>
        <option value="reverse" ${dir==='reverse'?'selected':''}>後退</option>
      </select>
      <select class="s-steer step-sel" onchange="updateStepRowUI(this)">
        <option value="right" ${steer==='right'?'selected':''}>右旋回</option>
        <option value="left" ${steer==='left'?'selected':''}>左旋回</option>
        <option value="straight" ${steer==='straight'?'selected':''}>直進</option>
      </select>
      <input type="number" class="s-val step-val" data-is-num="true" value="${value}">
      <span class="step-unit" style="flex-shrink:0; font-size:0.75rem;">度</span>
      <button class="btn-remove step-rm" onclick="removeStep(this)">×</button>
    </div>
    <div class="feedback-opt" style="display:none; width:100%; margin-top:4px; padding-top:4px; border-top:1px dashed #444;">
      <label class="step-fb-lbl">
        <input type="checkbox" class="cb-feedback" style="width:auto;" onchange="updateStepRowUI(this)" checked>
        🎯 フィードバック制御(連結角を上限以下に抑えて後退)
      </label>
      <div class="fb-detail step-fb-det">
        値の意味が「トラクタの旋回角度」→「<b>トレーラー(荷台)の目標回転角度</b>」に変わります。<br>
        目標連結角(安全マージン): <input type="number" class="s-psimax step-fb-inp" data-is-num="true" value="40">度
      </div>
    </div>
  `;
  document.getElementById('stepsList').appendChild(row);
  updateStepRowUI(row.querySelector('.s-steer'));
  renumberSteps();
  markAsChanged();
}
function updateStepRowUI(el){
  const row = el.closest('.step-row');
  const dir = row.querySelector('.s-dir').value;
  const steer = row.querySelector('.s-steer').value;
  const unitSpan = row.querySelector('.step-unit');
  const valInput = row.querySelector('.s-val');
  const fbOpt = row.querySelector('.feedback-opt');
  
  const wasStraight = unitSpan.textContent === 'm';
  if (steer === 'straight'){
    unitSpan.textContent = 'm';
    if (!wasStraight) valInput.value = 5;
  } else {
    unitSpan.textContent = '度';
    if (wasStraight) valInput.value = 90;
  }
  const isTractor = currentSvgType === 'tractor';
  fbOpt.style.display = (isTractor && dir === 'reverse' && steer !== 'straight') ? 'block' : 'none';
  row.querySelector('.fb-detail').style.display = row.querySelector('.cb-feedback').checked ? 'block' : 'none';
}
function removeStep(btn){
  const rows = document.querySelectorAll('.step-row');
  if (rows.length <= 1) { showToast("ステップは最低1つ必要です。"); return; }
  btn.closest('.step-row').remove();
  renumberSteps();
  markAsChanged();
}
function renumberSteps(){
  const rows = document.querySelectorAll('.step-row');
  rows.forEach((row, i) => { 
    row.querySelector('.step-num').textContent = (i+1) + '.'; 
    row.querySelector('.btn-remove').disabled = (rows.length === 1);
  });
}
function readSteps(){
  const steps = [];
  document.querySelectorAll('.step-row').forEach(row => {
    const fbOpt = row.querySelector('.feedback-opt');
    steps.push({
      dir: row.querySelector('.s-dir').value,
      steer: row.querySelector('.s-steer').value,
      value: Number(row.querySelector('.s-val').value) || 0,
      feedback: fbOpt.style.display !== 'none' && row.querySelector('.cb-feedback').checked,
      psiMax: Number(row.querySelector('.s-psimax').value) || 40
    });
  });
  return steps;
}
function updateSVGTextWithTooltip(id, label, value, tooltipMsg) {
  const el = document.getElementById(id);
  if(el) {
    el.textContent = `${label}=${Math.round(value)}`;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = tooltipMsg;
    el.appendChild(t);
  }
}
function setGeom(id, attrs) {
  const el = document.getElementById(id);
  if(el) for(let k in attrs) {
     if(k === 'class') {
       el.className.baseVal = attrs[k];
     } else {
       el.setAttribute(k, attrs[k]);
     }
  }
}
function renderSilhouette(){
  let L = parseFloat(document.getElementById('L').value) || 1;
  let WB = parseFloat(document.getElementById('WB').value) || 0;
  let FOH = parseFloat(document.getElementById('FOH').value) || 0;
  if (WB + FOH > L) { WB = L - FOH; if (WB < 0) { WB = 0; FOH = L; } }
  let ROH = L - WB - FOH;

  let drawL = L;
  const isTractor = currentSvgType === 'tractor';
  let tWB = 0, tROH = 0, hOffset = 0;
  if (isTractor) {
    hOffset = parseFloat(document.getElementById('hitchOffset').value) || 0;
    tWB = parseFloat(document.getElementById('trailerWB').value) || 1;
    tROH = parseFloat(document.getElementById('trailerROH').value) || 0;
    const trailerLenBack = -hOffset + tWB + tROH;
    if (trailerLenBack > ROH) drawL = L + (trailerLenBack - ROH);
  }
  const CG_pos = L * cgRatio; 
  const alertBox = document.getElementById('sil-alert-msg');
  const wrapper = document.getElementById('truck-wrapper');
  if(!wrapper) return;
  wrapper.className.baseVal = "truck-group"; 

  if (CG_pos < ROH) {
    alertBox.innerHTML = "⚠ 危険！重心が後輪を越えました。<br>尻餅をついて転倒します！";
    alertBox.classList.add('show');
    wrapper.classList.add('tilt-rear');
    cgError = true;
  } else if (CG_pos > ROH + WB) {
    alertBox.innerHTML = "⚠ 危険！重心が前輪を越えました。<br>前のめりに転倒します！";
    alertBox.classList.add('show');
    wrapper.classList.add('tilt-front');
    cgError = true;
  } else {
    alertBox.classList.remove('show');
    wrapper.classList.remove('tilt-rear', 'tilt-front');
    cgError = false;
  }
  validateInputs();

  const DRAW_W = 600;
  const scale = DRAW_W / drawL;
  const frontX = 100 + DRAW_W;
  const tireFX = frontX - (FOH * scale);
  const tireRX = tireFX - (WB * scale);
  const rearX = tireRX - (ROH * scale); 

  setGeom('trac-trailer-bed', { class: 'c-purple hide' });
  setGeom('trac-trailer-tire1', { class: 'tire hide' });
  setGeom('trac-trailer-tire2', { class: 'tire hide' });
  document.getElementById('trailer-dims').classList.add('hide');
  
  setGeom('line-rear', { x1: rearX, x2: rearX });
  setGeom('line-front', { x1: frontX, x2: frontX });
  setGeom('dim-l-line', { x1: rearX, x2: frontX, y1: 80, y2: 80 });
  setGeom('dim-l-txt', { x: (rearX + frontX) / 2, y: 70 });
  updateSVGTextWithTooltip('dim-l-txt', 'L', L, '全長 (L)');
  setGeom('dim-wb-line', { x1: tireRX, x2: tireFX, y1: 280, y2: 280 });
  setGeom('dim-wb-txt', { x: (tireRX + tireFX) / 2, y: 275 });
  updateSVGTextWithTooltip('dim-wb-txt', 'WB', WB, 'ホイールベース (WB)');
  setGeom('dim-foh-line', { x1: tireFX, x2: frontX, y1: 310, y2: 310 });
  setGeom('dim-foh-txt', { x: (tireFX + frontX) / 2, y: 305 });
  updateSVGTextWithTooltip('dim-foh-txt', 'FOH', FOH, 'フロントオーバーハング (FOH)');
  setGeom('dim-roh-line', { x1: rearX, x2: tireRX, y1: 310, y2: 310 });
  setGeom('dim-roh-txt', { x: (rearX + tireRX) / 2, y: 305 });
  updateSVGTextWithTooltip('dim-roh-txt', 'ROH', ROH, '後端オーバーハング (ROH)');

  const cgX = rearX + (CG_pos * scale);
  setGeom('cg-mark', { cx: cgX, cy: 170 });
  setGeom('cg-cross1', { d: `M ${cgX-8},170 L ${cgX+8},170` });
  setGeom('cg-cross2', { d: `M ${cgX},162 L ${cgX},178` });
  wrapper.style.transformOrigin = (CG_pos < ROH) ? `${tireRX}px 235px` : `${tireFX}px 235px`;

  const cabBaseX = Math.max(tireRX + (300*scale), frontX - (1800*scale)); 
  const isTandem = L > 6500; 
  const tOffset = isTandem ? 25 : 0;

  switch(currentSvgType) {
    case 'car':
      setGeom('car-body', { d: `M ${rearX},210 L ${rearX},120 L ${rearX+400*scale},80 L ${frontX-1200*scale},80 L ${frontX-300*scale},130 L ${frontX},140 L ${frontX},210 Z` });
      setGeom('car-tire-r', { cx: tireRX, cy: 235, r: 25 });
      setGeom('car-tire-f', { cx: tireFX, cy: 235, r: 25 });
      break;
    case 'truck':
      setGeom('truck-bed', { x: rearX, y: 100, width: cabBaseX - rearX, height: 110 });
      setGeom('truck-cab', { d: `M ${cabBaseX},210 L ${cabBaseX},80 L ${frontX-400*scale},80 L ${frontX-100*scale},120 L ${frontX},120 L ${frontX},210 Z` });
      setGeom('truck-tire-r1', { cx: tireRX - tOffset, cy: 235, r: 25 });
      setGeom('truck-tire-r2', { cx: tireRX + tOffset, cy: 235, r: 25 });
      if(!isTandem) setGeom('truck-tire-r2', { cx: tireRX, cy: 235, r: 25 }); 
      setGeom('truck-tire-f', { cx: tireFX, cy: 235, r: 25 });
      break;
    case 'dump':
      setGeom('dump-bed', { x: rearX, y: 140, width: cabBaseX - rearX, height: 70 });
      setGeom('dump-lines', { d: `M ${rearX+(cabBaseX-rearX)*0.33},140 L ${rearX+(cabBaseX-rearX)*0.33},210 M ${rearX+(cabBaseX-rearX)*0.66},140 L ${rearX+(cabBaseX-rearX)*0.66},210` });
      setGeom('dump-cab', { d: `M ${cabBaseX},210 L ${cabBaseX},80 L ${frontX-400*scale},80 L ${frontX-100*scale},120 L ${frontX},120 L ${frontX},210 Z` });
      setGeom('dump-tire-r1', { cx: tireRX - tOffset, cy: 235, r: 25 });
      setGeom('dump-tire-r2', { cx: tireRX + tOffset, cy: 235, r: 25 });
      if(!isTandem) setGeom('dump-tire-r2', { cx: tireRX, cy: 235, r: 25 });
      setGeom('dump-tire-f', { cx: tireFX, cy: 235, r: 25 });
      break;
    case 'mixer':
      setGeom('mix-subframe', { x: rearX, y: 190, width: cabBaseX - rearX, height: 20 });
      const mx = (t) => rearX + (cabBaseX - rearX) * t;
      setGeom('mix-hop', { points: `${mx(0)},60 ${mx(0.15)},60 ${mx(0.1)},100 ${mx(0)},90` });
      setGeom('mix-drum', { d: `M ${mx(0.1)},120 Q ${mx(0.1)},160 ${mx(0.25)},160 L ${mx(0.9)},165 Q ${mx(1.0)},165 ${mx(1.0)},130 L ${mx(0.95)},90 Q ${mx(0.9)},70 ${mx(0.8)},70 L ${mx(0.3)},60 Q ${mx(0.1)},55 ${mx(0.1)},100 Z` });
      setGeom('mix-shoot', { points: `${mx(0)-10},100 ${mx(0)+20},100 ${mx(0)+10},150 ${mx(0)-40},170 ${mx(0)-40},150` });
      setGeom('mix-tank', { x: mx(0.92), width: mx(1.0)-mx(0.92), y: 130, height: 50, rx: 5 });
      setGeom('mix-cab', { d: `M ${cabBaseX},210 L ${cabBaseX},80 L ${frontX-400*scale},80 L ${frontX-100*scale},120 L ${frontX},120 L ${frontX},210 Z` });
      setGeom('mix-tire-r1', { cx: tireRX - tOffset, cy: 235, r: 25 });
      setGeom('mix-tire-r2', { cx: tireRX + tOffset, cy: 235, r: 25 });
      if(!isTandem) setGeom('mix-tire-r2', { cx: tireRX, cy: 235, r: 25 });
      setGeom('mix-tire-f', { cx: tireFX, cy: 235, r: 25 });
      break;
    case 'tractor':
      setGeom('trac-frame', { x: rearX, y: 190, width: cabBaseX - rearX, height: 20 });
      setGeom('trac-coupler', { cx: tireRX + (hOffset*scale), cy: 185 });
      setGeom('trac-cab', { d: `M ${cabBaseX},210 L ${cabBaseX},80 L ${frontX-400*scale},80 L ${frontX-100*scale},120 L ${frontX},120 L ${frontX},210 Z` });
      setGeom('trac-tire-r', { cx: tireRX, cy: 235, r: 25 });
      setGeom('trac-tire-f', { cx: tireFX, cy: 235, r: 25 });
      if (isTractor) {
        const hitchX = tireRX + (hOffset * scale);
        const tAxleX = hitchX - (tWB * scale);
        const tRearX = tAxleX - (tROH * scale);
        setGeom('trac-trailer-bed', { x: tRearX, y: 70, width: hitchX - tRearX + 20, height: 110, class: 'c-purple' });
        setGeom('trac-trailer-tire1', { cx: tAxleX - 20, cy: 235, r: 25, class: 'tire' });
        setGeom('trac-trailer-tire2', { cx: tAxleX + 20, cy: 235, r: 25, class: 'tire' });
        document.getElementById('trailer-dims').classList.remove('hide');
        setGeom('dim-twb-line', { x1: tAxleX, y1: 340, x2: hitchX, y2: 340 });
        setGeom('dim-twb-txt', { x: (tAxleX + hitchX) / 2, y: 335 });
        updateSVGTextWithTooltip('dim-twb-txt', 'TWB', tWB, '連結点〜トレーラー軸中心 (TWB)');
        setGeom('dim-troh-line', { x1: tRearX, y1: 370, x2: tAxleX, y2: 370 });
        setGeom('dim-troh-txt', { x: (tRearX + tAxleX) / 2, y: 365 });
        updateSVGTextWithTooltip('dim-troh-txt', 'TROH', tROH, 'トレーラー後端オーバーハング (TROH)');
      }
      break;
    case 'roughter':
      const cFX = tireFX + Math.min(FOH * scale, 2000 * scale);
      setGeom('rg-body', { d: `M ${rearX},210 L ${rearX},150 L ${rearX+400*scale},130 L ${cFX-500*scale},130 L ${cFX},160 L ${cFX},210 Z` });
      setGeom('rg-cab', { d: `M ${tireFX},130 L ${tireFX},60 L ${cFX-200*scale},60 L ${cFX-200*scale},130 Z` });
      setGeom('rg-boom', { points: `${rearX+200*scale},140 ${frontX},90 ${frontX},50 ${rearX+200*scale},90` });
      setGeom('rg-tire-r', { cx: tireRX, cy: 225, r: 35 });
      setGeom('rg-tire-f', { cx: tireFX, cy: 225, r: 35 });
      wrapper.style.transformOrigin = (CG_pos < ROH) ? `${tireRX}px 225px` : `${tireFX}px 225px`;
      break;
  }
}

// 描画・変換
function getVehicleParams(){
  const L = Number(document.getElementById('L').value);
  const W = Number(document.getElementById('W').value);
  const WB = Number(document.getElementById('WB').value);
  const FOH = Number(document.getElementById('FOH').value);
  const ROH = L - WB - FOH;
  const R = Number(document.getElementById('R').value);
  const TR = Number(document.getElementById('TR').value);
  return {L, W, WB, FOH, ROH, R, TR};
}
function getBaseCorners(WB, FOH, ROH, W){
  return [
    {x: -W/2, y: WB + FOH}, {x: W/2, y: WB + FOH},
    {x: W/2, y: -ROH}, {x: -W/2, y: -ROH}
  ];
}
function normAngle(a){
  while (a > Math.PI) a -= 2*Math.PI;
  while (a < -Math.PI) a += 2*Math.PI;
  return a;
}
function rotateLocal(px, py, Cx, Cy, a){
  const dx = px - Cx, dy = py - Cy;
  return { x: Cx + dx * Math.cos(a) - dy * Math.sin(a), y: Cy + dx * Math.sin(a) + dy * Math.cos(a) };
}
function toGlobal(lx, ly, pose){
  return { x: pose.x + lx * Math.cos(pose.phi) - ly * Math.sin(pose.phi), y: pose.y + lx * Math.sin(pose.phi) + ly * Math.cos(pose.phi) };
}
function cornersToGlobal(localCorners, pose){
  return localCorners.map(c => toGlobal(c.x, c.y, pose));
}

function draw(){
  simDirMeta = []; 
  const {WB, FOH, ROH, W, L, R, TR} = getVehicleParams();
  const steerMode = document.getElementById('steerMode').value;
  const Rc = (steerMode === '4ws') ? Math.sqrt(R*R - (WB/2)*(WB/2)) - TR/2 : Math.sqrt(R*R - WB*WB) - TR/2;
  
  if (isNaN(Rc) || Rc <= 0) {
    resultHtml = '<span class="warn">⚠ 旋回半径(Rc)の計算でエラーが発生しました。車両寸法や旋回設定を見直してください。</span>';
    document.getElementById('resultBox').innerHTML = resultHtml;
    return;
  }
  
  const kappaMax = 1 / Rc;
  const steps = readSteps();
  
  if (steps.length === 0){
    resultHtml = '<span class="warn">⚠ ステップが1つもありません。「＋ステップ追加」してください。</span>';
    document.getElementById('resultBox').innerHTML = resultHtml;
    return;
  }
  const baseCorners = getBaseCorners(WB, FOH, ROH, W);
  const stepDeg = Math.abs(Number(document.getElementById('step').value)) || 10;
  const renderIntervalDist = Math.max(1000, L / 2);
  const isTractor = currentSvgType === 'tractor';
  
  let hitchOffset = 0, trailerW = 0, trailerWB = 1, trailerROH = 0, trailerCorners = [];
  if (isTractor){
    hitchOffset = Number(document.getElementById('hitchOffset').value) || 0;
    trailerW = Number(document.getElementById('trailerW').value) || 0;
    trailerWB = Number(document.getElementById('trailerWB').value) || 1;
    trailerROH = Number(document.getElementById('trailerROH').value) || 0;
    trailerCorners = [
      {x: -trailerW/2, y: trailerWB}, {x: trailerW/2, y: trailerWB},
      {x: trailerW/2, y: -trailerROH}, {x: -trailerW/2, y: -trailerROH}
    ];
  }

  let pose = {x: 0, y: 0, phi: 0};
  let beta = 0;
  let maxHitchAngleDeg = 0;
  let usedFeedback = false;
  let feedbackConverged = true;

  function trailerPoseFromBeta(hitchPt, betaVal){
    return { x: hitchPt.x + trailerWB*Math.sin(betaVal), y: hitchPt.y - trailerWB*Math.cos(betaVal), phi: betaVal };
  }
  function advanceTrailer(prevPose, newPose){
    if (!isTractor) return;
    const prevHitch = toGlobal(0, hitchOffset, prevPose);
    const newHitch = toGlobal(0, hitchOffset, newPose);
    const dx = newHitch.x - prevHitch.x, dy = newHitch.y - prevHitch.y;
    if (Math.hypot(dx, dy) > 1e-9){
      const d1 = -(dx * Math.cos(beta) + dy * Math.sin(beta)) / trailerWB;
      const betaMid = beta + d1 * 0.5;
      const d2 = -(dx * Math.cos(betaMid) + dy * Math.sin(betaMid)) / trailerWB;
      beta = normAngle(beta + d2);
    }
    const hitchAngleDeg = Math.abs(normAngle(newPose.phi - beta)) * 180 / Math.PI;
    if (hitchAngleDeg > maxHitchAngleDeg) maxHitchAngleDeg = hitchAngleDeg;
  }
  function trailerSnapshotAt(p){
    return cornersToGlobal(trailerCorners, trailerPoseFromBeta(toGlobal(0, hitchOffset, p), beta));
  }
  function getPsi(){
    return normAngle(pose.phi - beta);
  }
  function moveByCurvature(dsSigned, kappa){
    if (Math.abs(dsSigned) < 1e-9) return;
    if (Math.abs(kappa) < 1e-12){
      const localEnd = {x: 0, y: dsSigned};
      const prevPose = pose;
      const subPose = {
        x: pose.x + localEnd.x*Math.cos(pose.phi) - localEnd.y*Math.sin(pose.phi),
        y: pose.y + localEnd.x*Math.sin(pose.phi) + localEnd.y*Math.cos(pose.phi),
        phi: pose.phi
      };
      advanceTrailer(prevPose, subPose);
      pose = subPose;
      return;
    }
    const dPhi = kappa * dsSigned;
    const cxLocal = -1 / kappa;
    const cyLocal = (steerMode === '4ws') ? WB / 2 : 0;
    const subOrigin = rotateLocal(0, 0, cxLocal, cyLocal, dPhi);
    const prevPose = pose;
    const subPose = {
      x: pose.x + subOrigin.x*Math.cos(pose.phi) - subOrigin.y*Math.sin(pose.phi),
      y: pose.y + subOrigin.x*Math.sin(pose.phi) + subOrigin.y*Math.cos(pose.phi),
      phi: normAngle(pose.phi + dPhi)
    };
    advanceTrailer(prevPose, subPose);
    pose = subPose;
  }

  simPathPoints = [[], [], [], []];
  simTrailerPathPoints = [[], [], [], []];
  
  function recordPath(){
    const tCorners = cornersToGlobal(baseCorners, pose);
    for(let i=0; i<4; i++) simPathPoints[i].push(tCorners[i]);
    if(isTractor){
      const trCorners = trailerSnapshotAt(pose);
      for(let i=0; i<4; i++) simTrailerPathPoints[i].push(trCorners[i]);
    }
  }

  simSnapshots = [cornersToGlobal(baseCorners, pose)];
  simTrailerSnapshots = isTractor ? [trailerSnapshotAt(pose)] : [];
  simDirMeta.push({ isReverse: false }); 
  recordPath();

  steps.forEach(step => {
    const dirSign = step.dir === 'forward' ? 1 : -1;
    const isRev = (dirSign === -1);

    if (step.feedback && isTractor && step.steer !== 'straight' && step.dir === 'reverse'){
      usedFeedback = true;
      const steerSign = step.steer === 'right' ? 1 : -1;
      const targetBetaChange = Math.abs(step.value) * Math.PI / 180;
      if (targetBetaChange < 1e-10) return;

      let totalTargetDelta = (-steerSign) * targetBetaChange;
      let accumulatedBeta = 0;
      let prevBeta = beta;

      const psiLimit = Math.max(1, Math.min(55, Math.abs(step.psiMax || 40))) * Math.PI / 180;
      const K = 2.0 / trailerWB; 
      const dsStep = 20; 
      const maxTravel = Math.max(300000, targetBetaChange * trailerWB * 8);
      
      let travelled = 0, sinceRender = 0, localConverged = false;
      while (travelled < maxTravel){
        let stepDeltaBeta = normAngle(beta - prevBeta);
        accumulatedBeta += stepDeltaBeta;
        prevBeta = beta;
        let diffBeta = totalTargetDelta - accumulatedBeta;
        let psi = getPsi();
        
        if (Math.abs(diffBeta) < 1.0 * Math.PI / 180 && Math.abs(psi) < 3.0 * Math.PI / 180) {
          localConverged = true;
          break;
        }
        let desiredPsi = diffBeta * 2.0 * dirSign; 
        desiredPsi = Math.max(-psiLimit, Math.min(psiLimit, desiredPsi));
        
        const h_eff = (steerMode === '4ws') ? hitchOffset - WB / 2 : hitchOffset;
        const hitchFactor = 1 + (h_eff * Math.cos(psi)) / trailerWB;
        const safeFactor = Math.abs(hitchFactor) < 0.1 ? (hitchFactor >= 0 ? 0.1 : -0.1) : hitchFactor;
        let kappa = (Math.sin(psi) / trailerWB + dirSign * K * (desiredPsi - psi)) / safeFactor;
        
        kappa = Math.max(-kappaMax, Math.min(kappaMax, kappa));
        
        moveByCurvature(dirSign * dsStep, kappa);
        recordPath();
        
        if (Math.abs(getPsi()) > maxHitchAngleDeg * Math.PI / 180) maxHitchAngleDeg = Math.abs(getPsi()) * 180 / Math.PI;
        
        travelled += dsStep;
        sinceRender += dsStep;
        if (sinceRender >= renderIntervalDist){
          simSnapshots.push(cornersToGlobal(baseCorners, pose));
          simTrailerSnapshots.push(trailerSnapshotAt(pose));
          simDirMeta.push({ isReverse: isRev });
          sinceRender = 0;
        }
      }
      if (!localConverged) feedbackConverged = false;
      simSnapshots.push(cornersToGlobal(baseCorners, pose));
      simTrailerSnapshots.push(trailerSnapshotAt(pose));
      simDirMeta.push({ isReverse: isRev });

    } else if (step.steer === 'straight'){
      const dist = Math.abs(step.value) * 1000;
      if (dist < 1e-9) return;
      const nSub = Math.max(1, Math.ceil(dist / 50));
      const dsSigned = dirSign * (dist / nSub);
      let sinceRender = 0;
      for (let i = 0; i < nSub; i++){
        moveByCurvature(dsSigned, 0);
        recordPath();
        sinceRender += Math.abs(dsSigned);
        if (sinceRender >= renderIntervalDist || i === nSub - 1){
          simSnapshots.push(cornersToGlobal(baseCorners, pose));
          if (isTractor) simTrailerSnapshots.push(trailerSnapshotAt(pose));
          simDirMeta.push({ isReverse: isRev });
          sinceRender = 0;
        }
      }
    } else {
      const steerSign = step.steer === 'right' ? 1 : -1;
      const angleDeg = Math.abs(step.value);
      if (angleDeg < 1e-9) return;
      const nSub = Math.max(1, Math.ceil(angleDeg / 1));
      const dPhi = -steerSign * dirSign * (angleDeg / nSub * Math.PI / 180);
      const dsSigned = dPhi / (-steerSign / Rc);
      let sinceRenderDeg = 0;
      for (let i = 0; i < nSub; i++){
        moveByCurvature(dsSigned, -steerSign / Rc);
        recordPath();
        sinceRenderDeg += angleDeg / nSub;
        if (sinceRenderDeg >= stepDeg || i === nSub - 1){
          simSnapshots.push(cornersToGlobal(baseCorners, pose));
          if (isTractor) simTrailerSnapshots.push(trailerSnapshotAt(pose));
          simDirMeta.push({ isReverse: isRev });
          sinceRenderDeg = 0;
        }
      }
    }
  });

  let trailerInfo = '';
  if (isTractor){
    if (maxHitchAngleDeg > 55) trailerInfo += `<div class="warn">⚠ 連結角が最大${maxHitchAngleDeg.toFixed(1)}°に達しました。ジャックナイフの危険があります。</div>`;
    if (usedFeedback && !feedbackConverged) trailerInfo += `<div class="warn">⚠ フィードバック制御が目標回転角に収束しませんでした。</div>`;
    trailerInfo += `<div><b>トレーラー最終向き</b>: ${(normAngle(beta) * 180 / Math.PI).toFixed(1)}°</div>` +
                   `<div><b>最大連結角</b>: ${maxHitchAngleDeg.toFixed(1)}°</div>`;
    if (usedFeedback) trailerInfo += `<div><b>フィードバック制御</b>: ${feedbackConverged ? '収束' : '未収束'}</div>`;
  }
  resultHtml = `<div><b>最終位置</b>: X=${pose.x.toFixed(0)}mm, Y=${pose.y.toFixed(0)}mm</div>` +
               `<div><b>最終向き</b>: ${(normAngle(pose.phi) * 180 / Math.PI).toFixed(1)}°</div>` +
               trailerInfo + `<div><b>ステップ数</b>: ${steps.length}</div>`;
  isDirty = false;
  updateViewBox();
  redraw();
  
  if (isTractor && usedFeedback) {
    showToast("⚠ 注意：このトレーラーの軌跡は「運転が上手すぎる（理論上の最短経路）」状態です。<br>実際の運転ではより広いスペースを確保してください。", 6000);
  }
}

function updateViewBox() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  [...simPathPoints, ...simTrailerPathPoints].forEach(pathArr => pathArr.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }));
  [...simSnapshots, ...simTrailerSnapshots].forEach(box => box.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }));
  roads.forEach(r => {
    const hw = r.width / 2;
    if (r.x1 - hw < minX) minX = r.x1 - hw; if (r.x1 + hw > maxX) maxX = r.x1 + hw;
    if (r.x2 - hw < minX) minX = r.x2 - hw; if (r.x2 + hw > maxX) maxX = r.x2 + hw;
    if (r.y1 - hw < minY) minY = r.y1 - hw; if (r.y1 + hw > maxY) maxY = r.y1 + hw;
    if (r.y2 - hw < minY) minY = r.y2 - hw; if (r.y2 + hw > maxY) maxY = r.y2 + hw;
  });
  if (minX === Infinity) { minX = -5000; maxX = 5000; minY = -5000; maxY = 5000; }

  const canvas = document.getElementById('canvas');
  const spanX = Math.max(maxX - minX, 500), spanY = Math.max(maxY - minY, 500);
  viewScale = Math.min(canvas.width * 0.76 / spanX, canvas.height * 0.76 / spanY);
  viewCx = (minX + maxX) / 2; viewCy = (minY + maxY) / 2;
}
function getGlobalCoords(e) {
  const canvas = document.getElementById('canvas');
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: (sx - canvas.width/2) / viewScale + viewCx,
    y: (canvas.height/2 - sy) / viewScale + viewCy
  };
}
function distToSegment(p, v, w) {
  const l2 = (w.x - v.x)**2 + (w.y - v.y)**2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = Math.max(0, Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}
function getHitTarget(clickG) {
  let hitDimIdx = -1, hitRoadIdx = -1, minDimDist = Infinity, minRoadDist = Infinity;
  for(let i=0; i<roads.length; i++){
    const r = roads[i];
    if(r.dim) {
      const dx = r.x2 - r.x1, dy = r.y2 - r.y1, len = Math.hypot(dx, dy);
      if(len > 0){
        const nx = -dy/len, ny = dx/len, hw = r.width/2;
        const cx = r.x1 + dx * r.dim.t, cy = r.y1 + dy * r.dim.t;
        const d = distToSegment(clickG, {x: cx + nx*hw, y: cy + ny*hw}, {x: cx - nx*hw, y: cy - ny*hw});
        if(d < Math.max(1000, 15 / viewScale) && d < minDimDist) { minDimDist = d; hitDimIdx = i; }
      }
    }
    const dRoad = distToSegment(clickG, {x: r.x1, y: r.y1}, {x: r.x2, y: r.y2});
    if(dRoad < Math.max(r.width/2, 1000) && dRoad < minRoadDist) { minRoadDist = dRoad; hitRoadIdx = i; }
  }
  if (hitDimIdx !== -1) return { type: 'dim', index: hitDimIdx };
  if (hitRoadIdx !== -1) return { type: 'road', index: hitRoadIdx };
  return null;
}
function drawRoad(r, ctx, isPreview = false, roadHovered = false, dimHovered = false) {
  const dx = r.x2 - r.x1, dy = r.y2 - r.y1, len = Math.hypot(dx, dy);
  if (len === 0) return;
  const nx = -dy / len, ny = dx / len, hw = r.width / 2;
  const p1x = r.x1 + nx * hw, p1y = r.y1 + ny * hw;
  const p2x = r.x2 + nx * hw, p2y = r.y2 + ny * hw;
  const p3x = r.x1 - nx * hw, p3y = r.y1 - ny * hw;
  const p4x = r.x2 - nx * hw, p4y = r.y2 - ny * hw;
  
  // 塗りつぶし
  ctx.beginPath();
  ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p4x, p4y); ctx.lineTo(p3x, p3y); ctx.closePath();
  ctx.fillStyle = isPreview ? 'rgba(0, 255, 255, 0.2)' : roadHovered ? 'rgba(255, 170, 0, 0.25)' : 'rgba(255, 255, 255, 0.2)';
  ctx.fill();

  // 境界線
  ctx.beginPath();
  ctx.lineWidth = Math.max(150, 3 / viewScale); 
  ctx.strokeStyle = isPreview ? 'rgba(0, 255, 255, 0.8)' : roadHovered ? '#ffaa00' : '#ffffff';
  if (isPreview) ctx.setLineDash([400, 400]);
  ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y);
  ctx.moveTo(p3x, p3y); ctx.lineTo(p4x, p4y);
  ctx.stroke();
  ctx.setLineDash([]);
  
  if (!isPreview) {
    dxfLines.push({type: 'LINE', x1: p1x, y1: p1y, x2: p2x, y2: p2y, layer: 'Road', color: 7});
    dxfLines.push({type: 'LINE', x1: p3x, y1: p3y, x2: p4x, y2: p4y, layer: 'Road', color: 7});
  }

  if (r.dim && !isPreview) {
    const cx = r.x1 + dx * r.dim.t, cy = r.y1 + dy * r.dim.t;
    const dimA = {x: cx + nx*hw, y: cy + ny*hw}, dimB = {x: cx - nx*hw, y: cy - ny*hw};
    const textStr = (r.width/1000).toFixed(1) + "m";
    ctx.font = 'bold 16px sans-serif';
    const gap_global = (ctx.measureText(textStr).width + 10) / viewScale; 
    
    let dimAngle = Math.atan2(ny, nx);
    if (dimAngle > Math.PI/2 || dimAngle <= -Math.PI/2) dimAngle += Math.PI; 
    
    ctx.beginPath();
    ctx.lineWidth = Math.max(80, 2 / viewScale);
    ctx.strokeStyle = ctx.fillStyle = dimHovered ? '#ffffcc' : '#ffcc00';
    if (r.width > gap_global) {
      ctx.moveTo(dimA.x, dimA.y); ctx.lineTo(cx + nx * gap_global/2, cy + ny * gap_global/2);
      ctx.moveTo(dimB.x, dimB.y); ctx.lineTo(cx - nx * gap_global/2, cy - ny * gap_global/2);
    } else {
      ctx.moveTo(dimA.x, dimA.y); ctx.lineTo(dimB.x, dimB.y);
    }
    ctx.stroke();
    
    const asize = Math.min(600, r.width/4);
    ctx.beginPath();
    ctx.moveTo(dimA.x, dimA.y);
    ctx.lineTo(dimA.x - nx*asize + ny*asize*0.4, dimA.y - ny*asize - nx*asize*0.4);
    ctx.lineTo(dimA.x - nx*asize - ny*asize*0.4, dimA.y - ny*asize + nx*asize*0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(dimB.x, dimB.y);
    ctx.lineTo(dimB.x + nx*asize + ny*asize*0.4, dimB.y + ny*asize - nx*asize*0.4);
    ctx.lineTo(dimB.x + nx*asize - ny*asize*0.4, dimB.y + ny*asize + nx*asize*0.4);
    ctx.fill();
    
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(dimAngle); ctx.scale(1/viewScale, -1/viewScale);
    ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(textStr, 0, 2); 
    ctx.restore();
    
    if (!isPreview) {
      const textH = 400, gap_dxf = textStr.length * textH * 0.7 + 200;
      if (r.width > gap_dxf) {
        dxfLines.push({type: 'LINE', x1: dimA.x, y1: dimA.y, x2: cx + nx * gap_dxf/2, y2: cy + ny * gap_dxf/2, layer: 'RoadDim', color: 2});
        dxfLines.push({type: 'LINE', x1: dimB.x, y1: dimB.y, x2: cx - nx * gap_dxf/2, y2: cy - ny * gap_dxf/2, layer: 'RoadDim', color: 2});
      } else {
        dxfLines.push({type: 'LINE', x1: dimA.x, y1: dimA.y, x2: dimB.x, y2: dimB.y, layer: 'RoadDim', color: 2});
      }
      dxfLines.push({type: 'LINE', x1: dimA.x, y1: dimA.y, x2: dimA.x - nx*asize + ny*asize*0.4, y2: dimA.y - ny*asize - nx*asize*0.4, layer: 'RoadDim', color: 2});
      dxfLines.push({type: 'LINE', x1: dimA.x, y1: dimA.y, x2: dimA.x - nx*asize - ny*asize*0.4, y2: dimA.y - ny*asize + nx*asize*0.4, layer: 'RoadDim', color: 2});
      dxfLines.push({type: 'LINE', x1: dimB.x, y1: dimB.y, x2: dimB.x + nx*asize + ny*asize*0.4, y2: dimB.y + ny*asize - nx*asize*0.4, layer: 'RoadDim', color: 2});
      dxfLines.push({type: 'LINE', x1: dimB.x, y1: dimB.y, x2: dimB.x + nx*asize - ny*asize*0.4, y2: dimB.y + ny*asize + nx*asize*0.4, layer: 'RoadDim', color: 2});
      dxfLines.push({type: 'TEXT', x: cx, y: cy, text: textStr, height: textH, layer: 'RoadDim', color: 2, rotation: dimAngle * 180 / Math.PI, align: true});
    }
  }
}
function redraw() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  dxfLines = [];
  ctx.save();
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.scale(viewScale, -viewScale);
  ctx.translate(-viewCx, -viewCy);

  ctx.strokeStyle = '#222'; ctx.lineWidth = 1/viewScale;
  const gStep = 1000;
  const gMinX = Math.floor((viewCx - canvas.width/2/viewScale)/gStep)*gStep - gStep;
  const gMaxX = Math.ceil((viewCx + canvas.width/2/viewScale)/gStep)*gStep + gStep;
  const gMinY = Math.floor((viewCy - canvas.height/2/viewScale)/gStep)*gStep - gStep;
  const gMaxY = Math.ceil((viewCy + canvas.height/2/viewScale)/gStep)*gStep + gStep;
  for (let gx = gMinX; gx <= gMaxX; gx += gStep){ ctx.beginPath(); ctx.moveTo(gx, gMinY); ctx.lineTo(gx, gMaxY); ctx.stroke(); }
  for (let gy = gMinY; gy <= gMaxY; gy += gStep){ ctx.beginPath(); ctx.moveTo(gMinX, gy); ctx.lineTo(gMaxX, gy); ctx.stroke(); }

  roads.forEach((r, idx) => {
    drawRoad(r, ctx, false, 
      (hoveredTarget?.type === 'road' && hoveredTarget?.index === idx) || (isDraggingRoad && draggedRoadIndex === idx),
      (hoveredTarget?.type === 'dim' && hoveredTarget?.index === idx) || (isDraggingDim && draggedRoadIndex === idx)
    );
  });
  if (opMode === 'road' && isDragging && dragStartG && dragCurrentG) {
    drawRoad({x1: dragStartG.x, y1: dragStartG.y, x2: dragCurrentG.x, y2: dragCurrentG.y, width: (Number(document.getElementById('roadWidth').value) || 4.0) * 1000}, ctx, true);
  }

  const tractLineW = Math.max(40, 2 / viewScale), tractTrajW = Math.max(30, 2 / viewScale);
  const trailLineW = Math.max(35, 2 / viewScale), trailTrajW = Math.max(25, 2 / viewScale);

  simSnapshots.forEach((box, idx) => {
    const isStart = idx === 0, isEnd = idx === simSnapshots.length-1, isRev = simDirMeta[idx]?.isReverse;
    ctx.beginPath();
    ctx.strokeStyle = isStart ? '#00ffaa' : (isEnd ? '#ff8800' : '#ffcc00');
    ctx.lineWidth = tractLineW;
    ctx.moveTo(box[0].x, box[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(box[i].x, box[i].y);
    ctx.closePath(); ctx.stroke();

    for (let i = 0; i < 4; i++) dxfLines.push({type: 'LINE', x1: box[i].x, y1: box[i].y, x2: box[(i+1)%4].x, y2: box[(i+1)%4].y, layer: 'VehicleBox', color: 3});

    if (isStart || isEnd) drawFrontMarker(box, ctx, isRev);
  });

  if (simTrailerSnapshots.length > 0){
    ctx.setLineDash([120, 80]);
    simTrailerSnapshots.forEach((box, idx) => {
      const isStart = idx === 0, isEnd = idx === simTrailerSnapshots.length-1;
      ctx.beginPath();
      ctx.strokeStyle = isStart ? '#00ffaa' : (isEnd ? '#ff8800' : '#cc66ff');
      ctx.lineWidth = trailLineW;
      ctx.moveTo(box[0].x, box[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(box[i].x, box[i].y);
      ctx.closePath(); ctx.stroke();

      for (let i = 0; i < 4; i++) dxfLines.push({type: 'LINE', x1: box[i].x, y1: box[i].y, x2: box[(i+1)%4].x, y2: box[(i+1)%4].y, layer: 'TrailerBox', color: 6});
    });
    ctx.setLineDash([]);
  }

  if (simPathPoints[0] && simPathPoints[0].length > 0) {
    ctx.beginPath();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = tractTrajW;
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(simPathPoints[i][0].x, simPathPoints[i][0].y);
      for (let j = 1; j < simPathPoints[i].length; j++) {
        ctx.lineTo(simPathPoints[i][j].x, simPathPoints[i][j].y);
        dxfLines.push({type: 'LINE', x1: simPathPoints[i][j-1].x, y1: simPathPoints[i][j-1].y, x2: simPathPoints[i][j].x, y2: simPathPoints[i][j].y, layer: 'Trajectory', color: 4});
      }
    }
    ctx.stroke();
  }

  if (simTrailerPathPoints[0] && simTrailerPathPoints[0].length > 0) {
    ctx.beginPath();
    ctx.strokeStyle = '#ff66cc';
    ctx.lineWidth = trailTrajW;
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(simTrailerPathPoints[i][0].x, simTrailerPathPoints[i][0].y);
      for (let j = 1; j < simTrailerPathPoints[i].length; j++) {
        ctx.lineTo(simTrailerPathPoints[i][j].x, simTrailerPathPoints[i][j].y);
        dxfLines.push({type: 'LINE', x1: simTrailerPathPoints[i][j-1].x, y1: simTrailerPathPoints[i][j-1].y, x2: simTrailerPathPoints[i][j].x, y2: simTrailerPathPoints[i][j].y, layer: 'TrailerTrajectory', color: 1});
      }
    }
    ctx.stroke();
  }

  ctx.beginPath(); ctx.fillStyle = '#ff0044'; ctx.arc(0, 0, 100, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  if (simTrailerSnapshots.length > 0){
    const b = simTrailerSnapshots[0], mid = {x: (b[0].x+b[2].x)/2, y: (b[0].y+b[2].y)/2};
    ctx.fillText('トレーラー', canvas.width/2 + (mid.x - viewCx) * viewScale, canvas.height/2 - (mid.y - viewCy) * viewScale - 14);
  }
  if (!document.querySelector('.btn-draw').disabled) document.getElementById('resultBox').innerHTML = resultHtml;
}

function drawFrontMarker(box, ctx, isReverse = false){
  const fM = {x: (box[0].x+box[1].x)/2, y: (box[0].y+box[1].y)/2}, rM = {x: (box[2].x+box[3].x)/2, y: (box[2].y+box[3].y)/2};
  let dx = fM.x - rM.x, dy = fM.y - rM.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  ctx.beginPath(); ctx.fillStyle = isReverse ? '#ff4444' : '#ffffff';
  ctx.moveTo(fM.x + dx*800, fM.y + dy*800);
  ctx.lineTo(fM.x - dx*200 - dy*250, fM.y - dy*200 + dx*250);
  ctx.lineTo(fM.x - dx*200 + dy*250, fM.y - dy*200 - dx*250);
  ctx.closePath(); ctx.fill();
}

function downloadImage(bgMode) {
  document.getElementById('imgMenu').style.display = 'none';
  if (isDirty && !confirm("変更値が軌跡に反映されていません。このまま保存してもよろしいですか？\n※描画更新後に保存する事をおススメします。")) return;
  
  const canvas = document.getElementById('canvas');
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
  const tCtx = tempCanvas.getContext('2d');

  if (bgMode === 'black') {
    tCtx.fillStyle = '#000000';
    tCtx.fillRect(0, 0, canvas.width, canvas.height);
    tCtx.drawImage(canvas, 0, 0);
  } else {
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, canvas.width, canvas.height);
    const mainCtx = canvas.getContext('2d');
    const imgData = mainCtx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] > 0) {
        data[i] = 255 - data[i];
        data[i+1] = 255 - data[i+1];
        data[i+2] = 255 - data[i+2];
      }
    }
    const invCanvas = document.createElement('canvas');
    invCanvas.width = canvas.width; invCanvas.height = canvas.height;
    invCanvas.getContext('2d').putImageData(imgData, 0, 0);
    tCtx.drawImage(invCanvas, 0, 0);
  }

  const a = document.createElement("a");
  a.href = tempCanvas.toDataURL("image/png");
  a.download = getExportFilename("png");
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function downloadDXF(){
  if (dxfLines.length === 0){ alert("先に描画を行ってください。"); return; }
  if (isDirty && !confirm("変更値が軌跡に反映されていません。このまま保存してもよろしいですか？\n※描画更新後に保存する事をおススメします。")) return;
  
  let dxf = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  dxfLines.forEach(i => {
    if (i.type === 'TEXT') {
      dxf += `0\nTEXT\n8\n${i.layer}\n${i.color?`62\n${i.color}\n`:''}10\n${i.x.toFixed(2)}\n20\n${i.y.toFixed(2)}\n40\n${i.height.toFixed(2)}\n1\n${i.text}\n50\n${i.rotation.toFixed(2)}\n`;
      if (i.align) dxf += `72\n1\n73\n2\n11\n${i.x.toFixed(2)}\n21\n${i.y.toFixed(2)}\n`;
    } else {
      dxf += `0\nLINE\n8\n${i.layer||'0'}\n${i.color?`62\n${i.color}\n`:''}10\n${i.x1.toFixed(2)}\n20\n${i.y1.toFixed(2)}\n11\n${i.x2.toFixed(2)}\n21\n${i.y2.toFixed(2)}\n`;
    }
  });
  dxf += "0\nENDSEC\n0\nEOF\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([dxf], {type: "application/dxf"}));
  a.download = getExportFilename("dxf");
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// マウス・タッチイベント設定
function initCanvasEvents() {
  const canvas = document.getElementById('canvas');
  
  canvas.addEventListener('pointerdown', (e) => {
    if (opMode !== 'road') return; 
    
    hideContextMenu();
    
    if (e.button !== 0) return; // 左クリック以外は何もしない

    const clickG = getGlobalCoords(e);
    const target = getHitTarget(clickG);
    
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    
    if (target?.type === 'dim') { isDraggingDim = true; draggedRoadIndex = target.index; }
    else if (target?.type === 'road') { isDraggingRoad = true; draggedRoadIndex = target.index; lastDragG = clickG; }
    else { isDragging = true; dragStartG = dragCurrentG = clickG; }
    redraw();
    e.target.setPointerCapture(e.pointerId);

    // 長押しタイマーセット（道路か寸法をタッチした場合のみ、かつタッチ操作限定）
    if ((target?.type === 'dim' || target?.type === 'road') && e.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        isDragging = isDraggingRoad = isDraggingDim = false;
        draggedRoadIndex = -1;
        redraw();
        showContextMenu(e.clientX, e.clientY, target);
      }, LONG_PRESS_DELAY);
    }
  });
  
  canvas.addEventListener('pointermove', (e) => {
    if (opMode !== 'road') return;
    
    // 一定以上指が動いたら長押しをキャンセル（iPadの指のブレを考慮して15pxに緩和）
    if (longPressTimer) {
      if (Math.hypot(e.clientX - touchStartX, e.clientY - touchStartY) > 15) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
    
    const currG = getGlobalCoords(e);
    if (isDraggingDim && draggedRoadIndex !== -1) {
      const r = roads[draggedRoadIndex], dx = r.x2 - r.x1, dy = r.y2 - r.y1, len2 = dx*dx + dy*dy;
      if (len2 > 0) r.dim.t = Math.max(0, Math.min(1, ((currG.x - r.x1)*dx + (currG.y - r.y1)*dy) / len2));
      redraw();
    } else if (isDraggingRoad && draggedRoadIndex !== -1) {
      const dx = currG.x - lastDragG.x, dy = currG.y - lastDragG.y;
      roads[draggedRoadIndex].x1 += dx; roads[draggedRoadIndex].y1 += dy;
      roads[draggedRoadIndex].x2 += dx; roads[draggedRoadIndex].y2 += dy;
      lastDragG = currG; redraw();
    } else if (isDragging) {
      const dx = currG.x - dragStartG.x, dy = currG.y - dragStartG.y;
      const dist = Math.max(1000, Math.hypot(dx, dy));
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 36)) * (Math.PI / 36); 
      dragCurrentG = { x: dragStartG.x + Math.cos(angle) * dist, y: dragStartG.y + Math.sin(angle) * dist };
      redraw();
    } else {
      const target = getHitTarget(currG);
      if (hoveredTarget?.type !== target?.type || hoveredTarget?.index !== target?.index) {
        hoveredTarget = target;
        canvas.style.cursor = target ? 'move' : 'crosshair';
        redraw();
      }
    }
  });
  
  canvas.addEventListener('pointerup', (e) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (opMode !== 'road' || e.button !== 0) return;
    
    if (isDraggingDim) { isDraggingDim = false; draggedRoadIndex = -1; redraw(); }
    else if (isDraggingRoad) { isDraggingRoad = false; draggedRoadIndex = -1; updateViewBox(); redraw(); }
    else if (isDragging) {
      isDragging = false;
      const dx = getGlobalCoords(e).x - dragStartG.x, dy = getGlobalCoords(e).y - dragStartG.y;
      const dist = Math.max(1000, Math.hypot(dx, dy));
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 36)) * (Math.PI / 36);
      dragCurrentG = { x: dragStartG.x + Math.cos(angle) * dist, y: dragStartG.y + Math.sin(angle) * dist };
      if (Math.hypot(dx, dy) > 100) roads.push({ x1: dragStartG.x, y1: dragStartG.y, x2: dragCurrentG.x, y2: dragCurrentG.y, width: (Number(document.getElementById('roadWidth').value) || 4.0) * 1000, dim: { t: 0.15 } });
      updateViewBox(); redraw();
    }
    if (e.target.hasPointerCapture(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }
  });
  
  canvas.addEventListener('pointerout', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (hoveredTarget) { hoveredTarget = null; if (opMode === 'road') canvas.style.cursor = 'crosshair'; redraw(); }
  });
  
  canvas.addEventListener('contextmenu', (e) => {
    if (opMode !== 'road') return;
    e.preventDefault(); 
    const target = getHitTarget(getGlobalCoords(e));
    if (target) {
      showContextMenu(e.clientX, e.clientY, target);
    } else {
      hideContextMenu();
    }
  });
}

window.onload = function(){
  // データ注入
  if (typeof LOGO_BASE64 !== 'undefined') document.getElementById('logo-img').src = LOGO_BASE64;
  
  // 全ての入力欄にinputmodeを追加
  document.querySelectorAll('input[type="number"]').forEach(el => el.setAttribute('inputmode', 'none'));
  
  initVehiclePresets(); initTrailerPresets(); initCanvasEvents(); initNumpadDrag();
  
  // 入力欄のタッチ時にソフトウェアキーボードを抑制して独自テンキーを表示
  document.querySelector('.sidebar').addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'INPUT' && (e.target.type === 'number' || e.target.dataset.isNum)) {
      if (e.pointerType !== 'mouse') {
        e.preventDefault(); // モバイルでのOSキーボード展開を防止
      }
      e.target.dataset.isNum = "true"; 
      showNumpad(e.target);
    }
  });
  
  document.querySelector('.sidebar').addEventListener('input', (e) => { if (e.target.name !== 'opMode') markAsChanged(); });
  document.querySelector('.sidebar').addEventListener('change', (e) => { if (e.target.name !== 'opMode') markAsChanged(); });
  
  // 画面のどこかをタッチした時に各種メニューを閉じる処理
  document.addEventListener('pointerdown', (e) => {
    const imgMenu = document.getElementById('imgMenu');
    if (imgMenu.style.display === 'block' && !e.target.closest('#imgMenu') && !e.target.classList.contains('btn-img')) {
      imgMenu.style.display = 'none';
    }
    const ctxMenu = document.getElementById('contextMenu');
    if (ctxMenu.style.display === 'flex' && !e.target.closest('#contextMenu') && e.target.id !== 'canvas') {
      hideContextMenu();
    }
  });
  
  addStep('reverse', 'left', 90); draw();
};