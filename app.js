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
const termStages = ["一段", "二段", "三段"];
const courses = ["國文", "英文", "數A", "數B", "數學", "數輔", "自然", "總複習", "素養課", "讀書班"];
const termSubjects = ["國文", "英文", "數學", "自然", "歷史", "地理", "公民"];
const reportSubjects = [...new Set([...courses, ...termSubjects])];
const scheduleCourses = [...courses, "考加"];
const leavePeriods = ["上午", "下午", "晚上"];
const parentMode = new URLSearchParams(location.search).get("parent") === "1" || location.hash === "#parent";

let dashboardGrade = "全體";
let dashboardMode = "today";
let editingStudentId = null;
let editingExamId = null;
let selectedClassReportExamId = null;
let scoreSection = "entry";
let termSection = "entry";
let scoreDraft = null;
let careerSubject = "全部";
let parentCareerSubject = "全部";
let editingEventId = null;
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
const parentTabs = {
  leave: "attendance",
  late: "attendance",
  history: "attendance",
  students: "management",
  schedule: "management",
  scores: "management",
  term: "management",
  "class-ops": "class-ops",
  career: "management",
  events: "management",
};

function academicPeriodForDate(date = todayISO()) {
  const value = date || todayISO();
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText) || new Date().getFullYear();
  const month = Number(monthText) || new Date().getMonth() + 1;
  return {
    academicYear: String(month >= 8 ? year - 1911 : year - 1912),
    semester: month >= 8 || month === 1 ? "上學期" : "下學期",
  };
}

function defaultAcademicSettings() {
  return academicPeriodForDate();
}

function normalizeAcademicSettings(settings = {}) {
  const fallback = defaultAcademicSettings();
  return {
    academicYear: String(settings.academicYear || settings.year || fallback.academicYear),
    semester: ["上學期", "下學期"].includes(settings.semester) ? settings.semester : fallback.semester,
  };
}

function emptyState() {
  return {
    students: [],
    leaves: [],
    lateRecords: [],
    schedule: defaultSchedule(),
    settings: defaultAcademicSettings(),
    exams: [],
    termScores: [],
    termPeriods: {},
    events: [],
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
    settings: normalizeAcademicSettings(raw.settings),
    exams: (raw.exams || []).map(normalizeExam),
    termScores: (raw.termScores || []).map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      date: item.date || item.createdAt?.slice(0, 10) || todayISO(),
    })),
    termPeriods: normalizeTermPeriods(raw.termPeriods || {}),
    events: normalizeEvents(raw.events || []),
    archives: raw.archives || [],
  };
}

function normalizeTermPeriods(raw) {
  return Object.fromEntries(Object.entries(raw || {})
    .filter(([, value]) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)));
}

function normalizeEvents(records) {
  return (records || []).map((record) => ({
    id: record.id || crypto.randomUUID(),
    grade: ["全體", ...grades].includes(record.grade) ? record.grade : "全體",
    type: ["固定重大事件", "臨時重大事件"].includes(record.type) ? record.type : "臨時重大事件",
    date: record.date || todayISO(),
    title: record.title || "",
    note: record.note || "",
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  })).filter((record) => record.title.trim());
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
    數輔: "數輔",
    數學輔導: "數輔",
    數學輔導課: "數輔",
    社: "社會",
    社會: "社會",
    自: "自然",
    自然: "自然",
    歷: "歷史",
    歷史: "歷史",
    地: "地理",
    地理: "地理",
    公: "公民",
    公民: "公民",
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
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateUniqueParentCode(excludeStudentId = "") {
  for (let index = 0; index < 200; index += 1) {
    const code = generateParentCode();
    if (!parentCodeTaken(code, excludeStudentId)) return code;
  }
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}

function normalizeExam(exam) {
  const inferredPeriod = academicPeriodForDate(exam.date || todayISO());
  return {
    id: exam.id || crypto.randomUUID(),
    date: exam.date || todayISO(),
    academicYear: String(exam.academicYear || exam.year || inferredPeriod.academicYear),
    semester: ["上學期", "下學期"].includes(exam.semester) ? exam.semester : inferredPeriod.semester,
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

function renderSyncedState() {
  if (parentStudentId && !$("#parentShell")?.hidden) {
    renderParentPortal();
    return;
  }
  if (!$("#appShell")?.hidden) renderAll();
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
      renderSyncedState();
    }

    syncReady = true;
    setSyncStatus("同步中");
    if (!remote) await saveSupabaseState();
    supabasePollTimer = setInterval(checkSupabaseState, 3000);
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
      renderSyncedState();
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
        renderSyncedState();
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
  const mathGroup = ["數A", "數B", "數學", "數輔"];
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
  const list = targetId === "termSubject" ? termSubjects : courses;
  const target = $(`#${targetId}`);
  if (!target) return;
  target.innerHTML = list.map((course) => `<option value="${course}">${course}</option>`).join("");
}

function mathCoursesForGrade(grade) {
  const mathGroup = ["數A", "數B", "數學", "數輔"];
  return mathGroup.filter((course) => state.students.some((student) => student.grade === grade && student.courses.includes(course)));
}

function studentTakesSubject(student, subject) {
  if (!student) return false;
  if (student.courses.includes(subject)) return true;
  if (subject === "數輔") return student.courses.some((course) => ["數A", "數B", "數學", "數輔"].includes(course));
  return false;
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

function scheduledSubjectsForStudentDate(student, date) {
  if (!student) return [];
  const subjects = examSubjectsForDateAndGrade(date, student.grade)
    .filter((subject) => studentTakesSubject(student, subject));
  return subjects.length ? subjects : studentAvailableSubjects(student);
}

function scheduledSubjectLabel(subjects) {
  return subjects.length ? subjects.join("、") : "當日課程";
}

function renderExamSubjectOptions() {
  const target = $("#examSubject");
  if (!target) return;
  const previous = target.value;
  const subjects = examSubjectsForDateAndGrade($("#examDate").value || todayISO(), $("#examGrade").value || "國一");
  target.innerHTML = subjects.map((course) => `<option value="${course}">${course}</option>`).join("");
  target.value = subjects.includes(previous) ? previous : subjects[0] || "國文";
}

function activeAcademicPeriod() {
  return normalizeAcademicSettings(state.settings);
}

function academicPeriodLabel(period = activeAcademicPeriod()) {
  return `${period.academicYear}${period.semester}`;
}

function renderAcademicSettings() {
  const settings = activeAcademicPeriod();
  if ($("#academicYear")) $("#academicYear").value = settings.academicYear;
  if ($("#academicSemester")) $("#academicSemester").value = settings.semester;
  if ($("#examAcademicLabel")) $("#examAcademicLabel").textContent = academicPeriodLabel(settings);
}

function weeklyExamYears(student = null) {
  const ids = student ? new Set([student.id]) : null;
  const current = activeAcademicPeriod().academicYear;
  const years = new Set([current]);
  state.exams.forEach((exam) => {
    if (ids && exam.scores?.[student.id] === undefined) return;
    if (exam.academicYear) years.add(String(exam.academicYear));
  });
  return [...years].filter(Boolean).sort((a, b) => String(b).localeCompare(String(a), "zh-Hant"));
}

function renderWeeklyYearOptions(targetId, student = null) {
  const target = $(`#${targetId}`);
  if (!target) return;
  const previous = target.value;
  const years = weeklyExamYears(student);
  target.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  const currentYear = activeAcademicPeriod().academicYear;
  target.value = previous && years.includes(previous) ? previous : (years.includes(currentYear) ? currentYear : years[0] || "");
}

function weeklyPeriodFilter(prefix, student = null) {
  renderWeeklyYearOptions(`${prefix}Year`, student);
  return {
    academicYear: $(`#${prefix}Year`)?.value || activeAcademicPeriod().academicYear,
    semester: $(`#${prefix}Semester`)?.value || "全部",
  };
}

function examMatchesWeeklyPeriod(exam, period) {
  if (!period) return true;
  return String(exam.academicYear || "") === String(period.academicYear || "") &&
    (period.semester === "全部" || exam.semester === period.semester);
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
    .filter((student) => studentTakesSubject(student, subject));
}

function visibleScoreStudents() {
  const keyword = $("#scoreStudentPicker")?.value.trim() || "";
  const selected = $("#scoreStudentFilter")?.value || "全部";
  return studentsForGradeAndSubject($("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文")
    .filter((student) => selected === "全部" || student.id === selected)
    .filter((student) => !keyword || student.name.includes(keyword));
}

function scoreStudentMatches() {
  const keyword = $("#scoreStudentPicker")?.value.trim() || "";
  return studentsForGradeAndSubject($("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文")
    .filter((student) => !keyword || student.name.includes(keyword));
}

function renderScoreStudentOptions(open = false) {
  const optionsBox = $("#scoreStudentOptions");
  if (optionsBox) optionsBox.hidden = true;
}

function renderScoreStudentFilter() {
  const target = $("#scoreStudentFilter");
  if (!target) return;
  const previous = target.value || "全部";
  const students = studentsForGradeAndSubject($("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文");
  target.value = previous === "全部" || students.some((student) => student.id === previous) ? previous : "全部";
  const selected = getStudent(target.value);
  $("#scoreStudentPicker").value = target.value === "全部" ? "" : selected?.name || "";
  renderScoreStudentOptions(false);
}

function scoreDraftKey() {
  return `${STORAGE_KEY_PREFIX}-score-draft-${currentBranch || "local"}`;
}

function loadScoreDraft() {
  try {
    scoreDraft = JSON.parse(localStorage.getItem(scoreDraftKey()) || "null");
  } catch (_error) {
    scoreDraft = null;
  }
}

function saveScoreDraft() {
  if (!scoreDraft) return localStorage.removeItem(scoreDraftKey());
  localStorage.setItem(scoreDraftKey(), JSON.stringify(scoreDraft));
}

function clearScoreDraft() {
  scoreDraft = null;
  localStorage.removeItem(scoreDraftKey());
}

function captureScoreDraft() {
  if (!$("#examForm")) return;
  const draft = scoreDraft || { scores: {}, absences: [] };
  const nextKey = [$("#examDate").value, $("#examGrade").value, $("#examSubject").value].join("|");
  if (draft.key && draft.key !== nextKey) {
    draft.scores = {};
    draft.absences = [];
  }
  draft.key = nextKey;
  draft.editingExamId = editingExamId;
  draft.date = $("#examDate").value;
  draft.grade = $("#examGrade").value;
  draft.subject = $("#examSubject").value;
  draft.scope = $("#examScope").value;
  draft.paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  draft.noExam = $("#examNoTest").checked;
  draft.scores = draft.scores || {};
  draft.absences = Array.isArray(draft.absences) ? draft.absences : [];
  $$("[data-score-student]").forEach((input) => {
    const studentId = input.dataset.scoreStudent;
    const paper = input.dataset.scorePaper;
    if (!draft.scores[studentId]) draft.scores[studentId] = {};
    if (input.value === "") {
      delete draft.scores[studentId][paper];
    } else {
      draft.scores[studentId][paper] = input.value;
    }
  });
  $$("[data-score-absent]").forEach((input) => {
    const studentId = input.dataset.scoreAbsent;
    draft.absences = draft.absences.filter((id) => id !== studentId);
    if (input.classList.contains("active")) draft.absences.push(studentId);
  });
  scoreDraft = draft;
  saveScoreDraft();
}

function restoreScoreDraftMeta() {
  if (!scoreDraft || !$("#examForm")) return;
  if (scoreDraft.date) $("#examDate").value = scoreDraft.date;
  if (scoreDraft.grade) $("#examGrade").value = scoreDraft.grade;
  renderExamSubjectOptions();
  if (scoreDraft.subject && !Array.from($("#examSubject").options).some((option) => option.value === scoreDraft.subject)) {
    $("#examSubject").insertAdjacentHTML("beforeend", `<option value="${scoreDraft.subject}">${scoreDraft.subject}</option>`);
  }
  if (scoreDraft.subject) $("#examSubject").value = scoreDraft.subject;
  $("#examScope").value = scoreDraft.scope || "";
  $("#examPaperCount").value = Math.max(1, Number(scoreDraft.paperCount) || 1);
  $("#examNoTest").checked = Boolean(scoreDraft.noExam);
  editingExamId = scoreDraft.editingExamId || null;
  updateExamFormMode();
}

function applyScoreDraftToRows() {
  if (!scoreDraft) return;
  $$("[data-score-student]").forEach((input) => {
    const value = scoreDraft.scores?.[input.dataset.scoreStudent]?.[input.dataset.scorePaper];
    if (value !== undefined) input.value = value;
  });
  $$("[data-score-absent]").forEach((input) => {
    setScoreAbsentButton(input, (scoreDraft.absences || []).includes(input.dataset.scoreAbsent));
  });
}

function setScoreAbsentButton(button, active) {
  if (!button) return;
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.textContent = active ? "已缺考" : "缺考";
  const row = button.closest(".score-row");
  row?.classList.toggle("is-absent", active);
  row?.querySelectorAll("[data-score-student]").forEach((input) => {
    input.disabled = active;
  });
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
          <button class="absent-check" type="button" data-score-absent="${student.id}" aria-pressed="false">缺考</button>
        </div>
      </label>
    `).join("")
    : `<div class="empty">此年級尚無補 ${subject} 的學生。</div>`;
  applyEditingExamScores();
  applyScoreDraftToRows();
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
    if (absentInput) setScoreAbsentButton(absentInput, (exam.absences || []).includes(student.id));
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

function displayedClassReportExam() {
  const selected = selectedClassReportExamId ? state.exams.find((exam) => exam.id === selectedClassReportExamId) : null;
  return selected || latestExamForForm();
}

function renderScoreSections() {
  $("#scoreEntrySection")?.classList.toggle("active", scoreSection === "entry");
  $("#scoreHistorySection")?.classList.toggle("active", scoreSection === "history");
  if ($("#classReport")) $("#classReport").hidden = scoreSection !== "history" || !selectedClassReportExamId;
  $$("[data-score-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scoreSection === scoreSection);
  });
}

function renderTermSections() {
  $("#termEntrySection")?.classList.toggle("active", termSection === "entry");
  $("#termHistorySection")?.classList.toggle("active", termSection === "history");
  $$("[data-term-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.termSection === termSection);
  });
}

function renderClassReport(exam = displayedClassReportExam()) {
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
  const date = $("#examDate")?.value;
  const matches = state.exams
    .filter((exam) => exam.grade === grade && exam.subject === subject)
    .sort((a, b) => b.date.localeCompare(a.date));
  return matches.find((exam) => exam.date === date) || matches[0];
}

function viewExamReport(exam) {
  scoreSection = "history";
  selectedClassReportExamId = exam.id;
  $("#examDate").value = exam.date;
  $("#examGrade").value = exam.grade;
  renderExamSubjectOptions();
  if (!Array.from($("#examSubject").options).some((option) => option.value === exam.subject)) {
    $("#examSubject").insertAdjacentHTML("beforeend", `<option value="${exam.subject}">${exam.subject}</option>`);
  }
  $("#examSubject").value = exam.subject;
  renderScoreStudentFilter();
  renderScoreEntryList();
  renderClassReport(exam);
}

function returnCurrentClassReport() {
  selectedClassReportExamId = null;
  scoreSection = "history";
  renderScoreSections();
  renderClassReport();
  $("#examHistoryList")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveExam(event) {
  event.preventDefault();
  captureScoreDraft();
  const noExam = $("#examNoTest").checked;
  const paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  const scores = {};
  const absences = [];
  studentsForGradeAndSubject($("#examGrade").value, $("#examSubject").value).forEach((student) => {
    const absent = (scoreDraft?.absences || []).includes(student.id) || document.querySelector(`[data-score-absent="${student.id}"]`)?.classList.contains("active");
    if (absent) {
      absences.push(student.id);
      return;
    }
    const values = Array.from({ length: paperCount }, (_, index) => {
      const input = document.querySelector(`[data-score-student="${student.id}"][data-score-paper="${index}"]`);
      const draftValue = scoreDraft?.scores?.[student.id]?.[String(index)];
      const value = draftValue !== undefined ? draftValue : input?.value;
      return value !== "" && value !== undefined ? Number(value) : null;
    }).filter((value) => value !== null && Number.isFinite(value));
    if (values.length) scores[student.id] = values;
  });
  const existing = editingExamId ? state.exams.find((item) => item.id === editingExamId) : null;
  const period = existing
    ? { academicYear: existing.academicYear, semester: existing.semester }
    : activeAcademicPeriod();
  const exam = normalizeExam({
    id: existing?.id || crypto.randomUUID(),
    date: $("#examDate").value,
    academicYear: period.academicYear,
    semester: period.semester,
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
  selectedClassReportExamId = exam.id;
  scoreSection = "history";
  editingExamId = null;
  updateExamFormMode();
  clearScoreDraft();
  saveState();
  renderAll();
  flashButton(event.submitter, existing ? "已更新" : "已儲存");
}

function resetExamForm() {
  if (!confirm("確定重設當天成績輸入？尚未儲存的分數會清空。")) return;
  editingExamId = null;
  scoreSection = "entry";
  selectedClassReportExamId = null;
  clearScoreDraft();
  $("#examDate").value = todayISO();
  $("#examScope").value = "";
  $("#examPaperCount").value = 1;
  $("#examNoTest").checked = false;
  $("#scoreStudentPicker").value = "";
  $("#scoreStudentFilter").value = "全部";
  updateExamFormMode();
  renderScoreEntryList();
}

function fillExamForm(exam) {
  clearScoreDraft();
  scoreSection = "entry";
  selectedClassReportExamId = exam.id;
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
  $("#scoreStudentPicker").value = "";
  $("#scoreStudentFilter").value = "全部";
  updateExamFormMode();
  renderScoreStudentFilter();
  renderScoreEntryList();
  renderClassReport(exam);
}

function renderExamHistory() {
  const period = weeklyPeriodFilter("scoreHistory");
  const items = state.exams
    .filter((exam) => examMatchesWeeklyPeriod(exam, period))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);
  $("#examHistoryList").innerHTML = items.map((exam) => {
    const rows = currentScoreRows(exam);
    const average = rows.length ? (rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1) : "-";
    return `
      <article class="record-card">
        <strong>${dateLabel(exam.date)} ${exam.grade} ${exam.subject}</strong>
        <div class="meta">
          <span class="badge">${academicPeriodLabel(exam)}</span>
          <span class="badge">${exam.noExam ? "無考試" : `班平均 ${average}`}</span>
          ${exam.scope ? `<span class="badge gold">${exam.scope}</span>` : ""}
        </div>
      </article>
      <div class="action-row">
        <button class="ghost" data-view-exam="${exam.id}">查看當天成績單</button>
        <button class="ghost" data-edit-exam="${exam.id}">編輯成績單</button>
        <button class="ghost danger" data-delete-exam="${exam.id}">刪除成績單</button>
      </div>
    `;
  }).join("") || `<div class="empty">尚無成績歷史。</div>`;
}

function saveTermScore(event) {
  event.preventDefault();
  const year = $("#termYear").value.trim() || "未填學年";
  const semester = $("#termSemester").value;
  const grade = $("#termGrade").value;
  const stage = $("#termStage").value;
  const term = `${year}${semester}`;
  const meta = { year, semester, grade, stage };
  const endDate = $("#termEndDate")?.value || "";
  if (endDate) state.termPeriods[termPeriodKey(meta)] = endDate;
  const inputs = $$("[data-term-score-student][data-term-score-subject]");
  let saved = 0;
  inputs.forEach((input) => {
    if (input.value === "") return;
    const studentId = input.dataset.termScoreStudent;
    const subject = input.dataset.termScoreSubject;
    const score = Number(input.value);
    if (!Number.isFinite(score)) return;
    const existing = state.termScores.find((item) =>
      item.studentId === studentId &&
      item.year === year &&
      item.semester === semester &&
      item.stage === stage &&
      item.subject === subject
    );
    const payload = {
      studentId,
      year,
      semester,
      term,
      grade,
      date: existing?.date || "",
      stage,
      subject,
      score,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, payload);
    else state.termScores.push({ id: crypto.randomUUID(), ...payload });
    saved += 1;
  });
  if (!saved && !endDate) return alert("請至少輸入一位學生的段考成績，或設定段考截止日");
  if (saved) termSection = "history";
  saveState();
  renderAll();
  flashButton(event.submitter, saved ? "已儲存" : "已儲存日期");
}

function studentExamRows(student, period = null) {
  return state.exams
    .filter((exam) => !exam.noExam && exam.scores && exam.scores[student.id] !== undefined)
    .filter((exam) => examMatchesWeeklyPeriod(exam, period))
    .map((exam) => ({ exam, papers: scoreValuesForStudent(exam, student.id), score: averageScore(scoreValuesForStudent(exam, student.id)) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));
}

function currentTermMeta() {
  return {
    year: $("#termYear")?.value.trim() || "未填學年",
    semester: $("#termSemester")?.value || "上學期",
    grade: $("#termGrade")?.value || "國一",
    stage: $("#termStage")?.value || "一段",
  };
}

function syncTermEndDateInput() {
  const target = $("#termEndDate");
  if (!target) return;
  target.value = state.termPeriods?.[termPeriodKey(currentTermMeta())] || "";
}

function termRowsForMeta(meta = currentTermMeta()) {
  return state.termScores
    .filter((item) =>
      item.year === meta.year &&
      item.semester === meta.semester &&
      item.grade === meta.grade &&
      item.stage === meta.stage &&
      (!meta.subject || item.subject === meta.subject)
    )
    .map((item) => ({ ...item, student: getStudent(item.studentId) }))
    .filter((item) => item.student && Number.isFinite(Number(item.score)))
    .sort((a, b) => Number(b.score) - Number(a.score))
    .map((item, index, rows) => ({
      ...item,
      rank: rows.findIndex((row) => Number(row.score) === Number(item.score)) + 1,
    }));
}

function renderTermScoreEntryList() {
  const target = $("#termScoreEntryList");
  if (!target) return;
  const meta = currentTermMeta();
  const students = state.students.filter((student) => student.grade === meta.grade);
  const existing = new Map(termRowsForMeta(meta).map((row) => [`${row.studentId}|${row.subject}`, row]));
  target.innerHTML = students.length
    ? `<div class="table-wrap">
      <table class="term-entry-table">
        <thead><tr><th>班級</th><th>姓名</th>${termSubjects.map((subject) => `<th>${subject}</th>`).join("")}</tr></thead>
        <tbody>${students.map((student) => `
          <tr>
            <td>${student.grade}</td>
            <td>${student.name}</td>
            ${termSubjects.map((subject) => `<td><input type="number" min="0" max="100" step="0.1" data-term-score-student="${student.id}" data-term-score-subject="${subject}" value="${existing.get(`${student.id}|${subject}`)?.score ?? ""}" placeholder="-"></td>`).join("")}
          </tr>
        `).join("")}</tbody>
      </table>
    </div>`
    : `<div class="empty">此年級尚無學生。</div>`;
}

function termReportRows(meta = currentTermMeta()) {
  const rows = termRowsForMeta(meta);
  const byStudent = new Map();
  rows.forEach((row) => {
    if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, { student: row.student, scores: {}, values: [] });
    const item = byStudent.get(row.studentId);
    item.scores[row.subject] = Number(row.score);
    item.values.push(Number(row.score));
  });
  return [...byStudent.values()]
    .map((item) => {
      const average = item.values.length ? item.values.reduce((sum, score) => sum + score, 0) / item.values.length : NaN;
      return { ...item, average };
    })
    .filter((item) => Number.isFinite(item.average))
    .sort((a, b) => b.average - a.average)
    .map((item, index, rows) => ({
      ...item,
      rank: rows.findIndex((row) => row.average === item.average) + 1,
    }));
}

function renderTermReport() {
  const target = $("#termReportBody");
  if (!target) return;
  const meta = currentTermMeta();
  const rows = termReportRows(meta);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.average, 0) / rows.length : NaN;
  target.innerHTML = `
    <div class="report-head">
      <strong>${meta.year}${meta.semester} ${meta.grade} ${meta.stage}</strong>
      <span>班平均 ${scoreDisplay(average)}</span>
      <span>${rows.length} 位學生</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th>班級</th><th>姓名</th>${termSubjects.map((subject) => `<th>${subject}</th>`).join("")}<th>平均</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.rank}</td><td>${row.student.grade}</td><td>${row.student.name}</td>${termSubjects.map((subject) => `<td class="${scoreClass(row.scores[subject])}">${scoreDisplay(row.scores[subject])}</td>`).join("")}<td class="${scoreClass(row.average)}">${scoreDisplay(row.average)}</td></tr>`).join("") || `<tr><td colspan="${4 + termSubjects.length}">尚無段考成績</td></tr>`}</tbody>
    </table>
  `;
}

function termReportGroups() {
  const groups = new Map();
  state.termScores.forEach((item) => {
    const key = [item.year || "", item.semester || "", item.grade || "", item.stage || ""].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        year: item.year || "",
        semester: item.semester || "",
        grade: item.grade || "",
        stage: item.stage || "",
        count: 0,
        updatedAt: "",
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.updatedAt = [group.updatedAt, item.updatedAt || item.createdAt || ""].sort().pop();
  });
  return [...groups.values()].sort((a, b) =>
    (b.year + b.semester + b.stage + b.grade).localeCompare(a.year + a.semester + a.stage + a.grade, "zh-Hant")
  );
}

function renderTermHistoryList() {
  const target = $("#termHistoryList");
  if (!target) return;
  const groups = termReportGroups();
  target.innerHTML = groups.map((group) => `
    <article class="record-card">
      <strong>${group.year}${group.semester} ${group.grade} ${group.stage}</strong>
      <div class="meta">
        <span class="badge">${group.count} 筆科目成績</span>
        <span class="badge">${group.updatedAt ? `更新 ${dateLabel(group.updatedAt.slice(0, 10))}` : "尚無更新時間"}</span>
      </div>
      <div class="action-row">
        <button class="ghost" data-view-term-report="${group.key}">查看段考成績單</button>
        <button class="ghost" data-edit-term-report="${group.key}">編輯段考成績</button>
        <button class="ghost danger" data-delete-term-report="${group.key}">刪除段考成績單</button>
      </div>
    </article>
  `).join("") || `<div class="empty">尚無歷史段考成績單。</div>`;
}

function classOpsYears() {
  const years = new Set([activeAcademicPeriod().academicYear]);
  state.exams.forEach((exam) => exam.academicYear && years.add(String(exam.academicYear)));
  state.termScores.forEach((item) => item.year && years.add(String(item.year)));
  return [...years].sort((a, b) => String(b).localeCompare(String(a), "zh-Hant"));
}

function renderClassOpsFilters() {
  const yearTarget = $("#classOpsYear");
  const subjectTarget = $("#classOpsSubject");
  if (!yearTarget || !subjectTarget) return;
  const previousYear = yearTarget.value;
  const years = classOpsYears();
  yearTarget.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearTarget.value = previousYear && years.includes(previousYear) ? previousYear : activeAcademicPeriod().academicYear;
  const previousSubject = subjectTarget.value;
  subjectTarget.innerHTML = [`<option value="全部">全部科目</option>`, ...reportSubjects.map((subject) => `<option value="${subject}">${subject}</option>`)].join("");
  subjectTarget.value = previousSubject && ["全部", ...reportSubjects].includes(previousSubject) ? previousSubject : "全部";
}

function classOpsMeta() {
  return {
    year: $("#classOpsYear")?.value || activeAcademicPeriod().academicYear,
    semester: $("#classOpsSemester")?.value || "全部",
    grade: $("#classOpsGrade")?.value || grades[0],
    subject: $("#classOpsSubject")?.value || "全部",
  };
}

function classOpsWeeklyRows(meta, includeAllGrades = false) {
  return state.exams
    .filter((exam) => !exam.noExam)
    .filter((exam) => String(exam.academicYear || "") === String(meta.year))
    .filter((exam) => meta.semester === "全部" || exam.semester === meta.semester)
    .filter((exam) => includeAllGrades || exam.grade === meta.grade)
    .filter((exam) => meta.subject === "全部" || exam.subject === meta.subject)
    .flatMap((exam) => currentScoreRows(exam).map((row) => ({
      source: "週考",
      grade: exam.grade,
      subject: normalizeCourseName(exam.subject),
      score: row.score,
      scope: exam.scope || "",
      date: exam.date,
      student: row.student,
      exam,
    })));
}

function classOpsTermRows(meta, includeAllGrades = false) {
  return state.termScores
    .filter((item) => String(item.year || "") === String(meta.year))
    .filter((item) => meta.semester === "全部" || item.semester === meta.semester)
    .filter((item) => includeAllGrades || item.grade === meta.grade)
    .filter((item) => meta.subject === "全部" || normalizeCourseName(item.subject) === meta.subject)
    .map((item) => ({
      source: "段考",
      grade: item.grade,
      subject: normalizeCourseName(item.subject),
      score: Number(item.score),
      scope: item.stage || "",
      date: item.date || item.updatedAt || item.createdAt || "",
      student: getStudent(item.studentId),
      raw: item,
    }))
    .filter((row) => Number.isFinite(row.score));
}

function classOpsRows(meta, includeAllGrades = false) {
  return [...classOpsWeeklyRows(meta, includeAllGrades), ...classOpsTermRows(meta, includeAllGrades)]
    .filter((row) => reportSubjects.includes(row.subject));
}

function summarizeScores(rows) {
  const scores = rows.map((row) => Number(row.score)).filter(Number.isFinite);
  const average = averageScore(scores);
  const passRate = scores.length ? scores.filter((score) => score >= 60).length / scores.length * 100 : NaN;
  const lowRate = scores.length ? scores.filter((score) => score < 70).length / scores.length * 100 : NaN;
  const high = scores.length ? Math.max(...scores) : NaN;
  const low = scores.length ? Math.min(...scores) : NaN;
  return { count: scores.length, average, passRate, lowRate, high, low, range: Number.isFinite(high) && Number.isFinite(low) ? high - low : NaN };
}

function classOpsSubjectStats(meta) {
  const rows = classOpsRows(meta);
  const allRows = classOpsRows(meta, true);
  const subjectList = meta.subject === "全部" ? reportSubjects : [meta.subject];
  return subjectList.map((subject) => {
    const subjectRows = rows.filter((row) => row.subject === subject);
    const allSubjectRows = allRows.filter((row) => row.subject === subject);
    const summary = summarizeScores(subjectRows);
    const allSummary = summarizeScores(allSubjectRows);
    return {
      subject,
      rows: subjectRows,
      ...summary,
      benchmark: allSummary.average,
      gap: Number.isFinite(summary.average) && Number.isFinite(allSummary.average) ? summary.average - allSummary.average : NaN,
    };
  }).filter((item) => item.count || meta.subject !== "全部");
}

function classOpsWeakUnits(meta) {
  const weekly = classOpsWeeklyRows(meta)
    .filter((row) => row.scope)
    .filter((row) => meta.subject === "全部" || row.subject === meta.subject);
  const groups = new Map();
  weekly.forEach((row) => {
    const key = `${row.subject}|${row.scope}`;
    if (!groups.has(key)) groups.set(key, { subject: row.subject, scope: row.scope, scores: [], dates: [] });
    const group = groups.get(key);
    group.scores.push(row.score);
    if (row.date) group.dates.push(row.date);
  });
  return [...groups.values()]
    .map((group) => {
      const average = averageScore(group.scores);
      const lowCount = group.scores.filter((score) => score < 70).length;
      return { ...group, average, lowCount, count: group.scores.length, latestDate: group.dates.sort().pop() || "" };
    })
    .filter((group) => group.lowCount || group.average < 75)
    .sort((a, b) => b.lowCount - a.lowCount || a.average - b.average)
    .slice(0, 12);
}

function weakTopicKey(scope) {
  return String(scope || "")
    .replace(/[0-9０-９]+/g, "")
    .replace(/[第章節回單元測驗考卷範圍上下左右一二三四五六七八九十、，,.\s]/g, "")
    .slice(0, 8) || String(scope || "未標示單元").slice(0, 8);
}

function classOpsWeakHistory(meta) {
  const units = classOpsWeakUnits({ ...meta, subject: meta.subject });
  const groups = new Map();
  units.forEach((unit) => {
    const topic = weakTopicKey(unit.scope);
    const key = `${unit.subject}|${topic}`;
    if (!groups.has(key)) groups.set(key, { subject: unit.subject, topic, scopes: [], scores: [], lowCount: 0, count: 0, latestDate: "" });
    const group = groups.get(key);
    group.scopes.push(unit.scope);
    group.scores.push(...unit.scores);
    group.lowCount += unit.lowCount;
    group.count += unit.count;
    group.latestDate = [group.latestDate, unit.latestDate].filter(Boolean).sort().pop() || "";
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      average: averageScore(group.scores),
      examples: [...new Set(group.scopes)].slice(0, 4),
    }))
    .sort((a, b) => b.lowCount - a.lowCount || a.average - b.average)
    .slice(0, 8);
}

function classOpsStudentSegments(meta) {
  const rows = classOpsRows(meta);
  const byStudent = new Map();
  rows.forEach((row) => {
    if (!row.student) return;
    if (!byStudent.has(row.student.id)) byStudent.set(row.student.id, { student: row.student, scores: [], bySubject: new Map() });
    const item = byStudent.get(row.student.id);
    item.scores.push(row.score);
    if (!item.bySubject.has(row.subject)) item.bySubject.set(row.subject, []);
    item.bySubject.get(row.subject).push(row.score);
  });
  const ranked = [...byStudent.values()]
    .map((item) => {
      const average = averageScore(item.scores);
      const weakSubjects = [...item.bySubject.entries()]
        .map(([subject, scores]) => ({ subject, average: averageScore(scores) }))
        .filter((subject) => Number.isFinite(subject.average))
        .sort((a, b) => a.average - b.average)
        .slice(0, 2);
      return { ...item, average, weakSubjects };
    })
    .filter((item) => Number.isFinite(item.average))
    .sort((a, b) => b.average - a.average);
  if (!ranked.length) return { top: [], middle: [], support: [] };
  const topCount = Math.max(1, Math.ceil(ranked.length * .25));
  const supportCount = Math.max(1, Math.ceil(ranked.length * .25));
  return {
    top: ranked.slice(0, topCount),
    middle: ranked.slice(topCount, Math.max(topCount, ranked.length - supportCount)),
    support: ranked.slice(Math.max(topCount, ranked.length - supportCount)),
  };
}

function segmentStudentList(students) {
  return students.map((item) => {
    const weak = item.weakSubjects.length
      ? `弱科：${item.weakSubjects.map((subject) => `${subject.subject} ${scoreDisplay(subject.average)}`).join("、")}`
      : "弱科：暫無明顯落點";
    return `<li><strong>${studentLabel(item.student)}</strong><span>平均 ${scoreDisplay(item.average)}｜${weak}</span></li>`;
  }).join("");
}

function classOpsSegmentReport(meta) {
  const segments = classOpsStudentSegments(meta);
  if (!segments.top.length && !segments.middle.length && !segments.support.length) {
    return `<div class="empty">目前沒有足夠成績可以分出前中後段學生。</div>`;
  }
  return `
    <div class="segment-grid">
      <article class="segment-card">
        <div class="analysis-card-head"><strong>前段生</strong><b class="level-badge">拉高上限</b></div>
        <p>給挑戰題、限時複合題與錯題講解任務，讓他們帶動同儕討論。</p>
        <ul>${segmentStudentList(segments.top)}</ul>
      </article>
      <article class="segment-card">
        <div class="analysis-card-head"><strong>中段生</strong><b class="level-badge">穩定轉強</b></div>
        <p>先鎖定 1 到 2 個弱科單元，每週短測追蹤，把粗心與觀念缺口分開處理。</p>
        <ul>${segmentStudentList(segments.middle)}</ul>
      </article>
      <article class="segment-card">
        <div class="analysis-card-head"><strong>後段生</strong><b class="level-badge">補基本盤</b></div>
        <p>拆小目標：基礎題正確率、作業完成率、錯題重練。先求穩定及格，再追分數。</p>
        <ul>${segmentStudentList(segments.support)}</ul>
      </article>
    </div>
  `;
}

function classOpsRadarSvg(stats) {
  const items = stats.filter((item) => item.count).slice(0, 8);
  if (items.length < 3) return `<div class="empty">至少需要 3 科有成績，才能形成整班雷達。</div>`;
  const cx = 150;
  const cy = 150;
  const radius = 102;
  const axis = items.map((item, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / items.length;
    return { item, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle };
  });
  const polygon = axis.map(({ item, angle }) => {
    const value = Math.max(0, Math.min(100, item.average || 0)) / 100 * radius;
    return `${cx + Math.cos(angle) * value},${cy + Math.sin(angle) * value}`;
  }).join(" ");
  const rings = [25, 50, 75, 100].map((value) => `<circle cx="${cx}" cy="${cy}" r="${radius * value / 100}" class="radar-ring"></circle>`).join("");
  return `<svg class="class-radar" viewBox="0 0 300 300" role="img" aria-label="整班各科雷達圖">
    ${rings}
    ${axis.map(({ x, y }) => `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis"></line>`).join("")}
    <polygon points="${polygon}" class="radar-area"></polygon>
    ${axis.map(({ item, x, y }) => `<text x="${x}" y="${y}" class="radar-label">${escapeHtml(item.subject)}</text>`).join("")}
  </svg>`;
}

function renderClassOps() {
  if (!$("#classOpsSummary")) return;
  renderClassOpsFilters();
  const meta = classOpsMeta();
  const rows = classOpsRows(meta);
  const stats = classOpsSubjectStats(meta);
  const summary = summarizeScores(rows);
  const best = stats.filter((item) => item.count).sort((a, b) => b.average - a.average)[0];
  const weakest = stats.filter((item) => item.count).sort((a, b) => a.average - b.average)[0];
  $("#classOpsSummary").innerHTML = `
    <article class="metric"><span>班級平均</span><strong>${scoreDisplay(summary.average)}</strong></article>
    <article class="metric"><span>及格率</span><strong>${scoreDisplay(summary.passRate)}%</strong></article>
    <article class="metric"><span>優勢科目</span><strong>${best ? best.subject : "-"}</strong></article>
    <article class="metric"><span>優先補強</span><strong>${weakest ? weakest.subject : "-"}</strong></article>
  `;
  $("#classOpsRadar").innerHTML = classOpsRadarSvg(stats);
  $("#classOpsLevel").innerHTML = stats.filter((item) => item.count).map((item) => `
    <article class="level-row">
      <div><strong>${item.subject}</strong><span>班平均 ${scoreDisplay(item.average)}｜全體 ${scoreDisplay(item.benchmark)}</span></div>
      <b class="${item.gap >= 0 ? "positive-gap" : "negative-gap"}">${Number.isFinite(item.gap) ? `${item.gap >= 0 ? "+" : ""}${scoreDisplay(item.gap)}` : "-"}</b>
    </article>
  `).join("") || `<div class="empty">這個學年學期尚無可比較成績。</div>`;
  $("#classOpsSubjectAnalysis").innerHTML = `
    <div class="analysis-grid">
      ${stats.filter((item) => item.count).map((item) => `
        <article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${levelFromScore(item.average)}</b>
          </div>
          <span>平均 ${scoreDisplay(item.average)}｜及格率 ${scoreDisplay(item.passRate)}%｜低於 70：${scoreDisplay(item.lowRate)}%</span>
          <small>最高 ${scoreDisplay(item.high)}，最低 ${scoreDisplay(item.low)}，波動 ${scoreDisplay(item.range)}，共 ${item.count} 筆</small>
          <div class="subject-bar"><i style="width:${Math.max(0, Math.min(100, item.average || 0))}%"></i></div>
        </article>
      `).join("") || `<div class="empty">目前沒有符合條件的班級成績。</div>`}
    </div>
    <div class="class-report-block">
      <div class="panel-title">
        <h3>班級分析報告</h3>
        <span>前中後段生與帶法</span>
      </div>
      ${classOpsSegmentReport(meta)}
    </div>
  `;
  const weakUnits = classOpsWeakUnits(meta);
  const weakHistory = classOpsWeakHistory(meta);
  $("#classOpsWeakUnits").innerHTML = weakUnits.length
    ? `
    <div class="weak-topic-grid">
      ${weakHistory.map((topic) => `
        <article class="weak-topic-card">
          <strong>${topic.subject}｜${escapeHtml(topic.topic)}</strong>
          <span>歷史平均 ${scoreDisplay(topic.average)}｜低分 ${topic.lowCount} / ${topic.count}</span>
          <small>常見單元：${topic.examples.map(escapeHtml).join("、")}</small>
        </article>
      `).join("")}
    </div>
    <div class="subhead">單元明細</div>
    <div class="table-wrap"><table><thead><tr><th>科目</th><th>弱點單元</th><th>平均</th><th>低分次數</th><th>最近測驗</th></tr></thead><tbody>${weakUnits.map((unit) => `
      <tr>
        <td>${unit.subject}</td>
        <td>${escapeHtml(unit.scope)}</td>
        <td class="${scoreClass(unit.average)}">${scoreDisplay(unit.average)}</td>
        <td>${unit.lowCount} / ${unit.count}</td>
        <td>${unit.latestDate ? dateLabel(unit.latestDate) : "-"}</td>
      </tr>
    `).join("")}</tbody></table></div>`
    : `<div class="empty">目前沒有明顯弱點單元。若週考有填「範圍 / 單元」，這裡會自動整理低分熱點。</div>`;
}

function applyTermReportKey(key) {
  const [year, semester, grade, stage] = key.split("|");
  $("#termYear").value = year;
  $("#termSemester").value = semester;
  $("#termGrade").value = grade;
  $("#termStage").value = stage;
  return { year, semester, grade, stage };
}

function termReportFileName(meta, ext) {
  return `${meta.year}${meta.semester}_${meta.grade}_${meta.stage}_段考成績單.${ext}`;
}

function termReportExportRows(meta = currentTermMeta()) {
  const reportRows = termReportRows(meta);
  const rows = reportRows.map((row) => ({
    rank: row.rank,
    name: row.student.name,
    grade: row.student.grade,
    scores: Object.fromEntries(termSubjects.map((subject) => [subject, scoreDisplay(row.scores[subject])])),
    average: scoreDisplay(row.average),
    failing: row.average < 60,
  }));
  const average = rows.length
    ? reportRows.reduce((sum, row) => sum + row.average, 0) / rows.length
    : NaN;
  return { meta, rows, average };
}

function printTermReportPdf() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可輸出。");
  pdfDocument(`${meta.grade} ${meta.stage} 段考成績單`, `
    <header class="doc-head">
      <div class="brand"><img src="assets/logo.png" alt=""><div><h1>金牌躍騰教育集團 段考成績單</h1><div>${escapeHtml(meta.year)}${escapeHtml(meta.semester)} ${escapeHtml(meta.grade)} ${escapeHtml(meta.stage)}</div></div></div>
      <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
    </header>
    <div class="meta">
      <span class="pill">${escapeHtml(meta.year)}${escapeHtml(meta.semester)}</span>
      <span class="pill">班平均 ${scoreDisplay(average)}</span>
      <span class="pill">${rows.length} 筆成績</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th>班級</th><th class="left">姓名</th>${termSubjects.map((subject) => `<th>${escapeHtml(subject)}</th>`).join("")}<th>平均</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.grade)}</td><td class="left">${escapeHtml(row.name)}</td>${termSubjects.map((subject) => `<td class="${Number(row.scores[subject]) < 60 ? "fail-score" : ""}">${escapeHtml(row.scores[subject])}</td>`).join("")}<td class="${row.failing ? "fail-score" : ""}">${escapeHtml(row.average)}</td></tr>`).join("")}</tbody>
    </table>
  `, "landscape");
}

function downloadTermReportExcel() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可匯出。");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <table border="1">
      <tr><th colspan="${4 + termSubjects.length}">金牌躍騰教育集團 段考成績單</th></tr>
      <tr><td colspan="${4 + termSubjects.length}">${escapeHtml(meta.year)}${escapeHtml(meta.semester)} ${escapeHtml(meta.grade)} ${escapeHtml(meta.stage)}　班平均 ${scoreDisplay(average)}</td></tr>
      <tr><th>排名</th><th>班級</th><th>姓名</th>${termSubjects.map((subject) => `<th>${escapeHtml(subject)}</th>`).join("")}<th>平均</th></tr>
      ${rows.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.name)}</td>${termSubjects.map((subject) => `<td style="${Number(row.scores[subject]) < 60 ? "color:#e60012;font-weight:bold;" : ""}">${escapeHtml(row.scores[subject])}</td>`).join("")}<td style="${row.failing ? "color:#e60012;font-weight:bold;" : ""}">${escapeHtml(row.average)}</td></tr>`).join("")}
    </table>
  </body></html>`;
  downloadBlob(`\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8", termReportFileName(meta, "xls"));
}

function downloadTermReportImage() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可匯出。");
  const scale = 2;
  const width = 1380;
  const topSafe = 56;
  const rowHeight = 54;
  const headerBandHeight = 282;
  const tableY = 306;
  const height = topSafe + tableY + Math.max(rows.length, 1) * rowHeight + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#f7f1e3";
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#101419");
  gradient.addColorStop(.62, "#20242b");
  gradient.addColorStop(1, "#8a6424");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, headerBandHeight + topSafe);

  ctx.save();
  ctx.translate(0, topSafe);
  ctx.fillStyle = "#f5d47a";
  ctx.font = "bold 34px Microsoft JhengHei, Arial";
  canvasText(ctx, "金牌躍騰教育集團 段考成績單", 54, 64, 820);
  ctx.fillStyle = "#fff7df";
  ctx.font = "20px Microsoft JhengHei, Arial";
  canvasText(ctx, `${meta.year}${meta.semester}　${meta.grade}　${meta.stage}`, 56, 104, 660);
  canvasText(ctx, `列印日期：${new Date().toLocaleDateString("zh-TW")}`, 1120, 104, 220);

  ctx.fillStyle = "rgba(255,255,255,.08)";
  drawRoundRect(ctx, 54, 132, 1272, 78, 10);
  ctx.fill();
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 20px Microsoft JhengHei, Arial";
  canvasText(ctx, `${meta.year}${meta.semester}`, 82, 180, 180);
  canvasText(ctx, `班平均 ${scoreDisplay(average)}`, 288, 180, 180);
  canvasText(ctx, `${rows.length} 筆成績`, 492, 180, 150);

  const tableX = 54;
  const columns = [
    { label: "排名", width: 90 },
    { label: "班級", width: 110 },
    { label: "姓名", width: 180 },
    ...termSubjects.map((subject) => ({ label: subject, width: 110 })),
    { label: "平均", width: 120 },
  ];
  ctx.fillStyle = "#171b21";
  drawRoundRect(ctx, tableX, tableY - 48, 1272, 48, 8);
  ctx.fill();
  ctx.font = "bold 18px Microsoft JhengHei, Arial";
  ctx.fillStyle = "#f5d47a";
  let cursor = tableX;
  columns.forEach((column) => {
    canvasText(ctx, column.label, cursor + 14, tableY - 17, column.width - 18);
    cursor += column.width;
  });
  rows.forEach((row, rowIndex) => {
    const y = tableY + rowIndex * rowHeight;
    ctx.fillStyle = rowIndex % 2 ? "#f4ead2" : "#fffaf0";
    ctx.fillRect(tableX, y, 1272, rowHeight);
    ctx.strokeStyle = "#dfd0aa";
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowHeight);
    ctx.lineTo(tableX + 1272, y + rowHeight);
    ctx.stroke();
    cursor = tableX;
    const values = [row.rank, row.grade, row.name, ...termSubjects.map((subject) => row.scores[subject]), row.average];
    ctx.font = row.rank === 1 ? "bold 18px Microsoft JhengHei, Arial" : "17px Microsoft JhengHei, Arial";
    values.forEach((value, index) => {
      ctx.fillStyle = index >= 3 && Number(value) < 60 ? "#e60012" : "#1e2329";
      canvasText(ctx, value, cursor + 14, y + 34, columns[index].width - 18);
      cursor += columns[index].width;
    });
  });
  ctx.restore();
  ctx.fillStyle = "#76623a";
  ctx.font = "15px Microsoft JhengHei, Arial";
  canvasText(ctx, "不及格分數以紅字標示｜本圖檔可直接傳送家長群組", 54, height - 24, 760);
  canvas.toBlob((blob) => {
    if (!blob) return alert("圖片生成失敗，請再試一次。");
    downloadBlob(blob, "image/png", termReportFileName(meta, "png"));
  }, "image/png");
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
  const allScores = ordered.map((row) => row.score).filter(Number.isFinite);
  const scores = recent.map((row) => row.score).filter(Number.isFinite);
  if (!scores.length) {
    return { subject, level: "資料不足", recentAvg: NaN, latest: NaN, trend: NaN, range: NaN, count: 0, note: "尚無足夠考試紀錄可分析。" };
  }
  const weightedTotal = scores.reduce((sum, score, index) => sum + score * (index + 1), 0);
  const weightSum = scores.reduce((sum, _score, index) => sum + index + 1, 0);
  const recentAvg = weightedTotal / weightSum;
  const longAvg = allScores.reduce((sum, score) => sum + score, 0) / allScores.length;
  const latest = scores.at(-1);
  const firstBandAvg = allScores.slice(0, Math.min(3, allScores.length)).reduce((sum, score) => sum + score, 0) / Math.min(3, allScores.length);
  const trend = allScores.length >= 2 ? recentAvg - firstBandAvg : 0;
  const range = Math.max(...allScores) - Math.min(...allScores);
  const combined = recentAvg * .7 + longAvg * .3;
  let level = levelFromScore(combined);
  if (trend >= 8 && latest >= recentAvg) level = shiftLevel(level, 1);
  if (trend <= -8 || (range >= 25 && latest < recentAvg)) level = shiftLevel(level, -1);
  const weakRows = recent.filter((row) => row.score < 70);
  const focus = weakRows.map((row) => row.exam.scope || dateLabel(row.exam.date)).slice(-3).join("、");
  const note = [
    `歷程 ${allScores.length} 次`,
    `近期加權 ${scoreDisplay(recentAvg)}`,
    `長期平均 ${scoreDisplay(longAvg)}`,
    `最新 ${scoreDisplay(latest)}`,
    trendLabel(trend),
    stabilityLabel(range),
    focus ? `需補強：${focus}` : "近期未見明顯低於 70 分的單元",
  ].join("｜");
  return { subject, level, recentAvg, longAvg, latest, trend, range, count: allScores.length, recentCount: scores.length, note };
}

function subjectPerformanceRows(student) {
  const examRows = studentExamRows(student);
  return courses.map((subject) => {
    const rows = examRows.filter((row) => row.exam.subject === subject);
    if (!rows.length) return null;
    return { ...analyzeSubjectPerformance(subject, rows), rows };
  }).filter(Boolean);
}

function careerSubjectsForStudent(student) {
  if (!student) return [];
  const subjects = new Set(student.courses || []);
  studentExamRows(student)
    .filter((row) => studentTakesSubject(student, row.exam.subject))
    .forEach((row) => subjects.add(row.exam.subject));
  return reportSubjects.filter((subject) => subjects.has(subject));
}

function selectedCareerSubject(student) {
  const subjects = careerSubjectsForStudent(student);
  if (careerSubject !== "全部" && subjects.includes(careerSubject)) return careerSubject;
  return "全部";
}

function selectedParentCareerSubject(student) {
  const subjects = careerSubjectsForStudent(student);
  if (parentCareerSubject !== "全部" && subjects.includes(parentCareerSubject)) return parentCareerSubject;
  return "全部";
}

function scoreLineChart(rows) {
  const chartRows = rows.slice(-12);
  if (chartRows.length < 2) return `<div class="empty small-empty">至少需要 2 次成績才會形成折線圖。</div>`;
  const width = 640;
  const height = 220;
  const pad = 28;
  const points = chartRows.map((row, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, chartRows.length - 1);
    const y = height - pad - (Math.max(0, Math.min(100, row.score)) / 100) * (height - pad * 2);
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `
    <svg class="score-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="成績起伏折線圖">
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad - .6 * (height - pad * 2)}" x2="${width - pad}" y2="${height - pad - .6 * (height - pad * 2)}" class="chart-pass"></line>
      <polyline points="${polyline}" class="chart-line"></polyline>
      ${points.map((point) => `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" class="chart-dot"></circle><title>${dateLabel(point.row.exam.date)} ${point.row.exam.subject} ${scoreDisplay(point.row.score)}</title></g>`).join("")}
      ${points.map((point, index) => index % 2 === 0 || index === points.length - 1 ? `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${dateLabel(point.row.exam.date).replace("（週", "\n").replace("）", "")}</text>` : "").join("")}
      <text x="${pad + 4}" y="${height - pad - .6 * (height - pad * 2) - 6}" class="chart-mark">60</text>
    </svg>
  `;
}

function termScoreLineChart(rows) {
  const chartRows = rows.slice(-12);
  if (chartRows.length < 2) return `<div class="empty small-empty">至少需要 2 次段考成績才會形成折線圖。</div>`;
  const width = 640;
  const height = 220;
  const pad = 28;
  const points = chartRows.map((row, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, chartRows.length - 1);
    const y = height - pad - (Math.max(0, Math.min(100, Number(row.score))) / 100) * (height - pad * 2);
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `
    <svg class="score-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="段考成績起伏折線圖">
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad - .6 * (height - pad * 2)}" x2="${width - pad}" y2="${height - pad - .6 * (height - pad * 2)}" class="chart-pass"></line>
      <polyline points="${polyline}" class="chart-line"></polyline>
      ${points.map((point) => `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" class="chart-dot"></circle><title>${point.row.term} ${point.row.stage} ${point.row.subject} ${scoreDisplay(Number(point.row.score))}</title></g>`).join("")}
      ${points.map((point) => `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${point.row.stage}</text>`).join("")}
      <text x="${pad + 4}" y="${height - pad - .6 * (height - pad * 2) - 6}" class="chart-mark">60</text>
    </svg>
  `;
}

function careerSubjectButtonsHtml(student, selected, dataAttribute) {
  const subjects = careerSubjectsForStudent(student);
  return `
    <button class="subject-chip ${selected === "全部" ? "active" : ""}" type="button" ${dataAttribute}="全部">全部</button>
    ${subjects.map((subject) => `<button class="subject-chip ${selected === subject ? "active" : ""}" type="button" ${dataAttribute}="${subject}">${subject}</button>`).join("")}
  `;
}

function renderCareerSubjectButtons(student) {
  const target = $("#careerSubjectButtons");
  if (!target) return;
  target.innerHTML = careerSubjectButtonsHtml(student, selectedCareerSubject(student), "data-career-subject");
}

function renderParentCareerSubjectButtons(student) {
  const target = $("#parentCareerSubjectButtons");
  if (!target) return;
  target.innerHTML = careerSubjectButtonsHtml(student, selectedParentCareerSubject(student), "data-parent-career-subject");
}

function careerScoreLookupHtml(student, queryDate, selectedSubject, options = {}) {
  if (!student) {
    return `<div class="empty">請先選擇學生。</div>`;
  }
  const period = options.period || null;
  const dateSubjects = scheduledSubjectsForStudentDate(student, queryDate);
  const rows = studentExamRows(student, period)
    .filter((row) => !dateSubjects.length || dateSubjects.includes(row.exam.subject))
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const dayRows = rows.filter((row) => row.exam.date === queryDate);
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => !dateSubjects.length || dateSubjects.includes(normalizeCourseName(item.subject)));
  const subjectHistoryRows = studentExamRows(student, period)
    .filter((row) => studentTakesSubject(student, row.exam.subject))
    .filter((row) => selectedSubject === "全部" || row.exam.subject === selectedSubject)
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const subjectCardTitle = selectedSubject === "全部" ? "各科週考紀錄" : `${selectedSubject}週考紀錄`;
  return `
    <div class="lookup-result">
      <strong>${dateLabel(queryDate)} ${scheduledSubjectLabel(dateSubjects)}</strong>
      ${period ? `<span class="badge">${academicPeriodLabel(period)}</span>` : ""}
      <div class="lookup-list">
        ${dayRows.map((row) => `<article class="score-result-card"><b>${row.exam.subject}</b><span>${row.exam.scope || "未填重點"}</span><strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong><small>各卷 ${row.papers.map(scoreDisplay).join(" / ")}</small></article>`).join("") || `<div class="empty small-empty">當日此科暫時沒有成績。</div>`}
      </div>
    </div>
    <section class="career-score-browser">
      <div class="browser-head">
        <strong>${subjectCardTitle}</strong>
        <span>${subjectHistoryRows.length} 筆</span>
      </div>
      <div class="score-card-rail" aria-label="${subjectCardTitle}">
        ${subjectHistoryRows.map((row) => {
          const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
          return `<article class="exam-mini-card">
            <div class="mini-card-top">
              <b>${row.exam.subject}</b>
              <strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong>
            </div>
            <span>${row.exam.scope || "未填考試單元"}</span>
            <div class="mini-card-meta">
              <small>${dateLabel(row.exam.date)}</small>
              <small>排名 ${rank}</small>
            </div>
          </article>`;
        }).join("") || `<div class="empty small-empty">尚無此科週考紀錄。</div>`}
      </div>
    </section>
    ${options.hideDateHistory ? "" : `<div class="table-wrap career-history-table">
      <table>
        <thead><tr><th>日期</th><th>科目</th><th>重點</th><th>各卷</th><th>平均</th><th>排名</th></tr></thead>
        <tbody>${rows.map((row) => {
          const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
          return `<tr><td>${dateLabel(row.exam.date)}</td><td>${row.exam.subject}</td><td>${row.exam.scope || "-"}</td><td>${row.papers.map(scoreDisplay).join(" / ")}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${rank}</td></tr>`;
        }).join("") || `<tr><td colspan="6">尚無歷史成績</td></tr>`}</tbody>
      </table>
    </div>`}
    <div class="table-wrap career-history-table">
      <table>
        <thead><tr><th colspan="6">${selectedSubject === "全部" ? "各科" : selectedSubject} 歷史週考單元與成績</th></tr></thead>
        <thead><tr><th>日期</th><th>科目</th><th>考試重點 / 單元</th><th>各卷</th><th>平均</th><th>排名</th></tr></thead>
        <tbody>${subjectHistoryRows.map((row) => {
          const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
          return `<tr><td>${dateLabel(row.exam.date)}</td><td>${row.exam.subject}</td><td>${row.exam.scope || "-"}</td><td>${row.papers.map(scoreDisplay).join(" / ")}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${rank}</td></tr>`;
        }).join("") || `<tr><td colspan="6">尚無此科週考紀錄</td></tr>`}</tbody>
      </table>
    </div>
    <div class="meta">${termRows.map((item) => `<span class="badge">${item.term} ${item.stage} ${item.subject} ${scoreDisplay(Number(item.score))}</span>`).join("") || `<span class="badge">尚無段考成績</span>`}</div>
  `;
}

function renderCareerScoreLookup(student) {
  const target = $("#careerScoreLookup");
  if (!target) return;
  const period = weeklyPeriodFilter("careerExam", student);
  target.innerHTML = careerScoreLookupHtml(student, $("#careerQueryDate")?.value || todayISO(), selectedCareerSubject(student), { period });
}

function renderTermYearOptions(student, targetId) {
  const target = $(`#${targetId}`);
  if (!target) return;
  const previous = target.value;
  const years = [...new Set(state.termScores
    .filter((item) => item.studentId === student?.id)
    .map((item) => item.year)
    .filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a), "zh-Hant"));
  target.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("") || `<option value="">尚無段考</option>`;
  target.value = previous && years.includes(previous) ? previous : years[0] || "";
}

function termTrendHtml(student, year) {
  if (!student) {
    return `<div class="empty">請先選擇學生。</div>`;
  }
  const rows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => !year || item.year === year)
    .sort((a, b) => `${a.year}${a.semester}${a.stage}${a.subject}`.localeCompare(`${b.year}${b.semester}${b.stage}${b.subject}`, "zh-Hant"));
  if (!rows.length) {
    return `<div class="empty">尚無段考成績紀錄。</div>`;
  }
  const bySubject = termSubjects
    .map((subject) => ({
      subject,
      rows: rows.filter((item) => normalizeCourseName(item.subject) === subject),
    }))
    .filter((item) => item.rows.length);
  const groups = new Map();
  rows.forEach((row) => {
    const key = `${row.year}${row.semester} ${row.stage}`;
    if (!groups.has(key)) groups.set(key, { label: key, scores: {} });
    groups.get(key).scores[normalizeCourseName(row.subject)] = Number(row.score);
  });
  return `
    <div class="analysis-grid">
      ${bySubject.map((item) => {
        const avg = item.rows.reduce((sum, row) => sum + Number(row.score), 0) / item.rows.length;
        return `<article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${levelFromScore(avg)}</b>
          </div>
          <span>段考平均 ${scoreDisplay(avg)}｜共 ${item.rows.length} 次</span>
          ${termScoreLineChart(item.rows)}
        </article>`;
      }).join("")}
    </div>
    <div class="table-wrap career-history-table">
      <table>
        <thead><tr><th>學期段別</th>${termSubjects.map((subject) => `<th>${subject}</th>`).join("")}</tr></thead>
        <tbody>${[...groups.values()].map((group) => `<tr><td>${group.label}</td>${termSubjects.map((subject) => `<td class="${scoreClass(group.scores[subject])}">${scoreDisplay(group.scores[subject])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderCareerTermYearOptions(student) {
  renderTermYearOptions(student, "careerTermYear");
}

function renderCareerTermTrend(student) {
  const target = $("#careerTermTrend");
  if (!target) return;
  renderCareerTermYearOptions(student);
  target.innerHTML = termTrendHtml(student, $("#careerTermYear")?.value);
}

function renderParentTermTrend(student) {
  const target = $("#parentTermTrend");
  if (!target) return;
  renderTermYearOptions(student, "parentTermYear");
  target.innerHTML = termTrendHtml(student, $("#parentTermYear")?.value);
}

function currentTermAnalysisMeta(student) {
  return {
    year: $("#careerTermAnalysisYear")?.value.trim() || String(new Date().getFullYear() - 1911),
    semester: $("#careerTermAnalysisSemester")?.value || "上學期",
    grade: student?.grade || $("#careerGrade")?.value || "國一",
    stage: $("#careerTermAnalysisStage")?.value || "一段",
  };
}

function currentParentTermAnalysisMeta(student) {
  return {
    year: $("#parentTermAnalysisYear")?.value.trim() || String(new Date().getFullYear() - 1911),
    semester: $("#parentTermAnalysisSemester")?.value || "上學期",
    grade: student?.grade || "國一",
    stage: $("#parentTermAnalysisStage")?.value || "一段",
  };
}

function termPeriodKey(meta) {
  return [meta.year, meta.semester, meta.grade, meta.stage].join("|");
}

function previousTermStage(meta) {
  const index = termStages.indexOf(meta.stage);
  return index > 0 ? termStages[index - 1] : "";
}

function termAnalysisRows(student, meta) {
  const endDate = state.termPeriods?.[termPeriodKey(meta)] || "";
  if (!student || !endDate) return { endDate, previousDate: "", rows: [] };
  const previousStage = previousTermStage(meta);
  const previousDate = previousStage
    ? state.termPeriods?.[termPeriodKey({ ...meta, stage: previousStage })] || ""
    : "";
  const rows = studentExamRows(student)
    .filter((row) => row.exam.subject !== "社會")
    .filter((row) => studentTakesSubject(student, row.exam.subject))
    .filter((row) => row.exam.date <= endDate)
    .filter((row) => !previousDate || row.exam.date > previousDate)
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));
  return { endDate, previousDate, rows };
}

function termAnalysisReportHtml(student, meta, selectedSubject) {
  if (!student) {
    return `<div class="empty">請先選擇學生。</div>`;
  }
  const { endDate, previousDate, rows } = termAnalysisRows(student, meta);
  if (!endDate) {
    return `<div class="empty">請先設定 ${meta.year}${meta.semester} ${meta.grade} ${meta.stage} 的段考截止日期。</div>`;
  }
  const filteredRows = rows.filter((row) => selectedSubject === "全部" || row.exam.subject === selectedSubject);
  const bySubject = courses
    .map((subject) => ({
      subject,
      rows: filteredRows.filter((row) => row.exam.subject === subject),
    }))
    .filter((item) => item.rows.length);
  const periodText = previousDate ? `${dateLabel(previousDate)} 之後至 ${dateLabel(endDate)}` : `${dateLabel(endDate)} 前`;
  return `
    <div class="report-head">
      <strong>${studentLabel(student)}｜${meta.year}${meta.semester} ${meta.stage}</strong>
      <span>${periodText}</span>
      <span>以週考紀錄分析，不含段考分數</span>
    </div>
    <div class="analysis-grid">
      ${bySubject.map((item) => {
        const analysis = analyzeSubjectPerformance(item.subject, item.rows);
        const weakUnits = item.rows
          .filter((row) => row.score < 70)
          .map((row) => row.exam.scope || dateLabel(row.exam.date))
          .slice(-5);
        return `<article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${analysis.level}</b>
          </div>
          <span>段前週考 ${item.rows.length} 次｜近期 ${scoreDisplay(analysis.recentAvg)}｜最新 ${scoreDisplay(analysis.latest)}</span>
          <small>${trendLabel(analysis.trend)}｜${stabilityLabel(analysis.range)}</small>
          ${scoreLineChart(item.rows)}
          <p>${weakUnits.length ? `段考前需補強單元：${weakUnits.join("、")}` : "此段期間週考未見低於 70 分的明顯弱點。"}</p>
        </article>`;
      }).join("")}
      ${!bySubject.length ? `<div class="empty">此段期間沒有符合補習科目的週考紀錄。</div>` : ""}
    </div>
    <div class="table-wrap career-history-table">
      <table>
        <thead><tr><th>日期</th><th>科目</th><th>考試重點 / 單元</th><th>各卷</th><th>平均</th><th>排名</th></tr></thead>
        <tbody>${filteredRows.slice().reverse().map((row) => {
          const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
          return `<tr><td>${dateLabel(row.exam.date)}</td><td>${row.exam.subject}</td><td>${row.exam.scope || "-"}</td><td>${row.papers.map(scoreDisplay).join(" / ")}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${rank}</td></tr>`;
        }).join("") || `<tr><td colspan="6">尚無該段週考紀錄</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderTermAnalysisReport(student) {
  const target = $("#termAnalysisReport");
  if (!target) return;
  target.innerHTML = termAnalysisReportHtml(student, currentTermAnalysisMeta(student), selectedCareerSubject(student));
}

function renderParentTermAnalysisReport(student) {
  const target = $("#parentTermAnalysisReport");
  if (!target) return;
  target.innerHTML = termAnalysisReportHtml(student, currentParentTermAnalysisMeta(student), selectedParentCareerSubject(student));
}

function renderStudentReport() {
  const student = getStudent($("#careerStudent")?.value);
  if (!student) {
    renderCareerSubjectButtons(null);
    renderCareerScoreLookup(null);
    renderCareerTermTrend(null);
    renderTermAnalysisReport(null);
    $("#studentReport").innerHTML = `<div class="empty">請先選擇學生。</div>`;
    if ($("#archiveList")) $("#archiveList").innerHTML = `<div class="empty">尚無歷年紀錄。</div>`;
    return;
  }
  if (careerSubject !== "全部" && !careerSubjectsForStudent(student).includes(careerSubject)) careerSubject = "全部";
  renderCareerSubjectButtons(student);
  renderCareerScoreLookup(student);
  renderCareerTermTrend(student);
  renderTermAnalysisReport(student);
  $("#studentReport").innerHTML = renderStudentReportHtml(student);
  if ($("#archiveList")) {
    $("#archiveList").innerHTML = state.archives
      .filter((item) => item.studentId === student.id)
      .map((item) => `<article class="record-card done"><strong>${item.term}</strong><div class="meta"><span class="badge">${item.summary}</span></div></article>`)
      .join("") || `<div class="empty">尚無歷年紀錄。</div>`;
  }
}

function renderStudentReportHtml(student, subjectOverride = null) {
  const subject = subjectOverride || selectedCareerSubject(student);
  const analyses = subjectPerformanceRows(student)
    .filter((item) => studentTakesSubject(student, item.subject))
    .filter((item) => subject === "全部" || item.subject === subject);
  const levelSummary = analyses.length
    ? analyses.map((item) => `${item.subject} ${item.level}`).join("、")
    : "資料不足";
  return `
    <div class="report-head">
      <strong>${studentLabel(student)}</strong>
      <span>補習科目：${studentCoursesLabel(student)}</span>
      <span>週考推估：${levelSummary}</span>
    </div>
    <div class="analysis-grid">
      ${analyses.map((item) => `
        <article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${item.level}</b>
          </div>
          <span>近期加權 ${scoreDisplay(item.recentAvg)}｜長期平均 ${scoreDisplay(item.longAvg)}｜最新 ${scoreDisplay(item.latest)}</span>
          <small>${trendLabel(item.trend)}｜${stabilityLabel(item.range)}｜歷程 ${item.count} 次</small>
          ${scoreLineChart(item.rows)}
          <p>${item.note}</p>
        </article>
      `).join("")}
      ${!analyses.length ? `<div class="empty">尚無週考成績紀錄。</div>` : ""}
    </div>
    <p class="report-copy">此週考報告採各科獨立判讀，不混入段考成績；系統優先參考近期週考、分數起伏與進退步趨勢，避免早期成績或不同科目混算造成失準。</p>
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
  const exam = displayedClassReportExam();
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

function classReportFileName(exam, ext) {
  return `${exam.date}_${exam.grade}_${exam.subject}_班級成績單.${ext}`;
}

function classReportExportRows(exam) {
  if (!exam || exam.noExam) return { average: NaN, paperCount: Math.max(1, Number(exam?.paperCount) || 1), rows: [] };
  const { average, paperCount, reportRows } = classReportData(exam);
  const rows = reportRows.map(({ student, ranked, absent }) => ({
    rank: ranked ? ranked.rank : "-",
    name: student.name,
    grade: student.grade,
    subject: exam.subject,
    papers: Array.from({ length: paperCount }, (_item, index) => absent ? "缺考" : scoreDisplay(ranked?.papers[index])),
    average: absent ? "缺考" : scoreDisplay(ranked?.score),
    failing: !absent && Number.isFinite(ranked?.score) && ranked.score < 60,
  }));
  return { average, paperCount, rows };
}

function downloadBlob(content, mimeType, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadClassReportExcel() {
  const exam = displayedClassReportExam();
  if (!exam) return alert("尚無成績單可匯出。");
  const { average, paperCount, rows } = classReportExportRows(exam);
  const headers = ["排名", "姓名", "班級", "科目", ...Array.from({ length: paperCount }, (_item, index) => `卷${index + 1}`), "平均"];
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <table border="1">
      <tr><th colspan="${headers.length}">金牌躍騰教育集團 班級成績單</th></tr>
      <tr><td colspan="${headers.length}">${escapeHtml(dateLabel(exam.date))} ${escapeHtml(exam.grade)} ${escapeHtml(exam.subject)}　班平均 ${scoreDisplay(average)}　${escapeHtml(exam.scope || "未填考試重點")}</td></tr>
      <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      ${rows.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.subject)}</td>${row.papers.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}<td style="${row.failing ? "color:#e60012;font-weight:bold;" : ""}">${escapeHtml(row.average)}</td></tr>`).join("") || `<tr><td colspan="${headers.length}">${exam.noExam ? "無考試" : "尚無成績"}</td></tr>`}
    </table>
  </body></html>`;
  downloadBlob(`\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8", classReportFileName(exam, "xls"));
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function canvasText(ctx, text, x, y, maxWidth) {
  ctx.fillText(String(text ?? ""), x, y, maxWidth);
}

function downloadClassReportImage() {
  const exam = displayedClassReportExam();
  if (!exam) return alert("尚無成績單可匯出。");
  const { average, paperCount, rows } = classReportExportRows(exam);
  const scale = 2;
  const width = 1180;
  const topSafe = 56;
  const rowHeight = 54;
  const headerBandHeight = 300;
  const tableY = 322;
  const footerHeight = 54;
  const tableRows = Math.max(rows.length, 1);
  const height = topSafe + tableY + 48 + tableRows * rowHeight + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#f7f1e3";
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#11151a");
  gradient.addColorStop(.55, "#20242b");
  gradient.addColorStop(1, "#8a6424");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, headerBandHeight + topSafe);

  ctx.save();
  ctx.translate(0, topSafe);
  ctx.fillStyle = "#f5d47a";
  ctx.font = "bold 34px Microsoft JhengHei, Arial";
  canvasText(ctx, "金牌躍騰教育集團 班級成績單", 54, 66, 760);
  ctx.fillStyle = "#fff7df";
  ctx.font = "20px Microsoft JhengHei, Arial";
  canvasText(ctx, `${dateLabel(exam.date)}　${exam.grade}　${exam.subject}`, 56, 106, 620);
  canvasText(ctx, `列印日期：${new Date().toLocaleDateString("zh-TW")}`, 890, 106, 230);

  ctx.fillStyle = "rgba(255,255,255,.08)";
  drawRoundRect(ctx, 54, 138, 1072, 82, 10);
  ctx.fill();
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 20px Microsoft JhengHei, Arial";
  canvasText(ctx, `班平均 ${scoreDisplay(average)}`, 82, 188, 180);
  canvasText(ctx, `${paperCount} 份考卷`, 270, 188, 160);
  ctx.font = "18px Microsoft JhengHei, Arial";
  canvasText(ctx, `重點：${exam.scope || "未填考試重點"}`, 438, 188, 650);

  const tableX = 54;
  const tableWidth = 1072;
  const columns = [
    { key: "rank", label: "排名", width: 78 },
    { key: "name", label: "姓名", width: 190 },
    { key: "grade", label: "班級", width: 100 },
    { key: "subject", label: "科目", width: 120 },
    ...Array.from({ length: paperCount }, (_item, index) => ({ key: `p${index}`, label: `卷${index + 1}`, width: Math.max(80, Math.floor(300 / paperCount)) })),
    { key: "average", label: "平均", width: 110 },
  ];
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  columns.forEach((column) => { column.width = column.width * tableWidth / total; });

  ctx.fillStyle = "#171b21";
  drawRoundRect(ctx, tableX, tableY, tableWidth, 48, 8);
  ctx.fill();
  ctx.font = "bold 18px Microsoft JhengHei, Arial";
  ctx.fillStyle = "#f5d47a";
  let cursor = tableX;
  columns.forEach((column) => {
    canvasText(ctx, column.label, cursor + 14, tableY + 31, column.width - 18);
    cursor += column.width;
  });

  if (!rows.length) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(tableX, tableY + 48, tableWidth, rowHeight);
    ctx.fillStyle = "#333";
    ctx.font = "18px Microsoft JhengHei, Arial";
    canvasText(ctx, exam.noExam ? "當日無考試" : "尚無成績", tableX + 18, tableY + 82, tableWidth - 36);
  } else {
    rows.forEach((row, rowIndex) => {
      const y = tableY + 48 + rowIndex * rowHeight;
      ctx.fillStyle = rowIndex % 2 ? "#f4ead2" : "#fffaf0";
      ctx.fillRect(tableX, y, tableWidth, rowHeight);
      ctx.strokeStyle = "#dfd0aa";
      ctx.beginPath();
      ctx.moveTo(tableX, y + rowHeight);
      ctx.lineTo(tableX + tableWidth, y + rowHeight);
      ctx.stroke();
      ctx.font = row.rank === 1 ? "bold 18px Microsoft JhengHei, Arial" : "17px Microsoft JhengHei, Arial";
      cursor = tableX;
      const values = [row.rank, row.name, row.grade, row.subject, ...row.papers, row.average];
      values.forEach((value, index) => {
        ctx.fillStyle = index === values.length - 1 && row.failing ? "#e60012" : "#1e2329";
        canvasText(ctx, value, cursor + 14, y + 34, columns[index].width - 18);
        cursor += columns[index].width;
      });
    });
  }
  ctx.restore();

  ctx.fillStyle = "#76623a";
  ctx.font = "15px Microsoft JhengHei, Arial";
  canvasText(ctx, "不及格分數以紅字標示｜本圖檔可直接傳送家長群組", 54, height - 22, 800);
  canvas.toBlob((blob) => {
    if (!blob) return alert("圖片生成失敗，請再試一次。");
    downloadBlob(blob, "image/png", classReportFileName(exam, "png"));
  }, "image/png");
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
  `, "portrait");
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

function navigateToTab(tabId) {
  if (!tabId || !$(`#${tabId}`)) return;
  if ($("#scores")?.classList.contains("active")) captureScoreDraft();
  $$(".tab-button").forEach((tab) => {
    const activeTop = tab.dataset.tab === tabId || tab.dataset.tab === parentTabs[tabId];
    tab.classList.toggle("active", activeTop);
  });
  $$(".page").forEach((page) => page.classList.remove("active"));
  $(`#${tabId}`).classList.add("active");
  document.body.classList.remove("nav-open");
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToTab(button.dataset.tab);
    });
  });
  $$("[data-back-tab], .portal-tile").forEach((button) => {
    button.addEventListener("click", () => navigateToTab(button.dataset.backTab || button.dataset.tab));
  });
  $("#mobileMenuButton")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#mobileScrim")?.addEventListener("click", () => document.body.classList.remove("nav-open"));
}

function enforceMobilePages() {
  if (!mobileQuery.matches) return;
  const activePage = $(".page.active");
  if (activePage && !["dashboard", "attendance", "management", "class-ops", "academic", ...Object.keys(parentTabs)].includes(activePage.id)) navigateToTab("dashboard");
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

function clearEventForm() {
  editingEventId = null;
  $("#eventGrade").value = "全體";
  $("#eventType").value = "固定重大事件";
  $("#eventDate").value = todayISO();
  $("#eventTitle").value = "";
  $("#eventNote").value = "";
  $("#eventForm .primary").textContent = "張貼公告";
  $("#cancelEventEdit").hidden = true;
}

function fillEventForm(record) {
  editingEventId = record.id;
  $("#eventGrade").value = record.grade;
  $("#eventType").value = record.type;
  $("#eventDate").value = record.date;
  $("#eventTitle").value = record.title;
  $("#eventNote").value = record.note || "";
  $("#eventForm .primary").textContent = "儲存公告";
  $("#cancelEventEdit").hidden = false;
}

function setupForms() {
  const onInputChange = (id, handler) => {
    const element = $(`#${id}`);
    if (!element) return;
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
  };

  ["classOpsYear", "classOpsSemester", "classOpsGrade", "classOpsSubject"].forEach((id) => {
    onInputChange(id, renderClassOps);
  });

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
        parentCode: generateUniqueParentCode(),
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

  $("#eventForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = {
      grade: $("#eventGrade").value,
      type: $("#eventType").value,
      date: $("#eventDate").value,
      title: $("#eventTitle").value.trim(),
      note: $("#eventNote").value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (!payload.title) return alert("請輸入公告標題");
    if (editingEventId) {
      const record = state.events.find((item) => item.id === editingEventId);
      if (record) Object.assign(record, payload);
    } else {
      state.events.push({
        id: crypto.randomUUID(),
        ...payload,
        createdAt: new Date().toISOString(),
      });
    }
    clearEventForm();
    saveState();
    renderAll();
    flashButton(event.submitter, "已張貼");
  });

  $("#cancelEventEdit")?.addEventListener("click", () => {
    clearEventForm();
    renderAll();
  });

  $("#academicForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = normalizeAcademicSettings({
      academicYear: $("#academicYear").value.trim(),
      semester: $("#academicSemester").value,
    });
    saveState();
    renderAll();
    flashButton(event.submitter, "已儲存");
  });

  $("#examForm").addEventListener("submit", saveExam);
  $("#resetExamForm").addEventListener("click", resetExamForm);
  $("#termScoreForm").addEventListener("submit", saveTermScore);
  $("#saveSchedule").addEventListener("click", (event) => {
    saveSchedule();
    flashButton(event.currentTarget, "已儲存");
  });
  $("#printClassReport").addEventListener("click", printClassReportPdf);
  $("#returnCurrentClassReport").addEventListener("click", returnCurrentClassReport);
  $("#downloadClassReportImage").addEventListener("click", downloadClassReportImage);
  $("#downloadClassReportExcel").addEventListener("click", downloadClassReportExcel);
  $("#printStudentReport").addEventListener("click", printStudentReportPdf);
  $("#printTermReport").addEventListener("click", printTermReportPdf);
  $("#downloadTermReportImage").addEventListener("click", downloadTermReportImage);
  $("#downloadTermReportExcel").addEventListener("click", downloadTermReportExcel);
  $$("#termSectionSwitch [data-term-section]").forEach((button) => {
    button.addEventListener("click", () => {
      termSection = button.dataset.termSection;
      renderAll();
    });
  });
  $$("#scoreSectionSwitch [data-score-section]").forEach((button) => {
    button.addEventListener("click", () => {
      if (scoreSection === "entry") captureScoreDraft();
      scoreSection = button.dataset.scoreSection;
      renderAll();
    });
  });

  ["examDate", "examGrade", "examSubject", "examScope", "examPaperCount", "examNoTest", "scoreStudentPicker"].forEach((id) => {
    onInputChange(id, captureScoreDraft);
  });
  ["examDate", "examGrade", "examSubject"].forEach((id) => {
    onInputChange(id, () => {
      if (!editingExamId) selectedClassReportExamId = null;
      $("#scoreStudentFilter").value = "全部";
      $("#scoreStudentPicker").value = "";
      renderExamSubjectOptions();
      renderScoreStudentFilter();
      renderScoreEntryList();
      renderClassReport();
    });
  });
  $("#scoreEntryList").addEventListener("input", captureScoreDraft);
  $("#scoreEntryList").addEventListener("change", captureScoreDraft);
  $("#scoreEntryList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-score-absent]");
    if (!button) return;
    setScoreAbsentButton(button, !button.classList.contains("active"));
    captureScoreDraft();
  });

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

  $("#scoreStudentPicker").addEventListener("input", () => {
    $("#scoreStudentFilter").value = "全部";
    renderScoreEntryList();
  });

  $("#careerGrade").addEventListener("change", () => {
    $("#careerStudentPicker").value = "";
    $("#careerStudent").value = "";
    careerSubject = "全部";
    renderAll();
  });

  $("#careerStudentPicker").addEventListener("focus", () => renderCareerStudentOptions(true));
  $("#careerStudentPicker").addEventListener("click", () => renderCareerStudentOptions(true));
  $("#careerStudentPicker").addEventListener("input", () => {
    $("#careerStudent").value = "";
    careerSubject = "全部";
    renderCareerStudentOptions(true);
    renderStudentReport();
  });

  document.addEventListener("click", (event) => {
    if (!$("#leaveStudentCombo").contains(event.target)) {
      $("#leaveStudentOptions").hidden = true;
    }
    if ($("#scoreStudentCombo") && !$("#scoreStudentCombo").contains(event.target)) {
      $("#scoreStudentOptions").hidden = true;
    }
    if (!$("#careerStudentCombo")?.contains(event.target)) {
      $("#careerStudentOptions").hidden = true;
    }
  });

  ["studentFilter", "studentSearch", "lateGrade", "historyType", "historySearch", "scheduleGrade", "examGrade", "examSubject", "examPaperCount", "examNoTest", "scoreHistoryYear", "scoreHistorySemester", "careerQueryDate", "careerExamYear", "careerExamSemester", "careerTermYear", "careerTermAnalysisYear", "careerTermAnalysisSemester", "careerTermAnalysisStage", "termYear", "termSemester", "termGrade", "termStage"].forEach((id) => {
    onInputChange(id, renderAll);
  });

  $("#careerSubjectButtons")?.addEventListener("click", (event) => {
    const subject = event.target.dataset.careerSubject;
    if (!subject) return;
    careerSubject = subject;
    renderAll();
  });

  $("#parentCareerSubjectButtons")?.addEventListener("click", (event) => {
    const subject = event.target.dataset.parentCareerSubject;
    if (!subject) return;
    parentCareerSubject = subject;
    if (parentStudentId) renderParentPortal();
  });
  ["parentScoreDate", "parentExamYear", "parentExamSemester", "parentTermYear", "parentTermAnalysisYear", "parentTermAnalysisSemester", "parentTermAnalysisStage"].forEach((id) => {
    onInputChange(id, () => {
      if (parentStudentId) renderParentPortal();
    });
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
    const previous = $(studentSelector).value;
    const options = state.students
      .filter((student) => student.grade === grade)
      .map((student) => `<option value="${student.id}">${student.name}</option>`)
      .join("");
    $(studentSelector).innerHTML = options || `<option value="">請先建立學生檔案</option>`;
    if (previous && state.students.some((student) => student.id === previous && student.grade === grade)) {
      $(studentSelector).value = previous;
    }
  };
  renderLeaveOptions();
  renderOptions("#lateGrade", "#lateStudent");
  renderCareerStudentOptions(false);
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

function careerStudentMatches() {
  const grade = $("#careerGrade")?.value || "國一";
  const keyword = $("#careerStudentPicker")?.value.trim() || "";
  return state.students
    .filter((student) => student.grade === grade)
    .filter((student) => !keyword || student.name.includes(keyword));
}

function renderCareerStudentOptions(open = false) {
  const optionsBox = $("#careerStudentOptions");
  if (!optionsBox) return;
  const selected = getStudent($("#careerStudent")?.value);
  if (selected && selected.grade === ($("#careerGrade")?.value || "國一") && $("#careerStudentPicker") && !$("#careerStudentPicker").value) {
    $("#careerStudentPicker").value = selected.name;
  }
  const matches = careerStudentMatches();
  optionsBox.innerHTML = matches.length
    ? matches.map((student) => `
      <button type="button" class="combo-option" data-pick-career-student="${student.id}">
        <strong>${student.name}</strong><span>${student.grade}｜${studentCoursesLabel(student)}</span>
      </button>
    `).join("")
    : `<div class="combo-empty">請先建立學生，或換個關鍵字</div>`;
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
          <button class="ghost danger" data-delete-late="${record.id}">刪除晚到</button>
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

function eventVisibleToStudent(record, student) {
  return record.grade === "全體" || record.grade === student?.grade;
}

function sortedEvents(records = state.events) {
  return records.slice().sort((a, b) => {
    const fixedOrder = a.type === b.type ? 0 : a.type === "臨時重大事件" ? -1 : 1;
    return fixedOrder || b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

function renderEventCard(record, withActions = false) {
  return `
    <article class="record-card event-card ${record.type === "臨時重大事件" ? "ending" : ""}">
      <strong>${record.title}</strong>
      <div class="meta">
        <span class="badge">${record.type}</span>
        <span class="badge">${record.grade}</span>
        <span class="badge">${dateLabel(record.date)}</span>
        ${record.note ? `<span class="badge gold">${record.note}</span>` : ""}
      </div>
      ${withActions ? `
        <div class="action-row">
          <button class="ghost" data-edit-event="${record.id}">編輯</button>
          <button class="ghost danger" data-delete-event="${record.id}">刪除</button>
        </div>` : ""}
    </article>
  `;
}

function renderEventManageList() {
  const target = $("#eventManageList");
  if (!target) return;
  target.innerHTML = sortedEvents()
    .map((record) => renderEventCard(record, true))
    .join("") || `<div class="empty">尚未張貼重大行事曆公告。</div>`;
}

function setupActions() {
  document.addEventListener("click", (event) => {
    const deleteStudentId = event.target.dataset.deleteStudent;
    const editStudentId = event.target.dataset.editStudent;
    const pickLeaveStudentId = event.target.closest("[data-pick-leave-student]")?.dataset.pickLeaveStudent;
    const pickCareerStudentId = event.target.closest("[data-pick-career-student]")?.dataset.pickCareerStudent;
    const dismissLeaveId = event.target.dataset.dismissLeave;
    const deleteLeaveId = event.target.dataset.deleteLeave;
    const removeLateId = event.target.dataset.removeLate;
    const deleteLateId = event.target.dataset.deleteLate;
    const viewExamId = event.target.dataset.viewExam;
    const editExamId = event.target.dataset.editExam;
    const deleteExamId = event.target.dataset.deleteExam;
    const viewTermReportKey = event.target.dataset.viewTermReport;
    const editTermReportKey = event.target.dataset.editTermReport;
    const deleteTermReportKey = event.target.dataset.deleteTermReport;
    const editEventId = event.target.dataset.editEvent;
    const deleteEventId = event.target.dataset.deleteEvent;

    if (pickLeaveStudentId) {
      const student = getStudent(pickLeaveStudentId);
      if (student) {
        $("#leaveStudent").value = student.id;
        $("#leaveStudentPicker").value = student.name;
        $("#leaveStudentOptions").hidden = true;
      }
    }
    if (pickCareerStudentId) {
      const student = getStudent(pickCareerStudentId);
      if (student) {
        $("#careerStudent").value = student.id;
        $("#careerStudentPicker").value = student.name;
        $("#careerStudentOptions").hidden = true;
        careerSubject = "全部";
        renderStudentReport();
      }
    }
    if (editStudentId) {
      const student = getStudent(editStudentId);
      if (student) {
        fillStudentForm(student);
        navigateToTab("students");
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
    if (deleteLateId && confirm("確定刪除這筆晚到紀錄？刪除後不會保留在歷史紀錄。")) {
      state.lateRecords = state.lateRecords.filter((record) => record.id !== deleteLateId);
    }
    if (viewExamId) {
      const exam = state.exams.find((record) => record.id === viewExamId);
      if (exam) {
        viewExamReport(exam);
        navigateToTab("scores");
        $("#classReport")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    if (editExamId) {
      const exam = state.exams.find((record) => record.id === editExamId);
      if (exam) {
        fillExamForm(exam);
        navigateToTab("scores");
        $("#examDate").focus();
      }
    }
    if (deleteExamId && confirm("確定刪除這份成績單？刪除後家長端與生涯檔案也不會再顯示這次考試。")) {
      state.exams = state.exams.filter((record) => record.id !== deleteExamId);
      if (selectedClassReportExamId === deleteExamId) selectedClassReportExamId = null;
      if (editingExamId === deleteExamId) {
        editingExamId = null;
        updateExamFormMode();
      }
    }
    if (viewTermReportKey) {
      applyTermReportKey(viewTermReportKey);
      termSection = "history";
      navigateToTab("term");
      renderAll();
      $("#termReportBody")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (editTermReportKey) {
      applyTermReportKey(editTermReportKey);
      termSection = "entry";
      navigateToTab("term");
      renderAll();
      $("#termScoreEntryList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (deleteTermReportKey) {
      const { year, semester, grade, stage } = applyTermReportKey(deleteTermReportKey);
      if (confirm(`確定刪除 ${year}${semester} ${grade} ${stage} 段考成績單？刪除後家長端與生涯檔案也不會再顯示這次段考。`)) {
        state.termScores = state.termScores.filter((item) =>
          !(item.year === year && item.semester === semester && item.grade === grade && item.stage === stage)
        );
        termSection = "history";
        saveState();
        renderAll();
      }
    }
    if (editEventId) {
      const record = state.events.find((item) => item.id === editEventId);
      if (record) {
        fillEventForm(record);
        navigateToTab("events");
        $("#eventTitle").focus();
      }
    }
    if (deleteEventId && confirm("確定刪除這則重大行事曆公告？家長端也會同步移除。")) {
      state.events = state.events.filter((item) => item.id !== deleteEventId);
      if (editingEventId === deleteEventId) clearEventForm();
    }

    if (deleteStudentId || dismissLeaveId || deleteLeaveId || removeLateId || deleteLateId || deleteExamId || deleteEventId) {
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

function normalizeParentCodeInput(value) {
  return cleanCellText(value).toUpperCase().replace(/\s+/g, "");
}

function parentCodeTaken(code, ownStudentId) {
  return state.students.some((student) =>
    student.id !== ownStudentId &&
    normalizeParentCodeInput(student.parentCode) === code
  );
}

async function updateParentOwnCode(event) {
  event.preventDefault();
  const student = getStudent(parentStudentId);
  if (!student) return;
  const errorBox = $("#parentCodeUpdateError");
  const nextCode = normalizeParentCodeInput($("#parentOwnCode").value);
  if (!/^[A-Z0-9]{4,12}$/.test(nextCode)) {
    errorBox.textContent = "代碼請輸入 4 到 12 碼英文或數字。";
    errorBox.hidden = false;
    return;
  }
  try {
    const remote = supabaseClient ? await loadSupabaseState() : null;
    if (remote) {
      state = normalizeState(remote.data || emptyState());
      lastRemoteUpdatedAt = remote.updatedAt || lastRemoteUpdatedAt;
    }
    const latestStudent = getStudent(parentStudentId);
    if (!latestStudent) {
      errorBox.textContent = "找不到學生資料，請重新登入。";
      errorBox.hidden = false;
      return;
    }
    if (parentCodeTaken(nextCode, latestStudent.id)) {
      errorBox.textContent = "這個代碼已經有人使用，請換一組。";
      errorBox.hidden = false;
      $("#parentOwnCode").select();
      return;
    }
    latestStudent.parentCode = nextCode;
    errorBox.hidden = true;
    localStorage.setItem(storageKey(), JSON.stringify(state));
    if (remoteSave) await remoteSave();
    else saveState();
    renderParentPortal();
    flashButton(event.submitter, "已更新");
  } catch (error) {
    errorBox.textContent = "更新失敗，請稍後再試。";
    errorBox.hidden = false;
  }
}

function studentScoreSummary(student, subjectFilter = "全部") {
  return reportSubjects
    .filter((subject) => subjectFilter === "全部" || subject === subjectFilter)
    .map((subject) => {
    const exams = state.exams.filter((exam) => !exam.noExam && exam.subject === subject && exam.scores?.[student.id] !== undefined);
    const termRows = state.termScores.filter((item) => item.studentId === student.id && normalizeCourseName(item.subject) === subject);
    if (!exams.length && !termRows.length) return "";
    const weeklyScores = exams.map((exam) => averageScore(scoreValuesForStudent(exam, student.id))).filter(Number.isFinite);
    const termScores = termRows.map((item) => Number(item.score)).filter(Number.isFinite);
    const scores = [...weeklyScores, ...termScores];
    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const classRows = state.exams
      .filter((exam) => !exam.noExam && exam.subject === subject)
      .flatMap((exam) => Object.keys(exam.scores || {}).map((studentId) => averageScore(scoreValuesForStudent(exam, studentId))))
      .filter(Number.isFinite);
    const termClassRows = state.termScores
      .filter((item) => normalizeCourseName(item.subject) === subject)
      .map((item) => Number(item.score))
      .filter(Number.isFinite);
    const combinedClassRows = [...classRows, ...termClassRows];
    const classAvg = combinedClassRows.length ? combinedClassRows.reduce((sum, score) => sum + score, 0) / combinedClassRows.length : NaN;
    const latest = exams.sort((a, b) => b.date.localeCompare(a.date))[0];
    const rankRows = latest ? currentScoreRows(latest) : [];
    const latestTerm = termRows.sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    const latestIsTerm = latestTerm && (!latest || (latestTerm.date || "") >= latest.date);
    const rank = latestIsTerm
      ? termRowsForMeta({
        year: latestTerm.year,
        semester: latestTerm.semester,
        grade: latestTerm.grade,
        date: latestTerm.date,
        stage: latestTerm.stage,
        subject: latestTerm.subject,
      }).find((row) => row.student.id === student.id)?.rank || "-"
      : rankRows.find((row) => row.student.id === student.id)?.rank || "-";
    return `<article class="record-card"><strong>${subject}</strong><div class="meta"><span class="badge">個人平均 ${avg.toFixed(1)}</span><span class="badge">班平均 ${Number.isFinite(classAvg) ? classAvg.toFixed(1) : "-"}</span><span class="badge">最新排名 ${rank}</span></div></article>`;
  }).filter(Boolean).join("") || `<div class="empty">尚無成績紀錄。</div>`;
}

function studentAvailableSubjects(student) {
  const subjects = new Set(student.courses || []);
  studentExamRows(student)
    .filter((row) => studentTakesSubject(student, row.exam.subject))
    .forEach((row) => subjects.add(row.exam.subject));
  return reportSubjects.filter((subject) => subjects.has(subject));
}

function renderParentSubjectOptions(student) {
  const target = $("#parentSubjectFilter");
  if (!target) return;
  const previous = target.value;
  const queryDate = $("#parentScoreDate")?.value || todayISO();
  const subjects = scheduledSubjectsForStudentDate(student, queryDate);
  target.innerHTML = `<option value="當日課程">${scheduledSubjectLabel(subjects)}</option>${subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("")}`;
  target.value = previous && ["當日課程", ...subjects].includes(previous) ? previous : "當日課程";
}

function renderParentScoreHistory(student) {
  const queryDate = $("#parentScoreDate")?.value || todayISO();
  const dateSubjects = scheduledSubjectsForStudentDate(student, queryDate);
  const selectedSubject = $("#parentSubjectFilter")?.value || "當日課程";
  const lookupSubjects = selectedSubject === "當日課程" ? dateSubjects : [selectedSubject];
  const rows = studentExamRows(student)
    .filter((row) => !lookupSubjects.length || lookupSubjects.includes(row.exam.subject))
    .slice()
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const dayRows = rows.filter((row) => row.exam.date === queryDate);
  const historyRows = rows.filter((row) => row.exam.date !== queryDate);
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => !lookupSubjects.length || lookupSubjects.includes(normalizeCourseName(item.subject)))
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const dayTermRows = termRows.filter((item) => (item.date || item.createdAt?.slice(0, 10) || "") === queryDate);
  const historyTermRows = termRows.filter((item) => (item.date || item.createdAt?.slice(0, 10) || "") !== queryDate);

  if (!rows.length && !termRows.length) return `<div class="empty">尚無此科目的歷史成績。</div>`;

  return `
    <div class="parent-history-head">
      <strong>${scheduledSubjectLabel(lookupSubjects)} 歷史成績</strong>
      <span>${dateLabel(queryDate)} 依課表自動判斷科目</span>
    </div>
    ${lookupSubjects.map((subject) => studentScoreSummary(student, subject)).join("") || studentScoreSummary(student, "全部")}
    <h3 class="subhead">當日成績</h3>
    <div class="lookup-list">
      ${[
        ...dayRows.map((row) => `<article class="score-result-card"><b>${row.exam.subject}</b><span>${row.exam.scope || "未填重點"}</span><strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong><small>${dateLabel(row.exam.date)}｜週考｜各卷 ${row.papers.map(scoreDisplay).join(" / ")}</small></article>`),
        ...dayTermRows.map((item) => `<article class="score-result-card"><b>${item.subject}</b><span>${item.term || `${item.year || ""}${item.semester || ""}`} ${item.stage || ""}</span><strong class="${scoreClass(Number(item.score))}">${scoreDisplay(Number(item.score))}</strong><small>${dateLabel(item.date || item.createdAt?.slice(0, 10) || "")}｜段考</small></article>`),
      ].join("") || `<div class="empty small-empty">當日此科暫時沒有成績。</div>`}
    </div>
    <h3 class="subhead">週考歷史</h3>
    <div class="table-wrap parent-score-history">
      <table>
        <thead>
          <tr><th>日期</th><th>科目</th><th>考試重點</th><th>各卷分數</th><th>平均</th><th>排名</th><th>班平均</th></tr>
        </thead>
        <tbody>
          ${historyRows.map((row) => {
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
          ${historyTermRows.map((item) => `
            <tr>
              <td>${item.term || "-"}</td>
              <td>${item.stage || "-"}</td>
              <td>${item.subject || "-"}</td>
              <td class="${scoreClass(Number(item.score))}">${scoreDisplay(Number(item.score))}</td>
              <td>${item.date ? dateLabel(item.date) : item.createdAt ? dateLabel(item.createdAt.slice(0, 10)) : "-"}</td>
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
  $("#parentOwnCode").value = student.parentCode || "";
  $("#parentCodeUpdateError").hidden = true;
  $("#parentEventList").innerHTML = sortedEvents(state.events.filter((record) => eventVisibleToStudent(record, student)))
    .map((record) => renderEventCard(record))
    .join("") || `<div class="empty">目前尚無重大行事曆公告。</div>`;
  $("#parentLeaveList").innerHTML = state.leaves
    .filter((record) => record.studentId === student.id)
    .sort((a, b) => getLeaveStart(b).localeCompare(getLeaveStart(a)))
    .map(renderLeaveCard)
    .join("") || `<div class="empty">尚無請假紀錄。</div>`;
  if (parentCareerSubject !== "全部" && !careerSubjectsForStudent(student).includes(parentCareerSubject)) parentCareerSubject = "全部";
  renderParentCareerSubjectButtons(student);
  const period = weeklyPeriodFilter("parentExam", student);
  $("#parentScoreList").innerHTML = careerScoreLookupHtml(student, $("#parentScoreDate")?.value || todayISO(), selectedParentCareerSubject(student), { hideDateHistory: true, period });
  renderParentTermTrend(student);
  renderParentTermAnalysisReport(student);
  $("#parentReport").innerHTML = renderStudentReportHtml(student, selectedParentCareerSubject(student));
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
    loadScoreDraft();
    restoreScoreDraftMeta();
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
    cleanupCloudSync();
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
    setupCloudSync();
  });

  $("#parentCodeForm")?.addEventListener("submit", updateParentOwnCode);

  $("#parentLogout").addEventListener("click", () => {
    parentStudentId = null;
    cleanupCloudSync();
    showParentLogin();
  });
  $("#backTeacherLogin")?.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    showLogin();
  });
}

function renderAll() {
  $("#studentCount").textContent = dashboardStudents().length;
  renderAcademicSettings();
  renderExamSubjectOptions();
  renderScoreStudentFilter();
  renderExpectedAttendance();
  renderStudentOptions();
  renderStudents();
  renderSchedule();
  renderScoreEntryList();
  renderScoreSections();
  renderClassReport();
  renderExamHistory();
  renderStudentReport();
  renderTermSections();
  syncTermEndDateInput();
  renderTermScoreEntryList();
  renderTermReport();
  renderTermHistoryList();
  renderClassOps();
  renderEventManageList();
  renderActiveLeaves();
  renderLateBoard();
  renderManageLists();
  renderHistory();
}

function boot() {
  renderCourseInputs("studentCourses", "studentCourse");
  renderWeekdayInputs("studentFixedLeave", "fixedLeave");
  renderFixedLateInputs();
  resetLeaveForm();
  $("#examDate").value = todayISO();
  $("#careerQueryDate").value = todayISO();
  $("#parentScoreDate").value = todayISO();
  $("#termYear").value = String(new Date().getFullYear() - 1911);
  $("#careerTermAnalysisYear").value = String(new Date().getFullYear() - 1911);
  $("#parentTermAnalysisYear").value = String(new Date().getFullYear() - 1911);
  state.settings = normalizeAcademicSettings(state.settings);
  renderAcademicSettings();
  renderExamSubjectOptions();
  $("#lateDate").value = todayISO();
  $("#eventDate").value = todayISO();
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
    loadScoreDraft();
    restoreScoreDraftMeta();
    setupCloudSync();
    saveState();
    renderAll();
    enforceMobilePages();
  } else {
    showLogin();
  }
}

boot();
