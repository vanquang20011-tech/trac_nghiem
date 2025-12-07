// ========================
// IMPORT GOOGLE GEMINI SDK
// ========================
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ========================
// CẤU HÌNH API KEY
// ========================
// HÃY ĐIỀN API KEY CỦA BẠN VÀO ĐÂY (Lấy tại aistudio.google.com)
const GEMINI_API_KEY = "AIzaSyBK7FLMfkb3Ij1yuxz7uavpPvGnMBAH9_0"; 

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
let scoreChart = null; 

const API_KEY = "AIzaSyAry4xCdznJGeWvTi1NtId0q6YgPfZdwrg"; // Key cũ cho Drive (nếu cần)
const DRIVE_FOLDER_ID = ""; 

// ========================
// CÁC HÀM UI CƠ BẢN
// ========================

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

// ========================
// LOGIC ĐỀ THI
// ========================

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

// Expose functions to window (vì dùng type=module)
window.startExamNow = function() {
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

  document.getElementById("btnGradeHeader").style.display = "block";
  document.getElementById("btnGradeNav").style.display = "block";
  document.getElementById("examName").textContent = pendingData.name;
  setHeaderMode('active');
  
  generateQuiz();
  startTimer();

  // Mobile
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

window.loadFileFromLocal = function() {
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

window.chooseExamFromDriveFolder = function() {
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

window.openQuestionNav = function() { document.getElementById("questionNavOverlay").classList.add("open"); }
window.closeQuestionNav = function() { document.getElementById("questionNavOverlay").classList.remove("open"); }

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

  if (examFinished) return;
  examFinished = true;
  
  clearInterval(timerInterval);

  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

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

window.resetExam = function() {
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

// ========================
// FIREBASE
// ========================
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

// ========================
// AI GIA SƯ LOGIC
// ========================

// Hàm hiển thị nội dung AI dựa trên lần làm bài được chọn
function renderAIContent(attemptData) {
  const aiResultBox = document.getElementById("aiResultBox");
  const aiContent = document.getElementById("aiContent");
  const aiBtn = document.getElementById("btnAnalyzeAI");
  const expandBtn = document.getElementById("btnExpandAI");
  const reAnalyzeBtn = document.getElementById("btnReAnalyzeAI"); // Nút mới
  const loading = document.getElementById("aiLoading");

  // 1. Reset trạng thái chung
  aiResultBox.style.display = "none";
  aiContent.innerHTML = "";
  expandBtn.style.display = "none";
  reAnalyzeBtn.style.display = "none"; // Ẩn nút giải lại
  if (loading) loading.style.display = "none"; // Đảm bảo tắt loading

  // 2. Kiểm tra dữ liệu
  if (attemptData.aiAnalysis) {
      // ==> TRƯỜNG HỢP 1: ĐÃ CÓ LỜI GIẢI
      aiResultBox.style.display = "block";
      aiContent.innerHTML = attemptData.aiAnalysis;
      
      expandBtn.style.display = "block"; // Hiện nút phóng to
      reAnalyzeBtn.style.display = "block"; // Hiện nút Giải lại
      
      // Nút chính chuyển thành trạng thái "Đã xong" và không bấm được (để tránh bấm nhầm)
      aiBtn.textContent = "✅ Đã có lời giải (Đã lưu)";
      aiBtn.disabled = true; 
      aiBtn.style.background = "#cbd5e1"; // Màu xám nhạt
      aiBtn.style.cursor = "default";
      aiBtn.style.boxShadow = "none";

  } else {
      // ==> TRƯỜNG HỢP 2: CHƯA CÓ LỜI GIẢI
      // Reset style nút chính về màu tím đẹp
      aiBtn.disabled = false;
      aiBtn.style.background = "linear-gradient(135deg, #8b5cf6, #d946ef)";
      aiBtn.style.cursor = "pointer";
      aiBtn.style.boxShadow = "0 4px 10px rgba(139, 92, 246, 0.3)";
      
      aiBtn.textContent = "✨ Phân tích lỗi sai";
      
      // Kiểm tra nếu đúng 100%
      const mistakes = (attemptData.details || []).filter(q => !q.s);
      if (mistakes.length === 0) {
        aiBtn.textContent = "🎉 Lần này đúng 100%!";
        aiBtn.disabled = true;
        aiBtn.style.background = "#10b981"; // Màu xanh lá
      }
  }
}

async function analyzeWithGemini() {
  const aiBtn = document.getElementById("btnAnalyzeAI");
  const resultBox = document.getElementById("aiResultBox");
  const loading = document.getElementById("aiLoading");
  const content = document.getElementById("aiContent");
  const expandBtn = document.getElementById("btnExpandAI");
  const aiSelect = document.getElementById("aiHistorySelect"); // Lấy thanh chọn

  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("HAY_DIEN")) {
    alert("Chưa cấu hình API Key!"); return;
  }

  // 1. XÁC ĐỊNH LẦN LÀM BÀI DỰA VÀO DROPDOWN
  const selectedId = aiSelect.value;
  if (!selectedId) { alert("Vui lòng chọn lần làm bài cần phân tích."); return; }

  // Tìm đối tượng bài làm trong mảng globalHistoryData dựa vào ID
  const targetAttempt = globalHistoryData.find(h => h.id === selectedId);
  
  if (!targetAttempt) { alert("Không tìm thấy dữ liệu bài làm này."); return; }

  // 2. LOGIC GỌI AI
  const mistakes = targetAttempt.details.filter(q => !q.s); 
  if (mistakes.length === 0) { alert("Lần này bạn đúng hết, không cần AI sửa!"); return; }

  const limitedMistakes = mistakes.slice(0, 3);
  const mistakesJson = limitedMistakes.map(m => ({
      question: m.q, userAnswer: m.u || "Bỏ trống", correctAnswer: m.a
  }));

  resultBox.style.display = "block";
  loading.style.display = "flex";
  content.innerHTML = "";
  aiBtn.disabled = true;

  const candidateModels = [
    "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash-lite", "gemini-1.5-flash"
  ];

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const prompt = `
  Bạn là gia sư AI vui tính. Học sinh sai các câu này: ${JSON.stringify(mistakesJson)}
  Giải thích ngắn gọn tại sao sai và cho MẸO GHI NHỚ (thơ/vè).
  Trả về HTML (không markdown): 
  <div class="ai-response-item">
    <span class="ai-response-q">Tiêu đề câu hỏi</span>
    <div class="ai-explanation">Giải thích ngắn...</div>
    <div class="ai-response-tip">💡 Mẹo: ...</div>
  </div>. 
  Dùng emoji sinh động.
  `;

  let success = false;
  let finalHtml = "";

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      finalHtml = response.text().replace(/```html/g, "").replace(/```/g, "");
      success = true;
      break; 
    } catch (error) { console.error(error); }
  }

  if (success) {
    content.innerHTML = finalHtml;
    expandBtn.style.display = "block";
    aiBtn.textContent = "✅ Đã có lời giải (Đã lưu)";
    
    // --- LƯU VÀO ĐÚNG ID CỦA LẦN LÀM BÀI ĐANG CHỌN ---
    try {
        const user = auth.currentUser;
        if (user && targetAttempt.id) {
            await db.collection("users").doc(user.uid).collection("history").doc(targetAttempt.id).update({
                aiAnalysis: finalHtml
            });
            console.log("Đã lưu AI cho lần làm bài:", targetAttempt.dateStr);
            
            // Cập nhật dữ liệu cục bộ để không cần load lại trang
            targetAttempt.aiAnalysis = finalHtml; 
        }
    } catch (e) { console.error("Lỗi lưu AI:", e); }
    // --------------------------------------------------

  } else {
    content.innerHTML = `<p style="color:red">Hết lượt hoặc lỗi kết nối.</p>`;
  }

  loading.style.display = "none";
  aiBtn.disabled = false;
}

// Gắn hàm vào nút bấm
document.getElementById("btnAnalyzeAI").onclick = analyzeWithGemini;


// ========================
// CHART & THỐNG KÊ
// ========================

function renderChart(examName, data) {
  const chartBox = document.getElementById("chartContainer");
  const statsBox = document.getElementById("chartStats"); 
  const msgBox = document.getElementById("chartMessage");
  const ctx = document.getElementById("scoreChart").getContext('2d');
  
  // Lọc lịch sử của đề thi này
  let myHist = data.filter(h => h.examName === examName || h.examName.includes(examName));
  
  // Sắp xếp theo thời gian: Mới nhất -> Cũ nhất
  myHist.sort((a, b) => b.timestamp.seconds - a.timestamp.seconds);

  if (myHist.length < 2) { 
    chartBox.style.display = "none";
    statsBox.style.display = "none";
    msgBox.style.display = "block";
    // Vẫn render dropdown AI kể cả khi chưa đủ dữ liệu vẽ chart
  } else {
    chartBox.style.display = "block";
    statsBox.style.display = "flex";
    msgBox.style.display = "none";
    
    // Logic vẽ chart (Giữ nguyên logic cũ của bạn)
    const bestAttempt = [...myHist].sort((a, b) => b.score - a.score)[0];
    const recentAttempt = myHist[0]; // Vì đã sort time desc ở trên
    
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

    // Chuẩn bị dữ liệu cho Chart (đảo ngược lại để cũ -> mới)
    const chartData = [...myHist].reverse();
    const labels = chartData.map((_, index) => `Lần ${index + 1}`);
    const scores = chartData.map(h => h.score); 
    const totals = chartData.map(h => h.total);
    const percents = chartData.map(h => h.percent);
    const maxQuestions = Math.max(...totals);

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
            tension: 0.3,
            fill: true
        }]
        },
        options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: {
            beginAtZero: true,
            suggestedMax: maxQuestions,
            ticks: { stepSize: 5, precision: 0 },
            grid: { color: '#f1f5f9' }
            },
            x: { grid: { display: false } }
        }
        }
    });
  }

  // --- LOGIC MỚI: ĐIỀN DỮ LIỆU VÀO DROPDOWN CHỌN LẦN LÀM BÀI ---
  const aiSelect = document.getElementById("aiHistorySelect");
  
  if (myHist.length > 0) {
      let optionsHtml = "";
      myHist.forEach((attempt, index) => {
          // index 0 là mới nhất
          const time = attempt.dateStr || "N/A";
          // Label: "Lần làm (Ngày) - Điểm"
          optionsHtml += `<option value="${attempt.id}">📅 ${time} (Điểm: ${attempt.score}/${attempt.total})</option>`;
      });
      aiSelect.innerHTML = optionsHtml;
      
      // Mặc định chọn lần mới nhất (option đầu tiên)
      aiSelect.selectedIndex = 0;
      renderAIContent(myHist[0]); // Hiển thị AI cho lần đầu tiên

      // Sự kiện khi người dùng đổi lựa chọn
      aiSelect.onchange = function() {
          const selectedId = this.value;
          const selectedAttempt = myHist.find(h => h.id === selectedId);
          if (selectedAttempt) {
              renderAIContent(selectedAttempt);
          }
      };
  } else {
      aiSelect.innerHTML = "<option>Chưa có dữ liệu</option>";
  }
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

window.showHistory = async function() {
  const user = auth.currentUser;
  if (!user) { alert("Vui lòng đăng nhập."); return; }
  const modal = document.getElementById("historyModal");
  modal.style.display = "flex";
  
  document.getElementById("statsList").innerHTML = "<p style='text-align:center; padding:20px'>⏳ Đang tải...</p>";
  document.getElementById("aiResultBox").style.display = "none"; // Ẩn AI cũ nếu có
  
  document.getElementById("historyOverview").style.display = "none";
  document.getElementById("chartContainer").style.display = "none";

  window.switchHistoryTab('stats'); // Default tab

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

window.switchHistoryTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[onclick="window.switchHistoryTab('${tab}')"]`).classList.add('active');
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
window.filterStats = function() {
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
    html += `<div class="history-card-wrapper" id="card-${d.id}"><div class="history-summary" onclick="window.toggleHistoryDetail('${d.id}')"><div class="hist-left"><div class="hist-name">${d.examName}</div><div class="hist-date">${d.dateStr}</div></div><div class="hist-right"><div style="text-align:right; margin-right:8px;"><div class="hist-score" style="color:${scoreColor}">${d.score}/${d.total}</div><div class="hist-percent" style="background:${scoreColor}">${d.percent}%</div></div><div class="hist-arrow">▼</div></div></div><div id="detail-${d.id}" class="history-details-box" style="display:none;">${detailsHtml || '<p style="padding:10px; text-align:center;">Không có dữ liệu chi tiết.</p>'}</div></div>`;
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
    summaryEl.innerHTML = `<div><span style="font-size:18px;">🎓</span> Bạn đã làm đề <b>"${examName}"</b> tổng cộng <b>${count}</b> lần. Thành tích tốt nhất: <b style="color:${getMaxColor(maxScore)}">${maxScore}%</b>.</div><u onclick="window.showHistory()" style="cursor:pointer; font-weight:600; margin-left:15px; white-space:nowrap;">Xem chi tiết</u>`;
  }
}

// EVENTS
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fileInput").onchange = window.loadFileFromLocal;
  document.getElementById("btnSelectDrive").onclick = window.chooseExamFromDriveFolder;
  document.getElementById("btnStart").onclick = window.startExamNow;
  document.getElementById("btnReset").onclick = window.resetExam;

  const handleSubmission = () => {

    if (examFinished) return;

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
  document.getElementById("btnViewHistory").onclick = window.showHistory;
  document.getElementById("btnCloseHistory").onclick = () => document.getElementById("historyModal").style.display = "none";
  document.getElementById("btnToggleNavMobile").onclick = window.openQuestionNav;
  document.getElementById("questionNavCloseBtn").onclick = window.closeQuestionNav;
  document.getElementById("questionNavOverlay").onclick = (e) => { if(e.target.id === "questionNavOverlay") window.closeQuestionNav(); };
  document.getElementById("btnToggleNavMobileInHeader").onclick = window.openQuestionNav;  
  
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
    window.openQuestionNav();
    if (window.innerWidth <= 850) { header.classList.add("header-hidden"); toggleBtn.textContent = "▼"; }
  };
  updateFileStatus("", false); 

  // --- SỰ KIỆN PHÓNG TO / THU NHỎ (FIX GIAO DIỆN & LOADING) ---
  const aiBox = document.getElementById("aiResultBox");
  const expandBtn = document.getElementById("btnExpandAI");
  const closeExpandedBtn = document.getElementById("btnCloseExpanded");
  const aiSectionParent = document.getElementById("aiSection");

  // Nút đóng mới: Sửa lại text thành dấu X cho đẹp (vì CSS đã làm tròn nút)
  if(closeExpandedBtn) closeExpandedBtn.textContent = "✕";

  const toggleExpand = () => {
    const isExpanded = aiBox.classList.contains("expanded");
    
    if (!isExpanded) {
        // ==> BẬT PHÓNG TO
        // 1. Dịch chuyển box ra body
        document.body.appendChild(aiBox);
        
        // 2. Thêm class style
        aiBox.classList.add("expanded");
        document.body.classList.add("ai-open");
        
        // 3. Ẩn nút phóng to nhỏ
        if(expandBtn) expandBtn.style.display = "none";
        
        // 4. Kiểm tra xem có đang loading không để thêm class xử lý giao diện
        const loadingDiv = document.getElementById("aiLoading");
        if (loadingDiv && loadingDiv.style.display !== "none") {
            aiBox.classList.add("is-loading");
        } else {
            aiBox.classList.remove("is-loading");
        }

    } else {
        // ==> TẮT PHÓNG TO
        aiBox.classList.remove("expanded");
        aiBox.classList.remove("is-loading");
        document.body.classList.remove("ai-open");
        
        // Đưa về chỗ cũ
        aiSectionParent.appendChild(aiBox);
        
        // Hiện lại nút nhỏ
        if(expandBtn) expandBtn.style.display = "block";
        expandBtn.textContent = "⛶";
    }
  };

  if(expandBtn) expandBtn.onclick = toggleExpand;
  if(closeExpandedBtn) closeExpandedBtn.onclick = toggleExpand;
  
  // Phím ESC để thoát
  document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && aiBox && aiBox.classList.contains("expanded")) {
          toggleExpand();
      }
  });

  // Bấm ra ngoài vùng trắng để đóng
  if(aiBox) {
      aiBox.onclick = (e) => {
          // Nếu đang expanded và bấm vào vùng nền tối (aiBox), chứ không phải bấm vào nội dung (aiContent)
          if (aiBox.classList.contains("expanded") && e.target === aiBox) {
              toggleExpand();
          }
      };
  }

  // Sự kiện nút Phân tích chính (Chạy lần đầu)
  document.getElementById("btnAnalyzeAI").onclick = () => analyzeWithGemini(false);

  // Sự kiện nút Giải lại (Chạy lại ép buộc)
  const btnRe = document.getElementById("btnReAnalyzeAI");
  if (btnRe) {
      btnRe.onclick = () => {
          if(confirm("Bạn có chắc muốn chạy lại AI không?\n(Sẽ tốn thêm 1 lượt dùng trong ngày)")) {
              analyzeWithGemini(true); // Truyền true để ép chạy lại
          }
      };
  }
});