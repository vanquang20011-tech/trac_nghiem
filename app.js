// ========================
// BIẾN TOÀN CỤC
// ========================

let questionsData = [];
let timerInterval = null;
let remainingSeconds = 0;
let examFinished = false;
let examTotalSeconds = 0; // để tính thời gian làm thực tế

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
    remainingSeconds--;
    if (remainingSeconds < 0) remainingSeconds = 0;
    updateTimerDisplay();

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      if (!examFinished) {
        grade(true); // tự nộp khi hết giờ
      }
    }
  }, 1000);
}

// ========================
// LOAD FILE CÂU HỎI
// ========================

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
      if (!Array.isArray(data) || data.length === 0) {
        alert("File không đúng định dạng hoặc không có câu hỏi!");
        return;
      }

      questionsData = data;
      examFinished = false;

      // tên bài thi theo tên file
      const examNameEl = document.getElementById("examName");
      const fileName = file.name.replace(/\.json$/i, "");
      examNameEl.textContent = "Bài thi: " + fileName;
      examNameEl.style.display = "block";

      generateQuiz();
      startTimer();

      setHeaderCollapsed(true); // tạo đề xong thì thu gọn header

      document.getElementById("result").textContent = "";
      document.getElementById("noteArea").textContent =
        "Bài thi đã bắt đầu. Đừng quên nộp bài trước khi hết giờ!";
      document.getElementById("btnGrade").style.display = "inline-flex";

      const topResultEl = document.getElementById("topResult");
      if (topResultEl) {
        topResultEl.style.display = "none";
        topResultEl.textContent = "";
        topResultEl.classList.remove("bad");
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi đọc file. Hãy kiểm tra lại định dạng JSON.");
    }
  };
  reader.readAsText(file);
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
        card.scrollIntoView({ behavior: "smooth", block: "start" });
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

  questionsData.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.index = i;

    const header = document.createElement("div");
    header.className = "question-header";

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="question-number">Câu ${i + 1}</div>
      <div class="question-text">${q.question}</div>
      <div class="question-meta">Chọn 1 đáp án đúng</div>
    `;

    header.appendChild(left);
    card.appendChild(header);

    const optionsDiv = document.createElement("div");
    optionsDiv.className = "options";

    q.options.forEach((opt) => {
      const optionId = `q${i}-${Math.random().toString(36).slice(2, 8)}`;

      const wrapper = document.createElement("div");
      wrapper.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q${i}`;
      input.value = opt;
      input.id = optionId;
      input.className = "option-input";

      const label = document.createElement("label");
      label.className = "option-label";
      label.setAttribute("for", optionId);

      label.innerHTML = `
        <div class="option-bullet">
          <div class="option-bullet-inner"></div>
        </div>
        <div class="option-text">${opt}</div>
      `;

      wrapper.appendChild(input);
      wrapper.appendChild(label);
      optionsDiv.appendChild(wrapper);
    });

    card.appendChild(optionsDiv);

    const feedback = document.createElement("div");
    feedback.className = "feedback";
    feedback.id = `feedback-${i}`;
    card.appendChild(feedback);

    quizDiv.appendChild(card);
  });

  const allInputs = quizDiv.querySelectorAll("input[type=radio]");
  allInputs.forEach((inp) => {
    inp.disabled = false;
  });

  // tạo lại bảng số câu
  renderQuestionNav();
}

// ========================
// XẾP LOẠI THEO %
// ========================

function getRank(percent) {
  if (percent >= 85) return "Giỏi";
  if (percent >= 70) return "Khá";
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
    const feedbackEl = document.getElementById(`feedback-${i}`);
    const navBtn = document.querySelector(`.qnav-item[data-index="${i}"]`);

    card.classList.remove("correct", "incorrect");
    feedbackEl.classList.remove("correct", "incorrect");
    feedbackEl.textContent = "";

    const optionsWrapper = card.querySelectorAll(".option");
    optionsWrapper.forEach((wrap) => {
      const label = wrap.querySelector(".option-label");
      label.classList.remove("correct", "incorrect");
    });

    const selected = document.querySelector(`input[name="q${i}"]:checked`);

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
      if (selected) {
        msg += `Bạn chọn: "${selected.value}". `;
      } else {
        msg += "Bạn chưa chọn đáp án. ";
      }
      msg += `Đáp án đúng là: "${q.answer}". Hãy đọc lại để khắc sâu hơn.`;
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
    `Kết quả: <span>${score}/${total}</span> câu đúng ` +
    `(${percent}%). Sai ${wrong} câu – Xếp loại: <b>${rank}</b>. ` +
    `Thời gian làm: ${usedTimeStr}.`;

  // Hiện nổi bật trên đầu
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

  document.getElementById("btnGrade").style.display = "none";
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
  document.getElementById("btnGrade").style.display = "none";

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
  document.getElementById("btnStart").addEventListener("click", loadFile);
  document.getElementById("btnReset").addEventListener("click", resetExam);
  document.getElementById("btnGrade").addEventListener("click", () => grade(false));

  const headerToggle = document.getElementById("headerToggle");
  if (headerToggle) {
    headerToggle.addEventListener("click", () => {
      setHeaderCollapsed(!headerCollapsed);
    });
  }
});


