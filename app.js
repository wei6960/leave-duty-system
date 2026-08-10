const STORAGE_KEY_PREFIX = "leave-duty-system-v2";
const OLD_STORAGE_KEY = "leave-duty-system-v1";
const SESSION_KEY = "leave-duty-branch-session";
const LOGIN_PASSWORD = "90757744";
const FIREBASE_SDK_VERSION = "12.17.1";
const SUPABASE_SDK_VERSION = "2.86.0";
const SUPABASE_COLLECTION = "leaveDutyBranches";
const grades = ["國一", "國二", "國三"];
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const periods = ["上午", "下午", "晚上"];
const courses = ["國文", "英文", "數A", "數B", "數學", "自然", "總複習", "素養課", "讀書班"];
const scheduleCourses = [...courses, "考加"];
const leavePeriods = ["上午", "下午", "晚上"];
const parentMode = new URLSearchParams(location.search).get("parent") === "1" || location.hash === "#parent";

let dashboardGrade = "全體";
let dashboardMode = "today";
let editingStudentId = null;
let editingExamId = null;
let currentBranch = sessionStorage.getItem(SESSION_KEY) || "";
let state = currentBranch ? loadState() : emptyState();
let syncReady = false;
let syncLoading = false;
let syncUnsubscribe = null;
let syncSaveTimer = null;
let syncDocRef = null;
let setDocRemote = null;
let remoteSave = null;
let supabaseClient = null;
let supabasePollTimer = null;
let lastRemoteUpdatedAt = "";
let parentStudentId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const mobileQuery = window.matchMedia("(max-width: 720px)");

function emptyState() {
  return {
    students: [],
    leaves: [],
    lateRecords: [],
    schedule: defaultSchedule(),
    exams: [],
    termScores: [],
    archives: [],
  };
}

function defaultSchedule() {
  return Object.fromEntries(grades.map((grade) => [
    grade,
    Object.fromEntries(weekdays.map((day) => [
      day,
      Object.fromEntries(periods.map((period) => [period, ""])),
    ])),
  ]));
}

function storageKey() {
  return `${STORAGE_KEY_PREFIX}-${currentBranch || "平鎮"}`;
}

function loadState() {
  const saved = localStorage.getItem(storageKey());
  if (saved) return normalizeState(JSON.parse(saved));

  const previousSaved = currentBranch === "平鎮" ? localStorage.getItem(STORAGE_KEY_PREFIX) : null;
  if (previousSaved) return normalizeState(JSON.parse(previousSaved));

  const oldSaved = currentBranch === "平鎮" ? localStorage.getItem(OLD_STORAGE_KEY) : null;
  if (oldSaved) {
    const oldState = normalizeState(JSON.parse(oldSaved));
    const onlyOriginalSample =
      oldState.students.length === 1 &&
      oldState.students[0].name === "王小明" &&
      oldState.leaves.length === 0 &&
      oldState.lateRecords.length === 0;
    if (!onlyOriginalSample) return oldState;
  }

  return emptyState();
}

function normalizeState(raw) {
  const baseSchedule = defaultSchedule();
  const rawSchedule = raw.schedule || {};
  grades.forEach((grade) => {
    weekdays.forEach((day) => {
      periods.forEach((period) => {
        const course = normalizeCourseName(rawSchedule?.[grade]?.[day]?.[period]);
        baseSchedule[grade][day][period] = scheduleCourses.includes(course)
          ? course
          : "";
      });
    });
  });
  return {
    students: (raw.students || []).map((student) => ({
      id: student.id || crypto.randomUUID(),
      grade: grades.includes(student.grade) ? student.grade : "國一",
      name: student.name || "",
      weekdays: student.weekdays || [],
      courses: normalizeCourses(student.courses || student.subjects || []),
      meal: student.meal || "無訂餐",
      fixedLeave: student.fixedLeave || [],
      fixedLate: normalizeFixedLate(student.fixedLate || []),
      parentCode: student.parentCode || generateParentCode(),
    })),
    leaves: normalizeLeaves(raw.leaves || []),
    lateRecords: raw.lateRecords || [],
    schedule: baseSchedule,
    exams: (raw.exams || []).map(normalizeExam),
    termScores: raw.termScores || [],
    archives: raw.archives || [],
  };
}

function normalizeCourses(values) {
  return [...new Set((values || []).map(normalizeCourseName).filter((value) => courses.includes(value)))];
}

function normalizeCourseName(value) {
  const text = String(value || "").trim().replace("數Ａ", "數A").replace("數Ｂ", "數B");
  const map = {
    國: "國文",
    國文: "國文",
    英: "英文",
    英文: "英文",
    數: "數A",
    數A: "數A",
    數B: "數B",
    數學: "數學",
    社: "社會",
    社會: "社會",
    自: "自然",
    自然: "自然",
    總複習: "總複習",
    素養: "素養課",
    素養課: "素養課",
    讀書: "讀書班",
    讀書班: "讀書班",
    考加: "考加",
  };
  return map[text] || text;
}

function generateParentCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeExam(exam) {
  return {
    id: exam.id || crypto.randomUUID(),
    date: exam.date || todayISO(),
    grade: grades.includes(exam.grade) ? exam.grade : "國一",
    subject: courses.includes(normalizeCourseName(exam.subject)) ? normalizeCourseName(exam.subject) : "國文",
    scope: exam.scope || "",
    noExam: Boolean(exam.noExam),
    paperCount: Math.max(1, Number(exam.paperCount) || 1),
    scores: exam.scores || {},
    absences: Array.isArray(exam.absences) ? exam.absences : [],
    createdAt: exam.createdAt || new Date().toISOString(),
  };
}

function normalizeFixedLate(items) {
  return items.map((item) => {
    if (typeof item === "string") return { day: item, time: "", reason: "" };
    return { day: item.day, time: item.time || "", reason: item.reason || "" };
  }).filter((item) => weekdays.includes(item.day));
}

function normalizeLeaves(records) {
  const normalized = records.map((record) => ({
    ...record,
    startDate: record.startDate || record.date,
    endDate: record.endDate || record.date,
    date: record.startDate || record.date,
    periods: Array.isArray(record.periods) ? record.periods.filter((period) => leavePeriods.includes(period)) : [],
  }));

  const groups = new Map();
  normalized.forEach((record) => {
    const createdBucket = record.createdAt ? record.createdAt.slice(0, 19) : record.id;
    const key = [record.studentId, leavePeriodLabel(record), record.note || "", record.dismissedAt || "", createdBucket].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  return [...groups.values()].flatMap((group) => {
    const sorted = group.sort((a, b) => getLeaveStart(a).localeCompare(getLeaveStart(b)));
    const merged = [];
    sorted.forEach((record) => {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...record });
        return;
      }
      const nextExpected = addDays(getLeaveEnd(last), 1);
      if (getLeaveStart(record) <= nextExpected) {
        last.endDate = maxDate(getLeaveEnd(last), getLeaveEnd(record));
        last.date = last.startDate;
      } else {
        merged.push({ ...record });
      }
    });
    return merged;
  });
}

function saveState() {
  if (!currentBranch) return;
  localStorage.setItem(storageKey(), JSON.stringify(state));
  queueRemoteSave();
}

function setSyncStatus(text) {
  const target = $("#syncStatus");
  if (target) target.textContent = text;
}

function queueRemoteSave() {
  if (!syncReady || syncLoading || !remoteSave) return;
  clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(() => {
    remoteSave().catch(() => setSyncStatus("同步失敗"));
  }, 350);
}

function hasSupabaseConfig() {
  const config = window.SUPABASE_CONFIG;
  return Boolean(config && config.url && config.anonKey);
}

function hasFirebaseConfig() {
  const config = window.FIREBASE_CONFIG;
  return Boolean(config && config.apiKey && config.projectId && config.appId);
}

async function setupCloudSync() {
  if (!currentBranch) return;
  cleanupCloudSync();
  if (hasSupabaseConfig()) {
    await setupSupabaseSync();
    return;
  }
  await setupFirebaseSync();
}

function cleanupCloudSync() {
  if (syncUnsubscribe) {
    syncUnsubscribe();
    syncUnsubscribe = null;
  }
  if (supabasePollTimer) {
    clearInterval(supabasePollTimer);
    supabasePollTimer = null;
  }
  syncReady = false;
  syncDocRef = null;
  setDocRemote = null;
  remoteSave = null;
  supabaseClient = null;
  lastRemoteUpdatedAt = "";
}

async function setupSupabaseSync() {
  try {
    setSyncStatus("連線中");
    const { createClient } = await import(`https://esm.sh/@supabase/supabase-js@${SUPABASE_SDK_VERSION}`);
    supabaseClient = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    remoteSave = saveSupabaseState;

    const remote = await loadSupabaseState();
    if (remote) {
      state = normalizeState(remote.data || emptyState());
      lastRemoteUpdatedAt = remote.updatedAt || "";
      localStorage.setItem(storageKey(), JSON.stringify(state));
      renderAll();
    }

    syncReady = true;
    setSyncStatus("同步中");
    if (!remote) await saveSupabaseState();
    supabasePollTimer = setInterval(checkSupabaseState, 5000);
  } catch (error) {
    syncReady = false;
    setSyncStatus("同步失敗");
  }
}

async function loadSupabaseState() {
  const { data, error } = await supabaseClient
    .from("app_records")
    .select("data")
    .eq("collection", SUPABASE_COLLECTION)
    .eq("id", currentBranch)
    .maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

async function saveSupabaseState() {
  if (!supabaseClient || !currentBranch) return;
  const updatedAt = new Date().toISOString();
  lastRemoteUpdatedAt = updatedAt;
  const payload = {
    branch: currentBranch,
    data: JSON.parse(JSON.stringify(state)),
    updatedAt,
  };
  const { error } = await supabaseClient.from("app_records").upsert({
    collection: SUPABASE_COLLECTION,
    id: currentBranch,
    group_code: currentBranch,
    username: null,
    data: payload,
  }, { onConflict: "collection,id" });
  if (error) throw error;
  setSyncStatus("同步中");
}

async function checkSupabaseState() {
  if (!syncReady || syncLoading) return;
  try {
    syncLoading = true;
    const remote = await loadSupabaseState();
    if (remote && remote.updatedAt && remote.updatedAt !== lastRemoteUpdatedAt) {
      state = normalizeState(remote.data || emptyState());
      lastRemoteUpdatedAt = remote.updatedAt;
      localStorage.setItem(storageKey(), JSON.stringify(state));
      renderAll();
    }
    setSyncStatus("同步中");
  } catch (error) {
    setSyncStatus("同步失敗");
  } finally {
    syncLoading = false;
  }
}

async function setupFirebaseSync() {

  if (!hasFirebaseConfig()) {
    setSyncStatus("本機模式");
    return;
  }

  try {
    setSyncStatus("連線中");
    const [{ initializeApp, getApps, getApp }, firestore] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`),
    ]);
    const app = getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
    const db = firestore.getFirestore(app);
    syncDocRef = firestore.doc(db, "leave-duty-system", currentBranch);
    setDocRemote = firestore.setDoc;
    remoteSave = () => setDocRemote(syncDocRef, {
      branch: currentBranch,
      data: JSON.parse(JSON.stringify(state)),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    syncLoading = true;
    syncUnsubscribe = firestore.onSnapshot(syncDocRef, (snapshot) => {
      if (!snapshot.exists()) {
        syncLoading = false;
        syncReady = true;
        setSyncStatus("同步中");
        queueRemoteSave();
        return;
      }
      const remote = snapshot.data().data;
      if (remote && !snapshot.metadata.hasPendingWrites) {
        state = normalizeState(remote);
        localStorage.setItem(storageKey(), JSON.stringify(state));
        renderAll();
      }
      syncLoading = false;
      syncReady = true;
      setSyncStatus("同步中");
    }, () => {
      syncLoading = false;
      syncReady = false;
      setSyncStatus("同步失敗");
    });
  } catch (error) {
    syncLoading = false;
    syncReady = false;
    setSyncStatus("本機模式");
  }
}

function todayISO() {
  const now = new Date();
  return toISODate(now);
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(isoDate) {
  if (!isoDate) return "";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function datesBetween(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const dates = [];
  for (let cursor = startDate; cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(toISODate(cursor));
  }
  return dates;
}

function addDays(isoDate, amount) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

function maxDate(a, b) {
  return a > b ? a : b;
}

function getLeaveStart(record) {
  return record.startDate || record.date;
}

function getLeaveEnd(record) {
  return record.endDate || record.date;
}

function studentClassDatesForLeave(record, student = getStudent(record.studentId)) {
  if (!student) return datesBetween(getLeaveStart(record), getLeaveEnd(record));
  return datesBetween(getLeaveStart(record), getLeaveEnd(record))
    .filter((date) => studentHasClassOnDate(student, date));
}

function leaveDayCount(record, student = getStudent(record.studentId)) {
  return studentClassDatesForLeave(record, student).length;
}

function leaveDateLabel(record) {
  const start = getLeaveStart(record);
  const end = getLeaveEnd(record);
  if (start === end) return dateLabel(start);
  return `${dateLabel(start)} 到 ${dateLabel(end)}`;
}

function leavePeriodLabel(record) {
  return record.periods && record.periods.length ? record.periods.join("、") : "整天";
}

function classDaysLabel(student) {
  if (!gradeScheduleHasAnyCourse(student.grade)) return "星期一到五皆有課";
  const labels = weekdays
    .map((day) => {
      const items = studentClassesOnDay(student, day);
      if (items.length) return `星期${day} ${items.join("/")}`;
      return legacyStudentHasClassOnDay(student, day) ? `星期${day}` : "";
    })
    .filter(Boolean);
  return labels.length ? labels.join("、") : "未設定課表";
}

function weekdayFromDate(isoDate) {
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${isoDate}T00:00:00`).getDay()];
}

function byDateDesc(a, b) {
  return b.date.localeCompare(a.date);
}

function getStudent(id) {
  return state.students.find((student) => student.id === id);
}

function studentLabel(student) {
  return `${student.grade} ${student.name}`;
}

function studentCoursesLabel(student) {
  return student.courses && student.courses.length ? student.courses.join("、") : "未設定";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parentPortalUrl() {
  return `${location.origin}${location.pathname}?parent=1`;
}

function studentClassesOnDay(student, day) {
  const daySchedule = state.schedule?.[student.grade]?.[day] || {};
  return periods
    .map((period) => daySchedule[period])
    .filter((course) => course && (course === "考加" || studentMatchesCourse(student, course)));
}

function studentMatchesCourse(student, course) {
  if (student.courses.includes(course)) return true;
  const mathGroup = ["數A", "數B", "數學"];
  return mathGroup.includes(course) && student.courses.some((item) => mathGroup.includes(item));
}

function gradeScheduleHasAnyCourse(grade) {
  const gradeSchedule = state.schedule?.[grade];
  if (!gradeSchedule) return false;
  return weekdays.some((day) => periods.some((period) => Boolean(gradeSchedule[day]?.[period])));
}

function legacyStudentHasClassOnDay(student, day) {
  return (!student.courses || student.courses.length === 0) && Array.isArray(student.weekdays) && student.weekdays.includes(day);
}

function studentHasClassOnDate(student, date) {
  const day = weekdayFromDate(date);
  if (weekdays.includes(day) && !gradeScheduleHasAnyCourse(student.grade)) return true;
  return studentClassesOnDay(student, day).length > 0 || legacyStudentHasClassOnDay(student, day);
}

function dashboardStudents() {
  return state.students.filter((student) => dashboardGrade === "全體" || student.grade === dashboardGrade);
}

function dashboardStudentIds() {
  return new Set(dashboardStudents().map((student) => student.id));
}

function todayLeaveStudentIds() {
  const today = todayISO();
  const todayWeekday = weekdayFromDate(today);
  const ids = dashboardStudentIds();
  const leaveIds = new Set();

  state.leaves.forEach((record) => {
    if (record.dismissedAt || !ids.has(record.studentId)) return;
    if (getLeaveStart(record) <= today && getLeaveEnd(record) >= today) {
      leaveIds.add(record.studentId);
    }
  });

  state.students.forEach((student) => {
    if (ids.has(student.id) && studentHasClassOnDate(student, today) && student.fixedLeave.includes(todayWeekday)) {
      leaveIds.add(student.id);
    }
  });

  return leaveIds;
}

function renderExpectedAttendance() {
  const todayWeekday = weekdayFromDate(todayISO());
  const leaveIds = todayLeaveStudentIds();
  const expected = dashboardStudents()
    .filter((student) => studentHasClassOnDate(student, todayISO()))
    .filter((student) => !leaveIds.has(student.id)).length;
  $("#todayExpectedCount").textContent = expected;
}

function renderCourseInputs(targetId, name) {
  const target = $(`#${targetId}`);
  target.innerHTML = courses
    .map((course) => `
      <label class="check-pill">
        <input type="checkbox" name="${name}" value="${course}">
        ${course}
      </label>
    `)
    .join("");
}

function renderWeekdayInputs(targetId, name) {
  const target = $(`#${targetId}`);
  target.innerHTML = weekdays
    .map((day) => `
      <label class="check-pill">
        <input type="checkbox" name="${name}" value="${day}">
        星期${day}
      </label>
    `)
    .join("");
}

function renderFixedLateInputs() {
  $("#studentFixedLate").innerHTML = weekdays
    .map((day) => `
      <label class="fixed-late-row">
        <span>
          <input type="checkbox" name="fixedLateDay" value="${day}">
          星期${day}
        </span>
        <input type="time" data-fixed-late-time="${day}" aria-label="星期${day}到班時間">
        <input data-fixed-late-reason="${day}" placeholder="原因" aria-label="星期${day}固定晚到原因">
      </label>
    `)
    .join("");
}

function renderSubjectOptions(targetId, includeExamPlus = false) {
  const list = courses;
  const target = $(`#${targetId}`);
  if (!target) return;
  target.innerHTML = list.map((course) => `<option value="${course}">${course}</option>`).join("");
}

function mathCoursesForGrade(grade) {
  const mathGroup = ["數A", "數B", "數學"];
  return mathGroup.filter((course) => state.students.some((student) => student.grade === grade && student.courses.includes(course)));
}

function examSubjectsForDateAndGrade(date, grade) {
  const day = weekdayFromDate(date);
  const scheduled = periods
    .map((period) => state.schedule?.[grade]?.[day]?.[period])
    .filter((course) => course && course !== "考加");
  if (!scheduled.length || !gradeScheduleHasAnyCourse(grade)) return courses;
  const subjects = [];
  scheduled.forEach((course) => {
    if (["數A", "數B", "數學"].includes(course)) {
      const mathSubjects = mathCoursesForGrade(grade);
      subjects.push(...(mathSubjects.length ? mathSubjects : [course]));
    } else {
      subjects.push(course);
    }
  });
  return [...new Set(subjects)].filter((course) => courses.includes(course));
}

function renderExamSubjectOptions() {
  const target = $("#examSubject");
  if (!target) return;
  const previous = target.value;
  const subjects = examSubjectsForDateAndGrade($("#examDate").value || todayISO(), $("#examGrade").value || "國一");
  target.innerHTML = subjects.map((course) => `<option value="${course}">${course}</option>`).join("");
  target.value = subjects.includes(previous) ? previous : subjects[0] || "國文";
}

function courseSelect(value = "") {
  return `<select data-schedule-course>
    <option value="">無課</option>
    ${scheduleCourses.map((course) => `<option value="${course}" ${course === value ? "selected" : ""}>${course}</option>`).join("")}
  </select>`;
}

function renderSchedule() {
  const grade = $("#scheduleGrade")?.value || "國一";
  const gradeSchedule = state.schedule?.[grade] || defaultSchedule()[grade];
  $("#scheduleTable").innerHTML = periods.map((period) => `
    <tr>
      <th>${period}</th>
      ${weekdays.map((day) => `<td data-schedule-cell="${day}|${period}">${courseSelect(gradeSchedule[day]?.[period] || "")}</td>`).join("")}
    </tr>
  `).join("");
}

function saveSchedule() {
  const grade = $("#scheduleGrade").value;
  if (!state.schedule) state.schedule = defaultSchedule();
  weekdays.forEach((day) => {
    periods.forEach((period) => {
      const cell = document.querySelector(`[data-schedule-cell="${day}|${period}"] select`);
      state.schedule[grade][day][period] = cell ? cell.value : "";
    });
  });
  saveState();
  renderAll();
}

function studentsForGradeAndSubject(grade, subject) {
  return state.students
    .filter((student) => student.grade === grade)
    .filter((student) => student.courses.includes(subject));
}

function visibleScoreStudents() {
  const keyword = $("#scoreStudentSearch")?.value.trim() || "";
  const selected = $("#scoreStudentFilter")?.value || "全部";
  return studentsForGradeAndSubject($("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文")
    .filter((student) => selected === "全部" || student.id === selected)
    .filter((student) => !keyword || student.name.includes(keyword));
}

function renderScoreStudentFilter() {
  const target = $("#scoreStudentFilter");
  if (!target) return;
  const previous = target.value || "全部";
  const students = studentsForGradeAndSubject($("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文");
  target.innerHTML = `<option value="全部">全部學生</option>${students.map((student) => `<option value="${student.id}">${student.name}</option>`).join("")}`;
  target.value = previous === "全部" || students.some((student) => student.id === previous) ? previous : "全部";
}

function renderScoreEntryList() {
  const subject = $("#examSubject")?.value || "國文";
  const noExam = $("#examNoTest")?.checked;
  const paperCount = Math.max(1, Number($("#examPaperCount")?.value) || 1);
  const students = visibleScoreStudents();
  if (noExam) {
    $("#scoreEntryList").innerHTML = `<div class="empty">已選擇無考試，儲存後會保留當天無考試紀錄。</div>`;
    return;
  }
  $("#scoreEntryList").innerHTML = students.length
    ? students.map((student) => `
      <label class="score-row ${paperCount > 1 ? "multi-paper" : ""}">
        <span>${student.name}</span>
        <div class="paper-score-grid">
          ${Array.from({ length: paperCount }, (_, index) => `
            <input type="number" min="0" max="100" step="0.1" data-score-student="${student.id}" data-score-paper="${index}" placeholder="卷${index + 1}">
          `).join("")}
          <label class="absent-check"><input type="checkbox" data-score-absent="${student.id}">缺考</label>
        </div>
      </label>
    `).join("")
    : `<div class="empty">此年級尚無補 ${subject} 的學生。</div>`;
  applyEditingExamScores();
}

function scoreValuesForStudent(exam, studentId) {
  const raw = exam.scores?.[studentId];
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  const value = Number(raw);
  return Number.isFinite(value) ? [value] : [];
}

function averageScore(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function updateExamFormMode() {
  const submit = $("#examForm button[type='submit']");
  if (submit) submit.textContent = editingExamId ? "更新成績單" : "儲存成績單";
}

function applyEditingExamScores() {
  const exam = editingExamId ? state.exams.find((item) => item.id === editingExamId) : null;
  if (!exam || exam.grade !== $("#examGrade")?.value || exam.subject !== $("#examSubject")?.value) return;
  const paperCount = Math.max(1, Number($("#examPaperCount")?.value) || 1);
  studentsForGradeAndSubject(exam.grade, exam.subject).forEach((student) => {
    const absentInput = document.querySelector(`[data-score-absent="${student.id}"]`);
    if (absentInput) absentInput.checked = (exam.absences || []).includes(student.id);
    const values = scoreValuesForStudent(exam, student.id);
    Array.from({ length: paperCount }, (_, index) => {
      const input = document.querySelector(`[data-score-student="${student.id}"][data-score-paper="${index}"]`);
      if (input && values[index] !== undefined) input.value = values[index];
    });
  });
}

function currentScoreRows(exam) {
  const students = studentsForGradeAndSubject(exam.grade, exam.subject);
  return students
    .filter((student) => !(exam.absences || []).includes(student.id))
    .map((student) => {
      const papers = scoreValuesForStudent(exam, student.id);
      return { student, papers, score: averageScore(papers) };
    })
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score)
    .map((row, index, rows) => ({
      ...row,
      rank: rows.findIndex((item) => item.score === row.score) + 1,
    }));
}

function scoreDisplay(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "-";
}

function scoreClass(value) {
  return Number.isFinite(value) && value < 60 ? "fail-score" : "";
}

function scoreTableCell(value, absent = false) {
  if (absent) return `<td class="absent-score">缺考</td>`;
  return `<td class="${scoreClass(value)}">${scoreDisplay(value)}</td>`;
}

function classReportData(exam) {
  const rows = currentScoreRows(exam);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : NaN;
  const paperCount = Math.max(1, Number(exam.paperCount) || 1);
  const rankedById = new Map(rows.map((row) => [row.student.id, row]));
  const reportRows = studentsForGradeAndSubject(exam.grade, exam.subject)
    .map((student) => ({
      student,
      ranked: rankedById.get(student.id),
      absent: (exam.absences || []).includes(student.id),
    }))
    .sort((a, b) => {
      if (a.ranked && b.ranked) return a.ranked.rank - b.ranked.rank || b.ranked.score - a.ranked.score;
      if (a.ranked) return -1;
      if (b.ranked) return 1;
      if (a.absent !== b.absent) return a.absent ? 1 : -1;
      return a.student.name.localeCompare(b.student.name, "zh-Hant");
    });
  return { rows, average, paperCount, reportRows };
}

function renderClassReport(exam = latestExamForForm()) {
  if (!exam) {
    $("#classReportBody").innerHTML = `<div class="empty">尚無成績單。</div>`;
    return;
  }
  if (exam.noExam) {
    $("#classReportBody").innerHTML = `<div class="empty">${dateLabel(exam.date)} ${exam.grade} ${exam.subject}：無考試。${exam.scope ? `重點：${exam.scope}` : ""}</div>`;
    return;
  }
  const { average, paperCount, reportRows } = classReportData(exam);
  $("#classReportBody").innerHTML = `
    <div class="report-head">
      <strong>${dateLabel(exam.date)} ${exam.grade} ${exam.subject}</strong>
      <span>班平均 ${scoreDisplay(average)}</span>
      <span>${paperCount} 份考卷</span>
      <span>${exam.scope ? `重點：${exam.scope}` : "未填考試重點"}</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th>姓名</th><th>班級</th><th>科目</th>${Array.from({ length: paperCount }, (_, index) => `<th>卷${index + 1}</th>`).join("")}<th>平均</th></tr></thead>
      <tbody>${reportRows.map(({ student, ranked, absent }) => `<tr><td>${ranked ? ranked.rank : "-"}</td><td>${student.name}</td><td>${student.grade}</td><td>${exam.subject}</td>${Array.from({ length: paperCount }, (_, index) => scoreTableCell(ranked?.papers[index], absent)).join("")}${scoreTableCell(ranked?.score, absent)}</tr>`).join("") || `<tr><td colspan="${5 + paperCount}">尚無成績</td></tr>`}</tbody>
    </table>
  `;
}

function latestExamForForm() {
  const grade = $("#examGrade")?.value;
  const subject = $("#examSubject")?.value;
  return state.exams
    .filter((exam) => exam.grade === grade && exam.subject === subject)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function saveExam(event) {
  event.preventDefault();
  const noExam = $("#examNoTest").checked;
  const paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  const scores = {};
  const absences = [];
  studentsForGradeAndSubject($("#examGrade").value, $("#examSubject").value).forEach((student) => {
    if (document.querySelector(`[data-score-absent="${student.id}"]`)?.checked) {
      absences.push(student.id);
      return;
    }
    const values = Array.from({ length: paperCount }, (_, index) => {
      const input = document.querySelector(`[data-score-student="${student.id}"][data-score-paper="${index}"]`);
      return input && input.value !== "" ? Number(input.value) : null;
    }).filter((value) => value !== null && Number.isFinite(value));
    if (values.length) scores[student.id] = values;
  });
  const existing = editingExamId ? state.exams.find((item) => item.id === editingExamId) : null;
  const exam = normalizeExam({
    id: existing?.id || crypto.randomUUID(),
    date: $("#examDate").value,
    grade: $("#examGrade").value,
    subject: $("#examSubject").value,
    scope: $("#examScope").value.trim(),
    noExam,
    paperCount,
    scores,
    absences,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: existing ? new Date().toISOString() : undefined,
  });
  if (existing) {
    state.exams = state.exams.map((item) => item.id === existing.id ? exam : item);
  } else {
    state.exams.push(exam);
  }
  editingExamId = null;
  updateExamFormMode();
  saveState();
  renderAll();
  flashButton(event.submitter, existing ? "已更新" : "已儲存");
}

function resetExamForm() {
  if (!confirm("確定重設當天成績輸入？尚未儲存的分數會清空。")) return;
  editingExamId = null;
  $("#examDate").value = todayISO();
  $("#examScope").value = "";
  $("#examPaperCount").value = 1;
  $("#examNoTest").checked = false;
  $("#scoreStudentSearch").value = "";
  $("#scoreStudentFilter").value = "全部";
  updateExamFormMode();
  renderScoreEntryList();
}

function fillExamForm(exam) {
  editingExamId = exam.id;
  $("#examDate").value = exam.date;
  $("#examGrade").value = exam.grade;
  renderExamSubjectOptions();
  if (!Array.from($("#examSubject").options).some((option) => option.value === exam.subject)) {
    $("#examSubject").insertAdjacentHTML("beforeend", `<option value="${exam.subject}">${exam.subject}</option>`);
  }
  $("#examSubject").value = exam.subject;
  $("#examScope").value = exam.scope || "";
  $("#examPaperCount").value = Math.max(1, Number(exam.paperCount) || 1);
  $("#examNoTest").checked = Boolean(exam.noExam);
  $("#scoreStudentSearch").value = "";
  $("#scoreStudentFilter").value = "全部";
  updateExamFormMode();
  renderScoreStudentFilter();
  renderScoreEntryList();
  renderClassReport(exam);
}

function renderExamHistory() {
  const items = state.exams.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  $("#examHistoryList").innerHTML = items.map((exam) => {
    const rows = currentScoreRows(exam);
    const average = rows.length ? (rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1) : "-";
    return `
      <article class="record-card">
        <strong>${dateLabel(exam.date)} ${exam.grade} ${exam.subject}</strong>
        <div class="meta">
          <span class="badge">${exam.noExam ? "無考試" : `班平均 ${average}`}</span>
          ${exam.scope ? `<span class="badge gold">${exam.scope}</span>` : ""}
        </div>
      </article>
      <div class="action-row">
        <button class="ghost" data-edit-exam="${exam.id}">編輯成績單</button>
        <button class="ghost danger" data-delete-exam="${exam.id}">刪除成績單</button>
      </div>
    `;
  }).join("") || `<div class="empty">尚無成績歷史。</div>`;
}

function saveTermScore(event) {
  event.preventDefault();
  const studentId = $("#careerStudent").value;
  if (!studentId) return alert("請先選擇學生");
  if ($("#termScore").value === "") return alert("請輸入成績");
  state.termScores.push({
    id: crypto.randomUUID(),
    studentId,
    term: $("#termName").value.trim() || "未命名學期",
    stage: $("#termStage").value,
    subject: $("#termSubject").value,
    score: Number($("#termScore").value),
    createdAt: new Date().toISOString(),
  });
  $("#termScore").value = "";
  saveState();
  renderAll();
  flashButton(event.submitter, "已新增");
}

function studentExamRows(student) {
  return state.exams
    .filter((exam) => !exam.noExam && exam.scores && exam.scores[student.id] !== undefined)
    .map((exam) => ({ exam, papers: scoreValuesForStudent(exam, student.id), score: averageScore(scoreValuesForStudent(exam, student.id)) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));
}

function estimateLevel(avg) {
  if (!Number.isFinite(avg)) return "資料不足";
  if (avg >= 85) return "A 區間";
  if (avg >= 70) return "B 區間";
  return "C 區間";
}

const levelScale = ["C", "B", "B+", "B++", "A", "A+", "A++"];

function levelFromScore(score) {
  if (!Number.isFinite(score)) return "資料不足";
  if (score >= 95) return "A++";
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "B++";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  return "C";
}

function shiftLevel(level, amount) {
  const index = levelScale.indexOf(level);
  if (index < 0) return level;
  return levelScale[Math.max(0, Math.min(levelScale.length - 1, index + amount))];
}

function trendLabel(trend) {
  if (!Number.isFinite(trend)) return "資料不足";
  if (trend >= 8) return "明顯上升";
  if (trend >= 3) return "小幅上升";
  if (trend <= -8) return "明顯下滑";
  if (trend <= -3) return "小幅下滑";
  return "穩定";
}

function stabilityLabel(range) {
  if (!Number.isFinite(range)) return "資料不足";
  if (range <= 8) return "穩定";
  if (range <= 18) return "略有起伏";
  return "起伏偏大";
}

function analyzeSubjectPerformance(subject, rows) {
  const ordered = rows.slice().sort((a, b) => a.exam.date.localeCompare(b.exam.date));
  const recent = ordered.slice(-6);
  const scores = recent.map((row) => row.score).filter(Number.isFinite);
  if (!scores.length) {
    return { subject, level: "資料不足", recentAvg: NaN, latest: NaN, trend: NaN, range: NaN, count: 0, note: "尚無足夠考試紀錄可分析。" };
  }
  const weightedTotal = scores.reduce((sum, score, index) => sum + score * (index + 1), 0);
  const weightSum = scores.reduce((sum, _score, index) => sum + index + 1, 0);
  const recentAvg = weightedTotal / weightSum;
  const latest = scores.at(-1);
  const trend = scores.length >= 2 ? latest - scores[0] : 0;
  const range = Math.max(...scores) - Math.min(...scores);
  let level = levelFromScore(recentAvg);
  if (trend >= 8 && latest >= recentAvg) level = shiftLevel(level, 1);
  if (trend <= -8 || (range >= 25 && latest < recentAvg)) level = shiftLevel(level, -1);
  const weakRows = recent.filter((row) => row.score < 70);
  const focus = weakRows.map((row) => row.exam.scope || dateLabel(row.exam.date)).slice(-3).join("、");
  const note = [
    `近 ${scores.length} 次加權平均 ${scoreDisplay(recentAvg)}`,
    `最新 ${scoreDisplay(latest)}`,
    trendLabel(trend),
    stabilityLabel(range),
    focus ? `需補強：${focus}` : "近期未見明顯低於 70 分的單元",
  ].join("｜");
  return { subject, level, recentAvg, latest, trend, range, count: scores.length, note };
}

function subjectPerformanceRows(student) {
  const examRows = studentExamRows(student);
  return courses.map((subject) => {
    const rows = examRows.filter((row) => row.exam.subject === subject);
    if (!rows.length) return null;
    return { ...analyzeSubjectPerformance(subject, rows), rows };
  }).filter(Boolean);
}

function renderStudentReport() {
  const student = getStudent($("#careerStudent")?.value);
  if (!student) {
    $("#studentReport").innerHTML = `<div class="empty">請先選擇學生。</div>`;
    $("#archiveList").innerHTML = `<div class="empty">尚無歷年紀錄。</div>`;
    return;
  }
  $("#studentReport").innerHTML = renderStudentReportHtml(student);
  $("#archiveList").innerHTML = state.archives
    .filter((item) => item.studentId === student.id)
    .map((item) => `<article class="record-card done"><strong>${item.term}</strong><div class="meta"><span class="badge">${item.summary}</span></div></article>`)
    .join("") || `<div class="empty">尚無歷年紀錄。</div>`;
}

function renderStudentReportHtml(student) {
  const examRows = studentExamRows(student);
  const analyses = subjectPerformanceRows(student);
  const levelSummary = analyses.length ? analyses.map((item) => `${item.subject} ${item.level}`).join("、") : "資料不足";
  const termRows = state.termScores.filter((item) => item.studentId === student.id);
  return `
    <div class="report-head">
      <strong>${studentLabel(student)}</strong>
      <span>補習科目：${studentCoursesLabel(student)}</span>
      <span>各科推估：${levelSummary}</span>
    </div>
    <div class="analysis-grid">
      ${analyses.map((item) => `
        <article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${item.level}</b>
          </div>
          <span>近期加權 ${scoreDisplay(item.recentAvg)}｜最新 ${scoreDisplay(item.latest)}</span>
          <small>${trendLabel(item.trend)}｜${stabilityLabel(item.range)}｜近 ${item.count} 次</small>
          <div class="mini-bars">${item.rows.slice(-8).map((row) => `<i style="height:${Math.max(8, row.score)}%" title="${dateLabel(row.exam.date)} ${row.score}"></i>`).join("")}</div>
          <p>${item.note}</p>
        </article>
      `).join("") || `<div class="empty">尚無週考成績。</div>`}
    </div>
    <p class="report-copy">此報告採各科獨立判讀，不以全部科目總平均推估；系統優先參考近期考試、分數起伏與進退步趨勢，避免早期成績或不同科目混算造成失準。</p>
    <h2>段考紀錄</h2>
    <div class="meta">${termRows.map((item) => `<span class="badge">${item.term} ${item.stage} ${item.subject} ${item.score}</span>`).join("") || `<span class="badge">尚無段考紀錄</span>`}</div>
  `;
}

function pdfDocument(title, body, layout = "portrait") {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("請允許瀏覽器跳出視窗，才能產生 PDF 文件。");
    return;
  }
  printWindow.document.write(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 ${layout}; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #161616; background: #fff; font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif; }
    .sheet { width: 100%; }
    .doc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 3px solid #b9872f; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand img { width: 54px; height: 54px; object-fit: cover; border-radius: 50%; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
    h2 { margin: 22px 0 10px; font-size: 17px; color: #7a551a; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .pill { border: 1px solid #d8c291; border-radius: 999px; padding: 6px 10px; font-size: 13px; background: #fff9ea; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th { background: #181818; color: #f7df9b; }
    th, td { border: 1px solid #cfcfcf; padding: 8px 7px; text-align: center; }
    td.left, th.left { text-align: left; }
    .fail-score { color: #e60012; font-weight: 900; }
    .absent-score { color: #9a3412; font-weight: 800; }
    .summary { margin-top: 12px; line-height: 1.75; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px; }
    .card { border: 1px solid #d8c291; padding: 10px; border-radius: 6px; break-inside: avoid; }
    .card strong { display: block; margin-bottom: 5px; color: #7a551a; }
    .level { display: inline-block; min-width: 46px; padding: 3px 8px; border-radius: 999px; color: #161616; background: #f3c75f; font-weight: 900; text-align: center; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <main class="sheet">${body}</main>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 150));</script>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
}

function printClassReportPdf() {
  const exam = latestExamForForm();
  if (!exam) {
    alert("尚無成績單可輸出。");
    return;
  }
  const title = `${exam.grade} ${exam.subject} 班級成績單`;
  const scope = exam.scope ? `重點：${escapeHtml(exam.scope)}` : "未填考試重點";
  if (exam.noExam) {
    pdfDocument(title, `
      <header class="doc-head">
        <div class="brand"><img src="assets/logo.png" alt=""><div><h1>金牌躍騰教育集團 班級成績單</h1><div>${escapeHtml(dateLabel(exam.date))} ${escapeHtml(exam.grade)} ${escapeHtml(exam.subject)}</div></div></div>
      </header>
      <div class="meta"><span class="pill">無考試</span><span class="pill">${scope}</span></div>
    `, "portrait");
    return;
  }
  const { average, paperCount, reportRows } = classReportData(exam);
  const rowsHtml = reportRows.map(({ student, ranked, absent }) => `
    <tr>
      <td>${ranked ? ranked.rank : "-"}</td>
      <td class="left">${escapeHtml(student.name)}</td>
      <td>${escapeHtml(student.grade)}</td>
      <td>${escapeHtml(exam.subject)}</td>
      ${Array.from({ length: paperCount }, (_, index) => {
        if (absent) return `<td class="absent-score">缺考</td>`;
        const value = ranked?.papers[index];
        return `<td class="${scoreClass(value)}">${scoreDisplay(value)}</td>`;
      }).join("")}
      <td class="${absent ? "absent-score" : scoreClass(ranked?.score)}">${absent ? "缺考" : scoreDisplay(ranked?.score)}</td>
    </tr>
  `).join("");
  pdfDocument(title, `
    <header class="doc-head">
      <div class="brand"><img src="assets/logo.png" alt=""><div><h1>金牌躍騰教育集團 班級成績單</h1><div>${escapeHtml(dateLabel(exam.date))} ${escapeHtml(exam.grade)} ${escapeHtml(exam.subject)}</div></div></div>
      <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
    </header>
    <div class="meta">
      <span class="pill">班平均 ${scoreDisplay(average)}</span>
      <span class="pill">${paperCount} 份考卷</span>
      <span class="pill">${scope}</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th class="left">姓名</th><th>班級</th><th>科目</th>${Array.from({ length: paperCount }, (_, index) => `<th>卷${index + 1}</th>`).join("")}<th>平均</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${5 + paperCount}">尚無成績</td></tr>`}</tbody>
    </table>
  `, paperCount > 2 ? "landscape" : "portrait");
}

function printStudentReportPdf() {
  const student = getStudent($("#careerStudent")?.value);
  if (!student) {
    alert("請先選擇學生。");
    return;
  }
  const examRows = studentExamRows(student);
  const analyses = subjectPerformanceRows(student);
  const levelSummary = analyses.length ? analyses.map((item) => `${item.subject} ${item.level}`).join("、") : "資料不足";
  const termRows = state.termScores.filter((item) => item.studentId === student.id);
  const historyRows = state.archives.filter((item) => item.studentId === student.id);
  const weeklyRows = examRows.slice().reverse().map((row) => {
    const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
    return `<tr><td>${escapeHtml(dateLabel(row.exam.date))}</td><td>${escapeHtml(row.exam.subject)}</td><td class="left">${escapeHtml(row.exam.scope || "-")}</td><td>${escapeHtml(row.papers.map(scoreDisplay).join(" / "))}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${rank}</td></tr>`;
  }).join("");
  pdfDocument(`${student.name} 學生生涯報告`, `
    <header class="doc-head">
      <div class="brand"><img src="assets/logo.png" alt=""><div><h1>金牌躍騰教育集團 學生生涯報告</h1><div>${escapeHtml(studentLabel(student))}</div></div></div>
      <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
    </header>
    <div class="meta">
      <span class="pill">補習科目：${escapeHtml(studentCoursesLabel(student))}</span>
      <span class="pill">各科推估：${escapeHtml(levelSummary)}</span>
    </div>
    <p class="summary">本報告採各科獨立分析，優先參考近期考試、分數起伏與進退步趨勢，不用全部科目總平均直接推估。</p>
    <h2>各科概況</h2>
    <div class="grid">${analyses.map((item) => `<section class="card"><strong>${escapeHtml(item.subject)} <span class="level">${escapeHtml(item.level)}</span></strong><div>近期加權 ${scoreDisplay(item.recentAvg)}，最新 ${scoreDisplay(item.latest)}</div><div>${escapeHtml(trendLabel(item.trend))}｜${escapeHtml(stabilityLabel(item.range))}｜近 ${item.count} 次</div><div>${escapeHtml(item.note)}</div></section>`).join("") || `<section class="card">尚無週考成績</section>`}</div>
    <h2>週考紀錄</h2>
    <table><thead><tr><th>日期</th><th>科目</th><th class="left">重點/單元</th><th>各卷</th><th>平均</th><th>班排名</th></tr></thead><tbody>${weeklyRows || `<tr><td colspan="6">尚無週考紀錄</td></tr>`}</tbody></table>
    <h2>段考紀錄</h2>
    <table><thead><tr><th>學期</th><th>段別</th><th>科目</th><th>成績</th></tr></thead><tbody>${termRows.map((item) => `<tr><td>${escapeHtml(item.term)}</td><td>${escapeHtml(item.stage)}</td><td>${escapeHtml(item.subject)}</td><td class="${scoreClass(Number(item.score))}">${scoreDisplay(Number(item.score))}</td></tr>`).join("") || `<tr><td colspan="4">尚無段考紀錄</td></tr>`}</tbody></table>
    <h2>歷年結算</h2>
    <table><thead><tr><th>學期</th><th class="left">摘要</th></tr></thead><tbody>${historyRows.map((item) => `<tr><td>${escapeHtml(item.term)}</td><td class="left">${escapeHtml(item.summary)}</td></tr>`).join("") || `<tr><td colspan="2">尚無歷年紀錄</td></tr>`}</tbody></table>
  `, "portrait");
}

function archiveCurrentTerm() {
  const student = getStudent($("#careerStudent").value);
  if (!student) return alert("請先選擇學生");
  const term = $("#termName").value.trim() || "未命名學期";
  const rows = state.termScores.filter((item) => item.studentId === student.id && item.term === term);
  const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length : NaN;
  state.archives.push({
    id: crypto.randomUUID(),
    studentId: student.id,
    term,
    summary: rows.length ? `段考平均 ${avg.toFixed(1)}，共 ${rows.length} 筆` : "本學期尚無段考成績",
    createdAt: new Date().toISOString(),
  });
  state.termScores = state.termScores.filter((item) => !(item.studentId === student.id && item.term === term));
  saveState();
  renderAll();
}

function selectedValues(name) {
  return $$(`input[name="${name}"]:checked`).map((input) => input.value);
}

function setCheckedValues(name, values) {
  $$(`input[name="${name}"]`).forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

function selectedFixedLate() {
  return $$('input[name="fixedLateDay"]:checked').map((input) => ({
    day: input.value,
    time: document.querySelector(`[data-fixed-late-time="${input.value}"]`).value,
    reason: document.querySelector(`[data-fixed-late-reason="${input.value}"]`).value.trim(),
  }));
}

function setFixedLateValues(values) {
  const normalized = normalizeFixedLate(values);
  $$('input[name="fixedLateDay"]').forEach((input) => {
    const match = normalized.find((item) => item.day === input.value);
    input.checked = Boolean(match);
    document.querySelector(`[data-fixed-late-time="${input.value}"]`).value = match ? match.time : "";
    document.querySelector(`[data-fixed-late-reason="${input.value}"]`).value = match ? match.reason : "";
  });
}

function flashButton(button, label = "已完成") {
  if (!button) return;
  const originalText = button.textContent;
  button.classList.add("button-confirmed");
  button.textContent = label;
  window.setTimeout(() => {
    button.classList.remove("button-confirmed");
    button.textContent = originalText;
  }, 900);
}

function resetLeaveForm() {
  $("#leaveStudentPicker").value = "";
  $("#leaveStudent").value = "";
  $("#leaveStartDate").value = todayISO();
  $("#leaveEndDate").value = todayISO();
  $("#leaveNote").value = "";
  $$("input[name='leavePeriod']").forEach((input) => {
    input.checked = false;
  });
  renderLeaveStudentOptions(false);
}

function clearStudentForm() {
  editingStudentId = null;
  $("#studentForm").reset();
  setCheckedValues("studentCourse", []);
  setCheckedValues("fixedLeave", []);
  setFixedLateValues([]);
  $("#studentSubmitButton").textContent = "新增學生檔案";
  $("#cancelStudentEdit").hidden = true;
}

function fillStudentForm(student) {
  editingStudentId = student.id;
  $("#studentGrade").value = student.grade;
  $("#studentName").value = student.name;
  $("#studentMeal").value = student.meal;
  setCheckedValues("studentCourse", student.courses || []);
  setCheckedValues("fixedLeave", student.fixedLeave);
  setFixedLateValues(student.fixedLate);
  $("#studentSubmitButton").textContent = "儲存學生修改";
  $("#cancelStudentEdit").hidden = false;
}

function setupTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (mobileQuery.matches && button.classList.contains("desktop-only")) return;
      $$(".tab-button").forEach((tab) => tab.classList.remove("active"));
      $$(".page").forEach((page) => page.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.tab}`).classList.add("active");
      renderAll();
    });
  });
}

function enforceMobilePages() {
  if (!mobileQuery.matches) return;
  const activePage = $(".page.active");
  if (activePage && ["history"].includes(activePage.id)) {
    document.querySelector('[data-tab="dashboard"]').click();
  }
}

function setupDashboardFilter() {
  $$(".grade-button").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardGrade = button.dataset.grade;
      $$(".grade-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderAll();
    });
  });

  $$(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMode = button.dataset.mode;
      $$(".mode-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderAll();
    });
  });
}

function setupForms() {
  $("#studentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = {
      grade: $("#studentGrade").value,
      name: $("#studentName").value.trim(),
      courses: selectedValues("studentCourse"),
      meal: $("#studentMeal").value,
      fixedLeave: selectedValues("fixedLeave"),
      fixedLate: selectedFixedLate(),
    };
    if (editingStudentId) {
      const student = getStudent(editingStudentId);
      if (student) Object.assign(student, payload);
    } else {
      state.students.push({
        id: crypto.randomUUID(),
        ...payload,
      });
    }
    clearStudentForm();
    saveState();
    renderAll();
  });

  $("#cancelStudentEdit").addEventListener("click", () => {
    clearStudentForm();
    renderAll();
  });

  $("#leaveForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const submitButton = event.submitter;
    const studentId = $("#leaveStudent").value;
    const start = $("#leaveStartDate").value;
    const end = $("#leaveEndDate").value;
    if (!studentId) return alert("請先選擇學生");
    if (end < start) return alert("結束日期不能早於開始日期");
    const periods = $$("input[name='leavePeriod']:checked").map((input) => input.value);

    state.leaves.push({
      id: crypto.randomUUID(),
      studentId,
      date: start,
      startDate: start,
      endDate: end,
      periods,
      note: $("#leaveNote").value.trim(),
      createdAt: new Date().toISOString(),
    });

    saveState();
    renderAll();
    resetLeaveForm();
    flashButton(submitButton, "已新增");
  });

  $("#lateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("#lateStudent").value) return alert("請先選擇學生");
    state.lateRecords.push({
      id: crypto.randomUUID(),
      studentId: $("#lateStudent").value,
      date: $("#lateDate").value,
      type: "臨時晚到",
      note: $("#lateNote").value.trim(),
      createdAt: new Date().toISOString(),
    });
    $("#lateNote").value = "";
    saveState();
    renderAll();
  });

  $("#examForm").addEventListener("submit", saveExam);
  $("#resetExamForm").addEventListener("click", resetExamForm);
  $("#termScoreForm").addEventListener("submit", saveTermScore);
  $("#archiveTerm").addEventListener("click", archiveCurrentTerm);
  $("#saveSchedule").addEventListener("click", (event) => {
    saveSchedule();
    flashButton(event.currentTarget, "已儲存");
  });
  $("#printClassReport").addEventListener("click", printClassReportPdf);
  $("#printStudentReport").addEventListener("click", printStudentReportPdf);

  $("#leaveGrade").addEventListener("change", () => {
    $("#leaveStudentPicker").value = "";
    $("#leaveStudent").value = "";
    renderAll();
  });

  $("#leaveStudentPicker").addEventListener("focus", () => renderLeaveStudentOptions(true));
  $("#leaveStudentPicker").addEventListener("click", () => renderLeaveStudentOptions(true));
  $("#leaveStudentPicker").addEventListener("input", () => {
    $("#leaveStudent").value = "";
    renderLeaveStudentOptions(true);
  });

  document.addEventListener("click", (event) => {
    if (!$("#leaveStudentCombo").contains(event.target)) {
      $("#leaveStudentOptions").hidden = true;
    }
  });

  ["studentFilter", "studentSearch", "lateGrade", "historyType", "historySearch", "scheduleGrade", "examGrade", "examSubject", "examPaperCount", "examNoTest", "scoreStudentSearch", "scoreStudentFilter", "careerGrade", "careerStudent"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderAll);
  });

  $("#parentSubjectFilter")?.addEventListener("input", () => {
    if (parentStudentId) renderParentPortal();
  });
}

function updateClock() {
  const now = new Date();
  $("#currentDate").textContent = now.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  $("#currentTime").textContent = now.toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function leaveStatus(record) {
  const today = todayISO();
  const start = getLeaveStart(record);
  const end = getLeaveEnd(record);
  if (start > today) return { className: "", label: "未到日期", active: true };
  if (end === today) return { className: "ending", label: "今日即將結束", active: true };
  if (start <= today && end >= today) return { className: "ending", label: "請假中", active: true };
  return { className: "done", label: "已結束", active: false };
}

function renderStudentOptions() {
  const renderLeaveOptions = () => {
    renderLeaveStudentOptions(false);
  };

  const renderOptions = (gradeSelector, studentSelector) => {
    const grade = $(gradeSelector).value;
    const options = state.students
      .filter((student) => student.grade === grade)
      .map((student) => `<option value="${student.id}">${student.name}</option>`)
      .join("");
    $(studentSelector).innerHTML = options || `<option value="">請先建立學生檔案</option>`;
  };
  renderLeaveOptions();
  renderOptions("#lateGrade", "#lateStudent");
  renderOptions("#careerGrade", "#careerStudent");
}

function leaveStudentMatches() {
  const grade = $("#leaveGrade").value;
  const keyword = $("#leaveStudentPicker").value.trim();
  return state.students
    .filter((student) => student.grade === grade)
    .filter((student) => !keyword || student.name.includes(keyword));
}

function renderLeaveStudentOptions(open) {
  const optionsBox = $("#leaveStudentOptions");
  const matches = leaveStudentMatches();
  optionsBox.innerHTML = matches.length
    ? matches.map((student) => `
        <button type="button" class="combo-option" data-pick-leave-student="${student.id}">
          <strong>${student.name}</strong>
          <span>${student.grade}</span>
        </button>
      `).join("")
    : `<div class="combo-empty">沒有符合的學生</div>`;
  optionsBox.hidden = !open;
}

function normalizeDayToken(value) {
  const text = String(value || "").trim();
  const map = {
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    一: "一",
    二: "二",
    三: "三",
    四: "四",
    五: "五",
    星期一: "一",
    星期二: "二",
    星期三: "三",
    星期四: "四",
    星期五: "五",
    週一: "一",
    週二: "二",
    週三: "三",
    週四: "四",
    週五: "五",
  };
  return map[text] || "";
}

function parseWeekdays(value) {
  const text = String(value || "")
    .replaceAll("星期", "")
    .replaceAll("週", "")
    .replaceAll("禮拜", "")
    .replace(/[、，,／/|;；\s]+/g, "");
  return [...new Set([...text].map(normalizeDayToken).filter(Boolean))];
}

function parseFixedLate(value) {
  return String(value || "")
    .split(/[;；\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const dayMatch = part.match(/(?:星期|週|禮拜)?([一二三四五]|[1-5])/);
      const timeMatch = part.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
      const day = dayMatch ? normalizeDayToken(dayMatch[1]) : "";
      const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "";
      const reason = part
        .replace(/(?:星期|週|禮拜)?[一二三四五1-5]/, "")
        .replace(/([01]?\d|2[0-3])[:：]([0-5]\d)/, "")
        .trim();
      return { day, time, reason };
    })
    .filter((item) => item.day);
}

function rowValue(row, names) {
  const key = names.find((name) => Object.prototype.hasOwnProperty.call(row, name));
  return key ? row[key] : "";
}

function cleanCellText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u00A0\u3000]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeGradeText(value) {
  const text = cleanCellText(value)
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace("年級", "")
    .replace("國中", "")
    .replace("國", "");
  const map = {
    一: "國一",
    1: "國一",
    七: "國一",
    7: "國一",
    二: "國二",
    2: "國二",
    八: "國二",
    8: "國二",
    三: "國三",
    3: "國三",
    九: "國三",
    9: "國三",
  };
  if (grades.includes(cleanCellText(value))) return cleanCellText(value);
  return map[text] || "";
}

function renderStudents() {
  const grade = $("#studentFilter").value;
  const keyword = $("#studentSearch").value.trim();
  const rows = state.students
    .filter((student) => grade === "全部" || student.grade === grade)
    .filter((student) => !keyword || student.name.includes(keyword))
    .map((student) => {
      const leaveCount = state.leaves
        .filter((record) => record.studentId === student.id)
        .reduce((sum, record) => sum + leaveDayCount(record, student), 0);
      const lateCount = state.lateRecords.filter((record) => record.studentId === student.id).length + student.fixedLate.length;
      return `
        <tr>
          <td>${student.grade}</td>
          <td>${student.name}</td>
          <td>${studentCoursesLabel(student)}</td>
          <td>${student.meal}</td>
          <td>請假 ${leaveCount} / 晚到 ${lateCount}</td>
          <td>${student.fixedLeave.map((day) => `星期${day}`).join("、") || "-"}</td>
          <td>${student.fixedLate.map((item) => `星期${item.day}${item.time ? ` ${item.time}` : ""}${item.reason ? ` ${item.reason}` : ""}`).join("、") || "-"}</td>
          <td><code>${student.parentCode}</code><br><small>${parentPortalUrl()}</small></td>
          <td>
            <div class="action-row">
              <button class="ghost" data-edit-student="${student.id}">編輯</button>
              <button class="ghost danger" data-delete-student="${student.id}">移除學生</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  $("#studentTable").innerHTML = rows || `<tr><td colspan="9">尚無學生資料</td></tr>`;
}

function renderActiveLeaves() {
  const today = todayISO();
  const ids = dashboardStudentIds();
  const regularRecords = state.leaves
    .filter((record) => {
      const student = getStudent(record.studentId);
      if (!student || studentClassDatesForLeave(record, student).length === 0) return false;
      if (record.dismissedAt || !ids.has(record.studentId)) return false;
      if (dashboardMode === "today") {
        return getLeaveStart(record) <= today && getLeaveEnd(record) >= today && studentHasClassOnDate(student, today);
      }
      return studentClassDatesForLeave(record, student).some((date) => date >= today);
    });
  const fixedRecords = buildFixedLeaveRecords(today, ids);
  const records = [...regularRecords, ...fixedRecords]
    .sort((a, b) => getLeaveStart(a).localeCompare(getLeaveStart(b)));
  $("#activeLeaveCount").textContent = records.length;
  $("#activeLeaveList").innerHTML = records.map(renderLeaveCard).join("") || `<div class="empty">目前沒有亮燈中的請假。</div>`;
}

function buildFixedLeaveRecords(today, ids) {
  const days = dashboardMode === "today" ? [today] : datesBetween(today, addDays(today, 6));
  return state.students
    .filter((student) => ids.has(student.id))
    .flatMap((student) => days
      .filter((date) => studentHasClassOnDate(student, date) && student.fixedLeave.includes(weekdayFromDate(date)))
      .map((date) => ({
        id: `fixed-leave-${student.id}-${date}`,
        studentId: student.id,
        date,
        startDate: date,
        endDate: date,
        periods: [],
        note: "固定請假",
        fixed: true,
      })));
}

function renderLeaveCard(record) {
  const student = getStudent(record.studentId);
  if (!student) return "";
  const status = leaveStatus(record);
  const dayCount = leaveDayCount(record, student);
  if (dayCount === 0) return "";
  return `
    <article class="record-card ${status.className}">
      <strong>${studentLabel(student)}</strong>
      <div class="meta">
        <span class="badge green">${status.label}</span>
        <span class="badge">${leaveDateLabel(record)}</span>
        <span class="badge">${leavePeriodLabel(record)}</span>
        <span class="badge">${dayCount} 天</span>
        <span class="badge">課程：${studentCoursesLabel(student)}</span>
        <span class="badge">${student.meal}</span>
        ${record.note ? `<span class="badge gold">${record.note}</span>` : ""}
      </div>
    </article>
  `;
}

function renderLateBoard() {
  const today = todayISO();
  const todayWeekday = weekdayFromDate(today);
  const ids = dashboardStudentIds();
  const fixed = state.students
    .filter((student) => ids.has(student.id) && student.fixedLate.some((item) => item.day === todayWeekday))
    .map((student) => {
      const fixedLate = student.fixedLate.find((item) => item.day === todayWeekday);
      return {
        student,
        date: today,
        type: "固定晚到",
        note: `每週${todayWeekday}${fixedLate.time ? ` ${fixedLate.time} 到班` : ""}${fixedLate.reason ? `｜${fixedLate.reason}` : ""}`,
      };
    });
  const temporary = state.lateRecords
    .filter((record) => {
      if (record.dismissedAt || !ids.has(record.studentId)) return false;
      if (dashboardMode === "today") return record.date === today;
      return record.date >= today;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((record) => ({ ...record, student: getStudent(record.studentId) }))
    .filter((record) => record.student);
  const records = [...fixed, ...temporary];
  $("#todayLateCount").textContent = fixed.length + temporary.filter((record) => record.date === today).length;
  $("#lateList").innerHTML = records.map(renderLateCard).join("") || `<div class="empty">今日與未來暫無晚到。</div>`;
}

function renderLateCard(record) {
  return `
    <article class="record-card late">
      <strong>${studentLabel(record.student)}</strong>
      <div class="meta">
        <span class="badge">${record.type}</span>
        <span class="badge">${dateLabel(record.date)}</span>
        ${record.note ? `<span class="badge gold">${record.note}</span>` : ""}
      </div>
    </article>
  `;
}

function renderManageLists() {
  $("#leaveManageList").innerHTML = state.leaves
    .slice()
    .filter((record) => leaveDayCount(record) > 0)
    .sort((a, b) => getLeaveStart(b).localeCompare(getLeaveStart(a)))
    .map((record) => `${renderLeaveCard(record)}
      <div class="action-row">
        ${record.dismissedAt ? "" : `<button class="ghost" data-dismiss-leave="${record.id}">結束顯示但保留紀錄</button>`}
        <button class="ghost danger" data-delete-leave="${record.id}">移除請假</button>
      </div>`)
    .join("") || `<div class="empty">尚未新增請假日期。</div>`;

  $("#lateManageList").innerHTML = state.lateRecords
    .slice()
    .sort(byDateDesc)
    .map((record) => {
      const student = getStudent(record.studentId);
      if (!student) return "";
      return `${renderLateCard({ ...record, student })}
        <div class="action-row">
          ${record.dismissedAt ? "" : `<button class="ghost" data-remove-late="${record.id}">結束顯示但保留紀錄</button>`}
        </div>`;
    })
    .join("") || `<div class="empty">尚未新增臨時晚到。</div>`;
}

function renderHistory() {
  const type = $("#historyType").value;
  const keyword = $("#historySearch").value.trim();
  const leaveItems = state.leaves.map((record) => ({ ...record, type: "請假" }));
  const lateItems = state.lateRecords.map((record) => ({ ...record, type: "晚到" }));
  const items = [...leaveItems, ...lateItems]
    .filter((item) => type === "全部" || item.type === type)
    .filter((item) => item.type !== "請假" || leaveDayCount(item) > 0)
    .filter((item) => {
      const student = getStudent(item.studentId);
      const haystack = `${student ? studentLabel(student) : ""}${item.note || ""}`;
      return !keyword || haystack.includes(keyword);
    })
    .sort((a, b) => (getLeaveStart(b) || b.date).localeCompare(getLeaveStart(a) || a.date));

  $("#historyList").innerHTML = items.map((item) => {
    const student = getStudent(item.studentId);
    if (!student) return "";
    return `
      <article class="record-card ${item.type === "晚到" ? "late" : leaveStatus(item).className}">
        <strong>${studentLabel(student)}</strong>
        <div class="meta">
          <span class="badge">${item.type}</span>
          <span class="badge">${item.type === "請假" ? leaveDateLabel(item) : dateLabel(item.date)}</span>
          ${item.type === "請假" ? `<span class="badge">${leavePeriodLabel(item)}</span><span class="badge">${leaveDayCount(item, student)} 天</span><span class="badge">課程：${studentCoursesLabel(student)}</span>` : ""}
          <span class="badge">${item.type === "請假" ? leaveStatus(item).label : item.type}</span>
          ${item.note ? `<span class="badge gold">${item.note}</span>` : ""}
        </div>
      </article>
    `;
  }).join("") || `<div class="empty">目前沒有符合條件的歷史紀錄。</div>`;
}

function setupActions() {
  document.addEventListener("click", (event) => {
    const deleteStudentId = event.target.dataset.deleteStudent;
    const editStudentId = event.target.dataset.editStudent;
    const pickLeaveStudentId = event.target.dataset.pickLeaveStudent;
    const dismissLeaveId = event.target.dataset.dismissLeave;
    const deleteLeaveId = event.target.dataset.deleteLeave;
    const removeLateId = event.target.dataset.removeLate;
    const editExamId = event.target.dataset.editExam;
    const deleteExamId = event.target.dataset.deleteExam;

    if (pickLeaveStudentId) {
      const student = getStudent(pickLeaveStudentId);
      if (student) {
        $("#leaveStudent").value = student.id;
        $("#leaveStudentPicker").value = student.name;
        $("#leaveStudentOptions").hidden = true;
      }
    }
    if (editStudentId) {
      const student = getStudent(editStudentId);
      if (student) {
        fillStudentForm(student);
        document.querySelector('[data-tab="students"]').click();
        $("#studentName").focus();
      }
    }
    if (deleteStudentId && confirm("確定移除這位學生檔案？相關請假與晚到紀錄也會一起移除。")) {
      state.students = state.students.filter((student) => student.id !== deleteStudentId);
      state.leaves = state.leaves.filter((record) => record.studentId !== deleteStudentId);
      state.lateRecords = state.lateRecords.filter((record) => record.studentId !== deleteStudentId);
      if (editingStudentId === deleteStudentId) clearStudentForm();
    }
    if (dismissLeaveId) {
      const leave = state.leaves.find((record) => record.id === dismissLeaveId);
      if (leave) leave.dismissedAt = new Date().toISOString();
    }
    if (deleteLeaveId && confirm("確定移除這筆請假？這會從歷史紀錄中刪除。")) {
      state.leaves = state.leaves.filter((record) => record.id !== deleteLeaveId);
    }
    if (removeLateId) {
      const late = state.lateRecords.find((record) => record.id === removeLateId);
      if (late) late.dismissedAt = new Date().toISOString();
    }
    if (editExamId) {
      const exam = state.exams.find((record) => record.id === editExamId);
      if (exam) {
        fillExamForm(exam);
        document.querySelector('[data-tab="scores"]').click();
        $("#examDate").focus();
      }
    }
    if (deleteExamId && confirm("確定刪除這份成績單？刪除後家長端與生涯檔案也不會再顯示這次考試。")) {
      state.exams = state.exams.filter((record) => record.id !== deleteExamId);
      if (editingExamId === deleteExamId) {
        editingExamId = null;
        updateExamFormMode();
      }
    }

    if (deleteStudentId || dismissLeaveId || deleteLeaveId || removeLateId || deleteExamId) {
      saveState();
      renderAll();
    }
  });
}

function showLogin() {
  $("#loginScreen").hidden = false;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = true;
  $("#appShell").hidden = true;
  $("#loginPassword").value = "";
  $("#loginPassword").focus();
}

function showApp() {
  $("#loginScreen").hidden = true;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = true;
  $("#appShell").hidden = false;
  $("#currentBranchLabel").textContent = `${currentBranch}分校`;
}

function showParentLogin() {
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = true;
  $("#parentShell").hidden = true;
  $("#parentLoginScreen").hidden = false;
  $("#parentCode").focus();
}

function showParentShell() {
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = true;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = false;
}

async function loadParentBranchState(branch) {
  currentBranch = branch;
  state = loadState();
  if (hasSupabaseConfig()) {
    const { createClient } = await import(`https://esm.sh/@supabase/supabase-js@${SUPABASE_SDK_VERSION}`);
    supabaseClient = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    const remote = await loadSupabaseState();
    if (remote) state = normalizeState(remote.data || emptyState());
  }
}

function studentScoreSummary(student, subjectFilter = "全部") {
  return courses
    .filter((subject) => subjectFilter === "全部" || subject === subjectFilter)
    .map((subject) => {
    const exams = state.exams.filter((exam) => !exam.noExam && exam.subject === subject && exam.scores?.[student.id] !== undefined);
    if (!exams.length) return "";
    const scores = exams.map((exam) => averageScore(scoreValuesForStudent(exam, student.id))).filter(Number.isFinite);
    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const classRows = state.exams
      .filter((exam) => !exam.noExam && exam.subject === subject)
      .flatMap((exam) => Object.keys(exam.scores || {}).map((studentId) => averageScore(scoreValuesForStudent(exam, studentId))))
      .filter(Number.isFinite);
    const classAvg = classRows.length ? classRows.reduce((sum, score) => sum + score, 0) / classRows.length : NaN;
    const latest = exams.sort((a, b) => b.date.localeCompare(a.date))[0];
    const rankRows = currentScoreRows(latest);
    const rank = rankRows.find((row) => row.student.id === student.id)?.rank || "-";
    return `<article class="record-card"><strong>${subject}</strong><div class="meta"><span class="badge">個人平均 ${avg.toFixed(1)}</span><span class="badge">班平均 ${Number.isFinite(classAvg) ? classAvg.toFixed(1) : "-"}</span><span class="badge">最新排名 ${rank}</span></div></article>`;
  }).filter(Boolean).join("") || `<div class="empty">尚無成績紀錄。</div>`;
}

function studentAvailableSubjects(student) {
  const subjects = new Set(student.courses || []);
  studentExamRows(student).forEach((row) => subjects.add(row.exam.subject));
  state.termScores
    .filter((item) => item.studentId === student.id)
    .forEach((item) => subjects.add(normalizeCourseName(item.subject)));
  return courses.filter((subject) => subjects.has(subject));
}

function renderParentSubjectOptions(student) {
  const target = $("#parentSubjectFilter");
  if (!target) return;
  const previous = target.value;
  const subjects = studentAvailableSubjects(student);
  target.innerHTML = `<option value="全部">全部科目</option>${subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("")}`;
  target.value = previous && [...subjects, "全部"].includes(previous) ? previous : "全部";
}

function renderParentScoreHistory(student) {
  const subject = $("#parentSubjectFilter")?.value || "全部";
  const rows = studentExamRows(student)
    .filter((row) => subject === "全部" || row.exam.subject === subject)
    .slice()
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => subject === "全部" || normalizeCourseName(item.subject) === subject)
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!rows.length && !termRows.length) return `<div class="empty">尚無此科目的歷史成績。</div>`;

  return `
    <div class="parent-history-head">
      <strong>${subject === "全部" ? "全部科目歷史成績" : `${subject} 歷史成績`}</strong>
      <span>可調閱週考、段考與排名紀錄</span>
    </div>
    ${studentScoreSummary(student, subject)}
    <h3 class="subhead">週考歷史</h3>
    <div class="table-wrap parent-score-history">
      <table>
        <thead>
          <tr><th>日期</th><th>科目</th><th>考試重點</th><th>各卷分數</th><th>平均</th><th>排名</th><th>班平均</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const classRows = currentScoreRows(row.exam);
            const classAverage = classRows.length ? classRows.reduce((sum, item) => sum + item.score, 0) / classRows.length : NaN;
            const rank = classRows.find((item) => item.student.id === student.id)?.rank || "-";
            return `
              <tr>
                <td>${dateLabel(row.exam.date)}</td>
                <td>${row.exam.subject}</td>
                <td>${row.exam.scope || "-"}</td>
                <td>${row.papers.map(scoreDisplay).join(" / ")}</td>
                <td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td>
                <td>${rank}</td>
                <td>${scoreDisplay(classAverage)}</td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="7">尚無週考歷史</td></tr>`}
        </tbody>
      </table>
    </div>
    <h3 class="subhead">段考歷史</h3>
    <div class="table-wrap parent-score-history">
      <table>
        <thead>
          <tr><th>學期</th><th>段別</th><th>科目</th><th>成績</th><th>建立日期</th></tr>
        </thead>
        <tbody>
          ${termRows.map((item) => `
            <tr>
              <td>${item.term || "-"}</td>
              <td>${item.stage || "-"}</td>
              <td>${item.subject || "-"}</td>
              <td class="${scoreClass(Number(item.score))}">${scoreDisplay(Number(item.score))}</td>
              <td>${item.createdAt ? dateLabel(item.createdAt.slice(0, 10)) : "-"}</td>
            </tr>
          `).join("") || `<tr><td colspan="5">尚無段考歷史</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderParentPortal() {
  const student = getStudent(parentStudentId);
  if (!student) return;
  $("#parentStudentTitle").textContent = `${student.name} 生涯檔案`;
  $("#parentLeaveList").innerHTML = state.leaves
    .filter((record) => record.studentId === student.id)
    .sort((a, b) => getLeaveStart(b).localeCompare(getLeaveStart(a)))
    .map(renderLeaveCard)
    .join("") || `<div class="empty">尚無請假紀錄。</div>`;
  renderParentSubjectOptions(student);
  $("#parentScoreList").innerHTML = renderParentScoreHistory(student);
  $("#parentReport").innerHTML = renderStudentReportHtml(student);
}

function setupLogin() {
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("#loginPassword").value !== LOGIN_PASSWORD) {
      $("#loginError").hidden = false;
      $("#loginPassword").select();
      return;
    }

    currentBranch = $("#loginBranch").value;
    sessionStorage.setItem(SESSION_KEY, currentBranch);
    state = loadState();
    $("#loginError").hidden = true;
    showApp();
    setupCloudSync();
    saveState();
    renderAll();
  });

  $("#logoutButton").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    currentBranch = "";
    state = emptyState();
    cleanupCloudSync();
    setSyncStatus("本機模式");
    showLogin();
  });

  $("#parentLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadParentBranchState($("#parentBranch").value);
    const code = cleanCellText($("#parentCode").value).toUpperCase();
    const student = state.students.find((item) => cleanCellText(item.parentCode).toUpperCase() === code);
    if (!student) {
      $("#parentLoginError").hidden = false;
      $("#parentCode").select();
      return;
    }
    parentStudentId = student.id;
    $("#parentLoginError").hidden = true;
    showParentShell();
    renderParentPortal();
  });

  $("#parentLogout").addEventListener("click", showParentLogin);
  $("#backTeacherLogin").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    showLogin();
  });
}

function renderAll() {
  $("#studentCount").textContent = dashboardStudents().length;
  renderExamSubjectOptions();
  renderScoreStudentFilter();
  renderExpectedAttendance();
  renderStudentOptions();
  renderStudents();
  renderSchedule();
  renderScoreEntryList();
  renderClassReport();
  renderExamHistory();
  renderStudentReport();
  renderActiveLeaves();
  renderLateBoard();
  renderManageLists();
  renderHistory();
}

function boot() {
  renderCourseInputs("studentCourses", "studentCourse");
  renderWeekdayInputs("studentFixedLeave", "fixedLeave");
  renderFixedLateInputs();
  renderSubjectOptions("termSubject", false);
  resetLeaveForm();
  $("#examDate").value = todayISO();
  renderExamSubjectOptions();
  $("#lateDate").value = todayISO();
  setupTabs();
  mobileQuery.addEventListener("change", enforceMobilePages);
  setupDashboardFilter();
  setupForms();
  setupActions();
  setupLogin();
  updateClock();
  setInterval(updateClock, 1000);
  if (parentMode) {
    cleanupCloudSync();
    showParentLogin();
  } else if (currentBranch) {
    showApp();
    setupCloudSync();
    saveState();
    renderAll();
    enforceMobilePages();
  } else {
    showLogin();
  }
}

boot();
