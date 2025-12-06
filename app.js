// ========================
// BIẾN TOÀN CỤC
// ========================
let questionsData = [];
let pendingData = null;
let timerInterval = null;
let remainingSeconds = 0;
let examFinished = false;
let examTotalSeconds = 0;
let globalHistoryData = [];
let scoreChart = null; // Biến giữ biểu đồ

const API_KEY = "AIzaSyAry4xCdznJGeWvTi1NtId0q6YgPfZdwrg";
const DRIVE_FOLDER_ID = ""; 

function setHeaderMode(mode) {
  const setup = document.getElementById("setupPanel");
  const status = document.getElementById("statusPanel");
  if(mode === 'active') {
    setup.style.display = 'none';
    status.style.display = 'flex';
  } else {
    setup.style.display = 'flex';
    status.style.display = 'none';
  }
}

function updateFileStatus(name, ready) {
  const el = document.getElementById("fileStatusLabel");
  if(ready) {
    el.textContent = `✅ Đã tải: ${name}`;
    el.className = "file-status ready";
    document.getElementById("btnStart").disabled = false;
    document.getElementById("btnStart").style.opacity = "1";
    document.getElementById("btnStart").textContent = "Bắt đầu ngay ▶";
  } else {
    el.textContent = "Chưa chọn đề";
    el.className = "file-status";
    document.getElementById("btnStart").disabled = true;
    document.getElementById("btnStart").style.opacity = "0.5";
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateTimerDisplay() {
  const el = document.getElementById("timer");
  el.textContent = formatTime(remainingSeconds);
  el.classList.remove("danger");
  if (remainingSeconds <= 60) el.classList.add("danger");
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const min = parseInt(document.getElementById("timeInput").value) || 15;
  examTotalSeconds = min * 60;
  remainingSeconds = examTotalSeconds;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      if (!examFinished) grade(true);
      return;
    }
    remainingSeconds--;
    updateTimerDisplay();
  }, 1000);
}

function shuffleArray(arr) {
  if (!Array.isArray(arr)) return arr;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function handleDataLoaded(data, fileName) {
  if (!Array.isArray(data) || data.length === 0) {
    alert("File không hợp lệ hoặc không có câu hỏi.");
    return;
  }
  pendingData = { data: data, name: fileName };
  updateFileStatus(fileName, true);
  
  document.getElementById("quiz").innerHTML = `
    <div class="welcome-state">
      <div style="font-size:40px">✅</div>
      <h3>Đề "${fileName}" đã sẵn sàng!</h3>
      <p>Hãy chỉnh thời gian và nhấn nút <b>"Bắt đầu ngay"</b> ở trên.</p>
    </div>
  `;
  await checkCurrentExamHistorySummary(fileName);
}

function startExamNow() {
  if(!pendingData) {
    alert("Vui lòng chọn file đề trước!");
    return;
  }
  const cloned = pendingData.data.map((q) => ({
    ...q,
    options: Array.isArray(q.options) ? [...q.options] : []
  }));
  shuffleArray(cloned);
  cloned.forEach((q) => { if (Array.isArray(q.options)) shuffleArray(q.options); });

  questionsData = cloned;
  examFinished = false;

  document.getElementById("examName").textContent = pendingData.name;
  setHeaderMode('active');
  
  generateQuiz();
  startTimer();

  // Mobile: Thu gọn header khi bắt đầu
  if (window.innerWidth <= 850) {
    const header = document.getElementById("mainHeader");
    const toggleBtn = document.getElementById("btnToggleHeaderMobile");
    header.classList.add("header-hidden");
    toggleBtn.textContent = "▼";
  }

  document.getElementById("result").textContent = "";
  document.getElementById("topResult").style.display = "none";
  checkCurrentExamHistorySummary(pendingData.name);
}

function loadFileFromLocal() {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const name = file.name.replace(/\.json$/i, "");
      handleDataLoaded(data, name);
    } catch (err) { alert("Lỗi đọc JSON."); }
  };
  reader.readAsText(file);
}

function loadJsonFromDriveFileId(fileId, fileName) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;
  const btn = document.getElementById("btnSelectDrive");
  const oldText = btn.textContent;
  btn.textContent = "⏳ Đang tải...";
  btn.disabled = true;
  fetch(url).then(r => r.json()).then(json => {
    handleDataLoaded(json, fileName);
  }).catch(() => {
    alert("Không tải được file từ Drive.");
  }).finally(() => {
    btn.textContent = oldText;
    btn.disabled = false;
  });
}

function chooseExamFromDriveFolder() {
  let folderId = DRIVE_FOLDER_ID;
  if (!folderId) {
    const link = "https://drive.google.com/drive/folders/1yIfmYSkZHBpoJZqBtNfZKWMnxmg46uDX?usp=sharing";
    folderId = link.match(/folders\/([a-zA-Z0-9_-]+)/)[1];
  }
  const q = `'${folderId}' in parents and mimeType='application/json' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&key=${API_KEY}`;
  fetch(url).then(r => r.json()).then(data => {
    if (!data.files || !data.files.length) { alert("Folder Drive này trống."); return; }
    const listText = data.files.map((f, idx) => `${idx + 1}. ${f.name}`).join("\n");
    const choice = prompt("Nhập số thứ tự đề thi:\n\n" + listText);
    const index = parseInt(choice, 10) - 1;
    if (isNaN(index) || index < 0 || index >= data.files.length) return;
    loadJsonFromDriveFileId(data.files[index].id, data.files[index].name);
  }).catch(console.error);
}

function openQuestionNav() { document.getElementById("questionNavOverlay").classList.add("open"); }
function closeQuestionNav() { document.getElementById("questionNavOverlay").classList.remove("open"); }

function generateQuiz() {
  const quizDiv = document.getElementById("quiz");
  quizDiv.innerHTML = "";
  const letters = ["A", "B", "C", "D", "E", "F"];
  questionsData.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.index = index;
    let html = `
      <div class="question-header"><span>CÂU ${index + 1}</span></div>
      <div class="question-text">${q.question}</div>
      <div class="options">
    `;
    (q.options || []).forEach((opt, i) => {
      const letter = letters[i] || "?";
      html += `
        <div class="option-wrapper">
          <input type="radio" name="q${index}" value="${opt}" id="q${index}_opt${i}" class="option-input" style="display:none">
          <label for="q${index}_opt${i}" class="option-label">
            <span style="font-weight:700; min-width:25px; color:#3b82f6;">${letter}.</span>
            <span>${opt}</span>
          </label>
        </div>`;
    });
    html += `</div>`;
    card.innerHTML = html;
    quizDiv.appendChild(card);
    card.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", () => {
        const btn = document.querySelector(`.qnav-item[data-index="${index}"]`);
        if(btn) btn.classList.add("nav-answered");
      });
    });
  });
  
  const listEl = document.getElementById("questionList");
  listEl.innerHTML = "";
  questionsData.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.className = "qnav-item";
    btn.textContent = i + 1;
    btn.dataset.index = i;
    btn.onclick = () => {
      const card = document.querySelector(`.question-card[data-index="${i}"]`);
      if(card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      if(window.innerWidth <= 850) closeQuestionNav();
    };
    listEl.appendChild(btn);
  });
}

function grade(autoSubmit) {
  if(!questionsData.length) return;
  examFinished = true;
  clearInterval(timerInterval);
  let score = 0;
  document.querySelectorAll(".qnav-item").forEach(b => b.className = "qnav-item");
  questionsData.forEach((q, i) => {
    const card = document.querySelector(`.question-card[data-index="${i}"]`);
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    const navBtn = document.querySelector(`.qnav-item[data-index="${i}"]`);
    const correctText = (q.answer || "").trim();
    const userText = selected ? selected.value.trim() : "";
    const isCorrect = userText === correctText;
    const opts = q.options || [];
    card.classList.remove("correct", "incorrect");
    card.querySelectorAll(".option-label").forEach((lbl, idx) => {
       if((opts[idx]||"").trim() === correctText) lbl.classList.add("correct");
       if(selected && opts[idx] === userText && !isCorrect) lbl.classList.add("incorrect");
    });
    card.querySelectorAll("input").forEach(inp => inp.disabled = true);
    if (isCorrect) {
      score++;
      card.classList.add("correct");
      if(navBtn) navBtn.classList.add("nav-correct");
    } else {
      card.classList.add("incorrect");
      if(navBtn) navBtn.classList.add("nav-incorrect");
    }
  });
  const total = questionsData.length;
  const percent = Math.round((score / total) * 100);
  let rank = percent >= 80 ? "Giỏi" : (percent >= 50 ? "Khá" : "Yếu");
  if(percent >= 90) rank = "Xuất sắc";
  document.getElementById("result").innerHTML = `<span style="font-size:18px;">Kết quả: <b>${score}/${total}</b> (${percent}%) - ${rank}</span>`;
  const topRes = document.getElementById("topResult");
  topRes.style.display = "block";
  topRes.textContent = `${percent}%`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  const examName = document.getElementById("examName").textContent;
  saveExamResult(score, total, percent, examName);
}

function resetExam() {
  if(!confirm("Bạn muốn thoát bài này?")) return;
  clearInterval(timerInterval);
  examFinished = false;
  questionsData = [];
  pendingData = null; 
  setHeaderMode('setup');
  updateFileStatus("", false); 
  document.getElementById("quiz").innerHTML = `
    <div class="welcome-state">
      <div class="welcome-icon">👋</div>
      <h3>Sẵn sàng thử thách?</h3>
      <p>Chọn đề thi, cài đặt thời gian và nhấn nút <b>Bắt đầu</b>.</p>
    </div>`;
  document.getElementById("result").textContent = "";
  document.getElementById("topResult").style.display = "none";
  document.getElementById("examHistorySummary").style.display = "none";
  document.getElementById("questionList").innerHTML = "";
  closeQuestionNav();
}

// --- FIREBASE ---
auth.onAuthStateChanged((user) => {
  const btnLogin = document.getElementById("btnLogin");
  const userSection = document.getElementById("userSection");
  const avatar = document.getElementById("userAvatar");
  if (user) {
    btnLogin.style.display = "none";
    userSection.style.display = "flex";
    avatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`;
  } else {
    btnLogin.style.display = "block";
    userSection.style.display = "none";
  }
});
document.getElementById("btnLogin").onclick = () => auth.signInWithPopup(provider);
document.getElementById("btnLogout").onclick = () => auth.signOut();

async function saveExamResult(score, total, percent, examName) {
  const user = auth.currentUser;
  if(!user) return;
  const details = questionsData.map((q, i) => {
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    return { q: q.question, u: sel ? sel.value : "", a: q.answer || "", s: sel && sel.value === (q.answer || "") };
  });
  try {
    await db.collection("users").doc(user.uid).collection("history").add({
      examName: examName, score, total, percent,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      dateStr: new Date().toLocaleString('vi-VN'), details
    });
    fetchHistoryData(user.uid);
  } catch(e) {}
}
async function fetchHistoryData(uid) {
  try {
    const snap = await db.collection("users").doc(uid).collection("history").orderBy("timestamp", "desc").limit(100).get();
    globalHistoryData = [];
    snap.forEach(d => globalHistoryData.push({ id: d.id, ...d.data() }));
  } catch(e) {}
}

// --- [CẬP NHẬT] HÀM VẼ BIỂU ĐỒ & THỐNG KÊ CHI TIẾT ---
function renderChart(examName, data) {
  const chartBox = document.getElementById("chartContainer");
  const statsBox = document.getElementById("chartStats"); // [MỚI]
  const msgBox = document.getElementById("chartMessage");
  const ctx = document.getElementById("scoreChart").getContext('2d');
  
  let myHist = data.filter(h => h.examName === examName || h.examName.includes(examName));
  
  // Logic hiển thị thông báo nếu ít dữ liệu
  if (myHist.length < 2) { 
    chartBox.style.display = "none";
    statsBox.style.display = "none";
    msgBox.style.display = "block";
    return; 
  }
  
  chartBox.style.display = "block";
  statsBox.style.display = "flex"; // Hiện box thống kê
  msgBox.style.display = "none";

  // --- 1. TÍNH TOÁN SỐ LIỆU ---
  
  // Tìm lần làm TỐT NHẤT (Dựa trên điểm số score, nếu bằng nhau thì lấy mới hơn)
  // Sắp xếp giảm dần theo điểm
  const bestAttempt = [...myHist].sort((a, b) => b.score - a.score)[0];

  // Tìm lần làm GẦN NHẤT (Dựa trên thời gian)
  // Sắp xếp tăng dần theo thời gian (Cũ -> Mới) để vẽ biểu đồ
  myHist.sort((a, b) => (a.timestamp && b.timestamp) ? (a.timestamp.seconds - b.timestamp.seconds) : 0);
  
  const recentAttempt = myHist[myHist.length - 1]; // Lấy phần tử cuối cùng

  // --- 2. HIỂN THỊ HTML THỐNG KÊ ---
  statsBox.innerHTML = `
    <div class="c-stat-box">
      <div class="c-stat-label">Lần gần nhất</div>
      <div class="c-stat-val">${recentAttempt.score}/${recentAttempt.total} câu</div>
      <div class="c-stat-sub">(${recentAttempt.percent}%)</div>
    </div>
    <div class="c-stat-box best">
      <div class="c-stat-label">Cao nhất</div>
      <div class="c-stat-val">${bestAttempt.score}/${bestAttempt.total} câu</div>
      <div class="c-stat-sub">(${bestAttempt.percent}%)</div>
    </div>
  `;

  // --- 3. VẼ BIỂU ĐỒ (Giữ nguyên logic cũ) ---
  const labels = myHist.map((_, index) => `Lần ${index + 1}`);
  const scores = myHist.map(h => h.score); 
  const totals = myHist.map(h => h.total);
  const percents = myHist.map(h => h.percent);

  if (scoreChart) { scoreChart.destroy(); }

  scoreChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Số câu đúng',
        data: scores,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#2563eb',
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const idx = context.dataIndex;
              const sc = context.parsed.y;
              const tot = totals[idx];
              const per = percents[idx];
              return `Đúng: ${sc}/${tot} câu (${per}%)`; 
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: '1', // Thêm khoảng trống đỉnh (1 đơn vị)
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: '#f1f5f9' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderOverview(examName, data) {
  const container = document.getElementById("historyOverview");
  const myHist = data.filter(h => h.examName === examName || h.examName.includes(examName));
  if (myHist.length === 0) { container.style.display = "none"; return; }
  const count = myHist.length;
  const maxScore = Math.max(...myHist.map(h => h.score));
  const avgScore = Math.round(myHist.reduce((a, b) => a + b.percent, 0) / count);
  container.style.display = "flex";
  container.innerHTML = `
    <div class="overview-item"><span class="overview-val">${count}</span><span class="overview-label">Lần làm</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val" style="color:${getMaxColor(maxScore)}">${maxScore} câu</span><span class="overview-label">Cao nhất</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val">${avgScore}%</span><span class="overview-label">Trung bình</span></div>
  `;
}
function getMaxColor(p) { return p >= 90 ? '#16a34a' : (p >= 50 ? '#d97706' : '#dc2626'); }

async function showHistory() {
  const user = auth.currentUser;
  if (!user) { alert("Vui lòng đăng nhập."); return; }
  const modal = document.getElementById("historyModal");
  modal.style.display = "flex";
  
  document.getElementById("statsList").innerHTML = "<p style='text-align:center; padding:20px'>⏳ Đang tải...</p>";
  
  document.getElementById("historyOverview").style.display = "none";
  document.getElementById("chartContainer").style.display = "none";

  // Reset tab active
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[onclick="switchHistoryTab(\'stats\')"]').classList.add('active');
  document.getElementById("tabStats").style.display = "block";
  document.getElementById("tabTimeline").style.display = "none";
  document.getElementById("tabChart").style.display = "none";

  let targetExamName = null;
  const isExamActive = document.getElementById("statusPanel").style.display !== "none";
  if (isExamActive) { targetExamName = document.getElementById("examName").textContent; } 
  else if (pendingData) { targetExamName = pendingData.name; }
  
  if(globalHistoryData.length === 0) await fetchHistoryData(user.uid);
  
  if (targetExamName) {
    document.getElementById("filterArea").style.display = "none";
    document.getElementById("currentExamLabel").style.display = "none";
    document.getElementById("historyModalTitle").textContent = targetExamName;
    document.getElementById("historyOverview").style.display = "flex";
    
    renderOverview(targetExamName, globalHistoryData);
    renderChart(targetExamName, globalHistoryData);
    renderStats(targetExamName); 
    renderTimeline(targetExamName); 
  } else {
    document.getElementById("historyModalTitle").textContent = "Hồ sơ học tập chung";
    document.getElementById("filterArea").style.display = "flex";
    initStatsFilter(); renderStats('all'); renderTimeline('all');
  }
}

function switchHistoryTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[onclick="switchHistoryTab('${tab}')"]`).classList.add('active');
  document.getElementById('tabStats').style.display = (tab === 'stats') ? 'block' : 'none';
  document.getElementById('tabTimeline').style.display = (tab === 'timeline') ? 'block' : 'none';
  document.getElementById('tabChart').style.display = (tab === 'chart') ? 'block' : 'none';
}

function initStatsFilter() {
  const sel = document.getElementById("statsFilter");
  const names = new Set();
  globalHistoryData.forEach(i => names.add(i.examName));
  let html = `<option value="all">-- Tất cả --</option>`;
  names.forEach(n => html += `<option value="${n}">${n}</option>`);
  sel.innerHTML = html;
}
function filterStats() {
  const val = document.getElementById("statsFilter").value;
  renderStats(val);
  renderTimeline(val);
}
function renderStats(filterName) {
  const list = document.getElementById("statsList");
  let data = globalHistoryData;
  if(filterName !== 'all') data = data.filter(i => i.examName === filterName || i.examName.includes(filterName));
  if(!data.length) { list.innerHTML = "<p style='text-align:center; padding:20px'>Chưa có dữ liệu.</p>"; return; }
  let qMap = {};
  data.forEach(exam => {
    if(!exam.details) return;
    exam.details.forEach(d => {
      const txt = d.q.trim();
      if(!qMap[txt]) qMap[txt] = { q: txt, w: 0, r: 0, a: d.a };
      d.s ? qMap[txt].r++ : qMap[txt].w++;
    });
  });
  const badQs = Object.values(qMap).filter(x => x.w > 0).sort((a,b) => b.w - a.w);
  if (!badQs.length) { list.innerHTML = `<p style="text-align:center; color:var(--success); font-weight:bold; padding:20px;">Tuyệt vời! Bạn không có câu sai nào.</p>`; return; }
  let html = `<div style="padding:10px; background:#fff1f2; color:#be123c; margin-bottom:15px; border-radius:8px; font-size:14px;">🔥 Có <b>${badQs.length}</b> câu bạn cần ôn lại.</div>`;
  badQs.forEach(i => {
    html += `<div class="weak-item"><div class="weak-count" title="Sai ${i.w} lần">${i.w}</div><div class="weak-content"><div class="weak-q">${i.q}</div><div class="weak-ans">Đúng: ${i.a}</div></div></div>`;
  });
  list.innerHTML = html;
}

function renderTimeline(filterName) {
  const list = document.getElementById("timelineList");
  let data = globalHistoryData;
  if(filterName !== 'all') { data = data.filter(i => i.examName === filterName || i.examName.includes(filterName)); }
  if(!data.length) { list.innerHTML = "<p style='text-align:center; padding:20px; color:#64748b;'>Chưa có lịch sử làm bài nào.</p>"; return; }
  let html = "";
  data.forEach(d => {
    let scoreColor = '#16a34a'; if (d.percent < 50) scoreColor = '#dc2626'; else if (d.percent < 80) scoreColor = '#d97706';
    let detailsHtml = '';
    if (d.details && Array.isArray(d.details)) {
      detailsHtml = d.details.map((q, idx) => {
        const isRight = q.s;
        return `<div class="hist-q-item ${isRight ? 'hist-correct' : 'hist-wrong'}"><div class="hist-q-text"><span style="font-weight:bold; color:${isRight?'#16a34a':'#dc2626'}">Câu ${idx + 1}:</span> ${q.q}</div><div class="hist-user-ans">${isRight ? '✅' : '❌'} Bạn chọn: <b>${q.u || '(Bỏ trống)'}</b></div>${!isRight ? `<div class="hist-correct-ans">👉 Đáp án đúng: <b>${q.a}</b></div>` : ''}</div>`;
      }).join('');
    }
    html += `<div class="history-card-wrapper" id="card-${d.id}"><div class="history-summary" onclick="toggleHistoryDetail('${d.id}')"><div class="hist-left"><div class="hist-name">${d.examName}</div><div class="hist-date">${d.dateStr}</div></div><div class="hist-right"><div style="text-align:right; margin-right:8px;"><div class="hist-score" style="color:${scoreColor}">${d.score}/${d.total}</div><div class="hist-percent" style="background:${scoreColor}">${d.percent}%</div></div><div class="hist-arrow">▼</div></div></div><div id="detail-${d.id}" class="history-details-box" style="display:none;">${detailsHtml || '<p style="padding:10px; text-align:center;">Không có dữ liệu chi tiết.</p>'}</div></div>`;
  });
  list.innerHTML = html;
}
window.toggleHistoryDetail = function(id) {
  const detailEl = document.getElementById(`detail-${id}`);
  const cardEl = document.getElementById(`card-${id}`);
  const arrowEl = cardEl.querySelector('.hist-arrow');
  if (detailEl.style.display === "none") {
    detailEl.style.display = "block"; cardEl.classList.add("active"); if(arrowEl) arrowEl.style.transform = "rotate(180deg)";
  } else {
    detailEl.style.display = "none"; cardEl.classList.remove("active"); if(arrowEl) arrowEl.style.transform = "rotate(0deg)";
  }
};

async function checkCurrentExamHistorySummary(examName) {
  const user = auth.currentUser;
  const summaryEl = document.getElementById("examHistorySummary");
  if(!summaryEl || !user || !examName) return;
  summaryEl.style.display = 'none';
  await fetchHistoryData(user.uid);
  const myHist = globalHistoryData.filter(h => h.examName === examName || h.examName.includes(examName));
  if (myHist.length > 0) {
    const maxScore = Math.max(...myHist.map(h => h.percent));
    const count = myHist.length;
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `<div><span style="font-size:18px;">🎓</span> Bạn đã làm đề <b>"${examName}"</b> tổng cộng <b>${count}</b> lần. Thành tích tốt nhất: <b style="color:${getMaxColor(maxScore)}">${maxScore}%</b>.</div><u onclick="showHistory()" style="cursor:pointer; font-weight:600; margin-left:15px; white-space:nowrap;">Xem chi tiết</u>`;
  }
}

// EVENTS
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fileInput").onchange = loadFileFromLocal;
  document.getElementById("btnSelectDrive").onclick = chooseExamFromDriveFolder;
  document.getElementById("btnStart").onclick = startExamNow;
  document.getElementById("btnReset").onclick = resetExam;

  const handleSubmission = () => {
    if (!questionsData || questionsData.length === 0) return;
    const answeredCount = document.querySelectorAll('input[type="radio"]:checked').length;
    const total = questionsData.length;
    const unanswer = total - answeredCount;
    let msg = "Bạn có chắc chắn muốn nộp bài không?";
    if (unanswer > 0) { msg = `Bạn còn ${unanswer} câu chưa chọn đáp án.\nBạn có chắc chắn muốn nộp bài không?`; }
    if (confirm(msg)) {
      grade(false);
      if (window.innerWidth <= 850) {
         const header = document.getElementById("mainHeader");
         const toggleBtn = document.getElementById("btnToggleHeaderMobile");
         header.classList.add("header-hidden");
         toggleBtn.textContent = "▼";
      }
    }
  };

  document.getElementById("btnGradeHeader").onclick = handleSubmission;
  document.getElementById("btnGradeNav").onclick = handleSubmission;
  document.getElementById("btnViewHistory").onclick = showHistory;
  document.getElementById("btnCloseHistory").onclick = () => document.getElementById("historyModal").style.display = "none";
  document.getElementById("btnToggleNavMobile").onclick = openQuestionNav;
  document.getElementById("questionNavCloseBtn").onclick = closeQuestionNav;
  document.getElementById("questionNavOverlay").onclick = (e) => { if(e.target.id === "questionNavOverlay") closeQuestionNav(); };
  document.getElementById("btnToggleNavMobileInHeader").onclick = openQuestionNav;  
  
  const header = document.getElementById("mainHeader");
  const toggleBtn = document.getElementById("btnToggleHeaderMobile");
  toggleBtn.onclick = () => {
    header.classList.toggle("header-hidden");
    if (header.classList.contains("header-hidden")) {
      toggleBtn.textContent = "▼"; toggleBtn.title = "Hiện thanh công cụ";
    } else {
      toggleBtn.textContent = "▲"; toggleBtn.title = "Ẩn thanh công cụ";
    }
  };
  document.getElementById("btnToggleNavMobile").onclick = () => {
    openQuestionNav();
    if (window.innerWidth <= 850) { header.classList.add("header-hidden"); toggleBtn.textContent = "▼"; }
  };
  updateFileStatus("", false); 
});