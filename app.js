// ========================
// BIẾN TOÀN CỤC
// ========================

let questionsData = [];
let timerInterval = null;
let remainingSeconds = 0;
let examFinished = false;
let examTotalSeconds = 0; // để tính thời gian làm thực tế

// ========================
// GOOGLE DRIVE PICKER CONFIG
// ========================

const API_KEY = "AIzaSyAry4xCdznJGeWvTi1NtId0q6YgPfZdwrg";
const CLIENT_ID = "196533752702-und50rlogf3m1lqi93g8tomojj2t29oo.apps.googleusercontent.com";
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
let oauthToken = null;

// ========================
// TIỆN ÍCH
// ========================

let headerCollapsed = false;

function setHeaderCollapsed(collapse) {
  const headerEl = document.querySelector(".exam-header");
  const toggleBtn = document.getElementById("headerToggle");
  if (!headerEl || !toggleBtn) return;

  headerCollapsed = collapse;

  if (collapse) {
    headerEl.classList.add("header-collapsed");
    toggleBtn.textContent = "▼"; // đang thu, bấm để mở
  } else {
    headerEl.classList.remove("header-collapsed");
    toggleBtn.textContent = "▲"; // đang mở, bấm để thu
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateTimerDisplay() {
  const timerEl = document.getElementById("timer");
  timerEl.textContent = formatTime(remainingSeconds);

  timerEl.className = "timer"; // reset base class

  if (remainingSeconds <= 0) {
    timerEl.classList.add("timer-danger");
    return;
  }

  const timeInput = document.getElementById("timeInput");
  const totalMinutes = parseInt(timeInput.value) || 15;
  const total = totalMinutes * 60;
  const ratio = remainingSeconds / total;

  if (ratio > 0.5) {
    timerEl.classList.add("timer-ok");
  } else if (ratio > 0.2) {
    timerEl.classList.add("timer-warn");
  } else {
    timerEl.classList.add("timer-danger");
  }
}

// ========================
// TIMER
// ========================

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  const timeInput = document.getElementById("timeInput");
  let minutes = parseInt(timeInput.value);

  if (isNaN(minutes) || minutes <= 0) {
    minutes = 15;
    timeInput.value = 15;
  }

  examTotalSeconds = minutes * 60;
  remainingSeconds = examTotalSeconds;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      if (!examFinished) {
        grade(true); // auto nộp
      }
      return;
    }
    remainingSeconds--;
    updateTimerDisplay();
  }, 1000);
}

// ========================
// LOAD FILE CÂU HỎI TỪ LOCAL
// ========================
function applyExamData(data, examNameLabel) {
  if (!Array.isArray(data) || data.length === 0) {
    alert("File không đúng định dạng hoặc không có câu hỏi!");
    return;
  }

  questionsData = data;
  examFinished = false;

  // tên bài thi
  const examNameEl = document.getElementById("examName");
  if (examNameEl) {
    examNameEl.textContent = examNameLabel || "Bài thi trắc nghiệm";
    examNameEl.style.display = "block";
  }

  generateQuiz();
  startTimer();

  setHeaderCollapsed(true); // tạo đề xong thì thu gọn header

  document.getElementById("result").textContent = "";
  document.getElementById("noteArea").textContent =
    "Bài thi đã bắt đầu. Đừng quên nộp bài trước khi hết giờ!";
  const btnGrade = document.getElementById("btnGrade");
  if (btnGrade) btnGrade.style.display = "inline-flex";

  const topResultEl = document.getElementById("topResult");
  if (topResultEl) {
    topResultEl.style.display = "none";
    topResultEl.textContent = "";
    topResultEl.classList.remove("bad");
  }
}

function loadFile() {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) {
    alert("Vui lòng chọn file .json chứa câu hỏi trước!");
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const fileName = file.name ? file.name.replace(/\.json$/i, "") : "Đề thi từ file";
      applyExamData(data, "Bài thi: " + fileName);
    } catch (err) {
      console.error(err);
      alert("Lỗi đọc file. Hãy kiểm tra lại định dạng JSON.");
    }
  };
  reader.readAsText(file);
}

// ========================
// GOOGLE DRIVE PICKER
// ========================

function initAuthAndPicker() {
  if (!window.gapi) {
    alert("Google API chưa tải xong. Hãy tải lại trang và thử lại.");
    return;
  }

  gapi.load("client:auth2", () => {
    gapi.auth2
      .init({
        client_id: CLIENT_ID,
        scope: SCOPES.join(" "),
      })
      .then(() => {
        const auth = gapi.auth2.getAuthInstance();
        auth.signIn().then((googleUser) => {
          oauthToken = googleUser.getAuthResponse().access_token;
          openPicker();
        });
      });
  });
}

function openPicker() {
  gapi.load("picker", () => {
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes("application/json");

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(oauthToken)
      .setDeveloperKey(API_KEY)
      .addView(view)
      .setCallback(pickerCallback)
      .build();

    picker.setVisible(true);
  });
}

function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const file = data.docs[0];
    const fileId = file.id;
    const fileName = file.name || "Đề thi từ Google Drive";
    loadJsonFromDrive(fileId, fileName);
  }
}

function loadJsonFromDrive(fileId, fileName) {
  fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: "Bearer " + oauthToken },
  })
    .then((r) => r.json())
    .then((json) => {
      applyExamData(json, "Bài thi (Drive): " + fileName);
    })
    .catch((err) => {
      console.error(err);
      alert("Không đọc được file từ Google Drive. Kiểm tra lại quyền chia sẻ và định dạng JSON.");
    });
}

// ========================
// RENDER BẢNG SỐ CÂU
// ========================

function renderQuestionNav() {
  const listEl = document.getElementById("questionList");
  if (!listEl) return;

  listEl.innerHTML = "";

  questionsData.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.className = "qnav-item";
    btn.textContent = i + 1;
    btn.dataset.index = String(i);

    btn.addEventListener("click", () => {
      const card = document.querySelector(`.question-card[data-index="${i}"]`);
      if (card) {
        card.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        card.classList.add("jump-highlight");
        setTimeout(() => card.classList.remove("jump-highlight"), 800);
      }
    });

    listEl.appendChild(btn);
  });
}

// ========================
// TẠO GIAO DIỆN CÂU HỎI
// ========================

function generateQuiz() {
  const quizDiv = document.getElementById("quiz");
  quizDiv.innerHTML = "";

  questionsData.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.index = String(index);

    const header = document.createElement("div");
    header.className = "question-header";

    const number = document.createElement("div");
    number.className = "question-number";
    number.textContent = "CÂU " + (index + 1);

    const meta = document.createElement("div");
    meta.className = "question-meta";
    meta.textContent = q.meta || "";

    header.appendChild(number);
    header.appendChild(meta);

    const text = document.createElement("div");
    text.className = "question-text";
    text.textContent = q.question;

    const optionsDiv = document.createElement("div");
    optionsDiv.className = "options";

    q.options.forEach((opt, i) => {
      const optId = `q${index}_opt_${i}`;
      const wrapper = document.createElement("div");
      wrapper.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "q" + index;
      input.value = opt.key;
      input.id = optId;
      input.className = "option-input";

      const label = document.createElement("label");
      label.setAttribute("for", optId);
      label.className = "option-label";

      const bullet = document.createElement("div");
      bullet.className = "option-bullet";

      const bulletInner = document.createElement("div");
      bulletInner.className = "option-bullet-inner";
      bullet.appendChild(bulletInner);

      const textSpan = document.createElement("div");
      textSpan.className = "option-text";
      textSpan.textContent = `${opt.key}. ${opt.text}`;

      label.appendChild(bullet);
      label.appendChild(textSpan);

      wrapper.appendChild(input);
      wrapper.appendChild(label);
      optionsDiv.appendChild(wrapper);
    });

    const feedback = document.createElement("div");
    feedback.className = "feedback";
    feedback.id = `feedback-${index}`;

    card.appendChild(header);
    card.appendChild(text);
    card.appendChild(optionsDiv);
    card.appendChild(feedback);

    quizDiv.appendChild(card);
  });

  renderQuestionNav();
}

// ========================
// XẾP LOẠI
// ========================

function getRank(percent) {
  if (percent >= 90) return "Xuất sắc";
  if (percent >= 80) return "Giỏi";
  if (percent >= 65) return "Khá";
  if (percent >= 50) return "Trung bình";
  return "Yếu";
}

// ========================
// CHẤM ĐIỂM
// ========================

function grade(autoSubmit) {
  if (!questionsData || questionsData.length === 0) return;

  examFinished = true;
  if (timerInterval) clearInterval(timerInterval);

  let score = 0;

  // reset màu nav
  const navItems = document.querySelectorAll(".qnav-item");
  navItems.forEach((btn) => {
    btn.classList.remove("nav-correct", "nav-incorrect");
  });

  questionsData.forEach((q, i) => {
    const card = document.querySelector(`.question-card[data-index="${i}"]`);
    if (!card) return;
    card.classList.remove("correct", "incorrect");

    const feedbackEl = document.getElementById(`feedback-${i}`);
    if (!feedbackEl) return;
    feedbackEl.className = "feedback";
    feedbackEl.textContent = "";

    const optionsWrapper = card.querySelectorAll(".option");
    optionsWrapper.forEach((wrap) => {
      const label = wrap.querySelector(".option-label");
      label.classList.remove("correct", "incorrect");
    });

    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    const navBtn = document.querySelector(`.qnav-item[data-index="${i}"]`);

    if (selected && selected.value === q.answer) {
      score++;
      card.classList.add("correct");
      feedbackEl.classList.add("correct");
      feedbackEl.textContent = "✔ Chính xác. Bạn nhớ rất tốt!";

      optionsWrapper.forEach((wrap) => {
        const input = wrap.querySelector("input");
        const label = wrap.querySelector(".option-label");
        if (input.value === q.answer) {
          label.classList.add("correct");
        }
      });

      if (navBtn) navBtn.classList.add("nav-correct");
    } else {
      card.classList.add("incorrect");
      feedbackEl.classList.add("incorrect");

      let msg = "✗ Sai. ";
      if (!selected) {
        msg += "Bạn chưa chọn đáp án. Đáp án đúng là: " + q.answer;
      } else {
        msg += `Đáp án bạn chọn là ${selected.value}, đáp án đúng là ${q.answer}.`;
      }
      feedbackEl.textContent = msg;

      optionsWrapper.forEach((wrap) => {
        const input = wrap.querySelector("input");
        const label = wrap.querySelector(".option-label");

        if (selected && input === selected && selected.value !== q.answer) {
          label.classList.add("incorrect");
        }
        if (input.value === q.answer) {
          label.classList.add("correct");
        }
      });

      if (navBtn) navBtn.classList.add("nav-incorrect");
    }
  });

  const total = questionsData.length;
  const wrong = total - score;
  const percent = Math.round((score / total) * 100);
  const rank = getRank(percent);

  // Thời gian làm thực tế
  const usedSeconds = examTotalSeconds > 0
    ? examTotalSeconds - remainingSeconds
    : 0;
  const usedTimeStr = examTotalSeconds > 0
    ? formatTime(usedSeconds)
    : "--:--";

  // Hiện ở cuối trang
  const resultEl = document.getElementById("result");
  resultEl.innerHTML =
    `Bạn làm đúng <span>${score}/${total}</span> câu ` +
    `(${percent}%). Sai <span>${wrong}</span> câu. Xếp loại: <span>${rank}</span>. ` +
    `Thời gian làm: <span>${usedTimeStr}</span>.`;

  // Kết quả nổi bật ở trên đầu
  const topResultEl = document.getElementById("topResult");
  if (topResultEl) {
    topResultEl.style.display = "inline-flex";
    topResultEl.classList.remove("bad");

    topResultEl.innerHTML =
      `🎓 Hoàn thành bài thi – <span>${score}/${total}</span> câu đúng ` +
      `(${percent}%) · ${rank} · Thời gian: ${usedTimeStr}`;

    if (percent < 50) {
      topResultEl.classList.add("bad");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const allInputs = document.querySelectorAll("#quiz input[type=radio]");
  allInputs.forEach((inp) => (inp.disabled = true));

  document.getElementById("noteArea").textContent = autoSubmit
    ? "Hết giờ, bài đã được tự động nộp. Hãy xem kỹ lại những câu sai để nhớ lâu hơn."
    : "Bạn đã nộp bài. Hãy xem lại các câu sai và đọc kỹ đáp án đúng để củng cố trí nhớ.";

  const btnGrade = document.getElementById("btnGrade");
  if (btnGrade) btnGrade.style.display = "none";
}

// ========================
// RESET
// ========================

function resetExam() {
  if (!confirm("Bạn có chắc muốn làm lại từ đầu?")) return;

  if (timerInterval) clearInterval(timerInterval);
  examFinished = false;
  questionsData = [];
  examTotalSeconds = 0;
  remainingSeconds = 0;
  setHeaderCollapsed(false);

  document.getElementById("quiz").innerHTML =
    '<p class="muted">Chưa có đề. Hãy chọn file <b>.json</b> và nhập thời gian rồi bấm <b>“Tạo đề &amp; bắt đầu thi”</b>.</p>';
  document.getElementById("result").textContent = "";
  document.getElementById("noteArea").textContent = "";
  const timerEl = document.getElementById("timer");
  timerEl.textContent = "--:--";
  timerEl.className = "timer timer-idle";

  const btnGrade = document.getElementById("btnGrade");
  if (btnGrade) btnGrade.style.display = "none";

  const topResultEl = document.getElementById("topResult");
  if (topResultEl) {
    topResultEl.style.display = "none";
    topResultEl.textContent = "";
    topResultEl.classList.remove("bad");
  }

  const examNameEl = document.getElementById("examName");
  if (examNameEl) {
    examNameEl.style.display = "none";
    examNameEl.textContent = "";
  }

  const listEl = document.getElementById("questionList");
  if (listEl) listEl.innerHTML = "";
}

// ========================
// GÁN SỰ KIỆN
// ========================

document.addEventListener("DOMContentLoaded", () => {
  const btnStart = document.getElementById("btnStart");
  if (btnStart) btnStart.addEventListener("click", loadFile);

  const btnReset = document.getElementById("btnReset");
  if (btnReset) btnReset.addEventListener("click", resetExam);

  const btnGrade = document.getElementById("btnGrade");
  if (btnGrade) btnGrade.addEventListener("click", () => grade(false));

  const btnSelectDrive = document.getElementById("btnSelectDrive");
  if (btnSelectDrive) {
    btnSelectDrive.addEventListener("click", () => {
      initAuthAndPicker();
    });
  }

  const headerToggle = document.getElementById("headerToggle");
  if (headerToggle) {
    headerToggle.addEventListener("click", () => {
      setHeaderCollapsed(!headerCollapsed);
    });
  }
});
