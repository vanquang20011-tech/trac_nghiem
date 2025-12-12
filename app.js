// ========================
// IMPORT GOOGLE GEMINI SDK
// ========================
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ========================
// QUẢN LÝ API KEY (ĐỒNG BỘ ĐA THIẾT BỊ QUA FIREBASE)
// ========================
let API_KEYS = [];
let currentKeyIndex = 0;

// 1. Hàm lưu Key (Vừa lưu máy này, vừa lưu lên Cloud)
async function saveKeysToStorage(keysArray) {
    const cleanKeys = keysArray.map(k => k.trim()).filter(k => k.length > 10);
    
    if (cleanKeys.length > 0) {
        API_KEYS = cleanKeys;
        
        // A. Lưu vào máy hiện tại (để dùng nhanh)
        localStorage.setItem("gemini_api_keys", JSON.stringify(cleanKeys));
        
        // B. Lưu lên Cloud (Firebase) để đồng bộ sang máy khác
        const user = auth.currentUser;
        if (user) {
            try {
                await db.collection("users").doc(user.uid).set({
                    apiKeys: cleanKeys
                }, { merge: true }); // merge: true để không mất lịch sử thi
                alert(`✅ Đã lưu ${cleanKeys.length} Key vào tài khoản!\nGiờ bạn có thể dùng trên mọi thiết bị.`);
            } catch (e) {
                console.error("Lỗi lưu Cloud:", e);
                alert("⚠️ Đã lưu vào máy này, nhưng lỗi lưu lên Cloud (kiểm tra mạng).");
            }
        } else {
            alert(`✅ Đã lưu ${cleanKeys.length} Key vào trình duyệt này.\n(Hãy đăng nhập để đồng bộ sang điện thoại!)`);
        }
        
        // Reset index để dùng key mới ngay
        currentKeyIndex = 0;
        
    } else {
        alert("❌ Danh sách Key không hợp lệ.");
    }
}

// 2. Hàm tải Key từ Cloud về (Chạy khi đăng nhập)
async function syncKeysFromCloud(user) {
    if (!user) return;
    
    try {
        const doc = await db.collection("users").doc(user.uid).get();
        if (doc.exists && doc.data().apiKeys) {
            const cloudKeys = doc.data().apiKeys;
            if (Array.isArray(cloudKeys) && cloudKeys.length > 0) {
                API_KEYS = cloudKeys;
                // Cập nhật luôn vào localStorage cho lần sau
                localStorage.setItem("gemini_api_keys", JSON.stringify(cloudKeys));
                console.log(`☁️ Đã đồng bộ ${API_KEYS.length} Key từ tài khoản của bạn.`);
            }
        }
    } catch (e) {
        console.error("Lỗi đồng bộ Key:", e);
    }
}

// 3. Hàm tải Key từ Local (Chạy khi mới mở web)
function loadKeysFromLocal() {
    const stored = localStorage.getItem("gemini_api_keys");
    if (stored) {
        try {
            API_KEYS = JSON.parse(stored);
            console.log(`📂 Đã tải ${API_KEYS.length} Key từ máy.`);
        } catch(e) {}
    }
}

// 4. Popup nhập Key
function promptForKeys() {
    const currentKeysStr = API_KEYS.join("\n");
    const user = auth.currentUser;
    let msg = "🛠️ CẤU HÌNH API KEY (Multi-Device)\n\n";
    
    if (user) {
        msg += `👤 Đang đăng nhập: ${user.displayName}\n(Key bạn nhập sẽ được lưu vào tài khoản này)\n\n`;
    } else {
        msg += `⚠️ Bạn CHƯA đăng nhập.\nKey chỉ được lưu trên máy này thôi.\nHãy đăng nhập để đồng bộ sang điện thoại!\n\n`;
    }
    
    msg += "Dán danh sách Key vào đây (Mỗi key một dòng):";

    const input = prompt(msg, currentKeysStr);

    if (input !== null) {
        // Tách chuỗi thành mảng (chấp nhận xuống dòng hoặc dấu phẩy)
        const newKeys = input.split(/[\n,]+/).map(k => k.trim()).filter(k => k);
        saveKeysToStorage(newKeys);
    }
}

function getCurrentKey() {
    if (!API_KEYS || API_KEYS.length === 0) {
        // Nếu chưa có key thì chưa làm gì cả, đợi hàm gọi xử lý
        return null;
    }
    return API_KEYS[currentKeyIndex];
}

function rotateKey() {
    if (API_KEYS.length > 0) {
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        console.log(`⚠️ Đổi sang Key số ${currentKeyIndex + 1}`);
    }
}

// Khởi động: Tải từ local trước cho nhanh
loadKeysFromLocal();


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
    
    // --- MỚI: TỰ ĐỘNG TẢI KEY TỪ CLOUD VỀ ---
    syncKeysFromCloud(user);
    // ----------------------------------------
    
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
  const reAnalyzeBtn = document.getElementById("btnReAnalyzeAI");
  const loading = document.getElementById("aiLoading");

  // FIX LỖI LOADING
  aiResultBox.style.display = "none";
  aiResultBox.classList.remove("is-loading"); 
  if (loading) loading.style.display = "none";

  aiContent.innerHTML = "";
  expandBtn.style.display = "none";
  reAnalyzeBtn.style.display = "none";
  
  if (attemptData.aiAnalysis) {
      aiResultBox.style.display = "block";
      aiContent.innerHTML = attemptData.aiAnalysis;
      expandBtn.style.display = "block";
      reAnalyzeBtn.style.display = "block";
      aiBtn.textContent = "✅ Đã có lời giải (Đã lưu)";
      aiBtn.disabled = true; 
      aiBtn.style.background = "#cbd5e1";
      aiBtn.style.cursor = "default";
      aiBtn.style.boxShadow = "none";
  } else {
      aiBtn.disabled = false;
      aiBtn.style.background = "linear-gradient(135deg, #8b5cf6, #d946ef)";
      aiBtn.style.cursor = "pointer";
      aiBtn.style.boxShadow = "0 4px 10px rgba(139, 92, 246, 0.3)";
      aiBtn.textContent = "✨ Phân tích lỗi sai";
      
      const mistakes = (attemptData.details || []).filter(q => !q.s);
      if (mistakes.length === 0) {
        aiBtn.textContent = "🎉 Lần này đúng 100%!";
        aiBtn.disabled = true;
        aiBtn.style.background = "#10b981";
      }
  }
}

// ========================
// HÀM GỌI AI (PHIÊN BẢN MỚI NHẤT)
// ========================
async function analyzeWithGemini(forceUpdate = false) {
  const aiBtn = document.getElementById("btnAnalyzeAI");
  const resultBox = document.getElementById("aiResultBox");
  const loading = document.getElementById("aiLoading");
  const content = document.getElementById("aiContent");
  const reAnalyzeBtn = document.getElementById("btnReAnalyzeAI");
  const aiSelect = document.getElementById("aiHistorySelect");

  // KIỂM TRA KEY: Nếu chưa có key thì bắt nhập
  if (!API_KEYS || API_KEYS.length === 0) {
    promptForKeys();
    if (!API_KEYS || API_KEYS.length === 0) return; // Nhập xong vẫn rỗng thì thôi
  }

  // 1. Lấy ID từ dropdown
  const selectedId = aiSelect.value;
  if (!selectedId) { alert("Vui lòng chọn lần làm bài."); return; }
  const targetAttempt = globalHistoryData.find(h => h.id === selectedId);
  if (!targetAttempt) return;

  // 2. KIỂM TRA: Nếu đã có lời giải VÀ không ép chạy lại -> Hiện cái cũ
  if (targetAttempt.aiAnalysis && !forceUpdate) {
      renderAIContent(targetAttempt);
      return;
  }

  // 3. Lấy lỗi sai
  const mistakes = targetAttempt.details.filter(q => !q.s); 
  if (mistakes.length === 0) {
      alert("Bạn đúng 100%! Không có gì để phân tích."); return;
  }

  // Gửi tối đa 8 câu sai
  const limitedMistakes = mistakes.slice(0, 8);
  const mistakesJson = limitedMistakes.map(m => ({
      question: m.q, userAnswer: m.u || "Bỏ trống", correctAnswer: m.a
  }));

  // UI Loading
  resultBox.style.display = "block";
  if(loading) loading.style.display = "flex"; 
  content.innerHTML = "";
  
  aiBtn.disabled = true;
  aiBtn.textContent = forceUpdate ? "♻️ Đang tổng hợp báo cáo..." : "⏳ Đang phân tích chuyên sâu...";
  reAnalyzeBtn.style.display = "none"; 

  // --- LOGIC KEY POOL ---
  let success = false;
  let finalHtml = "";
  const candidateModels = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];

  for (let k = 0; k < API_KEYS.length; k++) {
      const activeKey = getCurrentKey();
      console.log(`🔄 Key đang dùng: ...${activeKey.slice(-4)}`);

      try {
          const genAI = new GoogleGenerativeAI(activeKey);
          
          for (const modelName of candidateModels) {
              try {
                  const model = genAI.getGenerativeModel({ model: modelName });
                  
                  const prompt = `
                  Bạn là một Chuyên gia Phân tích Giáo dục.
                  Học sinh vừa làm bài thi và sai các câu dưới đây (JSON):
                  ${JSON.stringify(mistakesJson)}

                  Nhiệm vụ: Tạo BÁO CÁO PHÂN TÍCH TOÀN DIỆN (HTML không markdown):
                  1. **Dashboard (Tổng quan):**
                     <div class="ai-dashboard">
                        <div class="ai-card card-weakness">
                            <div class="ai-card-title">📉 Điểm yếu cốt lõi</div>
                            <div class="ai-card-content">...Phân tích...</div>
                        </div>
                        <div class="ai-card card-solution">
                            <div class="ai-card-title">💊 Phác đồ cải thiện</div>
                            <div class="ai-card-content">...Giải pháp...</div>
                        </div>
                     </div>
                  2. **Chi tiết từng câu:**
                     <div class="ai-response-item">
                        <span class="ai-response-q">Câu hỏi...</span>
                        <div class="ai-explanation">Giải thích...</div>
                        <div class="ai-response-tip">💡 Mẹo: ...</div>
                     </div>
                  `;

                  const result = await model.generateContent(prompt);
                  let rawHtml = result.response.text().replace(/```html/g, "").replace(/```/g, "");
                  
                  if(rawHtml.length > 50) {
                      finalHtml = rawHtml + `
                        <div class="ai-model-footer">
                            ⚡ Phân tích bởi: <span class="ai-model-badge">${modelName}</span>
                            <span style="margin-left:5px;">(Key ${k + 1})</span>
                        </div>
                      `;
                      success = true;
                      break; 
                  }
              } catch (errModel) { console.log(`Model ${modelName} lỗi, thử tiếp...`); }
          }
      } catch (errKey) { console.error("Key lỗi:", errKey); }

      if (success) break; 
      rotateKey();
  }

  if (success) {
    targetAttempt.aiAnalysis = finalHtml;
    try {
        const user = auth.currentUser;
        if (user && targetAttempt.id) {
            await db.collection("users").doc(user.uid).collection("history").doc(targetAttempt.id).update({
                aiAnalysis: finalHtml
            });
        }
    } catch (e) { console.error(e); }

    renderAIContent(targetAttempt);
  } else {
    content.innerHTML = `<p style="color:red; text-align:center; padding:20px;">❌ Hệ thống đang bận. Vui lòng thử lại sau.</p>`;
    aiBtn.disabled = false;
    aiBtn.textContent = "Thử lại";
    if(loading) loading.style.display = "none";
  }
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
  
  let myHist = data.filter(h => h.examName === examName || h.examName.includes(examName));
  
  myHist.sort((a, b) => b.timestamp.seconds - a.timestamp.seconds);

  if (myHist.length < 2) { 
    chartBox.style.display = "none";
    statsBox.style.display = "none";
    msgBox.style.display = "block";
  } else {
    chartBox.style.display = "block";
    statsBox.style.display = "flex";
    msgBox.style.display = "none";
    
    const bestAttempt = [...myHist].sort((a, b) => b.score - a.score)[0];
    const recentAttempt = myHist[0]; 
    
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

    const chartData = [...myHist].reverse();
    const labels = chartData.map((_, index) => `Lần ${index + 1}`);
    const scores = chartData.map(h => h.score); 
    const totals = chartData.map(h => h.total);
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

  // LOGIC DROPDOWN CHỌN LẦN LÀM BÀI
  const aiSelect = document.getElementById("aiHistorySelect");
  
  if (myHist.length > 0) {
      let optionsHtml = "";
      myHist.forEach((attempt, index) => {
          const time = attempt.dateStr || "N/A";
          optionsHtml += `<option value="${attempt.id}">📅 ${time} (Điểm: ${attempt.score}/${attempt.total})</option>`;
      });
      aiSelect.innerHTML = optionsHtml;
      aiSelect.selectedIndex = 0;
      renderAIContent(myHist[0]); 

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
  document.getElementById("aiResultBox").style.display = "none"; 
  
  document.getElementById("historyOverview").style.display = "none";
  document.getElementById("chartContainer").style.display = "none";

  window.switchHistoryTab('stats'); 

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

  // --- SỰ KIỆN PHÓNG TO / THU NHỎ (FIX LỖI HIỂN THỊ) ---
  const aiBox = document.getElementById("aiResultBox");
  const expandBtn = document.getElementById("btnExpandAI");
  const closeExpandedBtn = document.getElementById("btnCloseExpanded");
  const aiSectionParent = document.getElementById("aiSection");

  if(closeExpandedBtn) closeExpandedBtn.textContent = "✕";

  const toggleExpand = () => {
    const isExpanded = aiBox.classList.contains("expanded");
    const loadingDiv = document.getElementById("aiLoading");
    const aiContent = document.getElementById("aiContent");
    
    if (!isExpanded) {
        // ==> BẬT PHÓNG TO
        // 1. Chuyển box ra body để thoát khỏi modal nhỏ
        document.body.appendChild(aiBox);
        
        // 2. Thêm class (Sử dụng requestAnimationFrame để đảm bảo render mượt)
        requestAnimationFrame(() => {
            aiBox.classList.add("expanded");
            document.body.classList.add("ai-open");
        });
        
        if(expandBtn) expandBtn.style.display = "none";
        
        // 3. Xử lý loading: Chỉ hiện loading nếu đang chạy thật sự
        if (loadingDiv && loadingDiv.style.display !== "none" && (!aiContent.innerHTML || aiContent.innerHTML.trim() === "")) {
            aiBox.classList.add("is-loading");
        } else {
            aiBox.classList.remove("is-loading");
        }

    } else {
        // ==> TẮT PHÓNG TO
        aiBox.classList.remove("expanded");
        aiBox.classList.remove("is-loading");
        document.body.classList.remove("ai-open");
        
        // Đưa về chỗ cũ ngay lập tức
        aiSectionParent.appendChild(aiBox);
        
        if(expandBtn) expandBtn.style.display = "block";
    }
  };

  if(expandBtn) expandBtn.onclick = toggleExpand;
  if(closeExpandedBtn) closeExpandedBtn.onclick = toggleExpand;
  
  // Phím ESC
  document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && aiBox && aiBox.classList.contains("expanded")) {
          toggleExpand();
      }
  });

  // Bấm vào vùng trống hoặc nội dung để đóng/mở
  if(aiBox) {
      aiBox.onclick = (e) => {
          // 1. Nếu ĐANG phóng to: Chỉ đóng khi bấm vào vùng đen (nền), không đóng khi bấm vào nội dung
          if (aiBox.classList.contains("expanded")) {
              if (e.target === aiBox) {
                  toggleExpand();
              }
          } 
          // 2. Nếu CHƯA phóng to: Bấm đâu cũng mở (trừ nút đóng)
          else {
              // Tránh xung đột nếu bấm vào nút đóng (dù nút đóng thường ẩn ở chế độ này)
              if (!e.target.classList.contains('btn-close-ai-expanded')) {
                  toggleExpand();
              }
          }
      };
  }

  // Sự kiện nút Phân tích chính
  document.getElementById("btnAnalyzeAI").onclick = () => analyzeWithGemini(false);

  // Sự kiện nút Giải lại
  const btnRe = document.getElementById("btnReAnalyzeAI");
  if (btnRe) {
      btnRe.onclick = () => {
          if(confirm("Bạn có chắc muốn chạy lại AI không?\n(Sẽ tốn thêm 1 lượt dùng trong ngày)")) {
              analyzeWithGemini(true); 
          }
      };
  }
  
  // SỰ KIỆN NÚT CÀI ĐẶT KEY
  const btnSetupKey = document.createElement("button");
  btnSetupKey.className = "btn-icon-small";
  btnSetupKey.textContent = "🔑";
  btnSetupKey.title = "Cài đặt API Key";
  btnSetupKey.style.marginRight = "5px";
  btnSetupKey.onclick = promptForKeys;
  
  // Chèn nút Key vào header AI (Bên cạnh tiêu đề)
  const aiHeaderTitle = document.querySelector(".ai-header h4");
  if(aiHeaderTitle) {
      aiHeaderTitle.appendChild(btnSetupKey);
  }
});