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
  const cleanKeys = keysArray.map((k) => k.trim()).filter((k) => k.length > 10);

  if (cleanKeys.length > 0) {
    API_KEYS = cleanKeys;

    // A. Lưu vào máy hiện tại (để dùng nhanh)
    localStorage.setItem("gemini_api_keys", JSON.stringify(cleanKeys));

    // B. Lưu lên Cloud (Firebase) để đồng bộ sang máy khác
    const user = auth.currentUser;
    if (user) {
      try {
        await db.collection("users").doc(user.uid).set(
          {
            apiKeys: cleanKeys,
          },
          { merge: true }
        ); // merge: true để không mất lịch sử thi
        alert(
          `✅ Đã lưu ${cleanKeys.length} Key vào tài khoản!\nGiờ bạn có thể dùng trên mọi thiết bị.`
        );
      } catch (e) {
        console.error("Lỗi lưu Cloud:", e);
        alert(
          "⚠️ Đã lưu vào máy này, nhưng lỗi lưu lên Cloud (kiểm tra mạng)."
        );
      }
    } else {
      alert(
        `✅ Đã lưu ${cleanKeys.length} Key vào trình duyệt này.\n(Hãy đăng nhập để đồng bộ sang điện thoại!)`
      );
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
        console.log(
          `☁️ Đã đồng bộ ${API_KEYS.length} Key từ tài khoản của bạn.`
        );
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
    } catch (e) {}
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
    const newKeys = input
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k);
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
let driveCache = {}; // Lưu trữ dữ liệu folder đã tải để không phải tải lại
let isReviewMode = false; // Trạng thái chế độ ôn tập
let scoreChart = null;

const API_KEY = "AIzaSyAry4xCdznJGeWvTi1NtId0q6YgPfZdwrg"; // Key cũ cho Drive (nếu cần)
const DRIVE_FOLDER_ID = "";

// ==========================================
// HỆ THỐNG QUẢN LÝ CÂU SAI (CLOUD FIREBASE)
// ==========================================

// Hàm tạo Key an toàn: Tự động chuyển sang mã Hash nếu câu quá dài
function getSmartKey(text) {
  // Nếu câu ngắn (< 300 ký tự) -> Dùng cách cũ (Base64) để tương thích dữ liệu cũ
  if (text.length < 300) return encodeKey(text);

  // Nếu câu dài -> Tạo mã Hash ngắn gọn (Ví dụ: long_q_152342)
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return "long_q_" + Math.abs(hash);
}

// 1. Hàm dọn dẹp tên đề thi để làm ID (Tránh lỗi ký tự cấm của Firebase)
const getSafeId = (str) => {
  if (!str) return "unknown_exam";
  // Chuyển tiếng Việt có dấu thành không dấu (tùy chọn, để ID đẹp hơn)
  const noAccent = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Thay thế các ký tự cấm: . # $ [ ] / bằng dấu gạch dưới
  return noAccent.trim().replace(/[\/\#\$\.\[\]\s]/g, "_");
};

// SỬA LỖI: Thay thế các ký tự cấm của Firebase (+, /) bằng (-, _)
const encodeKey = (str) => {
  return btoa(unescape(encodeURIComponent(str.trim())))
    .replace(/\+/g, "-") // Thay dấu + thành -
    .replace(/\//g, "_") // Thay dấu / thành _ (SỬA LỖI QUAN TRỌNG)
    .replace(/=+$/, ""); // Xóa dấu = ở cuối cho gọn
};

const decodeKey = (str) => {
  try {
    // Khôi phục lại ký tự gốc trước khi giải mã
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    // Thêm lại padding (=) nếu thiếu
    while (str.length % 4) {
      str += "=";
    }
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    return "Lỗi mã hóa câu hỏi";
  }
};

// 2. Cập nhật lỗi lên Cloud (Cộng hoặc Trừ)
// 2. Cập nhật lỗi lên Cloud (Cộng hoặc Trừ) - PHIÊN BẢN FIX LỖI TREO
async function updateMistakeInCloud(examName, questionText, isCorrect) {
  const user = auth.currentUser;
  if (!user) return 0;

  const safeExamId = getSafeId(examName);
  const originalKey = encodeKey(questionText);
  const qKey = getSmartKey(questionText);
  let targetKey = originalKey; // Mặc định dùng khóa tạo từ text

  // Kiểm tra độ dài khóa (Firestore giới hạn 1500 bytes)
  if (targetKey.length > 1000) {
    console.warn(
      "⚠️ Câu hỏi quá dài, có thể gây lỗi Cloud:",
      questionText.substring(0, 50) + "..."
    );
  }

  const docRef = db
    .collection("users")
    .doc(user.uid)
    .collection("mistake_tracking")
    .doc(safeExamId);

  try {
    // --- BƯỚC 1: LẤY DỮ LIỆU ĐỂ KIỂM TRA TRƯỚC ---
    const doc = await docRef.get();

    // Nếu chưa có dữ liệu gì trên Cloud
    if (!doc.exists) {
      if (isCorrect) return 0; // Đúng thì thôi, không cần làm gì
      // Nếu sai thì tạo mới ở dưới
    }

    let currentCount = 0;

    // --- BƯỚC 2: TÌM KHÓA CHÍNH XÁC (SMART LOOKUP) ---
    if (doc.exists) {
      const data = doc.data();

      // Trường hợp 1: Khóa khớp hoàn toàn
      if (data[targetKey] !== undefined) {
        currentCount = data[targetKey];
      }
      // Trường hợp 2: Khóa bị lệch (do khoảng trắng/encode), phải đi tìm
      else {
        // Quét tất cả các khóa đang có để tìm câu tương tự
        const cleanQ = questionText.trim();
        const foundKey = Object.keys(data).find((k) => {
          if (k === "last_updated") return false;
          try {
            // Giải mã khóa cũ xem có khớp nội dung không
            return decodeKey(k).trim() === cleanQ;
          } catch (e) {
            return false;
          }
        });

        if (foundKey) {
          console.log("🔧 Đã tìm thấy khóa khớp (Fix lỗi lệch):", foundKey);
          targetKey = foundKey; // Dùng khóa thực tế trong DB
          currentCount = data[foundKey];
        }
      }
    }

    // --- BƯỚC 3: THỰC HIỆN CẬP NHẬT ---
    if (!isCorrect) {
      // TRƯỜNG HỢP SAI: Cộng thêm 1
      const newCount = currentCount + 1;
      // Dùng set({merge: true}) an toàn hơn update
      let valueToSave;
      if (questionText.length >= 300) {
        valueToSave = { c: newCount, t: questionText };
      } else {
        valueToSave = newCount;
      }

      await docRef.set(
        {
          [qKey]: valueToSave,
          last_updated: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return "increased";
    } else {
      // TRƯỜNG HỢP ĐÚNG: Xóa hoặc Trừ
      if (currentCount <= 1) {
        // Hết nợ -> Xóa field
        await docRef.update({
          [qKey]: firebase.firestore.FieldValue.delete(),
        });
        return 0;
      } else {
        const newCount = currentCount - 1;
        let valueToSave = newCount;

        // Nếu đang là dạng Object (câu dài), phải giữ nguyên cấu trúc Object để không mất text
        if (questionText.length >= 300) {
          valueToSave = { c: newCount, t: questionText };
        }

        await docRef.update({
          [qKey]: valueToSave,
        });
        return newCount;
      }
    }
  } catch (e) {
    console.error("Lỗi cập nhật Cloud:", e);
    // Nếu lỗi do field quá dài hoặc lỗi khác, trả về -1 để UI báo lỗi
    return -1;
  }
}

// 3. Tải danh sách lỗi về để ôn
async function fetchMistakesFromCloud(examName) {
  const user = auth.currentUser;
  if (!user) return {};

  const safeExamId = getSafeId(examName);
  try {
    const doc = await db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking")
      .doc(safeExamId)
      .get();
    if (doc.exists) {
      return doc.data();
    }
  } catch (e) {
    console.error("Lỗi tải câu sai:", e);
  }
  return {};
}

// ========================
// CÁC HÀM UI CƠ BẢN
// ========================

function setHeaderMode(mode) {
  const setup = document.getElementById("setupPanel");
  const status = document.getElementById("statusPanel");
  const progressBar = document.querySelector(".progress-container"); // Lấy thanh tiến trình

  if (mode === "active") {
    // --- ĐANG LÀM BÀI ---
    setup.style.display = "none";
    status.style.display = "flex";
    if (progressBar) progressBar.style.display = "block"; // HIỆN thanh tiến trình
  } else {
    // --- CHẾ ĐỘ CHỜ / SETUP ---
    setup.style.display = "flex";
    status.style.display = "none";
    if (progressBar) progressBar.style.display = "none"; // ẨN thanh tiến trình
  }
}

function updateFileStatus(name, ready) {
  const el = document.getElementById("fileStatusLabel");
  if (ready) {
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
window.startExamNow = function () {
  if (!pendingData) {
    alert("Vui lòng chọn file đề trước!");
    return;
  }
  isReviewMode = false;
  const cloned = pendingData.data.map((q) => ({
    ...q,
    options: Array.isArray(q.options) ? [...q.options] : [],
  }));
  shuffleArray(cloned);
  cloned.forEach((q) => {
    if (Array.isArray(q.options)) shuffleArray(q.options);
  });

  questionsData = cloned;
  examFinished = false;

  document.getElementById("btnGradeHeader").style.display = "block";
  document.getElementById("btnGradeNav").style.display = "block";
  document.getElementById("examName").textContent = pendingData.name;
  setHeaderMode("active");

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
};

window.loadFileFromLocal = function () {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const name = file.name.replace(/\.json$/i, "");
      handleDataLoaded(data, name);
    } catch (err) {
      alert("Lỗi đọc JSON.");
    }
  };
  reader.readAsText(file);
};

function loadJsonFromDriveFileId(fileId, fileName) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;
  const btn = document.getElementById("btnSelectDrive");
  const oldText = btn.textContent;
  btn.textContent = "⏳ Đang tải...";
  btn.disabled = true;
  fetch(url)
    .then((r) => r.json())
    .then((json) => {
      handleDataLoaded(json, fileName);
    })
    .catch(() => {
      alert("Không tải được file từ Drive.");
    })
    .finally(() => {
      btn.textContent = oldText;
      btn.disabled = false;
    });
}

// --- LOGIC DRIVE MỚI (POPUP MODAL) ---
// ==========================================
// LOGIC DRIVE EXPLORER (HỖ TRỢ FOLDER)
// ==========================================

let driveHistoryStack = []; // Lưu lịch sử duyệt thư mục để Back
let currentFolderId = ""; // ID thư mục hiện tại

// 1. Khởi động Modal Drive
window.chooseExamFromDriveFolder = function () {
  const modal = document.getElementById("driveModal");
  modal.style.display = "flex";

  // Reset trạng thái
  driveHistoryStack = [];

  // Lấy ID Root folder
  let rootId = DRIVE_FOLDER_ID;
  if (!rootId) {
    // ID thư mục gốc mặc định (như code cũ của bạn)
    rootId = "1yIfmYSkZHBpoJZqBtNfZKWMnxmg46uDX";
  }

  // Bắt đầu tải thư mục gốc
  loadDriveFolder(rootId, "Trang chủ");
};

// HÀM DRIVE NÂNG CẤP (CACHE + SKELETON)
function loadDriveFolder(folderId, folderName) {
  const listEl = document.getElementById("driveListArea");
  const loadingEl = document.getElementById("driveLoading"); // Ẩn spinner cũ đi
  const backBtn = document.getElementById("btnDriveBack");
  const breadcrumb = document.getElementById("driveBreadcrumb");

  loadingEl.style.display = "none"; // Ta dùng Skeleton thay vì spinner xoay xoay cũ

  // Cập nhật Breadcrumb & Nút Back
  currentFolderId = folderId;
  breadcrumb.textContent =
    driveHistoryStack.map((f) => f.name).join(" > ") +
    (driveHistoryStack.length ? " > " : "") +
    folderName;
  backBtn.disabled = driveHistoryStack.length === 0;

  // 1. KIỂM TRA CACHE: Nếu đã có dữ liệu trong RAM thì hiện ngay lập tức!
  if (driveCache[folderId]) {
    renderDriveGrid(driveCache[folderId]);
    return;
  }

  // 2. HIỂN THỊ SKELETON (Hiệu ứng đang tải giả lập)
  let skeletonHtml = "";
  for (let i = 0; i < 8; i++) {
    skeletonHtml += `<div class="d-item skeleton-item"><div class="skeleton" style="width:50px; height:50px; border-radius:50%; margin-bottom:10px;"></div><div class="skeleton" style="width:80%; height:10px;"></div></div>`;
  }
  listEl.innerHTML = skeletonHtml;

  // 3. GỌI API (Như cũ)
  const q = `'${folderId}' in parents and (mimeType='application/json' or mimeType='application/vnd.google-apps.folder') and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,mimeType)&key=${API_KEY}`;

  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      if (!data.files || !data.files.length) {
        listEl.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#94a3b8;">📂 Thư mục trống</div>`;
        return;
      }

      // Sắp xếp
      const sortedFiles = data.files.sort((a, b) => {
        const isFolderA = a.mimeType.includes("folder");
        const isFolderB = b.mimeType.includes("folder");
        if (isFolderA && !isFolderB) return -1;
        if (!isFolderA && isFolderB) return 1;
        return a.name.localeCompare(b.name);
      });

      // LƯU VÀO CACHE
      driveCache[folderId] = sortedFiles;

      renderDriveGrid(sortedFiles);
    })
    .catch((err) => {
      console.error(err);
      listEl.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color:#ef4444;">❌ Lỗi tải dữ liệu.</div>`;
    });
}

// Thay thế hàm renderDriveGrid cũ bằng hàm này:

function renderDriveGrid(files) {
  const listEl = document.getElementById("driveListArea");

  // ICON SVG (Nhúng trực tiếp để không lỗi ảnh)
  const iconFolder = `
    <svg width="100%" height="100%" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M56 16H34.4L28.8 8H8C5.8 8 4 9.8 4 12V52C4 54.2 5.8 56 8 56H56C58.2 56 60 54.2 60 52V20C60 17.8 58.2 16 56 16Z" fill="#60A5FA"/>
      <path d="M56 20H8V52H56V20Z" fill="#93C5FD"/>
      <path d="M56 20H8V24H56V20Z" fill="#BFDBFE"/>
    </svg>`;

  const iconJson = `
    <svg width="100%" height="100%" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="4" width="44" height="56" rx="4" fill="white" stroke="#CBD5E1" stroke-width="2"/>
      <path d="M42 4V16H54" stroke="#CBD5E1" stroke-width="2" stroke-linejoin="round"/>
      <text x="32" y="38" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#F59E0B" text-anchor="middle">{ }</text>
      <text x="32" y="52" font-family="Arial, sans-serif" font-size="9" fill="#94A3B8" text-anchor="middle">JSON</text>
    </svg>`;

  let html = "";

  files.forEach((file) => {
    const isFolder = file.mimeType.includes("folder");

    if (isFolder) {
      // FOLDER ITEM
      html += `
        <div class="d-item is-folder" onclick="window.onDriveFolderClick('${file.id}', '${file.name}')" title="${file.name}">
            <div class="d-icon-box">${iconFolder}</div>
            <div class="d-name">${file.name}</div>
        </div>`;
    } else {
      // FILE ITEM
      html += `
        <div class="d-item is-file" onclick="window.onDriveFileClick('${file.id}', '${file.name}')" title="${file.name}">
            <div class="d-icon-box">${iconJson}</div>
            <div class="d-name">${file.name}</div>
        </div>`;
    }
  });

  listEl.innerHTML = html;
}

// 4. Sự kiện Click Folder (Đi sâu vào trong)
window.onDriveFolderClick = function (id, name) {
  // Đẩy folder hiện tại vào lịch sử để tí còn Back lại
  // Lưu tên folder TRƯỚC khi chuyển (cái đang hiển thị trên breadcrumb cuối cùng)
  const parentName = document
    .getElementById("driveBreadcrumb")
    .textContent.split(" > ")
    .pop();
  driveHistoryStack.push({ id: currentFolderId, name: parentName });

  // Tải folder mới
  loadDriveFolder(id, name);
};

// 5. Sự kiện Click File (Chọn đề thi)
window.onDriveFileClick = function (id, name) {
  document.getElementById("driveModal").style.display = "none";
  loadJsonFromDriveFileId(id, name); // Gọi lại hàm cũ để tải đề
};

// 6. Sự kiện Nút Back
document.getElementById("btnDriveBack").onclick = function () {
  if (driveHistoryStack.length === 0) return;

  const prev = driveHistoryStack.pop();
  loadDriveFolder(prev.id, prev.name);
};

// 7. Sự kiện đóng Modal
document.addEventListener("DOMContentLoaded", () => {
  // ... code cũ ...

  // Gán nút đóng cho Modal Drive mới
  const closeBtn = document.getElementById("btnCloseDrive");
  if (closeBtn)
    closeBtn.onclick = () =>
      (document.getElementById("driveModal").style.display = "none");
});

window.openQuestionNav = function () {
  document.getElementById("questionNavOverlay").classList.add("open");
};
window.closeQuestionNav = function () {
  document.getElementById("questionNavOverlay").classList.remove("open");
};

function generateQuiz() {
  const quizDiv = document.getElementById("quiz");
  quizDiv.innerHTML = "";

  // Reset Progress Bar
  updateProgressBar();

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

    // --- ĐOẠN SỬA ĐỔI Ở ĐÂY ---
    // Nếu là chế độ ôn tập thì thêm giải thích (Chỉ dùng class, KHÔNG DÙNG STYLE INLINE)
    if (isReviewMode && q.explain) {
      // Bỏ style="background:..." đi để CSS xử lý
      html += `<div class="review-explain" id="explain-${index}" style="display:none;">
        💡 <b>Giải thích:</b> ${q.explain}
      </div>`;
    }
    // ---------------------------

    card.innerHTML = html;
    quizDiv.appendChild(card);

    // SỰ KIỆN CHỌN ĐÁP ÁN

    card.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        // 1. Cập nhật menu bên phải
        const btn = document.querySelector(`.qnav-item[data-index="${index}"]`);
        if (btn) btn.classList.add("nav-answered");

        // 2. Cập nhật thanh tiến độ
        updateProgressBar();

        // 3. LOGIC RIÊNG CHO CHẾ ĐỘ ÔN TẬP (Review Mode)
        if (isReviewMode) {
          const userVal = inp.value;
          const correctVal = (q.answer || "").trim();
          const labels = card.querySelectorAll(".option-label");
          const currentExamName =
            document.getElementById("examName").textContent;
          card.querySelectorAll("input").forEach((i) => (i.disabled = true));
          card.classList.add("locked-card");
          // Xóa màu cũ
          labels.forEach((l) => l.classList.remove("correct", "incorrect"));

          // Tạo div phản hồi nếu chưa có
          let feedback = document.getElementById(`feedback-${index}`);
          if (!feedback) {
            feedback = document.createElement("div");
            feedback.id = `feedback-${index}`;
            feedback.style.marginTop = "15px";
            feedback.style.fontWeight = "bold";
            feedback.style.padding = "10px";
            feedback.style.borderRadius = "8px";
            card.appendChild(feedback);
          }
          feedback.innerHTML = "⏳ Đang đồng bộ Cloud...";
          feedback.style.background = "#f1f5f9";

          if (userVal === correctVal) {
            // --- TRƯỜNG HỢP ĐÚNG ---
            inp.nextElementSibling.classList.add("correct");
            if (btn) btn.classList.add("nav-correct");

            // Gọi Firebase trừ điểm
            updateMistakeInCloud(currentExamName, q.question, true)
              .then((remaining) => {
                // --- SỬA: Xử lý nếu gặp lỗi (-1) ---
                if (remaining === -1) {
                  feedback.style.background = "#fee2e2";
                  feedback.innerHTML = `<span style="color:#dc2626">⚠️ Lỗi kết nối! Chưa cập nhật được lên Cloud.</span>`;
                  return;
                }
                // -----------------------------------

                if (remaining > 0) {
                  feedback.style.background = "#fff7ed"; // Cam nhạt
                  feedback.innerHTML = `<span style="color:#c2410c">👏 Đúng rồi! Nhưng bạn vẫn còn nợ câu này <b>${remaining}</b> lần nữa.</span>`;
                } else {
                  feedback.style.background = "#f0fdf4"; // Xanh nhạt
                  feedback.innerHTML = `<span style="color:#16a34a">🎉 Xuất sắc! Đã xóa câu này khỏi danh sách sai trên Cloud.</span>`;
                }
              })
              .catch((err) => {
                // Phòng hờ lỗi không mong muốn
                feedback.innerHTML = "⚠️ Lỗi hệ thống. Vui lòng thử lại.";
              });
          } else {
            // --- TRƯỜNG HỢP SAI ---
            inp.nextElementSibling.classList.add("incorrect");
            if (btn) btn.classList.add("nav-incorrect");

            // Hiện đáp án đúng
            card.querySelectorAll("input").forEach((optInp) => {
              if (optInp.value === correctVal)
                optInp.nextElementSibling.classList.add("correct");
            });

            // SỬA LỖI Ở ĐÂY: Dùng updateMistakeInCloud và .then()
            updateMistakeInCloud(currentExamName, q.question, false).then(
              () => {
                feedback.style.background = "#fef2f2"; // Đỏ nhạt
                feedback.innerHTML = `<span style="color:#dc2626">⚠️ Sai rồi! Đã bị cộng thêm 1 lần phạt vào lịch sử.</span>`;
              }
            );
          }

          // Hiện giải thích
          const explainDiv = document.getElementById(`explain-${index}`);
          if (explainDiv) explainDiv.style.display = "block";
        }
      });
    });
  });

  // Render Nav List (Giữ nguyên logic cũ)
  const listEl = document.getElementById("questionList");
  listEl.innerHTML = "";
  questionsData.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.className = "qnav-item";
    btn.textContent = i + 1;
    btn.dataset.index = i;
    btn.onclick = () => {
      const card = document.querySelector(`.question-card[data-index="${i}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      if (window.innerWidth <= 850) closeQuestionNav();
    };
    listEl.appendChild(btn);
  });
}

// Hàm phụ cập nhật thanh tiến độ
function updateProgressBar() {
  const total = questionsData.length;
  if (total === 0) return;
  const answered = document.querySelectorAll(
    'input[type="radio"]:checked'
  ).length;
  const percent = (answered / total) * 100;
  const bar = document.getElementById("examProgressBar");
  if (bar) bar.style.width = `${percent}%`;
}

function grade(autoSubmit) {
  if (!questionsData.length) return;
  if (examFinished) return;

  examFinished = true;
  clearInterval(timerInterval);

  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

  let score = 0;
  document
    .querySelectorAll(".qnav-item")
    .forEach((b) => (b.className = "qnav-item"));

  // --- CHUẨN BỊ BATCH FIREBASE ---
  const batch = db.batch();
  const user = auth.currentUser;
  let hasMistakesToSave = false;
  const currentExamName = document.getElementById("examName").textContent;
  let mistakeDocRef = null;

  if (user && currentExamName) {
    const safeId = getSafeId(currentExamName);
    mistakeDocRef = db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking")
      .doc(safeId);
  }
  // -------------------------------

  questionsData.forEach((q, i) => {
    const card = document.querySelector(`.question-card[data-index="${i}"]`);
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    const navBtn = document.querySelector(`.qnav-item[data-index="${i}"]`);
    const correctText = (q.answer || "").trim();
    const userText = selected ? selected.value.trim() : "";
    const isCorrect = userText === correctText;

    // --- LƯU CÂU SAI VÀO BATCH ---
    if (!isCorrect && user && mistakeDocRef) {
      const qKey = encodeKey(q.question);
      batch.set(
        mistakeDocRef,
        {
          [qKey]: firebase.firestore.FieldValue.increment(1),
          last_updated: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      hasMistakesToSave = true;
    }
    // -----------------------------

    const opts = q.options || [];
    card.classList.remove("correct", "incorrect");
    card.querySelectorAll(".option-label").forEach((lbl, idx) => {
      if ((opts[idx] || "").trim() === correctText)
        lbl.classList.add("correct");
      if (selected && opts[idx] === userText && !isCorrect)
        lbl.classList.add("incorrect");
    });
    card.querySelectorAll("input").forEach((inp) => (inp.disabled = true));
    if (isCorrect) {
      score++;
      card.classList.add("correct");
      if (navBtn) navBtn.classList.add("nav-correct");
    } else {
      card.classList.add("incorrect");
      if (navBtn) navBtn.classList.add("nav-incorrect");
    }
  });

  // --- GỬI BATCH LÊN CLOUD ---
  if (hasMistakesToSave) {
    batch
      .commit()
      .then(() => console.log("☁️ Đã lưu các câu sai vào Firebase"));
  }
  // ---------------------------
  if (score > 0) {
    // Ví dụ: Mỗi câu đúng được 10 XP (hoặc tùy bạn chỉnh)
    // Nếu muốn khó hơn: gainXP(score * 5);
    gainXP(score * 10);
    console.log(`🎉 Đã cộng ${score * 10} XP`);
  }
  const total = questionsData.length;
  const percent = Math.round((score / total) * 100);
  let rank = percent >= 80 ? "Giỏi" : percent >= 50 ? "Khá" : "Yếu";
  if (percent >= 90) rank = "Xuất sắc";
  document.getElementById(
    "result"
  ).innerHTML = `<span style="font-size:18px;">Kết quả: <b>${score}/${total}</b> (${percent}%) - ${rank}</span>`;
  const topRes = document.getElementById("topResult");
  topRes.style.display = "block";
  topRes.textContent = `${percent}%`;
  window.scrollTo({ top: 0, behavior: "smooth" });

  saveExamResult(score, total, percent, currentExamName);
}

window.resetExam = function () {
  if (!confirm("Bạn muốn thoát bài này?")) return;
  clearInterval(timerInterval);
  examFinished = false;
  questionsData = [];
  pendingData = null;
  setHeaderMode("setup");
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
};

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
    avatar.src =
      user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`;

    // --- MỚI: TỰ ĐỘNG TẢI KEY TỪ CLOUD VỀ ---
    syncKeysFromCloud(user);
    // ----------------------------------------
  } else {
    btnLogin.style.display = "block";
    userSection.style.display = "none";
  }
});
document.getElementById("btnLogin").onclick = () =>
  auth.signInWithPopup(provider);
document.getElementById("btnLogout").onclick = () => auth.signOut();

async function saveExamResult(score, total, percent, examName) {
  const user = auth.currentUser;
  if (!user) return;
  const details = questionsData.map((q, i) => {
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    return {
      q: q.question,
      u: sel ? sel.value : "",
      a: q.answer || "",
      s: sel && sel.value === (q.answer || ""),
    };
  });
  try {
    await db
      .collection("users")
      .doc(user.uid)
      .collection("history")
      .add({
        examName: examName,
        score,
        total,
        percent,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        dateStr: new Date().toLocaleString("vi-VN"),
        details,
      });
    fetchHistoryData(user.uid);
  } catch (e) {}
}

async function fetchHistoryData(uid) {
  try {
    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("history")
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();
    globalHistoryData = [];
    snap.forEach((d) => globalHistoryData.push({ id: d.id, ...d.data() }));
  } catch (e) {}
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

    let cleanHtml = attemptData.aiAnalysis;
    // Xóa mọi thẻ <style>...</style> nếu còn sót lại trong database
    cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    aiContent.innerHTML = cleanHtml;

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

    const mistakes = (attemptData.details || []).filter((q) => !q.s);
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
  if (!selectedId) {
    alert("Vui lòng chọn lần làm bài.");
    return;
  }
  const targetAttempt = globalHistoryData.find((h) => h.id === selectedId);
  if (!targetAttempt) return;

  // 2. KIỂM TRA: Nếu đã có lời giải VÀ không ép chạy lại -> Hiện cái cũ
  if (targetAttempt.aiAnalysis && !forceUpdate) {
    renderAIContent(targetAttempt);
    return;
  }

  // 3. Lấy lỗi sai
  const mistakes = targetAttempt.details.filter((q) => !q.s);
  if (mistakes.length === 0) {
    alert("Bạn đúng 100%! Không có gì để phân tích.");
    return;
  }

  // Gửi tối đa 8 câu sai
  const limitedMistakes = mistakes.slice(0, 8);
  const mistakesJson = limitedMistakes.map((m) => ({
    question: m.q,
    userAnswer: m.u || "Bỏ trống",
    correctAnswer: m.a,
  }));

  // UI Loading
  resultBox.style.display = "block";
  if (loading) loading.style.display = "flex";
  content.innerHTML = "";

  aiBtn.disabled = true;
  aiBtn.textContent = forceUpdate
    ? "♻️ Đang tổng hợp báo cáo..."
    : "⏳ Đang phân tích chuyên sâu...";
  reAnalyzeBtn.style.display = "none";

  // --- LOGIC KEY POOL ---
  let success = false;
  let finalHtml = "";
  const candidateModels = [
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
  ];

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
          let rawHtml = result.response
            .text()
            .replace(/```html/g, "")
            .replace(/```/g, "");

          rawHtml = rawHtml.replace(/```html/g, "").replace(/```/g, "");
          rawHtml = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

          if (rawHtml.length > 50) {
            finalHtml =
              rawHtml +
              `
                        <div class="ai-model-footer">
                            ⚡ Phân tích bởi: <span class="ai-model-badge">${modelName}</span>
                            <span style="margin-left:5px;">(Key ${k + 1})</span>
                        </div>
                      `;
            success = true;
            break;
          }
        } catch (errModel) {
          console.log(`Model ${modelName} lỗi, thử tiếp...`);
        }
      }
    } catch (errKey) {
      console.error("Key lỗi:", errKey);
    }

    if (success) break;
    rotateKey();
  }

  if (success) {
    targetAttempt.aiAnalysis = finalHtml;
    try {
      const user = auth.currentUser;
      if (user && targetAttempt.id) {
        await db
          .collection("users")
          .doc(user.uid)
          .collection("history")
          .doc(targetAttempt.id)
          .update({
            aiAnalysis: finalHtml,
          });
      }
    } catch (e) {
      console.error(e);
    }

    renderAIContent(targetAttempt);
  } else {
    content.innerHTML = `<p style="color:red; text-align:center; padding:20px;">❌ Hệ thống đang bận. Vui lòng thử lại sau.</p>`;
    aiBtn.disabled = false;
    aiBtn.textContent = "Thử lại";
    if (loading) loading.style.display = "none";
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
  const ctx = document.getElementById("scoreChart").getContext("2d");

  let myHist = data.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );

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
    const scores = chartData.map((h) => h.score);
    const totals = chartData.map((h) => h.total);
    const maxQuestions = Math.max(...totals);

    if (scoreChart) {
      scoreChart.destroy();
    }
    scoreChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Số câu đúng",
            data: scores,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderWidth: 2,
            pointBackgroundColor: "#2563eb",
            pointRadius: 5,
            tension: 0.3,
            fill: true,
          },
        ],
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
            grid: { color: "#f1f5f9" },
          },
          x: { grid: { display: false } },
        },
      },
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

    aiSelect.onchange = function () {
      const selectedId = this.value;
      const selectedAttempt = myHist.find((h) => h.id === selectedId);
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
  const myHist = data.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );
  if (myHist.length === 0) {
    container.style.display = "none";
    return;
  }
  const count = myHist.length;
  const maxScore = Math.max(...myHist.map((h) => h.score));
  const avgScore = Math.round(
    myHist.reduce((a, b) => a + b.percent, 0) / count
  );
  container.style.display = "flex";
  container.innerHTML = `
    <div class="overview-item"><span class="overview-val">${count}</span><span class="overview-label">Lần làm</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val" style="color:${getMaxColor(
      maxScore
    )}">${maxScore} câu</span><span class="overview-label">Cao nhất</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val">${avgScore}%</span><span class="overview-label">Trung bình</span></div>
  `;
}
function getMaxColor(p) {
  return p >= 90 ? "#16a34a" : p >= 50 ? "#d97706" : "#dc2626";
}

window.showHistory = async function () {
  const user = auth.currentUser;
  if (!user) {
    alert("Vui lòng đăng nhập.");
    return;
  }
  const modal = document.getElementById("historyModal");
  modal.style.display = "flex";

  document.getElementById("statsList").innerHTML =
    "<p style='text-align:center; padding:20px'>⏳ Đang tải...</p>";
  document.getElementById("aiResultBox").style.display = "none";

  document.getElementById("historyOverview").style.display = "none";
  document.getElementById("chartContainer").style.display = "none";

  window.switchHistoryTab("stats");

  let targetExamName = null;
  const isExamActive =
    document.getElementById("statusPanel").style.display !== "none";
  if (isExamActive) {
    targetExamName = document.getElementById("examName").textContent;
  } else if (pendingData) {
    targetExamName = pendingData.name;
  }

  if (globalHistoryData.length === 0) await fetchHistoryData(user.uid);

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
    document.getElementById("historyModalTitle").textContent =
      "Hồ sơ học tập chung";
    document.getElementById("filterArea").style.display = "flex";
    initStatsFilter();
    renderStats("all");
    renderTimeline("all");
  }
};

window.switchHistoryTab = function (tab) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.tab-btn[onclick="window.switchHistoryTab('${tab}')"]`)
    .classList.add("active");
  document.getElementById("tabStats").style.display =
    tab === "stats" ? "block" : "none";
  document.getElementById("tabTimeline").style.display =
    tab === "timeline" ? "block" : "none";
  document.getElementById("tabChart").style.display =
    tab === "chart" ? "block" : "none";
};

function initStatsFilter() {
  const sel = document.getElementById("statsFilter");
  const names = new Set();
  globalHistoryData.forEach((i) => names.add(i.examName));
  let html = `<option value="all">-- Tất cả --</option>`;
  names.forEach((n) => (html += `<option value="${n}">${n}</option>`));
  sel.innerHTML = html;
}
window.filterStats = function () {
  const val = document.getElementById("statsFilter").value;
  renderStats(val);
  renderTimeline(val);
};

async function renderStats(filterName) {
  const list = document.getElementById("statsList");
  const user = auth.currentUser;

  if (!user) {
    list.innerHTML =
      "<p style='text-align:center; padding:20px'>Vui lòng đăng nhập.</p>";
    return;
  }

  list.innerHTML =
    "<p style='text-align:center; padding:20px'>⏳ Đang đồng bộ dữ liệu từ Cloud...</p>";

  try {
    // 1. Lấy dữ liệu (Giữ nguyên logic lấy snapshot cũ)
    let snapshot;
    const collectionRef = db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking");

    if (filterName !== "all") {
      const safeId = getSafeId(filterName);
      const doc = await collectionRef.doc(safeId).get();
      snapshot = doc.exists ? { docs: [doc] } : { docs: [] };
    } else {
      snapshot = await collectionRef.get();
    }

    if (snapshot.empty) {
      list.innerHTML = `<div style="text-align:center; padding:40px;"><p style="color:var(--success); font-weight:bold;">Sổ tay câu sai trống!</p></div>`;
      return;
    }

    // 2. Xử lý dữ liệu (UPDATE MỚI: Đọc được cả dạng số và dạng object)
    let allMistakes = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const examId = doc.id;

      Object.keys(data).forEach((key) => {
        if (key === "last_updated") return;

        let count = 0;
        let questionText = "";

        const entry = data[key];

        // --- LOGIC ĐỌC DỮ LIỆU THÔNG MINH ---
        if (typeof entry === "object" && entry !== null) {
          // Dạng mới (Câu dài): Lấy số lần từ .c và nội dung từ .t
          count = entry.c;
          questionText = entry.t;
        } else {
          // Dạng cũ (Câu ngắn): Giá trị chính là số lần
          count = entry;
          try {
            // Giải mã key để lấy lại nội dung câu hỏi
            questionText = decodeKey(key);
          } catch (e) {
            questionText = "Lỗi hiển thị câu hỏi";
          }
        }
        // -------------------------------------

        if (count > 0) {
          // Tìm đáp án đúng từ lịch sử cục bộ (nếu có)
          let foundAnswer = "Chưa có dữ liệu";
          for (let h of globalHistoryData) {
            if (h.details) {
              const qDetail = h.details.find(
                (d) => d.q.trim() === questionText.trim()
              );
              if (qDetail) {
                foundAnswer = qDetail.a;
                break;
              }
            }
          }

          allMistakes.push({
            q: questionText,
            a: foundAnswer,
            w: count,
            exam: examId,
          });
        }
      });
    });

    // 3. Sắp xếp & Render (Giữ nguyên phần render cũ của bạn)
    allMistakes.sort((a, b) => b.w - a.w);

    if (allMistakes.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:40px;"><p style="color:var(--success);">Bạn đã xóa hết nợ!</p></div>`;
      return;
    }

    let html = `<div style="padding:12px; background:#fff7ed; border:1px solid #fed7aa; color:#c2410c; margin-bottom:15px; border-radius:8px; font-size:14px;"><b>SỔ TAY CÂU SAI</b>: Còn <b>${allMistakes.length}</b> câu.</div>`;

    allMistakes.forEach((i) => {
      html += `
        <div class="weak-item">
            <div class="weak-count" style="background:#fee2e2; color:#ef4444; border-color:#fca5a5;">${i.w}</div>
            <div class="weak-content">
                <div class="weak-q">${i.q}</div>
                <div class="weak-ans" style="margin-top:5px; opacity:0.8">👉 Đáp án: <b>${i.a}</b></div>
            </div>
        </div>`;
    });

    list.innerHTML = html;
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p style='color:red;'>Lỗi: ${e.message}</p>`;
  }
}

// Cập nhật hàm gọi khi đổi tab (để chuyển thành async)
window.filterStats = function () {
  const val = document.getElementById("statsFilter").value;
  renderStats(val);
  // Timeline vẫn giữ nguyên logic cũ (lấy từ history)
  renderTimeline(val);
};

function renderTimeline(filterName) {
  const list = document.getElementById("timelineList");
  let data = globalHistoryData;
  if (filterName !== "all") {
    data = data.filter(
      (i) => i.examName === filterName || i.examName.includes(filterName)
    );
  }
  if (!data.length) {
    list.innerHTML =
      "<p style='text-align:center; padding:20px; color:#64748b;'>Chưa có lịch sử làm bài nào.</p>";
    return;
  }
  let html = "";
  data.forEach((d) => {
    let scoreColor = "#16a34a";
    if (d.percent < 50) scoreColor = "#dc2626";
    else if (d.percent < 80) scoreColor = "#d97706";
    let detailsHtml = "";
    if (d.details && Array.isArray(d.details)) {
      detailsHtml = d.details
        .map((q, idx) => {
          const isRight = q.s;
          return `<div class="hist-q-item ${
            isRight ? "hist-correct" : "hist-wrong"
          }"><div class="hist-q-text"><span style="font-weight:bold; color:${
            isRight ? "#16a34a" : "#dc2626"
          }">Câu ${idx + 1}:</span> ${q.q}</div><div class="hist-user-ans">${
            isRight ? "✅" : "❌"
          } Bạn chọn: <b>${q.u || "(Bỏ trống)"}</b></div>${
            !isRight
              ? `<div class="hist-correct-ans">👉 Đáp án đúng: <b>${q.a}</b></div>`
              : ""
          }</div>`;
        })
        .join("");
    }
    html += `<div class="history-card-wrapper" id="card-${
      d.id
    }"><div class="history-summary" onclick="window.toggleHistoryDetail('${
      d.id
    }')"><div class="hist-left"><div class="hist-name">${
      d.examName
    }</div><div class="hist-date">${
      d.dateStr
    }</div></div><div class="hist-right"><div style="text-align:right; margin-right:8px;"><div class="hist-score" style="color:${scoreColor}">${
      d.score
    }/${
      d.total
    }</div><div class="hist-percent" style="background:${scoreColor}">${
      d.percent
    }%</div></div><div class="hist-arrow">▼</div></div></div><div id="detail-${
      d.id
    }" class="history-details-box" style="display:none;">${
      detailsHtml ||
      '<p style="padding:10px; text-align:center;">Không có dữ liệu chi tiết.</p>'
    }</div></div>`;
  });
  list.innerHTML = html;
}
window.toggleHistoryDetail = function (id) {
  const detailEl = document.getElementById(`detail-${id}`);
  const cardEl = document.getElementById(`card-${id}`);
  const arrowEl = cardEl.querySelector(".hist-arrow");
  if (detailEl.style.display === "none") {
    detailEl.style.display = "block";
    cardEl.classList.add("active");
    if (arrowEl) arrowEl.style.transform = "rotate(180deg)";
  } else {
    detailEl.style.display = "none";
    cardEl.classList.remove("active");
    if (arrowEl) arrowEl.style.transform = "rotate(0deg)";
  }
};

async function checkCurrentExamHistorySummary(examName) {
  const user = auth.currentUser;
  const summaryEl = document.getElementById("examHistorySummary");
  if (!summaryEl || !user || !examName) return;
  summaryEl.style.display = "none";
  await fetchHistoryData(user.uid);
  const myHist = globalHistoryData.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );
  if (myHist.length > 0) {
    const maxScore = Math.max(...myHist.map((h) => h.percent));
    const count = myHist.length;
    summaryEl.style.display = "flex";
    summaryEl.innerHTML = `<div><span style="font-size:18px;">🎓</span> Bạn đã làm đề <b>"${examName}"</b> tổng cộng <b>${count}</b> lần. Thành tích tốt nhất: <b style="color:${getMaxColor(
      maxScore
    )}">${maxScore}%</b>.</div><u onclick="window.showHistory()" style="cursor:pointer; font-weight:600; margin-left:15px; white-space:nowrap;">Xem chi tiết</u>`;
  }
}

// ========================
// EVENTS (SỰ KIỆN KHỞI CHẠY)
// ========================
document.addEventListener("DOMContentLoaded", () => {
  // 1. Gán sự kiện cho các nút cơ bản
  document.getElementById("fileInput").onchange = window.loadFileFromLocal;
  document.getElementById("btnSelectDrive").onclick =
    window.chooseExamFromDriveFolder;
  document.getElementById("btnStart").onclick = window.startExamNow;
  document.getElementById("btnReset").onclick = window.resetExam;

  // 2. Sự kiện Sidebar Chế độ học (ĐÃ SỬA LỖI Ở ĐÂY)
  const studyOverlay = document.getElementById("studyOverlay");
  const btnOpenStudy = document.getElementById("btnOpenStudy");
  const btnCloseStudy = document.getElementById("btnCloseStudy");

  if (btnOpenStudy) {
    btnOpenStudy.onclick = () => {
      studyOverlay.classList.add("open");
    };
  }
  if (btnCloseStudy)
    btnCloseStudy.onclick = () => studyOverlay.classList.remove("open");
  if (studyOverlay) {
    studyOverlay.onclick = (e) => {
      if (e.target === studyOverlay) studyOverlay.classList.remove("open");
    };
  }

  // 3. Sự kiện Modal Drive
  const closeDriveBtn = document.getElementById("btnCloseDrive");
  if (closeDriveBtn) {
    closeDriveBtn.onclick = () => {
      document.getElementById("driveModal").style.display = "none";
    };
  }
  const driveModal = document.getElementById("driveModal");
  if (driveModal) {
    driveModal.onclick = (e) => {
      if (e.target === driveModal) driveModal.style.display = "none";
    };
  }

  // 4. Sự kiện Nộp bài
  const handleSubmission = () => {
    if (examFinished) return;
    if (!questionsData || questionsData.length === 0) return;
    const answeredCount = document.querySelectorAll(
      'input[type="radio"]:checked'
    ).length;
    const total = questionsData.length;
    const unanswer = total - answeredCount;
    let msg = "Bạn có chắc chắn muốn nộp bài không?";
    if (unanswer > 0) {
      msg = `Bạn còn ${unanswer} câu chưa chọn đáp án.\nBạn có chắc chắn muốn nộp bài không?`;
    }
    if (confirm(msg)) {
      grade(false);
      // Thu gọn header trên mobile sau khi nộp
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

  // 5. Các sự kiện UI khác
  document.getElementById("btnViewHistory").onclick = window.showHistory;
  document.getElementById("btnCloseHistory").onclick = () =>
    (document.getElementById("historyModal").style.display = "none");
  document.getElementById("btnToggleNavMobile").onclick =
    window.openQuestionNav;
  document.getElementById("questionNavCloseBtn").onclick =
    window.closeQuestionNav;
  document.getElementById("questionNavOverlay").onclick = (e) => {
    if (e.target.id === "questionNavOverlay") window.closeQuestionNav();
  };
  document.getElementById("btnToggleNavMobileInHeader").onclick =
    window.openQuestionNav;

  // 6. Toggle Header Mobile
  const header = document.getElementById("mainHeader");
  const toggleBtn = document.getElementById("btnToggleHeaderMobile");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      header.classList.toggle("header-hidden");
      if (header.classList.contains("header-hidden")) {
        toggleBtn.textContent = "▼";
        toggleBtn.title = "Hiện thanh công cụ";
      } else {
        toggleBtn.textContent = "▲";
        toggleBtn.title = "Ẩn thanh công cụ";
      }
    };
  }

  // 7. Toggle AI Expanded
  const aiBox = document.getElementById("aiResultBox");
  const expandBtn = document.getElementById("btnExpandAI");
  const closeExpandedBtn = document.getElementById("btnCloseExpanded");
  const aiSectionParent = document.getElementById("aiSection");

  if (closeExpandedBtn) closeExpandedBtn.textContent = "✕";

  const toggleExpand = () => {
    const isExpanded = aiBox.classList.contains("expanded");
    if (!isExpanded) {
      document.body.appendChild(aiBox);
      requestAnimationFrame(() => {
        aiBox.classList.add("expanded");
        document.body.classList.add("ai-open");
      });
      if (expandBtn) expandBtn.style.display = "none";
    } else {
      aiBox.classList.remove("expanded");
      aiBox.classList.remove("is-loading");
      document.body.classList.remove("ai-open");
      aiSectionParent.appendChild(aiBox);
      if (expandBtn) expandBtn.style.display = "block";
    }
  };

  if (expandBtn) expandBtn.onclick = toggleExpand;
  if (closeExpandedBtn) closeExpandedBtn.onclick = toggleExpand;
  if (aiBox) {
    aiBox.onclick = (e) => {
      if (aiBox.classList.contains("expanded")) {
        if (e.target === aiBox) toggleExpand();
      } else {
        if (!e.target.classList.contains("btn-close-ai-expanded"))
          toggleExpand();
      }
    };
  }

  // 8. Các nút chức năng AI
  document.getElementById("btnAnalyzeAI").onclick = () =>
    analyzeWithGemini(false);
  const btnRe = document.getElementById("btnReAnalyzeAI");
  if (btnRe) {
    btnRe.onclick = () => {
      if (
        confirm(
          "Bạn có chắc muốn chạy lại AI không?\n(Sẽ tốn thêm 1 lượt dùng trong ngày)"
        )
      ) {
        analyzeWithGemini(true);
      }
    };
  }

  // 9. Nút cài đặt Key
  const btnSetupKey = document.createElement("button");
  btnSetupKey.className = "btn-icon-small";
  btnSetupKey.textContent = "🔑";
  btnSetupKey.onclick = promptForKeys;
  const aiHeaderTitle = document.querySelector(".ai-header h4");
  if (aiHeaderTitle) aiHeaderTitle.appendChild(btnSetupKey);

  // 10. Dark Mode Logic
  const btnDark = document.getElementById("btnToggleDark");
  if (btnDark) {
    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
      btnDark.textContent = "☀️";
    }
    btnDark.onclick = () => {
      document.body.classList.toggle("dark-mode");
      const isDark = document.body.classList.contains("dark-mode");
      btnDark.textContent = isDark ? "☀️" : "🌙";
      localStorage.setItem("darkMode", isDark);
    };
  }

  updateFileStatus("", false);
}); // --- KẾT THÚC DOMContentLoaded ---

// ==========================================
// CÁC HÀM LOGIC TOÀN CỤC (WINDOW FUNCTIONS)
// Để ở ngoài cùng để HTML gọi được
// ==========================================

// ==========================================
// LOGIC FLASHCARD (CHẾ ĐỘ 1 CÂU - SINGLE VIEW)
// ==========================================

let currentFcIndex = 0; // Biến theo dõi câu hiện tại

// 1. Chế độ: FLASHCARD
window.startFlashcardMode = function () {
  // --- FIX: Tự động nạp dữ liệu từ file vừa chọn nếu chưa bấm Start ---
  if ((!questionsData || questionsData.length === 0) && pendingData) {
    // Clone dữ liệu từ pendingData sang questionsData
    questionsData = pendingData.data.map((q) => ({
      ...q,
      options: Array.isArray(q.options) ? [...q.options] : [],
    }));
    // Xáo trộn đề ngay lập tức để học ngẫu nhiên
    shuffleArray(questionsData);
    questionsData.forEach((q) => {
      if (Array.isArray(q.options)) shuffleArray(q.options);
    });
    // Cập nhật tên đề
    document.getElementById("examName").textContent = pendingData.name;
  }
  // -----------------------------------------------------------------------

  // Kiểm tra lại lần nữa
  if (!questionsData || questionsData.length === 0) {
    alert(
      "Bạn chưa chọn đề thi nào! Vui lòng Tải file hoặc chọn từ Drive trước."
    );
    return;
  }

  document.getElementById("studyOverlay").classList.remove("open");

  if (
    !confirm("Bắt đầu chế độ Flashcard?\n(Giao diện tập trung, mỗi lần 1 câu)")
  )
    return;

  // Setup dữ liệu
  isReviewMode = true;
  examFinished = false;
  currentFcIndex = 0;

  // Xáo trộn lại lần nữa
  shuffleArray(questionsData);

  // UI Updates
  document.getElementById("quiz").style.display = "none"; // Ẩn danh sách cũ
  document.getElementById("flashcardContainer").style.display = "flex"; // Hiện Flashcard

  // Nếu tên đề chưa có (do chưa bấm Start), lấy từ pendingData hoặc đặt mặc định
  if (
    document.getElementById("examName").textContent === "Đang tải..." &&
    pendingData
  ) {
    document.getElementById("examName").textContent = pendingData.name;
  } else if (
    document.getElementById("examName").textContent === "Đang tải..."
  ) {
    document.getElementById("examName").textContent = "⚡ FLASHCARD MODE";
  }

  setHeaderMode("active");
  document.getElementById("timer").textContent = "∞"; // Không tính giờ
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

  // Render câu đầu tiên
  renderFlashcard();
};

// 2. Render câu hỏi hiện tại
window.renderFlashcard = function () {
  const container = document.getElementById("fcCard");
  const q = questionsData[currentFcIndex];
  const total = questionsData.length;

  // Cập nhật số trang
  document.getElementById("fcCurrent").textContent = currentFcIndex + 1;
  document.getElementById("fcTotal").textContent = total;

  // Disable nút Prev nếu là câu 1, Next nếu là câu cuối
  document.getElementById("btnFcPrev").disabled = currentFcIndex === 0;
  document.getElementById("btnFcNext").textContent =
    currentFcIndex === total - 1 ? "Hoàn thành 🏁" : "Câu tiếp ➡";

  // HTML Nội dung thẻ
  let html = `<div class="fc-question-text">${q.question}</div>
              <div class="fc-options">`;

  const letters = ["A", "B", "C", "D", "E", "F"];
  (q.options || []).forEach((opt, i) => {
    // Lưu ý: Dùng onclick để gọi hàm xử lý chọn
    html += `
      <div class="fc-option-item" onclick="handleFlashcardSelect(this, '${i}')">
          <span style="font-weight:bold; color:var(--primary); min-width:25px">${letters[i]}.</span>
          <span>${opt}</span>
      </div>`;
  });
  html += `</div>`;

  // Thêm vùng giải thích (ẩn mặc định)
  html += `<div id="fcExplain" class="review-explain" style="display:none; margin-top:20px;">
              <b>💡 Giải thích:</b> ${
                q.explain || "Không có giải thích chi tiết."
              }
           </div>`;

  container.innerHTML = html;

  // Hiệu ứng Fade In nhẹ
  container.style.opacity = 0;
  setTimeout(() => (container.style.opacity = 1), 50);
};

// 3. Xử lý khi chọn đáp án
window.handleFlashcardSelect = function (el, optIndex) {
  // Chặn click nếu đã chọn rồi (để tránh spam)
  if (
    document.querySelector(".fc-option-item.correct") ||
    document.querySelector(".fc-option-item.incorrect")
  ) {
    return;
  }

  const q = questionsData[currentFcIndex];
  const userVal = (q.options[optIndex] || "").trim();
  const correctVal = (q.answer || "").trim();
  const currentExamName = pendingData ? pendingData.name : "Flashcard Session"; // Lấy tên đề gốc

  const allOpts = document.querySelectorAll(".fc-option-item");

  // Xử lý đúng sai
  if (userVal === correctVal) {
    // ĐÚNG
    el.classList.add("correct");

    // Gọi Firebase trừ điểm
    updateMistakeInCloud(currentExamName, q.question, true).then(
      (remaining) => {
        showFcFeedback(true, remaining);
      }
    );
  } else {
    // SAI
    el.classList.add("incorrect");

    // Tìm và hiện đáp án đúng
    allOpts.forEach((optEl) => {
      const text = optEl.querySelector("span:last-child").textContent;
      if (text.trim() === correctVal) {
        optEl.classList.add("correct");
      }
    });

    // Gọi Firebase cộng điểm
    updateMistakeInCloud(currentExamName, q.question, false).then(() => {
      showFcFeedback(false);
    });
  }

  // Hiện giải thích
  document.getElementById("fcExplain").style.display = "block";
};

// 4. Hiển thị thông báo phản hồi dưới thẻ
function showFcFeedback(isCorrect, remaining = 0) {
  let div = document.createElement("div");
  div.className = "fc-feedback";

  if (isCorrect) {
    if (remaining > 0) {
      div.style.background = "#fff7ed";
      div.style.color = "#c2410c";
      div.innerHTML = `👏 Đúng rồi! Còn nợ <b>${remaining}</b> lần nữa.`;
    } else {
      div.style.background = "#f0fdf4";
      div.style.color = "#16a34a";
      div.innerHTML = `🎉 Xuất sắc! Đã xóa khỏi danh sách câu sai.`;
    }
  } else {
    div.style.background = "#fef2f2";
    div.style.color = "#dc2626";
    div.innerHTML = `⚠️ Sai rồi! Đã ghi nhớ lỗi này vào hệ thống.`;
  }

  document.getElementById("fcCard").appendChild(div);
}

// 5. Điều hướng
window.nextFlashcard = function () {
  if (currentFcIndex < questionsData.length - 1) {
    currentFcIndex++;
    renderFlashcard();
  } else {
    if (confirm("Bạn đã hoàn thành bộ Flashcard! Quay lại màn hình chính?")) {
      window.exitFlashcardMode();
    }
  }
};

window.prevFlashcard = function () {
  if (currentFcIndex > 0) {
    currentFcIndex--;
    renderFlashcard();
  }
};

// 6. Thoát chế độ Flashcard
window.exitFlashcardMode = function () {
  document.getElementById("flashcardContainer").style.display = "none";
  document.getElementById("quiz").style.display = "block";
  document.getElementById("examName").textContent = pendingData
    ? pendingData.name
    : "Đề thi";
  setHeaderMode("setup");

  // Reset lại đề thi về trạng thái ban đầu (để làm bài thi thật nếu muốn)
  window.resetExam();
};

// 2. Chế độ: LUYỆN TẬP TRUNG (Câu sai từ lịch sử)
window.startWeaknessReview = function () {
  if (!globalHistoryData || globalHistoryData.length === 0) {
    alert("Bạn chưa có lịch sử làm bài. Hãy làm thử vài đề trước!");
    return;
  }
  document.getElementById("studyOverlay").classList.remove("open");

  let wrongQuestionsMap = {};
  globalHistoryData.forEach((exam) => {
    if (exam.details) {
      exam.details.forEach((d) => {
        if (!d.s) {
          wrongQuestionsMap[d.q.trim()] = {
            question: d.q,
            answer: d.a,
            explain: "Ôn tập lại câu sai từ quá khứ",
          };
        }
      });
    }
  });

  const weakList = Object.values(wrongQuestionsMap);
  if (weakList.length === 0) {
    alert("Tuyệt vời! Bạn không có câu sai nào trong lịch sử.");
    return;
  }

  if (
    !confirm(
      `Tìm thấy ${weakList.length} câu bạn từng làm sai.\nBạn có muốn ôn tập lại không?`
    )
  )
    return;

  questionsData = weakList.map((item) => {
    return {
      question: item.question,
      options: [
        item.answer,
        "Đáp án sai 1",
        "Đáp án sai 2",
        "Đáp án sai 3",
      ].sort(() => Math.random() - 0.5),
      answer: item.answer,
      explain: item.explain,
    };
  });

  isReviewMode = true;
  examFinished = false;
  document.getElementById("examName").textContent =
    "🧠 Ôn tập câu sai (Tổng hợp)";
  setHeaderMode("active");
  document.getElementById("timer").textContent = "ÔN TẬP";
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("result").innerHTML =
    "<b style='color:#22c55e'>🧠 LUYỆN TẬP TRUNG</b>";
  generateQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// 3. Chế độ: Ôn câu sai (Spaced Repetition - Cloud Version)
window.startReviewMistakes = async function () {
  const user = auth.currentUser;
  if (!user) {
    alert("⚠️ Bạn cần Đăng nhập để dùng tính năng đồng bộ này!");
    return;
  }

  // 1. Xác định đề thi
  let examName = "";
  if (pendingData) examName = pendingData.name;
  else if (document.getElementById("examName").textContent !== "Đang tải...") {
    examName = document.getElementById("examName").textContent;
  }

  if (!examName) {
    alert(
      "Vui lòng chọn một đề thi trước để hệ thống biết bạn muốn ôn đề nào."
    );
    return;
  }

  // UI Loading
  const btnStart = document.querySelector(
    "#studyOverlay .study-card:first-child"
  );
  const oldText = btnStart.innerHTML;
  btnStart.innerHTML = "⏳ Đang tải từ Cloud...";

  // 2. Tải danh sách lỗi từ Firebase
  const mistakeData = await fetchMistakesFromCloud(examName);
  const mistakeKeys = Object.keys(mistakeData).filter(
    (k) => k !== "last_updated"
  );

  // Reset UI
  btnStart.innerHTML = oldText;
  document.getElementById("studyOverlay").classList.remove("open");

  if (mistakeKeys.length === 0) {
    alert(`Tuyệt vời! Bạn không có câu sai nào được lưu cho đề "${examName}".`);
    return;
  }

  if (
    !confirm(
      `☁️ Cloud: Tìm thấy ${mistakeKeys.length} câu bạn chưa thuộc trong đề "${examName}".\nBạn có muốn ôn lại ngay không?`
    )
  )
    return;

  // 3. Lấy nội dung câu hỏi từ dữ liệu gốc
  if (!pendingData || !pendingData.data) {
    alert("Vui lòng nạp lại file đề gốc để hệ thống lấy nội dung câu hỏi.");
    return;
  }

  // Lọc câu hỏi: So sánh mã hóa Base64
  const reviewQuestions = pendingData.data.filter((q) => {
    const key = encodeKey(q.question);
    return mistakeData[key] > 0;
  });

  if (reviewQuestions.length === 0) {
    alert(
      "Lỗi: Dữ liệu trên Cloud không khớp với file đề hiện tại.\n(Có thể nội dung câu hỏi trong file đã bị sửa?)"
    );
    return;
  }

  // 4. Bắt đầu ôn tập
  questionsData = reviewQuestions.map((q) => ({
    ...q,
    options: shuffleArray([...q.options]),
  }));

  isReviewMode = true;
  examFinished = false;
  document.getElementById("examName").textContent = examName;
  setHeaderMode("active");

  document.getElementById("timer").textContent = "CLOUD";
  document.getElementById(
    "result"
  ).innerHTML = `<b style='color:#ea580c'>🔥 CÒN ${questionsData.length} CÂU CẦN KHẮC PHỤC</b>`;
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

  generateQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ==========================================
// HỆ THỐNG GAMIFICATION (LEVEL & STREAK 2.0)
// ==========================================

let userStats = {
  xp: 0, // XP tích lũy hiện tại (trong cấp này)
  level: 1, // Cấp độ hiện tại
  streak: 0, // Chuỗi ngày
  lastStudyDate: null, // Ngày học cuối "YYYY-MM-DD"
};

// 1. TÍNH ĐỘ KHÓ: Càng lên cao càng cần nhiều XP
// Công thức: XP cần = Level hiện tại * 500
// VD: Lv1->Lv2 cần 500XP. Lv2->Lv3 cần 1000XP.
function getRequiredXP(level) {
  return level * 500;
}

// 2. Khởi tạo & Tải dữ liệu từ Cloud
async function initGamification() {
  const user = auth.currentUser;
  if (!user) return;

  const docRef = db.collection("users").doc(user.uid);
  try {
    const doc = await docRef.get();
    if (doc.exists) {
      const data = doc.data();
      if (data.gamification) {
        userStats = { ...userStats, ...data.gamification };
      }
    }
    checkStreakLogic(); // Kiểm tra xem có bị mất chuỗi không
    updateGamificationUI();
  } catch (e) {
    console.error("Lỗi tải Gamification:", e);
  }
}

// 3. Logic Streak (Giữ lửa)
function checkStreakLogic() {
  const today = new Date().toISOString().split("T")[0];

  if (userStats.lastStudyDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Nếu ngày học cuối KHÔNG PHẢI là hôm qua (tức là đã bỏ > 1 ngày) -> Reset về 0
    if (userStats.lastStudyDate && userStats.lastStudyDate < yesterdayStr) {
      userStats.streak = 0;
    }
  }
}

// 4. HÀM CỘNG ĐIỂM (Gọi khi nộp bài)
async function gainXP(amount) {
  const user = auth.currentUser;
  if (!user) return;

  userStats.xp += amount;

  // Logic thăng cấp (Level Up Loop)
  // Dùng vòng lặp để xử lý trường hợp cộng nhiều XP thăng vài cấp 1 lúc
  let leveledUp = false;
  while (true) {
    const required = getRequiredXP(userStats.level);
    if (userStats.xp >= required) {
      userStats.xp -= required; // Trừ đi XP đã dùng để thăng cấp
      userStats.level++;
      leveledUp = true;
    } else {
      break;
    }
  }

  if (leveledUp) {
    alert(
      `🎉 CHÚC MỪNG! Bạn đã thăng lên Cấp ${
        userStats.level
      }!\nĐộ khó cấp tiếp theo: ${getRequiredXP(userStats.level)} XP`
    );
  }

  // Cập nhật Streak (Nếu hôm nay chưa tính)
  const today = new Date().toISOString().split("T")[0];
  if (userStats.lastStudyDate !== today) {
    userStats.streak++;
    userStats.lastStudyDate = today;

    // Hiệu ứng phóng to Lửa
    const fireBadge = document.querySelector(".streak-badge");
    if (fireBadge) {
      fireBadge.style.transform = "scale(1.3)";
      setTimeout(() => (fireBadge.style.transform = "scale(1)"), 400);
    }
  }

  updateGamificationUI();

  // Lưu Cloud
  try {
    await db.collection("users").doc(user.uid).set(
      {
        gamification: userStats,
      },
      { merge: true }
    );
  } catch (e) {
    console.error(e);
  }
}

// 5. Cập nhật giao diện (PHIÊN BẢN: SLIM & INTENSE)
// 5. Cập nhật giao diện (PHIÊN BẢN: ULTIMATE ANIMATION)
function updateGamificationUI() {
  const panel = document.getElementById("gamificationPanel");
  const lvEl = document.getElementById("userLevel");
  const strEl = document.getElementById("streakCount");

  if (!lvEl || !strEl) return;

  lvEl.textContent = userStats.level;
  strEl.textContent = userStats.streak;

  const required = getRequiredXP(userStats.level);
  const percent = Math.min((userStats.xp / required) * 100, 100);

  document.getElementById("currentXP").textContent = `${userStats.xp} XP`;
  document.getElementById("requiredXP").textContent = `/ ${required} XP`;
  document.getElementById("xpBar").style.width = `${percent}%`;

  // --- LOGIC PHÂN CẤP (TIER SYSTEM) ---
  // Tự động đổi giao diện dựa trên Level
  let rankClass = "rank-1";
  let rankName = "Tân Binh";

  // MỐC LEVEL:
  // 1-9: Rank 1
  // 10-29: Rank 2 (Elite)
  // 30-49: Rank 3 (Master - Lửa)
  // 50+: Rank 4 (Legendary - RGB)

  if (userStats.level >= 50) {
    rankClass = "rank-4";
    rankName = "⚔️ HUYỀN THOẠI ⚔️";
  } else if (userStats.level >= 30) {
    rankClass = "rank-3";
    rankName = "🔥 ĐẠI SƯ 🔥";
  } else if (userStats.level >= 10) {
    rankClass = "rank-2";
    rankName = "✨ TINH ANH";
  }

  // Reset class cũ và gán class mới
  panel.className = "user-stats-card";
  panel.classList.add(rankClass);

  // Hiệu ứng Streak cao: Nếu chuỗi > 3 ngày, thêm class cháy mạnh
  if (userStats.streak >= 3) {
    document.querySelector(".fire-icon").style.animationDuration = "0.8s"; // Tim đập nhanh hơn
  } else {
    document.querySelector(".fire-icon").style.animationDuration = "1.5s";
  }

  // Cập nhật tên danh hiệu
  const titleEl = document.getElementById("levelTitle");
  titleEl.textContent = rankName;
}

// Khởi chạy khi login
auth.onAuthStateChanged((user) => {
  if (user) initGamification();
});
