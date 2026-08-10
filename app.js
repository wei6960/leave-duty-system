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
const termSubjects = ["國文", "英文", "數學", "社會", "自然", "歷史", "地理", "公民"];
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
let scoreDraft = null;
let careerSubject = "全部";
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
  career: "management",
};

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
    termScores: (raw.termScores || []).map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      date: item.date || item.createdAt?.slice(0, 10) || todayISO(),
    })),
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
  const list = targetId === "termSubject" ? termSubjects : courses;
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
    if (input.checked) draft.absences.push(studentId);
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
    input.checked = (scoreDraft.absences || []).includes(input.dataset.scoreAbsent);
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
          <label class="absent-check"><input type="checkbox" data-score-absent="${student.id}">缺考</label>
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
    const absent = (scoreDraft?.absences || []).includes(student.id) || document.querySelector(`[data-score-absent="${student.id}"]`)?.checked;
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
  $("#scoreStudentSearch").value = "";
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
  const date = $("#termDate").value || todayISO();
  const stage = $("#termStage").value;
  const subject = $("#termSubject").value;
  const term = `${year}${semester}`;
  const inputs = $$("[data-term-score-student]");
  let saved = 0;
  inputs.forEach((input) => {
    if (input.value === "") return;
    const studentId = input.dataset.termScoreStudent;
    const score = Number(input.value);
    if (!Number.isFinite(score)) return;
    const existing = state.termScores.find((item) =>
      item.studentId === studentId &&
      item.year === year &&
      item.semester === semester &&
      item.date === date &&
      item.stage === stage &&
      item.subject === subject
    );
    const payload = {
      studentId,
      year,
      semester,
      term,
      grade,
      date,
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
  if (!saved) return alert("請至少輸入一位學生的段考成績");
  saveState();
  renderAll();
  flashButton(event.submitter, "已儲存");
}

function studentExamRows(student) {
  return state.exams
    .filter((exam) => !exam.noExam && exam.scores && exam.scores[student.id] !== undefined)
    .map((exam) => ({ exam, papers: scoreValuesForStudent(exam, student.id), score: averageScore(scoreValuesForStudent(exam, student.id)) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));
}

function currentTermMeta() {
  return {
    year: $("#termYear")?.value.trim() || "未填學年",
    semester: $("#termSemester")?.value || "上學期",
    grade: $("#termGrade")?.value || "國一",
    date: $("#termDate")?.value || todayISO(),
    stage: $("#termStage")?.value || "一段",
    subject: $("#termSubject")?.value || "國文",
  };
}

function termRowsForMeta(meta = currentTermMeta()) {
  return state.termScores
    .filter((item) =>
      item.year === meta.year &&
      item.semester === meta.semester &&
      item.grade === meta.grade &&
      (item.date || item.createdAt?.slice(0, 10) || "") === meta.date &&
      item.stage === meta.stage &&
      item.subject === meta.subject
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
  const existing = new Map(termRowsForMeta(meta).map((row) => [row.studentId, row]));
  target.innerHTML = students.length
    ? students.map((student) => `
      <label class="score-row term-score-row">
        <span>${student.name}</span>
        <input type="number" min="0" max="100" step="0.1" data-term-score-student="${student.id}" value="${existing.get(student.id)?.score ?? ""}" placeholder="輸入成績">
      </label>
    `).join("")
    : `<div class="empty">此年級尚無學生。</div>`;
}

function renderTermReport() {
  const target = $("#termReportBody");
  if (!target) return;
  const meta = currentTermMeta();
  const rows = termRowsForMeta(meta);
  const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length : NaN;
  target.innerHTML = `
    <div class="report-head">
      <strong>${meta.year}${meta.semester} ${meta.grade} ${meta.stage} ${meta.subject}</strong>
      <span>${dateLabel(meta.date)}</span>
      <span>班平均 ${scoreDisplay(average)}</span>
      <span>${rows.length} 筆成績</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th>姓名</th><th>班級</th><th>科目</th><th>成績</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.rank}</td><td>${row.student.name}</td><td>${row.grade}</td><td>${row.subject}</td><td class="${scoreClass(Number(row.score))}">${scoreDisplay(Number(row.score))}</td></tr>`).join("") || `<tr><td colspan="5">尚無段考成績</td></tr>`}</tbody>
    </table>
  `;
}

function termReportFileName(meta, ext) {
  return `${meta.date}_${meta.grade}_${meta.stage}_${meta.subject}_段考成績單.${ext}`;
}

function termReportExportRows(meta = currentTermMeta()) {
  const rows = termRowsForMeta(meta).map((row) => ({
    rank: row.rank,
    name: row.student.name,
    grade: row.grade,
    subject: row.subject,
    score: scoreDisplay(Number(row.score)),
    failing: Number(row.score) < 60,
  }));
  const average = rows.length
    ? termRowsForMeta(meta).reduce((sum, row) => sum + Number(row.score), 0) / rows.length
    : NaN;
  return { meta, rows, average };
}

function printTermReportPdf() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可輸出。");
  pdfDocument(`${meta.grade} ${meta.stage} ${meta.subject} 段考成績單`, `
    <header class="doc-head">
      <div class="brand"><img src="assets/logo.png" alt=""><div><h1>金牌躍騰教育集團 段考成績單</h1><div>${escapeHtml(dateLabel(meta.date))} ${escapeHtml(meta.grade)} ${escapeHtml(meta.stage)} ${escapeHtml(meta.subject)}</div></div></div>
      <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
    </header>
    <div class="meta">
      <span class="pill">${escapeHtml(meta.year)}${escapeHtml(meta.semester)}</span>
      <span class="pill">班平均 ${scoreDisplay(average)}</span>
      <span class="pill">${rows.length} 筆成績</span>
    </div>
    <table>
      <thead><tr><th>排名</th><th class="left">姓名</th><th>班級</th><th>科目</th><th>成績</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.rank}</td><td class="left">${escapeHtml(row.name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.subject)}</td><td class="${row.failing ? "fail-score" : ""}">${escapeHtml(row.score)}</td></tr>`).join("")}</tbody>
    </table>
  `, "portrait");
}

function downloadTermReportExcel() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可匯出。");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <table border="1">
      <tr><th colspan="5">金牌躍騰教育集團 段考成績單</th></tr>
      <tr><td colspan="5">${escapeHtml(dateLabel(meta.date))} ${escapeHtml(meta.grade)} ${escapeHtml(meta.stage)} ${escapeHtml(meta.subject)}　${escapeHtml(meta.year)}${escapeHtml(meta.semester)}　班平均 ${scoreDisplay(average)}</td></tr>
      <tr><th>排名</th><th>姓名</th><th>班級</th><th>科目</th><th>成績</th></tr>
      ${rows.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.subject)}</td><td style="${row.failing ? "color:#e60012;font-weight:bold;" : ""}">${escapeHtml(row.score)}</td></tr>`).join("")}
    </table>
  </body></html>`;
  downloadBlob(`\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8", termReportFileName(meta, "xls"));
}

function downloadTermReportImage() {
  const { meta, rows, average } = termReportExportRows();
  if (!rows.length) return alert("尚無段考成績單可匯出。");
  const scale = 2;
  const width = 1080;
  const topSafe = 56;
  const rowHeight = 54;
  const headerHeight = 224;
  const height = topSafe + headerHeight + Math.max(rows.length, 1) * rowHeight + 70;
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
  ctx.fillRect(0, 0, width, 160 + topSafe);

  ctx.save();
  ctx.translate(0, topSafe);
  ctx.fillStyle = "#f5d47a";
  ctx.font = "bold 34px Microsoft JhengHei, Arial";
  canvasText(ctx, "金牌躍騰教育集團 段考成績單", 54, 64, 720);
  ctx.fillStyle = "#fff7df";
  ctx.font = "20px Microsoft JhengHei, Arial";
  canvasText(ctx, `${dateLabel(meta.date)}　${meta.grade}　${meta.stage}　${meta.subject}`, 56, 104, 660);
  canvasText(ctx, `列印日期：${new Date().toLocaleDateString("zh-TW")}`, 820, 104, 220);

  ctx.fillStyle = "rgba(255,255,255,.08)";
  drawRoundRect(ctx, 54, 126, 972, 66, 10);
  ctx.fill();
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 20px Microsoft JhengHei, Arial";
  canvasText(ctx, `${meta.year}${meta.semester}`, 82, 166, 180);
  canvasText(ctx, `班平均 ${scoreDisplay(average)}`, 288, 166, 180);
  canvasText(ctx, `${rows.length} 筆成績`, 492, 166, 150);

  const tableX = 54;
  const tableY = 244;
  const columns = [
    { label: "排名", width: 90 },
    { label: "姓名", width: 300 },
    { label: "班級", width: 150 },
    { label: "科目", width: 200 },
    { label: "成績", width: 232 },
  ];
  ctx.fillStyle = "#171b21";
  drawRoundRect(ctx, tableX, tableY - 48, 972, 48, 8);
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
    ctx.fillRect(tableX, y, 972, rowHeight);
    ctx.strokeStyle = "#dfd0aa";
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowHeight);
    ctx.lineTo(tableX + 972, y + rowHeight);
    ctx.stroke();
    cursor = tableX;
    const values = [row.rank, row.name, row.grade, row.subject, row.score];
    ctx.font = row.rank === 1 ? "bold 18px Microsoft JhengHei, Arial" : "17px Microsoft JhengHei, Arial";
    values.forEach((value, index) => {
      ctx.fillStyle = index === 4 && row.failing ? "#e60012" : "#1e2329";
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
  studentExamRows(student).forEach((row) => subjects.add(row.exam.subject));
  state.termScores
    .filter((item) => item.studentId === student.id)
    .forEach((item) => subjects.add(normalizeCourseName(item.subject)));
  return reportSubjects.filter((subject) => subjects.has(subject));
}

function selectedCareerSubject(student) {
  const subjects = careerSubjectsForStudent(student);
  if (careerSubject !== "全部" && subjects.includes(careerSubject)) return careerSubject;
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

function renderCareerSubjectButtons(student) {
  const target = $("#careerSubjectButtons");
  if (!target) return;
  const subjects = careerSubjectsForStudent(student);
  const selected = selectedCareerSubject(student);
  target.innerHTML = `
    <button class="subject-chip ${selected === "全部" ? "active" : ""}" type="button" data-career-subject="全部">全部</button>
    ${subjects.map((subject) => `<button class="subject-chip ${selected === subject ? "active" : ""}" type="button" data-career-subject="${subject}">${subject}</button>`).join("")}
  `;
}

function renderCareerScoreLookup(student) {
  const target = $("#careerScoreLookup");
  if (!target) return;
  if (!student) {
    target.innerHTML = `<div class="empty">請先選擇學生。</div>`;
    return;
  }
  const subject = selectedCareerSubject(student);
  const queryDate = $("#careerQueryDate")?.value || todayISO();
  const rows = studentExamRows(student)
    .filter((row) => subject === "全部" || row.exam.subject === subject)
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const dayRows = rows.filter((row) => row.exam.date === queryDate);
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => subject === "全部" || normalizeCourseName(item.subject) === subject);
  target.innerHTML = `
    <div class="lookup-result">
      <strong>${dateLabel(queryDate)} ${subject === "全部" ? "全部科目" : subject}</strong>
      <div class="lookup-list">
        ${dayRows.map((row) => `<article class="score-result-card"><b>${row.exam.subject}</b><span>${row.exam.scope || "未填重點"}</span><strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong><small>各卷 ${row.papers.map(scoreDisplay).join(" / ")}</small></article>`).join("") || `<div class="empty small-empty">當日此科暫時沒有成績。</div>`}
      </div>
    </div>
    <div class="table-wrap career-history-table">
      <table>
        <thead><tr><th>日期</th><th>科目</th><th>重點</th><th>各卷</th><th>平均</th><th>排名</th></tr></thead>
        <tbody>${rows.map((row) => {
          const rank = currentScoreRows(row.exam).find((item) => item.student.id === student.id)?.rank || "-";
          return `<tr><td>${dateLabel(row.exam.date)}</td><td>${row.exam.subject}</td><td>${row.exam.scope || "-"}</td><td>${row.papers.map(scoreDisplay).join(" / ")}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${rank}</td></tr>`;
        }).join("") || `<tr><td colspan="6">尚無歷史成績</td></tr>`}</tbody>
      </table>
    </div>
    <div class="meta">${termRows.map((item) => `<span class="badge">${item.term} ${item.stage} ${item.subject} ${scoreDisplay(Number(item.score))}</span>`).join("") || `<span class="badge">尚無段考成績</span>`}</div>
  `;
}

function renderStudentReport() {
  const student = getStudent($("#careerStudent")?.value);
  if (!student) {
    renderCareerSubjectButtons(null);
    renderCareerScoreLookup(null);
    $("#studentReport").innerHTML = `<div class="empty">請先選擇學生。</div>`;
    $("#archiveList").innerHTML = `<div class="empty">尚無歷年紀錄。</div>`;
    return;
  }
  if (careerSubject !== "全部" && !careerSubjectsForStudent(student).includes(careerSubject)) careerSubject = "全部";
  renderCareerSubjectButtons(student);
  renderCareerScoreLookup(student);
  $("#studentReport").innerHTML = renderStudentReportHtml(student);
  $("#archiveList").innerHTML = state.archives
    .filter((item) => item.studentId === student.id)
    .map((item) => `<article class="record-card done"><strong>${item.term}</strong><div class="meta"><span class="badge">${item.summary}</span></div></article>`)
    .join("") || `<div class="empty">尚無歷年紀錄。</div>`;
}

function renderStudentReportHtml(student, subjectOverride = null) {
  const examRows = studentExamRows(student);
  const subject = subjectOverride || selectedCareerSubject(student);
  const analyses = subjectPerformanceRows(student).filter((item) => subject === "全部" || item.subject === subject);
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => subject === "全部" || normalizeCourseName(item.subject) === subject);
  const analyzedSubjects = new Set(analyses.map((item) => item.subject));
  const termOnlyAnalyses = reportSubjects
    .filter((itemSubject) => (subject === "全部" || itemSubject === subject) && !analyzedSubjects.has(itemSubject))
    .map((itemSubject) => {
      const rows = termRows
        .filter((row) => normalizeCourseName(row.subject) === itemSubject)
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length : NaN;
      return rows.length ? { subject: itemSubject, avg, rows } : null;
    })
    .filter(Boolean);
  const levelSummary = analyses.length || termOnlyAnalyses.length
    ? [...analyses.map((item) => `${item.subject} ${item.level}`), ...termOnlyAnalyses.map((item) => `${item.subject} ${levelFromScore(item.avg)}`)].join("、")
    : "資料不足";
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
          <span>近期加權 ${scoreDisplay(item.recentAvg)}｜長期平均 ${scoreDisplay(item.longAvg)}｜最新 ${scoreDisplay(item.latest)}</span>
          <small>${trendLabel(item.trend)}｜${stabilityLabel(item.range)}｜歷程 ${item.count} 次</small>
          ${scoreLineChart(item.rows)}
          <p>${item.note}</p>
        </article>
      `).join("")}
      ${termOnlyAnalyses.map((item) => `
        <article class="analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${levelFromScore(item.avg)}</b>
          </div>
          <span>段考平均 ${scoreDisplay(item.avg)}｜共 ${item.rows.length} 筆</span>
          <small>目前此科以段考紀錄為主</small>
          ${scoreLineChart(item.rows.map((row) => ({
            score: Number(row.score),
            exam: { date: row.date || row.createdAt?.slice(0, 10) || todayISO(), subject: row.subject },
          })))}
          <p>尚無週考折線圖；已有段考成績會納入生涯檔案與家長端紀錄。</p>
        </article>
      `).join("")}
      ${!analyses.length && !termOnlyAnalyses.length ? `<div class="empty">尚無成績紀錄。</div>` : ""}
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
  const headerHeight = 238;
  const footerHeight = 54;
  const tableRows = Math.max(rows.length, 1);
  const height = topSafe + headerHeight + 56 + tableRows * rowHeight + footerHeight;
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
  ctx.fillRect(0, 0, width, 170 + topSafe);

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
  drawRoundRect(ctx, 54, 132, 1072, 72, 10);
  ctx.fill();
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 20px Microsoft JhengHei, Arial";
  canvasText(ctx, `班平均 ${scoreDisplay(average)}`, 82, 176, 180);
  canvasText(ctx, `${paperCount} 份考卷`, 270, 176, 160);
  ctx.font = "18px Microsoft JhengHei, Arial";
  canvasText(ctx, `重點：${exam.scope || "未填考試重點"}`, 438, 176, 650);

  const tableX = 54;
  const tableY = 258;
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
  const meta = currentTermMeta();
  const term = `${meta.year}${meta.semester}`;
  const students = state.students.filter((student) => student.grade === meta.grade);
  if (!students.length) return alert("此年級尚無學生");
  if (!confirm(`確定結算 ${term} ${meta.grade}？結算後會寫入歷年紀錄並清除該學期段考表格。`)) return;
  students.forEach((student) => {
    const rows = state.termScores.filter((item) =>
      item.studentId === student.id &&
      item.year === meta.year &&
      item.semester === meta.semester
    );
    const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length : NaN;
    state.archives.push({
      id: crypto.randomUUID(),
      studentId: student.id,
      term,
      summary: rows.length ? `段考平均 ${avg.toFixed(1)}，共 ${rows.length} 筆` : "本學期尚無段考成績",
      createdAt: new Date().toISOString(),
    });
  });
  state.termScores = state.termScores.filter((item) => !(item.year === meta.year && item.semester === meta.semester && item.grade === meta.grade));
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
  if (activePage && !["dashboard", "attendance", "management", ...Object.keys(parentTabs)].includes(activePage.id)) navigateToTab("dashboard");
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
  const onInputChange = (id, handler) => {
    const element = $(`#${id}`);
    if (!element) return;
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
  };

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
  $("#returnCurrentClassReport").addEventListener("click", returnCurrentClassReport);
  $("#downloadClassReportImage").addEventListener("click", downloadClassReportImage);
  $("#downloadClassReportExcel").addEventListener("click", downloadClassReportExcel);
  $("#printStudentReport").addEventListener("click", printStudentReportPdf);
  $("#printTermReport").addEventListener("click", printTermReportPdf);
  $("#downloadTermReportImage").addEventListener("click", downloadTermReportImage);
  $("#downloadTermReportExcel").addEventListener("click", downloadTermReportExcel);
  $$("#scoreSectionSwitch [data-score-section]").forEach((button) => {
    button.addEventListener("click", () => {
      if (scoreSection === "entry") captureScoreDraft();
      scoreSection = button.dataset.scoreSection;
      renderAll();
    });
  });

  ["examDate", "examGrade", "examSubject", "examScope", "examPaperCount", "examNoTest", "scoreStudentSearch", "scoreStudentFilter"].forEach((id) => {
    onInputChange(id, captureScoreDraft);
  });
  ["examDate", "examGrade", "examSubject"].forEach((id) => {
    onInputChange(id, () => {
      if (!editingExamId) selectedClassReportExamId = null;
      renderExamSubjectOptions();
      renderScoreStudentFilter();
      renderScoreEntryList();
      renderClassReport();
    });
  });
  $("#scoreEntryList").addEventListener("input", captureScoreDraft);
  $("#scoreEntryList").addEventListener("change", captureScoreDraft);

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

  ["studentFilter", "studentSearch", "lateGrade", "historyType", "historySearch", "scheduleGrade", "examGrade", "examSubject", "examPaperCount", "examNoTest", "scoreStudentSearch", "scoreStudentFilter", "careerGrade", "careerStudent", "careerQueryDate", "termYear", "termSemester", "termGrade", "termDate", "termStage", "termSubject"].forEach((id) => {
    onInputChange(id, renderAll);
  });

  $("#careerSubjectButtons")?.addEventListener("click", (event) => {
    const subject = event.target.dataset.careerSubject;
    if (!subject) return;
    careerSubject = subject;
    renderAll();
  });

  $("#parentSubjectFilter")?.addEventListener("input", () => {
    if (parentStudentId) renderParentPortal();
  });
  $("#parentSubjectFilter")?.addEventListener("change", () => {
    if (parentStudentId) renderParentPortal();
  });
  $("#parentScoreDate")?.addEventListener("input", () => {
    if (parentStudentId) renderParentPortal();
  });
  $("#parentScoreDate")?.addEventListener("change", () => {
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
    const viewExamId = event.target.dataset.viewExam;
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
  studentExamRows(student).forEach((row) => subjects.add(row.exam.subject));
  state.termScores
    .filter((item) => item.studentId === student.id)
    .forEach((item) => subjects.add(normalizeCourseName(item.subject)));
  return reportSubjects.filter((subject) => subjects.has(subject));
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
  const queryDate = $("#parentScoreDate")?.value || todayISO();
  const rows = studentExamRows(student)
    .filter((row) => subject === "全部" || row.exam.subject === subject)
    .slice()
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const dayRows = rows.filter((row) => row.exam.date === queryDate);
  const historyRows = rows.filter((row) => row.exam.date !== queryDate);
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => subject === "全部" || normalizeCourseName(item.subject) === subject)
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const dayTermRows = termRows.filter((item) => (item.date || item.createdAt?.slice(0, 10) || "") === queryDate);
  const historyTermRows = termRows.filter((item) => (item.date || item.createdAt?.slice(0, 10) || "") !== queryDate);

  if (!rows.length && !termRows.length) return `<div class="empty">尚無此科目的歷史成績。</div>`;

  return `
    <div class="parent-history-head">
      <strong>${subject === "全部" ? "全部科目歷史成績" : `${subject} 歷史成績`}</strong>
      <span>可調閱週考、段考與排名紀錄</span>
    </div>
    ${studentScoreSummary(student, subject)}
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
  $("#parentLeaveList").innerHTML = state.leaves
    .filter((record) => record.studentId === student.id)
    .sort((a, b) => getLeaveStart(b).localeCompare(getLeaveStart(a)))
    .map(renderLeaveCard)
    .join("") || `<div class="empty">尚無請假紀錄。</div>`;
  renderParentSubjectOptions(student);
  $("#parentScoreList").innerHTML = renderParentScoreHistory(student);
  $("#parentReport").innerHTML = renderStudentReportHtml(student, $("#parentSubjectFilter")?.value || "全部");
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
  renderScoreSections();
  renderClassReport();
  renderExamHistory();
  renderStudentReport();
  renderTermScoreEntryList();
  renderTermReport();
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
  $("#careerQueryDate").value = todayISO();
  $("#parentScoreDate").value = todayISO();
  $("#termDate").value = todayISO();
  $("#termYear").value = String(new Date().getFullYear() - 1911);
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
