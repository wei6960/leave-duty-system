const STORAGE_KEY_PREFIX = "leave-duty-system-v2";
const OLD_STORAGE_KEY = "leave-duty-system-v1";
const SESSION_KEY = "leave-duty-branch-session";
const DEVICE_KEY = "leave-duty-device-id";
const LOGIN_PASSWORD = "90757744";
const FIREBASE_SDK_VERSION = "12.17.1";
const SUPABASE_SDK_VERSION = "2.86.0";
const SUPABASE_COLLECTION = "leaveDutyBranches";
const SUPABASE_EXAM_COLLECTION = `${SUPABASE_COLLECTION}:exams`;
const geminiModelOptions = [
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite（免費優先）" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash（舊版相容）" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash（舊版相容）" },
];
const grades = ["國一", "國二", "國三"];
const studentStatuses = [...grades, "校友"];
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const periods = ["上午", "下午", "晚上"];
const termStages = ["一段", "二段", "三段"];
const coreCourses = ["國文", "英文", "數A", "數B", "數學", "自然", "總複習"];
const defaultCourses = ["國文", "英文", "數A", "數B", "數學", "數輔", "自然", "總複習", "素養課", "讀書班"];
let courses = [...defaultCourses];
const termSubjects = ["國文", "英文", "數學", "自然", "歷史", "地理", "公民"];
let reportSubjects = [...new Set([...courses, ...termSubjects])];
let scheduleCourses = [...courses, "考加"];
const leavePeriods = ["上午", "下午", "晚上"];
const leaveTypes = ["請假", "提早離班"];
const defaultRoomLayouts = {
  "3F大": { rows: 5, cols: 8 },
  "3F小": { rows: 4, cols: 6 },
  "2F大": { rows: 5, cols: 8 },
  "2F小": { rows: 4, cols: 6 },
  "1F小": { rows: 4, cols: 6 },
};
let roomLayouts = {};
const parentMode = new URLSearchParams(location.search).get("parent") === "1" || location.hash === "#parent";
const deviceId = localStorage.getItem(DEVICE_KEY) || crypto.randomUUID();
localStorage.setItem(DEVICE_KEY, deviceId);

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
let editingContactId = null;
let currentBranch = sessionStorage.getItem(SESSION_KEY) || "";
let state = currentBranch ? loadState() : emptyState();
roomLayouts = state.roomLayouts || normalizeRoomLayouts({});
applyCourseCatalog(state.courseCatalog);
let syncReady = false;
let syncLoading = false;
let syncUnsubscribe = null;
let syncSaveTimer = null;
let syncDocRef = null;
let setDocRemote = null;
let remoteSave = null;
let supabaseClient = null;
let supabasePollTimer = null;
let supabaseRefreshTimer = null;
let supabaseRealtimeChannel = null;
let lastRemoteUpdatedAt = "";
let parentStudentId = null;
let parentActiveSection = "parentHomeSection";
let parentBackStack = [];
let parentReportView = "menu";
let parentContactWeekDate = todayISO();
let teacherBackStack = [];
let classOpsSection = "menu";
let classOpsSelectedGrade = "國一";
let contactBookSection = "menu";
let aboutSection = "display";
let examHistoryPage = 1;
let paperAnalysisImageData = "";
let editingCourseName = null;
let rollCallGrade = "國一";
let seatSettingsSection = "menu";
let retentionGrade = "國一";
let retentionDate = todayISO();
let retentionSubject = "全部";
const studentAiCache = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const mobileQuery = window.matchMedia("(max-width: 720px)");
const parentTabs = {
  leave: "attendance",
  late: "attendance",
  history: "attendance",
  students: "management",
  schedule: "settings",
  scores: "management",
  term: "management",
  "class-ops": "class-ops",
  "roll-call": "management",
  career: "class-ops",
  events: "contact-book",
  "grade-promotion": "class-ops",
  "contact-book": "contact-book",
  "about-admin": "about-admin",
  settings: "settings",
  "course-admin": "settings",
  "seat-settings": "settings",
  "ai-settings": "settings",
  "retention-report": "management",
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

function currentRocYear() {
  return new Date().getFullYear() - 1911;
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
    deletedStudentIds: [],
    leaves: [],
    deletedLeaveIds: [],
    lateRecords: [],
    deletedLateIds: [],
    schedule: defaultSchedule(),
    settings: defaultAcademicSettings(),
    exams: [],
    deletedExamIds: [],
    termScores: [],
    termPeriods: {},
    termWeights: {},
    academicPeriods: [],
    events: [],
    contactBooks: [],
    paperAnalyses: [],
    courseCatalog: defaultCourses.map((name) => ({ name, core: coreCourses.includes(name) })),
    deletedCourseNames: [],
    roomLayouts: normalizeRoomLayouts({}),
    seatSettings: {},
    rollCalls: [],
    scoreDrafts: {},
    scoreActivity: null,
    about: defaultAboutSettings(),
    aiSettings: defaultAiSettings(),
    archives: [],
  };
}

function defaultAiSettings() {
  return {
    geminiApiKey: "",
    model: geminiModelOptions[0].value,
  };
}

function defaultAboutSettings() {
  return {
    publicEnabled: true,
    branch: "平鎮分校",
    slogan: "改變從金牌躍騰開始，一起見證孩子的成長",
    address: "",
    phone: "",
    lineUrl: "",
    facebookUrl: "",
    intro: "金牌躍騰教育集團以完整追蹤、即時回饋與分層輔導，陪伴孩子建立穩定成長節奏。",
    courses: "國中各科課程、段考複習、週考追蹤、個別弱點補強。",
    teachers: "",
    planning: "依學生程度安排前中後段目標，定期檢視週考、段考與作業完成狀態。",
    environmentPhotos: "",
    teacherPhotos: "",
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
  const deletedCourseNames = Array.isArray(raw.deletedCourseNames)
    ? raw.deletedCourseNames.map(normalizeCourseName).filter((name) => name && !coreCourses.includes(name))
    : [];
  const courseCatalog = normalizeCourseCatalog(raw.courseCatalog || defaultCourses)
    .filter((item) => item.core || !deletedCourseNames.includes(item.name));
  const normalizedRoomLayouts = normalizeRoomLayouts(raw.roomLayouts || {}, raw.seatSettings || {});
  roomLayouts = normalizedRoomLayouts;
  const availableCourses = courseCatalog.map((item) => item.name);
  const baseSchedule = defaultSchedule();
  const rawSchedule = raw.schedule || {};
  grades.forEach((grade) => {
    weekdays.forEach((day) => {
      periods.forEach((period) => {
        const course = normalizeCourseName(rawSchedule?.[grade]?.[day]?.[period]);
        baseSchedule[grade][day][period] = [...availableCourses, "考加"].includes(course)
          ? course
          : "";
      });
    });
  });
  return {
    deletedStudentIds: Array.isArray(raw.deletedStudentIds) ? raw.deletedStudentIds : [],
    students: (raw.students || [])
      .filter((student) => !(raw.deletedStudentIds || []).includes(student.id))
      .map((student) => ({
      id: student.id || crypto.randomUUID(),
      grade: studentStatuses.includes(student.grade) ? student.grade : "國一",
      name: student.name || "",
      weekdays: student.weekdays || [],
      courses: normalizeCourses(student.courses || student.subjects || [], availableCourses),
      meal: student.meal || "無訂餐",
      fixedLeave: student.fixedLeave || [],
      fixedLate: normalizeFixedLate(student.fixedLate || []),
      withdrawn: Boolean(student.withdrawn),
      withdrawnAt: student.withdrawnAt || "",
      parentCode: student.parentCode || generateParentCode(),
    })),
    deletedLeaveIds: Array.isArray(raw.deletedLeaveIds) ? raw.deletedLeaveIds : [],
    leaves: normalizeLeaves(raw.leaves || []).filter((record) => !(raw.deletedLeaveIds || []).includes(record.id)),
    deletedLateIds: Array.isArray(raw.deletedLateIds) ? raw.deletedLateIds : [],
    lateRecords: (raw.lateRecords || []).filter((record) => !(raw.deletedLateIds || []).includes(record.id)),
    schedule: baseSchedule,
    settings: normalizeAcademicSettings(raw.settings),
    deletedExamIds: Array.isArray(raw.deletedExamIds) ? raw.deletedExamIds : [],
    exams: (raw.exams || []).filter((exam) => !(raw.deletedExamIds || []).includes(exam.id)).map(normalizeExam),
    termScores: (raw.termScores || []).map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      date: item.date || item.createdAt?.slice(0, 10) || todayISO(),
    })),
    termPeriods: normalizeTermPeriods(raw.termPeriods || {}),
    termWeights: normalizeTermWeights(raw.termWeights || {}),
    academicPeriods: normalizeAcademicPeriods(raw.academicPeriods || [], normalizeAcademicSettings(raw.settings)),
    events: normalizeEvents(raw.events || []),
    contactBooks: normalizeContactBooks(raw.contactBooks || []),
    paperAnalyses: normalizePaperAnalyses(raw.paperAnalyses || []),
    courseCatalog,
    deletedCourseNames,
    roomLayouts: normalizedRoomLayouts,
    seatSettings: normalizeSeatSettings(raw.seatSettings || {}),
    rollCalls: normalizeRollCalls(raw.rollCalls || []),
    scoreDrafts: normalizeScoreDrafts(raw.scoreDrafts || {}),
    scoreActivity: raw.scoreActivity || null,
    about: normalizeAboutSettings(raw.about || {}),
    aiSettings: normalizeAiSettings(raw.aiSettings || raw.ai || {}),
    archives: raw.archives || [],
  };
}

function normalizeAiSettings(settings = {}) {
  const fallback = defaultAiSettings();
  return {
    geminiApiKey: settings.geminiApiKey || settings.apiKey || "",
    model: settings.model || fallback.model,
  };
}

function normalizeCourseCatalog(raw = defaultCourses) {
  const hasSavedCatalog = Array.isArray(raw) && raw.length;
  const names = hasSavedCatalog
    ? raw.map((item) => typeof item === "string" ? item : item?.name)
    : defaultCourses;
  const unique = [...new Set([...(hasSavedCatalog ? coreCourses : defaultCourses), ...names].map(normalizeCourseName).filter(Boolean))];
  return unique.map((name) => ({ name, core: coreCourses.includes(name) }));
}

function applyCourseCatalog(catalog = state?.courseCatalog) {
  courses = normalizeCourseCatalog(catalog).map((item) => item.name);
  reportSubjects = [...new Set([...courses, ...termSubjects])];
  scheduleCourses = [...courses, "考加"];
}

function normalizeContactBooks(records) {
  return (records || []).map((record) => ({
    id: record.id || crypto.randomUUID(),
    date: record.date || todayISO(),
    grade: ["全體", ...grades].includes(record.grade) ? record.grade : "全體",
    subject: normalizeCourseName(record.subject || "國文"),
    todayTest: record.todayTest || "",
    nextTest: record.nextTest || "",
    homework: record.homework || "",
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  }));
}

function normalizePaperAnalyses(records) {
  return (records || []).map((record) => ({
    id: record.id || crypto.randomUUID(),
    date: record.date || record.createdAt?.slice(0, 10) || todayISO(),
    title: record.title || "未命名考卷",
    grade: grades.includes(record.grade) ? record.grade : "國一",
    subject: normalizeCourseName(record.subject || "國文"),
    note: record.note || "",
    analysis: record.analysis || "",
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  }));
}

function normalizeRoomLayouts(raw = {}, seatSettings = {}) {
  const layouts = {};
  Object.entries(defaultRoomLayouts).forEach(([name, layout]) => {
    layouts[name] = {
      name,
      layoutSeats: normalizeLayoutSeats(defaultLayoutSeatIdsFromSize(layout.rows, layout.cols), name),
      core: true,
      updatedAt: "",
    };
  });
  Object.entries(raw || {}).forEach(([key, value]) => {
    const name = String(value?.name || key || "").trim();
    if (!name) return;
    const sizeSeats = value?.rows && value?.cols ? defaultLayoutSeatIdsFromSize(Number(value.rows), Number(value.cols)) : [];
    layouts[name] = {
      name,
      layoutSeats: normalizeLayoutSeats(value?.layoutSeats?.length ? value.layoutSeats : sizeSeats, name),
      core: Boolean(value?.core || defaultRoomLayouts[name]),
      updatedAt: value?.updatedAt || "",
    };
  });
  Object.values(seatSettings || {}).forEach((setting) => {
    const name = String(setting?.room || "").trim();
    if (!name || !Array.isArray(setting?.layoutSeats) || !setting.layoutSeats.length) return;
    const existing = layouts[name];
    if (!existing || !existing.updatedAt || (setting.updatedAt && setting.updatedAt > existing.updatedAt)) {
      layouts[name] = {
        name,
        layoutSeats: normalizeLayoutSeats(setting.layoutSeats, name, setting.seats || {}),
        core: Boolean(existing?.core || defaultRoomLayouts[name]),
        updatedAt: setting.updatedAt || existing?.updatedAt || "",
      };
    }
  });
  return layouts;
}

function roomLayoutNames() {
  const defaults = Object.keys(defaultRoomLayouts).filter((name) => roomLayouts[name]);
  const custom = Object.keys(roomLayouts).filter((name) => !defaultRoomLayouts[name]).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return [...defaults, ...custom];
}

function defaultRoomName() {
  return roomLayoutNames()[0] || "3F大";
}

function roomLayoutSeats(room = defaultRoomName()) {
  return normalizeLayoutSeats(roomLayouts[room]?.layoutSeats, room);
}

function seatPositionFromId(id = "") {
  const match = String(id).match(/^([ra])(\d+)c(\d+)$/);
  return match ? { type: match[1] === "a" ? "aisle" : "seat", row: Number(match[2]), col: Number(match[3]) } : null;
}

function sortSeatIds(ids = []) {
  return [...new Set(ids)]
    .filter((id) => seatPositionFromId(id))
    .sort((a, b) => {
      const left = seatPositionFromId(a);
      const right = seatPositionFromId(b);
      return left.row - right.row || left.col - right.col;
    });
}

function defaultLayoutSeatIds(room = "3F大") {
  const layout = roomLayouts[room] || roomLayouts["3F大"];
  if (layout?.layoutSeats?.length) return layout.layoutSeats;
  return defaultLayoutSeatIdsFromSize(layout?.rows || 5, layout?.cols || 8);
}

function defaultLayoutSeatIdsFromSize(rows = 5, cols = 8) {
  return Array.from({ length: rows * cols }, (_item, index) => {
    const row = Math.floor(index / cols) + 1;
    const col = index % cols + 1;
    return seatId(row, col);
  });
}

function aisleId(row, col) {
  return `a${row}c${col}`;
}

function normalizeLayoutSeats(layoutSeats, room = "3F大", seats = {}) {
  const saved = Array.isArray(layoutSeats) ? layoutSeats : [];
  const assigned = seats && typeof seats === "object" ? Object.keys(seats) : [];
  const ids = (saved.length ? saved : [...defaultLayoutSeatIds(room), ...assigned, seatId(1, 1)])
    .map((id) => {
      const pos = seatPositionFromId(id);
      return pos?.type === "aisle" ? aisleId(1, pos.col) : id;
    });
  const byPosition = [];
  sortSeatIds(ids).forEach((id) => {
    const pos = seatPositionFromId(id);
    if (!pos) return;
    if (byPosition.some((item) => {
      const itemPos = seatPositionFromId(item);
      if (pos.type === "aisle" || itemPos?.type === "aisle") return itemPos?.col === pos.col;
      return itemPos?.row === pos.row && itemPos?.col === pos.col;
    })) return;
    byPosition.push(id);
  });
  return byPosition.includes(seatId(1, 1)) ? byPosition : sortSeatIds([seatId(1, 1), ...byPosition]);
}

function normalizeSeatSettings(raw = {}) {
  return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [
    key,
    {
      grade: grades.includes(value?.grade) ? value.grade : key.split("|")[0] || "國一",
      subject: normalizeCourseName(value?.subject || key.split("|")[1] || "國文"),
      room: roomLayouts[value?.room] ? value.room : "3F大",
      seats: value?.seats && typeof value.seats === "object" ? value.seats : {},
      layoutSeats: normalizeLayoutSeats(value?.layoutSeats, value?.room, value?.seats),
      updatedAt: value?.updatedAt || "",
    },
  ]));
}

function normalizeRollCalls(records) {
  return (records || []).map((record) => ({
    id: record.id || rollCallKey(record.date, record.grade, record.subject),
    date: record.date || todayISO(),
    grade: grades.includes(record.grade) ? record.grade : "國一",
    subject: normalizeCourseName(record.subject || "國文"),
    statuses: record.statuses && typeof record.statuses === "object" ? record.statuses : {},
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString(),
  }));
}

function scoreDraftId(date, grade, subject) {
  return [date || todayISO(), grade || "國一", normalizeCourseName(subject || "國文")].join("|");
}

function normalizeDraftScoreCell(cell) {
  if (cell && typeof cell === "object" && "value" in cell) {
    return {
      value: String(cell.value ?? ""),
      updatedAt: cell.updatedAt || cell.createdAt || "",
      deviceId: cell.deviceId || "",
    };
  }
  if (cell === undefined || cell === null || cell === "") return null;
  return {
    value: String(cell),
    updatedAt: "",
    deviceId: "",
  };
}

function normalizeDraftAbsence(item, activeFallback = true) {
  if (item && typeof item === "object") {
    return {
      active: item.active !== false,
      updatedAt: item.updatedAt || item.createdAt || "",
      deviceId: item.deviceId || "",
    };
  }
  return {
    active: activeFallback,
    updatedAt: "",
    deviceId: "",
  };
}

function normalizeScoreDraft(record = {}) {
  const date = record.date || todayISO();
  const grade = grades.includes(record.grade) ? record.grade : "國一";
  const subject = normalizeCourseName(record.subject || "國文");
  const key = record.key || scoreDraftId(date, grade, subject);
  const scores = {};
  Object.entries(record.scores || {}).forEach(([studentId, papers]) => {
    if (!papers || typeof papers !== "object") return;
    Object.entries(papers).forEach(([paper, cell]) => {
      const normalized = normalizeDraftScoreCell(cell);
      if (!normalized) return;
      if (!scores[studentId]) scores[studentId] = {};
      scores[studentId][paper] = normalized;
    });
  });
  const absences = {};
  if (Array.isArray(record.absences)) {
    record.absences.forEach((studentId) => {
      if (studentId) absences[studentId] = normalizeDraftAbsence(null, true);
    });
  } else {
    Object.entries(record.absences || {}).forEach(([studentId, item]) => {
      absences[studentId] = normalizeDraftAbsence(item, Boolean(item));
    });
  }
  return {
    key,
    editingExamId: record.editingExamId || null,
    date,
    grade,
    subject,
    scope: record.scope || "",
    paperCount: Math.max(1, Number(record.paperCount) || 1),
    paperTopics: Array.isArray(record.paperTopics) ? record.paperTopics : [],
    noExam: Boolean(record.noExam),
    mockMode: Boolean(record.mockMode),
    scores,
    absences,
    clearedAt: record.clearedAt || "",
    updatedAt: record.updatedAt || record.createdAt || "",
    updatedBy: record.updatedBy || "",
  };
}

function normalizeScoreDrafts(raw = {}) {
  return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => {
    const draft = normalizeScoreDraft({ ...value, key: value?.key || key });
    return [draft.key, draft];
  }));
}

function normalizeAboutSettings(settings = {}) {
  return {
    ...defaultAboutSettings(),
    ...settings,
    teachers: settings.teachers || "",
    teacherCards: (settings.teacherCards || []).map((teacher) => ({
      id: teacher.id || crypto.randomUUID(),
      name: teacher.name || "",
      role: teacher.role || "",
      specialty: teacher.specialty || "",
      experience: teacher.experience || "",
      photo: teacher.photo || "",
      certificates: teacher.certificates || [],
      createdAt: teacher.createdAt || new Date().toISOString(),
    })),
    publicEnabled: settings.publicEnabled !== false,
  };
}

function normalizeAcademicPeriods(records, currentSettings = defaultAcademicSettings()) {
  const byKey = new Map();
  const add = (record = {}) => {
    const settings = normalizeAcademicSettings(record);
    const key = `${settings.academicYear}|${settings.semester}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: record.id || key,
        academicYear: settings.academicYear,
        semester: settings.semester,
        note: record.note || "",
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
      });
    } else {
      const existing = byKey.get(key);
      existing.note = record.note || existing.note;
      existing.updatedAt = [existing.updatedAt, record.updatedAt || record.createdAt || ""].filter(Boolean).sort().pop() || existing.updatedAt;
    }
  };
  records.forEach(add);
  add(currentSettings);
  return [...byKey.values()].sort((a, b) => `${b.academicYear}${b.semester}`.localeCompare(`${a.academicYear}${a.semester}`, "zh-Hant"));
}

function normalizeTermPeriods(raw) {
  return Object.fromEntries(Object.entries(raw || {})
    .map(([key, value]) => {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return [key, { startDate: "", endDate: value }];
      if (value && typeof value === "object") {
        return [key, {
          startDate: /^\d{4}-\d{2}-\d{2}$/.test(value.startDate || "") ? value.startDate : "",
          endDate: /^\d{4}-\d{2}-\d{2}$/.test(value.endDate || "") ? value.endDate : "",
        }];
      }
      return null;
    })
    .filter((item) => item && (item[1].startDate || item[1].endDate)));
}

function normalizeTermWeights(raw) {
  return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [
    key,
    Object.fromEntries(termSubjects.map((subject) => {
      const weight = Number(value?.[subject]);
      return [subject, Number.isFinite(weight) && weight > 0 ? weight : 1];
    })),
  ]));
}

function normalizeEvents(records) {
  return (records || []).map((record) => ({
    id: record.id || crypto.randomUUID(),
    grade: ["全體", ...grades].includes(record.grade) ? record.grade : "全體",
    type: ["固定重大事件", "臨時重大事件"].includes(record.type) ? record.type : "臨時重大事件",
    date: record.startDate || record.date || todayISO(),
    startDate: record.startDate || record.date || todayISO(),
    endDate: record.endDate || record.startDate || record.date || todayISO(),
    title: record.title || "",
    note: record.note || "",
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  })).filter((record) => record.title.trim());
}

function normalizeCourses(values, available = courses) {
  return [...new Set((values || []).map(normalizeCourseName).filter((value) => available.includes(value)))];
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
    mockMode: Boolean(exam.mockMode),
    paperCount: Math.max(1, Number(exam.paperCount) || 1),
    paperTopics: Array.isArray(exam.paperTopics) ? exam.paperTopics.map((item) => String(item || "")) : [],
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
    type: normalizeLeaveType(record.type),
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
  if (!syncReady || !remoteSave) return;
  clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(() => {
    remoteSave().catch(() => setSyncStatus("同步失敗"));
  }, 180);
}

function renderSyncedState() {
  applyCourseCatalog(state.courseCatalog);
  if (parentStudentId && !$("#parentShell")?.hidden) {
    renderParentPortal();
    return;
  }
  if (!$("#appShell")?.hidden) {
    if ($("#scores")?.classList.contains("active") && scoreSection === "entry") {
      renderScoreLiveStatus();
      applyRemoteScoreDraftToForm();
      renderClassReport();
      return;
    }
    if ($("#seat-settings")?.classList.contains("active")) {
      if (!document.activeElement?.closest?.("[data-seat-student], [data-seat-student-search]")) renderSeatSettingBoard();
      return;
    }
    if ($("#roll-call")?.classList.contains("active")) {
      renderRollCall();
      return;
    }
    renderAll();
  }
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
  if (supabaseRealtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(supabaseRealtimeChannel);
    supabaseRealtimeChannel = null;
  }
  if (supabaseRefreshTimer) {
    clearTimeout(supabaseRefreshTimer);
    supabaseRefreshTimer = null;
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
    const remoteExamRecords = await loadSupabaseExamRecords().catch(() => []);
    if (remote) {
      state = normalizeState(remote.data || emptyState());
      state.exams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
      lastRemoteUpdatedAt = remote.updatedAt || "";
      localStorage.setItem(storageKey(), JSON.stringify(state));
      renderSyncedState();
    } else if (remoteExamRecords.length) {
      state.exams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
      localStorage.setItem(storageKey(), JSON.stringify(state));
      renderSyncedState();
    }

    syncReady = true;
    setSyncStatus("同步中");
    if (!remote) await saveSupabaseState();
    setupSupabaseRealtime();
    supabasePollTimer = setInterval(checkSupabaseState, 500);
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

function mergeById(localItems = [], remoteItems = []) {
  const byId = new Map();
  remoteItems.forEach((item) => item?.id && byId.set(item.id, item));
  localItems.forEach((item) => {
    if (!item?.id) return;
    const current = byId.get(item.id);
    if (!current || recordStamp(item) >= recordStamp(current)) byId.set(item.id, item);
  });
  return [...byId.values()];
}

function mergeByIdWithDeleted(localItems = [], remoteItems = [], deletedIds = []) {
  const deleted = new Set(deletedIds || []);
  return mergeById(
    (localItems || []).filter((item) => !deleted.has(item?.id)),
    (remoteItems || []).filter((item) => !deleted.has(item?.id))
  );
}

function scheduleSupabaseRefresh() {
  if (supabaseRefreshTimer) clearTimeout(supabaseRefreshTimer);
  supabaseRefreshTimer = setTimeout(() => {
    checkSupabaseState();
  }, 120);
}

function setupSupabaseRealtime() {
  if (!supabaseClient || !currentBranch || supabaseRealtimeChannel) return;
  try {
    supabaseRealtimeChannel = supabaseClient
      .channel(`leave-duty-${currentBranch}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "app_records",
        filter: `group_code=eq.${currentBranch}`,
      }, scheduleSupabaseRefresh)
      .subscribe();
  } catch (_error) {
    supabaseRealtimeChannel = null;
  }
}

function recordStamp(item = {}) {
  return item.updatedAt || item.createdAt || "";
}

function mergeExams(localItems = [], remoteItems = [], deletedIds = state?.deletedExamIds || []) {
  const deleted = new Set(deletedIds || []);
  const byId = new Map();
  [...remoteItems, ...localItems].forEach((item) => {
    if (!item?.id || deleted.has(item.id)) return;
    const exam = normalizeExam(item);
    const current = byId.get(exam.id);
    if (!current || recordStamp(exam) >= recordStamp(current)) byId.set(exam.id, exam);
  });
  return [...byId.values()];
}

function newestRecord(left, right) {
  return recordStamp(left || {}) >= recordStamp(right || {}) ? left : right;
}

function mergeScoreDraft(localDraft, remoteDraft) {
  if (!localDraft) return normalizeScoreDraft(remoteDraft || {});
  if (!remoteDraft) return normalizeScoreDraft(localDraft || {});
  const local = normalizeScoreDraft(localDraft || {});
  const remote = normalizeScoreDraft(remoteDraft || {});
  if (local.clearedAt && recordStamp(local) >= recordStamp(remote)) return local;
  if (remote.clearedAt && recordStamp(remote) >= recordStamp(local)) return remote;
  const base = newestRecord(local, remote) === local ? { ...remote, ...local } : { ...local, ...remote };
  const scores = {};
  const studentIds = new Set([...Object.keys(local.scores || {}), ...Object.keys(remote.scores || {})]);
  studentIds.forEach((studentId) => {
    const paperIds = new Set([...Object.keys(local.scores?.[studentId] || {}), ...Object.keys(remote.scores?.[studentId] || {})]);
    paperIds.forEach((paper) => {
      const cell = newestRecord(local.scores?.[studentId]?.[paper], remote.scores?.[studentId]?.[paper]);
      if (!cell || cell.value === "") return;
      if (!scores[studentId]) scores[studentId] = {};
      scores[studentId][paper] = cell;
    });
  });
  const absences = {};
  [...new Set([...Object.keys(local.absences || {}), ...Object.keys(remote.absences || {})])].forEach((studentId) => {
    const absence = newestRecord(local.absences?.[studentId], remote.absences?.[studentId]);
    if (absence) absences[studentId] = absence;
  });
  return normalizeScoreDraft({ ...base, scores, absences });
}

function mergeScoreDrafts(localDrafts = {}, remoteDrafts = {}) {
  const merged = {};
  [...new Set([...Object.keys(remoteDrafts || {}), ...Object.keys(localDrafts || {})])].forEach((key) => {
    merged[key] = mergeScoreDraft(localDrafts?.[key], remoteDrafts?.[key]);
  });
  return merged;
}

function mergeSeatSettings(localSettings = {}, remoteSettings = {}) {
  const merged = {};
  [...new Set([...Object.keys(remoteSettings || {}), ...Object.keys(localSettings || {})])].forEach((key) => {
    const local = localSettings?.[key];
    const remote = remoteSettings?.[key];
    merged[key] = normalizeSeatSettings({ [key]: newestRecord(local, remote) })[key];
  });
  return merged;
}

function mergeRoomLayouts(localLayouts = {}, remoteLayouts = {}) {
  const local = normalizeRoomLayouts(localLayouts || {});
  const remote = normalizeRoomLayouts(remoteLayouts || {});
  const merged = {};
  [...new Set([...Object.keys(remote), ...Object.keys(local)])].forEach((name) => {
    merged[name] = normalizeRoomLayouts({ [name]: newestRecord(local[name], remote[name]) })[name];
  });
  return merged;
}

function supabaseExamRecordId(examId) {
  return `${currentBranch}:${examId}`;
}

function unpackSupabaseRecord(row) {
  const payload = row?.data || {};
  return payload.data || payload;
}

async function loadSupabaseExamRecords() {
  if (!supabaseClient || !currentBranch) return [];
  const { data, error } = await supabaseClient
    .from("app_records")
    .select("data")
    .eq("collection", SUPABASE_EXAM_COLLECTION)
    .eq("group_code", currentBranch);
  if (error) throw error;
  return (data || [])
    .map(unpackSupabaseRecord)
    .filter((exam) => exam?.id)
    .map(normalizeExam);
}

async function saveSupabaseExamRecords(exams = state.exams) {
  if (!supabaseClient || !currentBranch || !exams.length) return;
  const rows = exams.filter((exam) => exam?.id).map((exam) => ({
    collection: SUPABASE_EXAM_COLLECTION,
    id: supabaseExamRecordId(exam.id),
    group_code: currentBranch,
    username: null,
    data: {
      branch: currentBranch,
      data: JSON.parse(JSON.stringify(normalizeExam(exam))),
      updatedAt: exam.updatedAt || exam.createdAt || new Date().toISOString(),
    },
  }));
  if (!rows.length) return;
  const { error } = await supabaseClient
    .from("app_records")
    .upsert(rows, { onConflict: "collection,id" });
  if (error) throw error;
}

async function deleteSupabaseExamRecord(examId) {
  if (!supabaseClient || !currentBranch || !examId) return;
  await supabaseClient
    .from("app_records")
    .delete()
    .eq("collection", SUPABASE_EXAM_COLLECTION)
    .eq("id", supabaseExamRecordId(examId));
}

function mergeRemoteStateForSave(localState, remotePayload) {
  if (!remotePayload?.data) return localState;
  const remoteState = normalizeState(remotePayload.data || emptyState());
  const local = normalizeState(localState || emptyState());
  const deletedCourseNames = [...new Set([...(remoteState.deletedCourseNames || []), ...(local.deletedCourseNames || [])])]
    .filter((name) => !coreCourses.includes(name));
  const courseCatalog = normalizeCourseCatalog([...(remoteState.courseCatalog || []), ...(local.courseCatalog || [])])
    .filter((item) => item.core || !deletedCourseNames.includes(item.name));
  return {
    ...local,
    deletedStudentIds: [...new Set([...(remoteState.deletedStudentIds || []), ...(local.deletedStudentIds || [])])],
    students: mergeByIdWithDeleted(local.students, remoteState.students, [...(remoteState.deletedStudentIds || []), ...(local.deletedStudentIds || [])]),
    deletedLeaveIds: [...new Set([...(remoteState.deletedLeaveIds || []), ...(local.deletedLeaveIds || [])])],
    leaves: mergeByIdWithDeleted(local.leaves, remoteState.leaves, [...(remoteState.deletedLeaveIds || []), ...(local.deletedLeaveIds || [])]),
    deletedLateIds: [...new Set([...(remoteState.deletedLateIds || []), ...(local.deletedLateIds || [])])],
    lateRecords: mergeByIdWithDeleted(local.lateRecords, remoteState.lateRecords, [...(remoteState.deletedLateIds || []), ...(local.deletedLateIds || [])]),
    deletedExamIds: [...new Set([...(remoteState.deletedExamIds || []), ...(local.deletedExamIds || [])])],
    exams: mergeExams(local.exams, remoteState.exams, [...(remoteState.deletedExamIds || []), ...(local.deletedExamIds || [])]),
    termScores: mergeById(local.termScores, remoteState.termScores),
    academicPeriods: mergeById(local.academicPeriods, remoteState.academicPeriods),
    events: mergeById(local.events, remoteState.events),
    contactBooks: mergeById(local.contactBooks, remoteState.contactBooks),
    paperAnalyses: mergeById(local.paperAnalyses, remoteState.paperAnalyses),
    rollCalls: mergeById(local.rollCalls, remoteState.rollCalls),
    archives: mergeById(local.archives, remoteState.archives),
    scoreDrafts: mergeScoreDrafts(local.scoreDrafts, remoteState.scoreDrafts),
    roomLayouts: mergeRoomLayouts(local.roomLayouts, remoteState.roomLayouts),
    seatSettings: mergeSeatSettings(local.seatSettings, remoteState.seatSettings),
    termPeriods: { ...(remoteState.termPeriods || {}), ...(local.termPeriods || {}) },
    termWeights: { ...(remoteState.termWeights || {}), ...(local.termWeights || {}) },
    schedule: local.schedule || remoteState.schedule,
    settings: local.settings || remoteState.settings,
    courseCatalog,
    deletedCourseNames,
    scoreActivity: recordStamp(local.scoreActivity || {}) >= recordStamp(remoteState.scoreActivity || {}) ? local.scoreActivity : remoteState.scoreActivity,
    about: local.about || remoteState.about,
    aiSettings: local.aiSettings || remoteState.aiSettings,
  };
}
async function saveSupabaseState() {
  if (!supabaseClient || !currentBranch) return;
  const remoteBeforeSave = await loadSupabaseState().catch(() => null);
  const remoteExamRecords = await loadSupabaseExamRecords().catch(() => []);
  if (remoteBeforeSave?.data && remoteExamRecords.length) {
    remoteBeforeSave.data.exams = mergeExams(remoteBeforeSave.data.exams, remoteExamRecords, state.deletedExamIds);
  }
  state = mergeRemoteStateForSave(state, remoteBeforeSave);
  localStorage.setItem(storageKey(), JSON.stringify(state));
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
  await saveSupabaseExamRecords().catch(() => {});
  setSyncStatus("同步中");
}

async function checkSupabaseState() {
  if (!syncReady || syncLoading) return;
  try {
    syncLoading = true;
    const remote = await loadSupabaseState();
    const remoteExamRecords = await loadSupabaseExamRecords().catch(() => []);
    if (remote && remote.updatedAt && remote.updatedAt !== lastRemoteUpdatedAt) {
      state = mergeRemoteStateForSave(state, remote);
      state.exams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
      lastRemoteUpdatedAt = remote.updatedAt;
      localStorage.setItem(storageKey(), JSON.stringify(state));
      renderSyncedState();
    } else if (remoteExamRecords.length) {
      const mergedExams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
      if (JSON.stringify(mergedExams.map((exam) => `${exam.id}:${recordStamp(exam)}`).sort()) !== JSON.stringify(state.exams.map((exam) => `${exam.id}:${recordStamp(exam)}`).sort())) {
        state.exams = mergedExams;
        localStorage.setItem(storageKey(), JSON.stringify(state));
        renderSyncedState();
      }
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

function weekStartISO(isoDate = todayISO()) {
  const date = new Date(`${isoDate || todayISO()}T00:00:00`);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return toISODate(date);
}

function weekDates(isoDate = todayISO()) {
  const start = weekStartISO(isoDate);
  return Array.from({ length: 7 }, (_item, index) => addDays(start, index));
}

function weekRangeLabel(isoDate = todayISO()) {
  const dates = weekDates(isoDate);
  return `${dateLabel(dates[0])} 到 ${dateLabel(dates[6])}`;
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
  return state.students.filter((student) => student.grade !== "校友").filter((student) => dashboardGrade === "全體" || student.grade === dashboardGrade);
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
    const student = getStudent(record.studentId);
    if (record.dismissedAt || !ids.has(record.studentId) || !student || !studentHasClassOnDate(student, today)) return;
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
  const expected = dashboardStudents()
    .filter((student) => studentHasClassOnDate(student, todayISO())).length;
  $("#todayExpectedCount").textContent = expected;
}

function scheduledSubjectsFromSchedule(grade, date) {
  const day = weekdayFromDate(date || todayISO());
  const scheduled = periods
    .map((period) => normalizeCourseName(state.schedule?.[grade]?.[day]?.[period]))
    .filter((subject) => subject && subject !== "考加");
  return expandMathScheduleSubjects([...new Set(scheduled)], grade);
}

function expandMathScheduleSubjects(subjects, grade) {
  const expanded = new Set();
  subjects.forEach((subject) => {
    if (["數學", "數A", "數B"].includes(subject)) {
      ["數A", "數B"].forEach((mathSubject) => {
        if (courses.includes(mathSubject) && state.students.some((student) => student.grade === grade && studentTakesSubject(student, mathSubject))) {
          expanded.add(mathSubject);
        }
      });
      if (!expanded.has("數A") && !expanded.has("數B") && courses.includes(subject)) expanded.add(subject);
      return;
    }
    if (courses.includes(subject)) expanded.add(subject);
  });
  return [...expanded];
}

function todaySubjectsForGrade(grade) {
  return scheduledSubjectsFromSchedule(grade, todayISO());
}

function rollSummaryForCourse(date, grade, subject) {
  const students = studentsForGradeAndSubject(grade, subject);
  const record = state.rollCalls.find((item) => item.id === rollCallKey(date, grade, subject));
  const presentIds = new Set(Object.entries(record?.statuses || {}).filter((entry) => entry[1] === "present").map(([id]) => id));
  const leaveStudents = students.filter((student) => !presentIds.has(student.id) && rollLeaveForStudent(student.id, date)?.type !== "提早離班" && rollLeaveForStudent(student.id, date));
  const leaveIds = new Set(leaveStudents.map((student) => student.id));
  const absentStudents = students.filter((student) => !presentIds.has(student.id) && !leaveIds.has(student.id));
  const presentStudents = students.filter((student) => presentIds.has(student.id));
  const lateStudents = students.filter((student) => rollLateForStudent(student.id, date));
  const fixedLeaveStudents = leaveStudents.filter((student) => rollLeaveForStudent(student.id, date)?.fixed);
  return {
    students,
    record,
    presentIds,
    leaveIds,
    expected: students.length,
    present: presentStudents.length,
    leave: leaveStudents.length,
    absent: absentStudents.length,
    presentStudents,
    leaveStudents,
    absentStudents,
    lateStudents,
    fixedLeaveStudents,
  };
}

function rollReportText(date, grade, subject, summary = rollSummaryForCourse(date, grade, subject)) {
  return `${dateLabel(date)} ${grade} ${subject}
應到：${summary.expected}
實到：${summary.present}
請假：${summary.leave}${summary.leaveStudents.length ? `（${summary.leaveStudents.map((student) => student.name).join("、")}）` : ""}
未到：${summary.absent}${summary.absentStudents.length ? `（${summary.absentStudents.map((student) => student.name).join("、")}）` : ""}
晚到：${summary.lateStudents.length ? summary.lateStudents.map((student) => student.name).join("、") : "-"}`;
}

function renderTodayClassAttendance() {
  const target = $("#todayClassAttendance");
  if (!target) return;
  const today = todayISO();
  const cards = grades.flatMap((grade) => {
    const subjects = todaySubjectsForGrade(grade);
    return subjects.map((subject) => {
      const stats = rollSummaryForCourse(today, grade, subject);
      return { grade, subject, ...stats };
    });
  }).filter((item) => dashboardGrade === "全體" || item.grade === dashboardGrade);
  if ($("#todayClassSummary")) $("#todayClassSummary").textContent = `${dateLabel(today)}｜${cards.length} 堂課`;
  target.innerHTML = cards.map((item) => `
    <article class="today-class-card">
      <div>
        <strong>${escapeHtml(item.grade)} ${escapeHtml(item.subject)}</strong>
        <span>今日課程</span>
      </div>
      <div class="mini-metrics">
        <span><b>${item.expected}</b>應到</span>
        <span><b>${item.present}</b>實到</span>
        <span><b>${item.absent}</b>未到</span>
        <span class="leave-text"><b>${item.leave}</b>請假</span>
        <span class="leave-text"><b>${item.fixedLeaveStudents.length}</b>固定請假</span>
      </div>
    </article>
  `).join("") || `<div class="empty">今日課表尚未設定課程。</div>`;
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

function renderCourseAdmin() {
  const target = $("#courseList");
  if (!target) return;
  applyCourseCatalog(state.courseCatalog);
  target.innerHTML = normalizeCourseCatalog(state.courseCatalog).map((course) => `
    <article class="record-card">
      <strong>${escapeHtml(course.name)}</strong>
      <div class="meta">
        <span class="badge ${course.core ? "gold" : ""}">${course.core ? "核心課程不可刪" : "可調整課程"}</span>
      </div>
      <div class="action-row">
        ${course.core ? "" : `<button class="ghost" data-edit-course="${escapeHtml(course.name)}">編輯</button><button class="ghost danger" data-delete-course="${escapeHtml(course.name)}">刪除</button>`}
      </div>
    </article>
  `).join("");
  if ($("#cancelCourseEdit")) $("#cancelCourseEdit").hidden = !editingCourseName;
}

function clearCourseForm() {
  editingCourseName = null;
  if ($("#courseName")) $("#courseName").value = "";
  if ($("#cancelCourseEdit")) $("#cancelCourseEdit").hidden = true;
}

function seatSettingKey(grade = $("#seatSettingGrade")?.value || "國一", subject = $("#seatSettingSubject")?.value || "國文") {
  return `${grade}|${subject}`;
}

function rollCallKey(date, grade, subject) {
  return `${date}|${grade}|${subject}`;
}

function seatId(row, col) {
  return `r${row}c${col}`;
}

function currentSeatSetting() {
  const grade = $("#seatSettingGrade")?.value || "國一";
  const subject = $("#seatSettingSubject")?.value || "國文";
  const key = seatSettingKey(grade, subject);
  const selectedRoom = $("#seatSettingRoom")?.value;
  const stored = state.seatSettings[key];
  const room = selectedRoom || stored?.room || defaultRoomName();
  const setting = state.seatSettings[key] || { grade, subject, room, seats: {} };
  return {
    ...setting,
    grade,
    subject,
    room,
    seats: setting.seats || {},
    layoutSeats: roomLayoutSeats(room),
  };
}

function renderSeatSubjectOptions() {
  ["seatSettingSubject", "rollSubject"].forEach((id) => {
    const target = $(`#${id}`);
    if (!target) return;
    const previous = target.value || "國文";
    target.innerHTML = courses.map((course) => `<option value="${course}">${course}</option>`).join("");
    target.value = courses.includes(previous) ? previous : courses[0];
  });
}

function renderRoomOptions() {
  const names = roomLayoutNames();
  ["seatSettingRoom", "roomLayoutRoom"].forEach((id) => {
    const target = $(`#${id}`);
    if (!target) return;
    const previous = target.value || defaultRoomName();
    target.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    target.value = names.includes(previous) ? previous : defaultRoomName();
  });
}

function scheduledSubjectsForGradeDate(grade, date) {
  return scheduledSubjectsFromSchedule(grade, date || todayISO());
}

function chooseDefaultRollSubject() {
  const target = $("#rollSubject");
  if (!target) return;
  renderSeatSubjectOptions();
  const grade = $("#rollGrade")?.value || rollCallGrade;
  const date = $("#rollDate")?.value || todayISO();
  const scheduled = scheduledSubjectsForGradeDate(grade, date);
  if (scheduled.length) target.value = scheduled[0];
}

function chooseDefaultExamSubject() {
  const target = $("#examSubject");
  if (!target) return;
  renderExamSubjectOptions();
  const scheduled = scheduledSubjectsForGradeDate($("#examGrade")?.value || "國一", $("#examDate")?.value || todayISO());
  if (scheduled.length && Array.from(target.options).some((option) => option.value === scheduled[0])) {
    target.value = scheduled[0];
  }
}

function seatGridTemplate(layoutSeats) {
  const positions = layoutSeats.map(seatPositionFromId).filter(Boolean);
  const maxCol = Math.max(1, ...positions.map((pos) => pos.col));
  const aisleCols = new Set(positions.filter((pos) => pos.type === "aisle").map((pos) => pos.col));
  return Array.from({ length: maxCol }, (_item, index) => aisleCols.has(index + 1) ? "var(--aisle-width, 1.35rem)" : "minmax(var(--seat-cell-min, 5.5rem), 1fr)").join(" ");
}

function seatMaxRow(layoutSeats) {
  return Math.max(1, ...layoutSeats.map((id) => seatPositionFromId(id)?.row || 1));
}

function renderSeatSettingsPanels() {
  if ($("#seatSettingsMenu")) $("#seatSettingsMenu").hidden = seatSettingsSection !== "menu";
  if ($("#seatAssignPanel")) $("#seatAssignPanel").hidden = seatSettingsSection !== "assign";
  if ($("#seatLayoutPanel")) $("#seatLayoutPanel").hidden = seatSettingsSection !== "layout";
  $$("[data-seat-section]").forEach((button) => button.classList.toggle("active", button.dataset.seatSection === seatSettingsSection));
}

function renderSeatSettingBoard() {
  renderSeatSubjectOptions();
  renderRoomOptions();
  renderSeatSettingsPanels();
  const target = $("#seatSettingBoard");
  if (!target) return;
  const setting = currentSeatSetting();
  if ($("#seatSettingRoom")) $("#seatSettingRoom").value = setting.room || defaultRoomName();
  const students = studentsForGradeAndSubject(setting.grade, setting.subject);
  const layoutSeats = roomLayoutSeats(setting.room);
  const gridTemplate = seatGridTemplate(layoutSeats);
  const maxRow = seatMaxRow(layoutSeats);
  const listId = "seatStudentSearchList";
  const assignedIds = new Set(Object.values(setting.seats || {}).filter(Boolean));
  target.innerHTML = `<datalist id="${listId}">${students.map((student) => `<option value="${escapeHtml(student.name)}" label="${assignedIds.has(student.id) ? "已排" : ""}"></option>`).join("")}</datalist><div class="podium-strip">講台</div><div class="seat-board custom-seat-board" style="grid-template-columns:${gridTemplate};">
    ${layoutSeats.map((id) => {
      const pos = seatPositionFromId(id);
      if (!pos) return "";
      if (pos.type === "aisle") {
        return `<div class="seat-cell custom-seat-cell aisle-cell" style="grid-row:1 / span ${maxRow};grid-column:${pos.col};" data-seat-cell="${id}">
          <strong>走道</strong>
        </div>`;
      }
      const assigned = setting.seats?.[id] || "";
      const assignedStudent = getStudent(assigned);
      return `<label class="seat-cell custom-seat-cell" style="grid-row:${pos.row};grid-column:${pos.col};" data-seat-cell="${id}">
        <span>${pos.row}-${pos.col}</span>
        <input data-seat-student-search="${id}" list="${listId}" value="${escapeHtml(assignedStudent?.name || "")}" placeholder="搜尋學生">
        ${assignedStudent ? `<small>已排</small>` : ""}
        <input type="hidden" data-seat-student="${id}" value="${escapeHtml(assigned)}">
      </label>`;
    }).join("")}
  </div>`;
  renderRoomLayoutBoard();
}

function renderRoomLayoutBoard() {
  renderRoomOptions();
  const target = $("#roomLayoutBoard");
  if (!target) return;
  const room = $("#roomLayoutRoom")?.value || defaultRoomName();
  const layoutSeats = roomLayoutSeats(room);
  const gridTemplate = seatGridTemplate(layoutSeats);
  const maxRow = seatMaxRow(layoutSeats);
  target.innerHTML = `<div class="podium-strip">講台</div><div class="seat-board custom-seat-board" style="grid-template-columns:${gridTemplate};">
    ${layoutSeats.map((id) => {
      const pos = seatPositionFromId(id);
      if (!pos) return "";
      if (pos.type === "aisle") {
        return `<div class="seat-cell custom-seat-cell aisle-cell" style="grid-row:1 / span ${maxRow};grid-column:${pos.col};" data-layout-cell="${id}">
          <strong>走道</strong>
          <div class="seat-tools">
            <button type="button" class="mini-icon-button" data-add-layout-column-right="${id}" title="在走道右邊新增一欄座位">→座</button>
            <button type="button" class="mini-icon-button danger" data-delete-layout-cell="${id}" title="刪除此走道">×</button>
          </div>
        </div>`;
      }
      return `<div class="seat-cell custom-seat-cell" style="grid-row:${pos.row};grid-column:${pos.col};" data-layout-cell="${id}">
        <span>${pos.row}-${pos.col}</span>
        <strong>座位</strong>
        <div class="seat-tools">
          <button type="button" class="mini-icon-button" data-add-layout-seat-right="${id}" title="往右新增一個座位">→座</button>
          <button type="button" class="mini-icon-button" data-add-layout-seat-down="${id}" title="往下新增一個座位">↓座</button>
          <button type="button" class="mini-icon-button" data-add-layout-aisle-right="${id}" title="往右新增走道">→走</button>
          <button type="button" class="mini-icon-button danger" data-delete-layout-cell="${id}" title="刪除此座位" ${id === seatId(1, 1) ? "disabled" : ""}>×</button>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

function applySeatSearchInput(input) {
  const seatKey = input.dataset.seatStudentSearch;
  const hidden = document.querySelector(`[data-seat-student="${seatKey}"]`);
  const setting = currentSeatSetting();
  const students = studentsForGradeAndSubject(setting.grade, setting.subject);
  const name = input.value.trim();
  if (!name) {
    if (hidden) hidden.value = "";
    saveCurrentSeatSetting({ render: false });
    return;
  }
  const student = students.find((item) => item.name === name);
  if (!student) {
    input.value = "";
    if (hidden) hidden.value = "";
    return;
  }
  $$("[data-seat-student]").forEach((field) => {
    if (field !== hidden && field.value === student.id) {
      field.value = "";
      const otherInput = document.querySelector(`[data-seat-student-search="${field.dataset.seatStudent}"]`);
      if (otherInput) otherInput.value = "";
    }
  });
  if (hidden) hidden.value = student.id;
  saveCurrentSeatSetting({ render: false });
}

function collectSeatSettingFromDom() {
  const seats = {};
  const usedStudents = new Set();
  const layoutSeats = $$("[data-seat-cell]").map((cell) => cell.dataset.seatCell).filter(Boolean);
  $$("[data-seat-student]").forEach((select) => {
    if (!select.value || usedStudents.has(select.value)) {
      if (select.value && usedStudents.has(select.value)) select.value = "";
      return;
    }
    seats[select.dataset.seatStudent] = select.value;
    usedStudents.add(select.value);
  });
  return { seats, layoutSeats: normalizeLayoutSeats(layoutSeats, $("#seatSettingRoom")?.value || "3F大", seats) };
}

function saveCurrentSeatSetting({ render = true } = {}) {
  const grade = $("#seatSettingGrade")?.value || "國一";
  const subject = $("#seatSettingSubject")?.value || "國文";
  const room = $("#seatSettingRoom")?.value || defaultRoomName();
  const { seats, layoutSeats } = collectSeatSettingFromDom();
  state.seatSettings[seatSettingKey(grade, subject)] = {
    grade,
    subject,
    room,
    seats,
    layoutSeats,
    updatedAt: new Date().toISOString(),
  };
  saveState();
  if (render) renderSeatSettingBoard();
}

function saveRoomLayout(room, layoutSeats) {
  const name = room || defaultRoomName();
  state.roomLayouts = normalizeRoomLayouts({
    ...(state.roomLayouts || {}),
    [name]: {
      ...(state.roomLayouts?.[name] || {}),
      name,
      layoutSeats: normalizeLayoutSeats(layoutSeats, name),
      core: Boolean(defaultRoomLayouts[name] || state.roomLayouts?.[name]?.core),
      updatedAt: new Date().toISOString(),
    },
  }, state.seatSettings);
  roomLayouts = state.roomLayouts;
  saveState();
}

function changeRoomLayout(anchorId, direction) {
  const room = $("#roomLayoutRoom")?.value || defaultRoomName();
  const layoutSeats = roomLayoutSeats(room);
  const pos = seatPositionFromId(anchorId);
  if (!pos) return;
  const isAisle = direction.startsWith("aisle");
  if (direction === "column-right" && pos.type === "aisle") {
    const nextCol = pos.col + 1;
    const maxRow = seatMaxRow(layoutSeats);
    const newSeats = Array.from({ length: maxRow }, (_item, index) => seatId(index + 1, nextCol));
    const blocked = layoutSeats.some((id) => seatPositionFromId(id)?.col === nextCol);
    if (blocked) return alert("走道右邊已經有座位或走道了。");
    saveRoomLayout(room, [...layoutSeats, ...newSeats]);
    renderRoomLayoutBoard();
    return;
  }
  const isRight = direction.endsWith("right");
  const row = isRight ? pos.row : pos.row + 1;
  const col = isRight ? pos.col + 1 : pos.col;
  const nextId = isAisle ? aisleId(row, col) : seatId(row, col);
  const occupied = layoutSeats.some((id) => {
    const itemPos = seatPositionFromId(id);
    if (!itemPos) return false;
    if (isAisle || itemPos.type === "aisle") return itemPos.col === col;
    return itemPos.row === row && itemPos.col === col;
  });
  if (occupied) {
    alert("這個位置已經有座位或走道了。");
    return;
  }
  saveRoomLayout(room, [...layoutSeats, nextId]);
  renderRoomLayoutBoard();
}

function deleteRoomLayoutCell(cellId) {
  if (cellId === seatId(1, 1)) return alert("左上角第一個座位需保留。");
  const room = $("#roomLayoutRoom")?.value || defaultRoomName();
  saveRoomLayout(room, roomLayoutSeats(room).filter((id) => id !== cellId));
  Object.entries(state.seatSettings || {}).forEach(([key, setting]) => {
    if (setting.room !== room || !setting.seats?.[cellId]) return;
    const seats = { ...(setting.seats || {}) };
    delete seats[cellId];
    state.seatSettings[key] = { ...setting, seats, updatedAt: new Date().toISOString() };
  });
  saveState();
  renderRoomLayoutBoard();
  renderSeatSettingBoard();
}

function currentRollRecord() {
  const date = $("#rollDate")?.value || todayISO();
  const grade = $("#rollGrade")?.value || rollCallGrade;
  const subject = $("#rollSubject")?.value || courses[0] || "國文";
  const key = rollCallKey(date, grade, subject);
  let record = state.rollCalls.find((item) => item.id === key);
  if (!record) {
    record = normalizeRollCalls([{ id: key, date, grade, subject, statuses: {} }])[0];
    state.rollCalls.push(record);
  }
  return record;
}

function rollLeaveForStudent(studentId, date) {
  const regular = state.leaves.find((record) => record.studentId === studentId && getLeaveStart(record) <= date && getLeaveEnd(record) >= date);
  if (regular) return regular;
  const student = getStudent(studentId);
  if (student && studentHasClassOnDate(student, date) && student.fixedLeave.includes(weekdayFromDate(date))) {
    return {
      id: `fixed-leave-${student.id}-${date}`,
      studentId,
      date,
      startDate: date,
      endDate: date,
      periods: [],
      type: "請假",
      note: "固定請假",
      fixed: true,
    };
  }
  return null;
}

function rollLateForStudent(studentId, date) {
  return state.lateRecords.find((record) => record.studentId === studentId && record.date === date && !record.dismissedAt);
}

function renderRollCall() {
  renderSeatSubjectOptions();
  const panel = $("#rollCallPanel");
  if (!panel) return;
  if (panel.hidden || !$("#roll-call")?.classList.contains("active")) return;
  const grade = $("#rollGrade")?.value || rollCallGrade;
  const subject = $("#rollSubject")?.value || courses[0] || "國文";
  const date = $("#rollDate")?.value || todayISO();
  const setting = state.seatSettings[seatSettingKey(grade, subject)] || { grade, subject, room: defaultRoomName(), seats: {} };
  const layoutSeats = roomLayoutSeats(setting.room);
  const gridTemplate = seatGridTemplate(layoutSeats);
  const maxRow = seatMaxRow(layoutSeats);
  const summary = rollSummaryForCourse(date, grade, subject);
  const { students, record, presentIds, leaveIds } = summary;
  if ($("#rollCallTitle")) $("#rollCallTitle").textContent = `${dateLabel(date)} ${grade} ${subject} 點名`;
  if ($("#rollCallStats")) $("#rollCallStats").textContent = `應到 ${summary.expected}｜實到 ${summary.present}｜請假 ${summary.leave}｜未到 ${summary.absent}`;
  const target = $("#rollCallBoard");
  if (!target) return;
  target.innerHTML = `<div class="podium-strip">講台</div><div class="seat-board roll-board" style="grid-template-columns:${gridTemplate};">
    ${layoutSeats.map((id) => {
      const pos = seatPositionFromId(id);
      if (!pos) return "";
      if (pos.type === "aisle") {
        return `<div class="seat-cell aisle-cell" style="grid-row:1 / span ${maxRow};grid-column:${pos.col};">
          <strong>走道</strong>
        </div>`;
      }
      const student = getStudent(setting.seats?.[id]);
      const leave = student ? rollLeaveForStudent(student.id, date) : null;
      const late = student ? rollLateForStudent(student.id, date) : null;
      const present = student ? presentIds.has(student.id) : false;
      const className = !student ? "empty-seat" : present ? "present-seat" : leave && leave.type !== "提早離班" ? "leave-seat" : "";
      return `<button type="button" class="seat-cell ${className}" style="grid-row:${pos.row};grid-column:${pos.col};" data-roll-seat="${student?.id || ""}">
        <span>${pos.row}-${pos.col}</span><strong>${student?.name || "空位"}</strong>
        <small>${late ? "晚到" : ""}${leave?.type === "提早離班" ? " 提早離班" : ""}</small>
      </button>`;
    }).join("")}
  </div>
  <div class="roll-summary">
    <div class="roll-summary-metrics">
      <span><b>${summary.expected}</b>應到</span>
      <span><b>${summary.present}</b>實到</span>
      <span><b>${summary.leave}</b>請假</span>
      <span><b>${summary.absent}</b>未到</span>
    </div>
    <div class="roll-summary-lines">
      <p><b>未到：</b>${summary.absentStudents.map((student) => student.name).join("、") || "-"}</p>
      <p><b>晚到：</b>${summary.lateStudents.map((student) => student.name).join("、") || "-"}</p>
      <p><b>請假：</b>${summary.leaveStudents.map((student) => student.name).join("、") || "-"}</p>
    </div>
    <textarea class="copy-box" readonly>${escapeHtml(rollReportText(date, grade, subject, summary))}</textarea>
    <button class="ghost" type="button" data-copy-roll-report>複製回報</button>
  </div>`;
}

function printRollCallPdf() {
  const date = $("#rollDate")?.value || todayISO();
  const grade = $("#rollGrade")?.value || rollCallGrade;
  const subject = $("#rollSubject")?.value || courses[0] || "國文";
  const setting = state.seatSettings[seatSettingKey(grade, subject)] || { room: defaultRoomName(), seats: {} };
  const layoutSeats = roomLayoutSeats(setting.room);
  const gridTemplate = seatGridTemplate(layoutSeats);
  const maxRow = seatMaxRow(layoutSeats);
  const summary = rollSummaryForCourse(date, grade, subject);
  const { record, students } = summary;
  const compactPrint = students.length > 34;
  const rowHtml = (student, index) => {
    const leave = rollLeaveForStudent(student.id, date);
    const late = rollLateForStudent(student.id, date);
    const present = record.statuses?.[student.id] === "present";
    const mark = present ? "✓" : leave && leave.type !== "提早離班" ? "假" : "";
    return `<tr><td>${index + 1}</td><td>${escapeHtml(student.name)}</td><td class="${mark === "假" ? "leave" : ""}">${mark}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${late ? "晚到" : ""}${leave?.type === "提早離班" ? "提早離班" : ""}</td></tr>`;
  };
  const totalPrintRows = Math.max(50, students.length + 5);
  const allRows = Array.from({ length: totalPrintRows }, (_item, index) => {
    const student = students[index];
    return student
      ? rowHtml(student, index)
      : `<tr><td>${index + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  });
  const tableCols = `<colgroup><col class="col-no"><col class="col-name"><col class="col-roll"><col class="col-score"><col class="col-score"><col class="col-homework"><col class="col-check"><col class="col-check"><col class="col-check"><col class="col-check"><col class="col-remark"></colgroup>`;
  const tableHead = `${tableCols}<thead><tr><th rowspan="2">序號</th><th rowspan="2">名字</th><th rowspan="2">到班</th><th colspan="2">成績</th><th rowspan="2">作業</th><th colspan="2">聯絡本</th><th colspan="2">上課狀況</th><th rowspan="2">備註</th></tr><tr><th>1</th><th>2</th><th>繳交</th><th>未簽名</th><th>筆記</th><th>專注</th></tr></thead>`;
  const leftRows = allRows.slice(0, 40).join("");
  const rightRows = allRows.slice(40).join("");
  const summaryHtml = `<div class="summary-counts"><b>應到</b><span>${summary.expected}</span><b>實到</b><span>${summary.present}</span><b>請假</b><span>${summary.leave}</span><b>未到</b><span>${summary.absent}</span></div><div class="summary-list"><b>未到：</b>${summary.absentStudents.map((student) => student.name).join("、") || "-"}<br><b>晚到：</b>${summary.lateStudents.map((student) => student.name).join("、") || "-"}</div><div class="leave-follow-grid"><b>請假同學</b><span>${summary.leaveStudents.map((student) => student.name).join("、") || "-"}</span><b>補課日期</b><span></span><b>補課檢核</b><span></span><b>補考</b><span></span></div><div class="sign-grid"><b>班導師簽核</b><span></span><b>主管簽核</b><span></span></div>`;
  const focusHtml = `<div class="focus-title">本日重點事項</div><div class="focus-grid"><b>帶班導師</b><span></span><b>授課師</b><span></span><b>進度</b><span class="wide"></span><b>作業</b><span class="wide"></span><b>考試</b><span class="wide"></span><b>備註</b><span class="wide tall"></span><b>上課狀況</b><span class="wide extra-tall"></span></div>`;
  const seatHtml = layoutSeats.map((id) => {
    const pos = seatPositionFromId(id);
    if (!pos) return "";
    if (pos.type === "aisle") return `<div class="seat aisle-print" style="grid-row:1 / span ${maxRow};grid-column:${pos.col};"><b>走道</b></div>`;
    const student = getStudent(setting.seats?.[id]);
    const leave = student ? rollLeaveForStudent(student.id, date) : null;
    const present = student ? record.statuses?.[student.id] === "present" : false;
    const leaveClass = student && !present && leave?.type !== "提早離班" ? " seat-leave" : "";
    return `<div class="seat${leaveClass}" style="grid-row:${pos.row};grid-column:${pos.col};">${pos.row}-${pos.col}<br><b>${escapeHtml(student?.name || "")}</b></div>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>點名表</title><style>
    @page { size: B4 landscape; margin: 7mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Microsoft JhengHei", Arial, sans-serif; color: #151515; background: #f7f2e7; }
    .sheet { position: relative; min-height: calc(100vh - 14mm); display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
    .brand-head { display: flex; justify-content: space-between; align-items: end; padding: 8px 12px; border-radius: 12px; color: #fff7df; background: linear-gradient(112deg, #0f151d, #5b4520 56%, #b88a31); box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
    .brand-left { display: flex; align-items: center; gap: 10px; }
    .brand-logo { width: 38px; height: 38px; border-radius: 50%; object-fit: contain; background: rgba(255,255,255,.08); }
    .brand-head h1 { margin: 0; font-size: 21px; letter-spacing: 0; }
    .brand-head p { margin: 3px 0 0; font-size: 12px; color: #ffe6a3; }
    .brand-head strong { font-size: 15px; }
    .front-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 1; min-height: 0; }
    .front-right { display: grid; grid-template-rows: auto 1fr; gap: 6px; min-height: 0; }
    .paper-panel { position: relative; display: flex; min-height: 0; padding: 6px; border: 1.5px solid #b88a31; border-radius: 13px; background: #fffdf7; overflow: hidden; }
    .right-roster { min-height: 0; max-height: 45mm; }
    .paper-panel::before { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(184,138,49,.12), transparent 38%); pointer-events: none; }
    table { position: relative; width: 100%; height: 100%; border-collapse: collapse; font-size: ${compactPrint ? "10px" : "11.2px"}; table-layout: fixed; background: #fff; }
    th, td { border: 1px solid #303030; padding: ${compactPrint ? "2px 2px" : "3px 3px"}; text-align: center; overflow: hidden; }
    th { height: 22px; background: #111820; color: #f5d77d; font-size: ${compactPrint ? "8.8px" : "10px"}; line-height: 1.08; }
    tbody tr { height: auto; }
    td:nth-child(2), td:last-child { text-align: left; }
    .col-no { width: 5%; }
    .col-name { width: 13%; }
    .col-roll { width: 5%; }
    .col-score { width: 4.5%; }
    .col-homework { width: 4.5%; }
    .col-check { width: 4.5%; }
    .col-remark { width: 45.5%; }
    .leave { color: #d90000; font-weight: 900; }
    .front-footer { display: grid; grid-template-columns: 1fr 30%; gap: 6px; min-height: 0; }
    .focus-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 7px 9px; border: 2px solid #303030; border-radius: 10px; background: #fffdf7; font-size: 11px; overflow: hidden; }
    .focus-title { font-weight: 900; text-align: center; margin-bottom: 5px; color: #7a5a21; }
    .focus-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 68px 1fr 68px 1fr; grid-template-rows: 24px 28px 28px 28px 42px minmax(90px, 1fr); border-top: 1px solid #303030; border-left: 1px solid #303030; }
    .focus-grid b, .focus-grid span { min-height: 0; padding: 3px 5px; border-right: 1px solid #303030; border-bottom: 1px solid #303030; }
    .focus-grid b { display: grid; place-items: center; background: #f2ead9; }
    .focus-grid .wide { grid-column: span 3; }
    .focus-grid .tall { min-height: 0; }
    .focus-grid .extra-tall { min-height: 0; }
    .summary { padding: 7px 9px; border: 2px solid #b88a31; border-radius: 12px; background: rgba(255,248,232,.96); font-size: 10.8px; line-height: 1.35; box-shadow: 0 8px 20px rgba(60,43,12,.12); overflow: hidden; }
    .summary b { color: #8b1d12; }
    .summary-counts, .sign-grid, .leave-follow-grid { display: grid; grid-template-columns: 56px 1fr 56px 1fr; border-top: 1px solid #303030; border-left: 1px solid #303030; margin-bottom: 5px; }
    .summary-counts b, .summary-counts span, .sign-grid b, .sign-grid span, .leave-follow-grid b, .leave-follow-grid span { min-height: 18px; padding: 3px 4px; border-right: 1px solid #303030; border-bottom: 1px solid #303030; background: #fff; }
    .summary-counts b, .sign-grid b, .leave-follow-grid b { display: grid; place-items: center; background: #f2ead9; }
    .leave-follow-grid { grid-template-columns: 64px 1fr; }
    .leave-follow-grid b, .leave-follow-grid span { min-height: 24px; }
    .summary-list { margin: 4px 0 5px; min-height: 27px; }
    .sign-grid { margin-top: 8px; }
    .sign-grid span { min-height: 54px; }
    .page-break { break-before: page; page-break-before: always; }
    .seat-wrap { display: flex; flex-direction: column; gap: 9px; flex: 1; padding: 10px; border: 2px solid #b88a31; border-radius: 16px; background: radial-gradient(circle at 18% 12%, rgba(184,138,49,.16), transparent 28%), #fffdf7; }
    .podium-print { padding: 10px; border-radius: 13px; text-align: center; font-weight: 900; color: #fff7df; background: linear-gradient(100deg, #111820, #7a5a21); }
    .seat-map { display: grid; grid-template-columns: ${gridTemplate}; gap: 8px; flex: 1; align-items: stretch; }
    .seat { min-height: 64px; border: 1.5px solid #4e442e; border-radius: 10px; padding: 8px; text-align: center; background: linear-gradient(145deg, #fff8e8, #f5e9ca); font-size: 15px; }
    .seat b { font-size: 17px; }
    .seat-leave { color: #a40000; border-color: #c23a32; background: linear-gradient(145deg, #ffe4df, #f7c8bf); }
    .aisle-print { display: grid; place-items: center; padding: 0; color: #7b6b4f; background: repeating-linear-gradient(45deg, #e4dccb 0 8px, #f8f2e6 8px 16px); border-style: dashed; }
    .aisle-print b { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 0; line-height: 1; }
    .seat-page-bottom { display: flex; justify-content: flex-end; }
  </style></head><body>
    <section class="sheet">
      <div class="brand-head"><div class="brand-left"><img class="brand-logo" src="assets/logo.png"><div><h1>金牌躍騰平鎮分校 教務點名表</h1><p>${escapeHtml(dateLabel(date))}｜${escapeHtml(grade)}｜${escapeHtml(subject)}｜${escapeHtml(setting.room || "")}</p></div></div><strong>應到 ${summary.expected}　實到 ${summary.present}　請假 ${summary.leave}　未到 ${summary.absent}</strong></div>
      <div class="front-grid">
        <div class="paper-panel"><table>${tableHead}<tbody>${leftRows}</tbody></table></div>
        <div class="front-right">
          <div class="paper-panel right-roster"><table>${tableHead}<tbody>${rightRows}</tbody></table></div>
          <div class="front-footer"><div class="focus-panel">${focusHtml}</div><div class="summary">${summaryHtml}</div></div>
        </div>
      </div>
    </section>
    <section class="sheet page-break">
      <div class="brand-head"><div class="brand-left"><img class="brand-logo" src="assets/logo.png"><div><h1>金牌躍騰平鎮分校 座位圖</h1><p>${escapeHtml(dateLabel(date))}｜${escapeHtml(grade)}｜${escapeHtml(subject)}｜${escapeHtml(setting.room || "")}</p></div></div><strong>B4 第二面</strong></div>
      <div class="seat-wrap"><div class="podium-print">講台</div><div class="seat-map">${seatHtml}</div></div>
    </section>
    <script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script>
  </body></html>`;
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(() => iframe.contentWindow?.print(), 400);
}

function printSeatAssignmentPdf() {
  const grade = $("#seatSettingGrade")?.value || "國一";
  const subject = $("#seatSettingSubject")?.value || courses[0] || "國文";
  const setting = currentSeatSetting();
  const layoutSeats = roomLayoutSeats(setting.room);
  const gridTemplate = seatGridTemplate(layoutSeats);
  const maxRow = seatMaxRow(layoutSeats);
  const today = todayISO();
  const seatHtml = layoutSeats.map((id) => {
    const pos = seatPositionFromId(id);
    if (!pos) return "";
    if (pos.type === "aisle") return `<div class="seat aisle-print" style="grid-row:1 / span ${maxRow};grid-column:${pos.col};"><b>走道</b></div>`;
    const student = getStudent(setting.seats?.[id]);
    const leave = student ? rollLeaveForStudent(student.id, today) : null;
    const leaveClass = student && leave?.type !== "提早離班" ? " seat-leave" : "";
    return `<div class="seat${leaveClass}" style="grid-row:${pos.row};grid-column:${pos.col};">${pos.row}-${pos.col}<br><b>${escapeHtml(student?.name || "")}</b></div>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>座位表</title><style>
    @page { size: B4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Microsoft JhengHei", Arial, sans-serif; color: #151515; background: #f7f2e7; }
    .sheet { min-height: calc(100vh - 16mm); display: flex; flex-direction: column; gap: 9px; }
    .brand-head { display: flex; justify-content: space-between; align-items: end; padding: 9px 12px; border-radius: 12px; color: #fff7df; background: linear-gradient(112deg, #0f151d, #5b4520 56%, #b88a31); }
    .brand-left { display: flex; align-items: center; gap: 10px; }
    .brand-logo { width: 42px; height: 42px; border-radius: 50%; object-fit: contain; background: rgba(255,255,255,.08); }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 3px 0 0; color: #ffe6a3; }
    .seat-wrap { display: flex; flex-direction: column; gap: 9px; flex: 1; padding: 10px; border: 2px solid #b88a31; border-radius: 16px; background: #fffdf7; }
    .podium-print { padding: 12px; border-radius: 13px; text-align: center; font-weight: 900; color: #fff7df; background: linear-gradient(100deg, #111820, #7a5a21); }
    .seat-map { display: grid; grid-template-columns: ${gridTemplate}; gap: 8px; flex: 1; align-items: stretch; }
    .seat { min-height: 68px; border: 1.5px solid #4e442e; border-radius: 10px; padding: 8px; text-align: center; background: linear-gradient(145deg, #fff8e8, #f5e9ca); font-size: 15px; }
    .seat b { font-size: 18px; }
    .seat-leave { color: #a40000; border-color: #c23a32; background: linear-gradient(145deg, #ffe4df, #f7c8bf); }
    .aisle-print { display: grid; place-items: center; color: #7b6b4f; background: repeating-linear-gradient(45deg, #e4dccb 0 8px, #f8f2e6 8px 16px); border-style: dashed; }
    .aisle-print b { writing-mode: vertical-rl; text-orientation: upright; }
  </style></head><body><section class="sheet">
    <div class="brand-head"><div class="brand-left"><img class="brand-logo" src="assets/logo.png"><div><h1>金牌躍騰平鎮分校 座位表</h1><p>${escapeHtml(grade)}｜${escapeHtml(subject)}｜${escapeHtml(setting.room || "")}｜${escapeHtml(dateLabel(today))}</p></div></div><strong>座位安排</strong></div>
    <div class="seat-wrap"><div class="podium-print">講台</div><div class="seat-map">${seatHtml}</div></div>
  </section><script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script></body></html>`;
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

function renderRetentionSubjectOptions() {
  const target = $("#retentionSubject");
  if (!target) return;
  const previous = target.value || retentionSubject || "全部";
  const subjects = [...new Set(state.exams
    .filter((exam) => exam.grade === retentionGrade && exam.date === retentionDate && !exam.noExam)
    .map((exam) => exam.subject)
    .filter(Boolean))];
  target.innerHTML = `<option value="全部">全部科目</option>${subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("")}`;
  target.value = previous === "全部" || subjects.includes(previous) ? previous : "全部";
  retentionSubject = target.value;
}

function studentSubjectAverageBefore(studentId, subject, date) {
  const rows = state.exams
    .filter((exam) => exam.subject === subject && exam.date < date && !exam.noExam)
    .flatMap((exam) => currentScoreRows(exam).filter((row) => row.student.id === studentId));
  if (!rows.length) return NaN;
  return rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
}

function retentionDecision(row, examRows) {
  const baseline = studentSubjectAverageBefore(row.student.id, row.exam.subject, row.exam.date);
  const total = Math.max(1, examRows.length);
  const classAverage = examRows.length ? examRows.reduce((sum, item) => sum + item.score, 0) / examRows.length : NaN;
  const rankRatio = row.rank / total;
  const reasonable = Number.isFinite(baseline)
    ? Math.max(35, Math.min(88, baseline - (baseline >= 80 ? 10 : baseline >= 60 ? 8 : 5)))
    : (Number.isFinite(classAverage) ? Math.max(35, Math.min(60, classAverage - 10)) : 50);
  const reasons = [];
  if (Number.isFinite(baseline) && row.score < reasonable) reasons.push(`低於個人合理值 ${scoreDisplay(reasonable)}`);
  if (Number.isFinite(baseline) && baseline >= 70 && row.score <= baseline - 15) reasons.push("較長期水準明顯失常");
  if (!Number.isFinite(baseline) && row.score < reasonable) reasons.push("新資料偏低需追蹤");
  if (row.score < 35) reasons.push("基礎分數過低需立即補強");
  return { baseline, reasonable, classAverage, total, rankRatio, shouldStay: reasons.length > 0, reason: reasons.join("、") || "達個人合理水準" };
}

function renderRetentionReport() {
  if (!$("#retention-report")) return;
  if ($("#retentionDate")) $("#retentionDate").value = retentionDate;
  renderRetentionSubjectOptions();
  if ($("#retentionTitle")) $("#retentionTitle").textContent = `${dateLabel(retentionDate)} ${retentionGrade} 留班報告`;
  const target = $("#retentionReportBody");
  if (!target) return;
  const exams = state.exams
    .filter((exam) => exam.grade === retentionGrade && exam.date === retentionDate && !exam.noExam)
    .filter((exam) => retentionSubject === "全部" || exam.subject === retentionSubject);
  if (!exams.length) {
    target.innerHTML = `<div class="empty">這一天尚無符合的考試成績單。</div>`;
    return;
  }
  const rows = exams.flatMap((exam) => {
    const examRows = currentScoreRows(exam);
    return examRows.map((row) => ({ ...row, exam, decision: retentionDecision({ ...row, exam }, examRows) }));
  }).sort((a, b) => a.exam.subject.localeCompare(b.exam.subject, "zh-Hant") || a.rank - b.rank || a.score - b.score);
  const stayRows = rows
    .filter((row) => row.decision.shouldStay)
    .sort((a, b) => a.exam.subject.localeCompare(b.exam.subject, "zh-Hant") || a.rank - b.rank || a.score - b.score);
  const scopes = [...new Set(exams.map((exam) => `${exam.subject}：${exam.scope || "未填單元"}`).filter(Boolean))];
  const totalStudents = rows.length;
  const subjectCards = exams.map((exam) => {
    const examRows = currentScoreRows(exam);
    const avg = examRows.length ? examRows.reduce((sum, row) => sum + row.score, 0) / examRows.length : NaN;
    const stayCount = stayRows.filter((row) => row.exam.id === exam.id).length;
    return `<article class="record-card">
      <strong>${escapeHtml(exam.subject)}｜${escapeHtml(exam.scope || "未填單元")}</strong>
      <div class="meta">
        <span class="badge">人數 ${examRows.length}</span>
        <span class="badge">班平均 ${scoreDisplay(avg)}</span>
        <span class="badge gold">留班 ${stayCount}</span>
      </div>
    </article>`;
  }).join("");
  target.innerHTML = `
    <div class="status-grid retention-overview">
      <article class="metric"><span>班級</span><strong>${escapeHtml(retentionGrade)}</strong></article>
      <article class="metric"><span>今日考試人數</span><strong>${totalStudents}</strong></article>
      <article class="metric"><span>建議留班</span><strong>${stayRows.length}</strong></article>
      <article class="metric"><span>今日考試單元內容</span><p>${escapeHtml(scopes.join("、") || "-")}</p></article>
    </div>
    <div class="record-list compact-record-list">${subjectCards}</div>
    <h3 class="subhead">當天成績排名</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>排名</th><th>學生</th><th>科目</th><th>單元</th><th>成績</th><th>歷史平均</th><th>合理值</th><th>留班</th><th>原因</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr class="${row.decision.shouldStay ? "attention-row" : ""}">
            <td>${row.rank}/${row.decision.total}</td>
            <td>${escapeHtml(row.student.name)}</td>
            <td>${escapeHtml(row.exam.subject)}</td>
            <td>${escapeHtml(row.exam.scope || "-")}</td>
            <td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td>
            <td>${scoreDisplay(row.decision.baseline)}</td>
            <td>${scoreDisplay(row.decision.reasonable)}</td>
            <td>${row.decision.shouldStay ? "留班" : "-"}</td>
            <td>${escapeHtml(row.decision.reason)}</td>
          </tr>
        `).join("") || `<tr><td colspan="9">目前沒有當天成績。</td></tr>`}</tbody>
      </table>
    </div>
    <h3 class="subhead">留班名單</h3>
    <div class="record-list compact-record-list">${stayRows.map((row) => `<article class="record-card"><strong>${escapeHtml(row.student.name)}｜${escapeHtml(row.exam.subject)}｜第 ${row.rank} 名</strong><p>${escapeHtml(row.decision.reason)}</p></article>`).join("") || `<div class="empty">目前沒有建議留班名單。</div>`}</div>
  `;
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

function academicPeriodOptions() {
  return normalizeAcademicPeriods(state.academicPeriods || [], activeAcademicPeriod());
}

function setSelectOptions(target, values, fallback = "") {
  if (!target) return "";
  const previous = target.value;
  const options = [...new Set(values.filter(Boolean))];
  target.innerHTML = options.map((value) => `<option value="${value}">${value}</option>`).join("");
  const next = options.includes(previous) ? previous : (options.includes(fallback) ? fallback : options[0] || "");
  target.value = next;
  return next;
}

function renderAcademicSettings() {
  const settings = activeAcademicPeriod();
  if ($("#academicYear")) $("#academicYear").value = settings.academicYear;
  if ($("#academicSemester")) $("#academicSemester").value = settings.semester;
  if ($("#examAcademicLabel")) $("#examAcademicLabel").textContent = academicPeriodLabel(settings);
}

function upsertAcademicPeriod(settings = activeAcademicPeriod()) {
  const period = normalizeAcademicSettings(settings);
  state.academicPeriods = normalizeAcademicPeriods([
    ...(state.academicPeriods || []),
    {
      academicYear: period.academicYear,
      semester: period.semester,
      updatedAt: new Date().toISOString(),
    },
  ], period);
}

function renderAcademicPeriodList() {
  const target = $("#academicPeriodList");
  if (!target) return;
  upsertAcademicPeriod(activeAcademicPeriod());
  const current = academicPeriodLabel();
  target.innerHTML = (state.academicPeriods || []).map((period) => {
    const label = academicPeriodLabel(period);
    const examCount = state.exams.filter((exam) => exam.academicYear === period.academicYear && exam.semester === period.semester).length;
    const termCount = state.termScores.filter((item) => item.year === period.academicYear && item.semester === period.semester).length;
    return `
      <article class="record-card academic-period-card ${label === current ? "done" : ""}">
        <strong>${label}</strong>
        <div class="meta">
          <span class="badge">週考 ${examCount} 份</span>
          <span class="badge">段考 ${termCount} 筆</span>
          <span class="badge">${label === current ? "目前使用中" : "可切換調閱"}</span>
        </div>
        <div class="action-row">
          <button class="ghost" data-apply-academic-period="${period.academicYear}|${period.semester}">設為目前</button>
          <button class="ghost" data-edit-academic-period="${period.academicYear}|${period.semester}">編輯</button>
          <button class="ghost" data-open-class-ops-period="${period.academicYear}|${period.semester}">看班級經營</button>
        </div>
      </article>
    `;
  }).join("") || `<div class="empty">尚無學年學期紀錄。</div>`;
}

function renderPromotionPreview() {
  const target = $("#promotionPreview");
  if (!target) return;
  const counts = Object.fromEntries(studentStatuses.map((grade) => [grade, state.students.filter((student) => student.grade === grade).length]));
  target.innerHTML = `
    <article class="metric"><span>國一 → 國二</span><strong>${counts["國一"]}</strong></article>
    <article class="metric"><span>國二 → 國三</span><strong>${counts["國二"]}</strong></article>
    <article class="metric"><span>國三 → 校友</span><strong>${counts["國三"]}</strong></article>
    <article class="metric"><span>目前校友</span><strong>${counts["校友"]}</strong></article>
  `;
}

function promoteGrades() {
  const password = prompt("請輸入升級密碼");
  if (password !== "44775709") return alert("密碼錯誤，已取消升級。");
  const counts = {
    first: state.students.filter((student) => student.grade === "國一").length,
    second: state.students.filter((student) => student.grade === "國二").length,
    third: state.students.filter((student) => student.grade === "國三").length,
  };
  if (!counts.first && !counts.second && !counts.third) return alert("目前沒有國一到國三學生可以升級。");
  const message = `確定執行年級升級？\n國一 ${counts.first} 人會變國二\n國二 ${counts.second} 人會變國三\n國三 ${counts.third} 人會變校友\n\n歷史成績與請假紀錄會保留。`;
  if (!confirm(message)) return;
  const graduatingIds = new Set(state.students.filter((student) => student.grade === "國三").map((student) => student.id));
  state.students = state.students.map((student) => {
    if (student.grade === "國一") return { ...student, grade: "國二", promotedAt: new Date().toISOString() };
    if (student.grade === "國二") return { ...student, grade: "國三", promotedAt: new Date().toISOString() };
    if (student.grade === "國三") return { ...student, grade: "校友", alumniAt: new Date().toISOString() };
    return student;
  });
  state.leaves = state.leaves.map((record) => graduatingIds.has(record.studentId) ? { ...record, dismissedAt: record.dismissedAt || new Date().toISOString() } : record);
  state.lateRecords = state.lateRecords.map((record) => graduatingIds.has(record.studentId) ? { ...record, dismissedAt: record.dismissedAt || new Date().toISOString() } : record);
  clearStudentForm();
  saveState();
  renderAll();
  alert("年級升級完成。現在可以建立新國一學生。");
}

function applyAcademicPeriodKey(key, openClassOps = false) {
  const [academicYear, semester] = String(key || "").split("|");
  if (!academicYear || !semester) return;
  state.settings = normalizeAcademicSettings({ academicYear, semester });
  upsertAcademicPeriod(state.settings);
  if ($("#academicYear")) $("#academicYear").value = academicYear;
  if ($("#academicSemester")) $("#academicSemester").value = semester;
  if (openClassOps) {
    navigateToTab("class-ops");
    if ($("#classOpsYear")) $("#classOpsYear").value = academicYear;
    if ($("#classOpsSemester")) $("#classOpsSemester").value = semester;
  }
  saveState();
  renderAll();
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
    .filter((student) => student.grade === grade && !student.withdrawn)
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

function currentScoreDraftKey() {
  return scoreDraftId($("#examDate")?.value || todayISO(), $("#examGrade")?.value || "國一", $("#examSubject")?.value || "國文");
}

function currentSharedScoreDraft() {
  const key = currentScoreDraftKey();
  const localDraft = scoreDraft?.key === key ? scoreDraft : null;
  const existing = state.scoreDrafts?.[key] || localDraft;
  return normalizeScoreDraft({
    ...(existing || {}),
    key,
    date: $("#examDate")?.value || todayISO(),
    grade: $("#examGrade")?.value || "國一",
    subject: $("#examSubject")?.value || "國文",
  });
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

function clearScoreDraft({ remote = true } = {}) {
  const key = scoreDraft?.key || currentScoreDraftKey();
  scoreDraft = null;
  localStorage.removeItem(scoreDraftKey());
  if (remote) {
    if (!state.scoreDrafts) state.scoreDrafts = {};
    const [date, grade, subject] = key.split("|");
    const now = new Date().toISOString();
    state.scoreDrafts[key] = normalizeScoreDraft({
      key,
      date,
      grade,
      subject,
      scores: {},
      absences: {},
      clearedAt: now,
      updatedAt: now,
      updatedBy: deviceId,
    });
    saveState();
  }
}

function publishScoreDraft(draft, { immediate = false } = {}) {
  if (!draft?.key) return;
  if (!state.scoreDrafts) state.scoreDrafts = {};
  scoreDraft = normalizeScoreDraft({
    ...draft,
    clearedAt: "",
    updatedAt: new Date().toISOString(),
    updatedBy: deviceId,
  });
  state.scoreDrafts[scoreDraft.key] = scoreDraft;
  saveScoreDraft();
  localStorage.setItem(storageKey(), JSON.stringify(state));
  queueRemoteSave();
  renderScoreLiveStatus();
}

function captureScoreDraft() {
  if (!$("#examForm")) return;
  const draft = currentSharedScoreDraft();
  const nextKey = [$("#examDate").value, $("#examGrade").value, $("#examSubject").value].join("|");
  if (draft.key && draft.key !== nextKey) {
    draft.scores = {};
    draft.absences = {};
  }
  draft.key = nextKey;
  draft.editingExamId = editingExamId;
  draft.date = $("#examDate").value;
  draft.grade = $("#examGrade").value;
  draft.subject = $("#examSubject").value;
  draft.scope = $("#examScope").value;
  draft.paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  draft.paperTopics = paperTopicValues();
  draft.noExam = $("#examNoTest").checked;
  draft.mockMode = $("#examMockMode")?.checked || false;
  draft.scores = draft.scores || {};
  draft.absences = draft.absences && !Array.isArray(draft.absences) ? draft.absences : {};
  const updatedAt = new Date().toISOString();
  $$("[data-score-student]").forEach((input) => {
    const studentId = input.dataset.scoreStudent;
    const paper = input.dataset.scorePaper;
    if (!draft.scores[studentId]) draft.scores[studentId] = {};
    if (input.value === "") {
      draft.scores[studentId][paper] = { value: "", updatedAt, deviceId };
    } else {
      draft.scores[studentId][paper] = { value: input.value, updatedAt, deviceId };
    }
  });
  $$("[data-score-absent]").forEach((input) => {
    const studentId = input.dataset.scoreAbsent;
    draft.absences[studentId] = { active: input.classList.contains("active"), updatedAt, deviceId };
  });
  publishScoreDraft(draft);
}

function updateScoreDraftMeta({ immediate = false } = {}) {
  if (!$("#examForm")) return;
  const draft = currentSharedScoreDraft();
  draft.editingExamId = editingExamId;
  draft.scope = $("#examScope").value;
  draft.paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  draft.paperTopics = paperTopicValues();
  draft.noExam = $("#examNoTest").checked;
  draft.mockMode = $("#examMockMode")?.checked || false;
  publishScoreDraft(draft, { immediate });
}

function updateScoreDraftCell(input) {
  if (!input) return;
  const draft = currentSharedScoreDraft();
  const studentId = input.dataset.scoreStudent;
  const paper = input.dataset.scorePaper;
  if (!draft.scores[studentId]) draft.scores[studentId] = {};
  if (input.value === "") {
    draft.scores[studentId][paper] = { value: "", updatedAt: new Date().toISOString(), deviceId };
  } else {
    draft.scores[studentId][paper] = { value: input.value, updatedAt: new Date().toISOString(), deviceId };
  }
  publishScoreDraft(draft);
}

function updateScoreDraftAbsence(button) {
  if (!button) return;
  const draft = currentSharedScoreDraft();
  draft.absences[button.dataset.scoreAbsent] = {
    active: button.classList.contains("active"),
    updatedAt: new Date().toISOString(),
    deviceId,
  };
  publishScoreDraft(draft);
}

function touchScoreActivity() {
  state.scoreActivity = {
    id: deviceId,
    date: $("#examDate")?.value || todayISO(),
    grade: $("#examGrade")?.value || "",
    subject: $("#examSubject")?.value || "",
    updatedAt: new Date().toISOString(),
  };
  queueRemoteSave();
  renderScoreLiveStatus();
}

function renderScoreLiveStatus() {
  const target = $("#scoreLiveStatus");
  if (!target) return;
  const activity = state.scoreActivity;
  const active = activity?.updatedAt && (Date.now() - new Date(activity.updatedAt).getTime()) < 120000;
  if (active && activity.id !== deviceId) {
    target.textContent = `有人正在登記：${activity.grade || ""} ${activity.subject || ""} ${activity.date || ""}`;
    target.classList.add("live-dot");
  } else {
    target.textContent = "排名會自動計算";
    target.classList.remove("live-dot");
  }
}

function restoreScoreDraftMeta() {
  if (!$("#examForm")) return;
  scoreDraft = state.scoreDrafts?.[currentScoreDraftKey()] || scoreDraft;
  if (!scoreDraft) return;
  scoreDraft = normalizeScoreDraft(scoreDraft);
  if (scoreDraft.clearedAt) return;
  if (scoreDraft.date) $("#examDate").value = scoreDraft.date;
  if (scoreDraft.grade) $("#examGrade").value = scoreDraft.grade;
  renderExamSubjectOptions();
  if (scoreDraft.subject && !Array.from($("#examSubject").options).some((option) => option.value === scoreDraft.subject)) {
    $("#examSubject").insertAdjacentHTML("beforeend", `<option value="${scoreDraft.subject}">${scoreDraft.subject}</option>`);
  }
  if (scoreDraft.subject) $("#examSubject").value = scoreDraft.subject;
  $("#examScope").value = scoreDraft.scope || "";
  $("#examPaperCount").value = Math.max(1, Number(scoreDraft.paperCount) || 1);
  renderPaperTopicInputs(scoreDraft.paperTopics || []);
  $("#examNoTest").checked = Boolean(scoreDraft.noExam);
  if ($("#examMockMode")) $("#examMockMode").checked = Boolean(scoreDraft.mockMode);
  editingExamId = scoreDraft.editingExamId || null;
  updateExamFormMode();
}

function draftScoreValue(draft, studentId, paper) {
  const cell = draft?.scores?.[studentId]?.[paper];
  if (cell && typeof cell === "object" && "value" in cell) return cell.value;
  return cell;
}

function draftAbsenceActive(draft, studentId) {
  if (!draft) return false;
  if (Array.isArray(draft.absences)) return draft.absences.includes(studentId);
  return draft.absences?.[studentId]?.active === true;
}

function applyScoreDraftToRows() {
  scoreDraft = state.scoreDrafts?.[currentScoreDraftKey()] || scoreDraft;
  if (!scoreDraft) return;
  scoreDraft = normalizeScoreDraft(scoreDraft);
  if (scoreDraft.clearedAt) return;
  $$("[data-score-student]").forEach((input) => {
    const value = draftScoreValue(scoreDraft, input.dataset.scoreStudent, input.dataset.scorePaper);
    if (value !== undefined) input.value = value;
  });
  $$("[data-score-absent]").forEach((input) => {
    setScoreAbsentButton(input, draftAbsenceActive(scoreDraft, input.dataset.scoreAbsent));
  });
}

function applyRemoteScoreDraftToForm() {
  const remoteDraft = state.scoreDrafts?.[currentScoreDraftKey()];
  if (!remoteDraft) return;
  scoreDraft = normalizeScoreDraft(remoteDraft);
  if (scoreDraft.clearedAt) return;
  const focused = document.activeElement;
  if (!focused?.matches?.("#examScope")) $("#examScope").value = scoreDraft.scope || "";
  if (!focused?.matches?.("#examPaperCount")) $("#examPaperCount").value = Math.max(1, Number(scoreDraft.paperCount) || 1);
  if (!focused?.matches?.("#examNoTest")) $("#examNoTest").checked = Boolean(scoreDraft.noExam);
  if (!focused?.matches?.("#examMockMode") && $("#examMockMode")) $("#examMockMode").checked = Boolean(scoreDraft.mockMode);
  if (!focused?.closest?.("#examPaperTopics")) renderPaperTopicInputs(scoreDraft.paperTopics || []);
  const noExam = $("#examNoTest")?.checked;
  if (!noExam && !$("#scoreEntryList [data-score-student]").length) renderScoreEntryList();
  $$("[data-score-student]").forEach((input) => {
    if (input === focused) return;
    const value = draftScoreValue(scoreDraft, input.dataset.scoreStudent, input.dataset.scorePaper);
    input.value = value !== undefined ? value : "";
  });
  $$("[data-score-absent]").forEach((button) => {
    if (button === focused) return;
    setScoreAbsentButton(button, draftAbsenceActive(scoreDraft, button.dataset.scoreAbsent));
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
  const mockMode = $("#examMockMode")?.checked;
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
            <input type="text" inputmode="${mockMode ? "text" : "decimal"}" data-score-student="${student.id}" data-score-paper="${index}" placeholder="${mockMode ? `卷${index + 1} / A、B、C` : `卷${index + 1} / 分數`}">
          `).join("")}
          <button class="absent-check" type="button" data-score-absent="${student.id}" aria-pressed="false">缺考</button>
        </div>
      </label>
    `).join("")
    : `<div class="empty">此年級尚無補 ${subject} 的學生。</div>`;
  applyEditingExamScores();
  applyScoreDraftToRows();
}

function renderArchiveCleanup() {
  const target = $("#archiveCleanupList");
  if (!target) return;
  const currentYear = currentRocYear();
  const years = [...new Set([
    ...state.exams.map((exam) => exam.academicYear),
    ...state.leaves.map((record) => academicPeriodForDate(getLeaveStart(record)).academicYear),
  ].filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  target.innerHTML = years.map((year) => {
    const eligible = Number(year) <= currentYear - 3;
    const examCount = state.exams.filter((exam) => exam.academicYear === year).length;
    const leaveCount = state.leaves.filter((record) => academicPeriodForDate(getLeaveStart(record)).academicYear === year).length;
    return `<article class="record-card ${eligible ? "" : "done"}">
      <strong>${escapeHtml(year)} 學年</strong>
      <div class="meta">
        <span class="badge">週考 ${examCount} 份</span>
        <span class="badge">請假 ${leaveCount} 筆</span>
        <span class="badge ${eligible ? "gold" : ""}">${eligible ? "可清理" : `需等到 ${Number(year) + 3} 學年`}</span>
      </div>
      <div class="action-row">
        <button class="ghost danger" data-clean-archive-year="${escapeHtml(year)}" ${eligible ? "" : "disabled"}>清理此學年請假與成績單</button>
      </div>
    </article>`;
  }).join("") || `<div class="empty">目前沒有可列出的歷屆資料。</div>`;
}

function paperTopicValues() {
  return $$("[data-paper-topic]").map((input) => input.value.trim());
}

function renderPaperTopicInputs(values = []) {
  const target = $("#examPaperTopics");
  if (!target) return;
  const paperCount = Math.max(1, Number($("#examPaperCount")?.value) || 1);
  target.innerHTML = Array.from({ length: paperCount }, (_item, index) => `
    <label>卷${index + 1}單元
      <input data-paper-topic="${index}" value="${escapeHtml(values[index] || "")}" placeholder="例：基礎題、閱讀理解、1-2函數">
    </label>
  `).join("");
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

function parseScoreInput(value, mockMode = $("#examMockMode")?.checked) {
  const text = String(value ?? "").trim().toUpperCase();
  const mockLevelMap = { "A++": 100, "A+": 95, A: 90, "B++": 88, "B+": 84, B: 80, C: 75 };
  if (mockMode) return mockLevelMap[text] ?? NaN;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : NaN;
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
  const students = state.students.filter((student) =>
    student.grade === exam.grade &&
    (exam.scores?.[student.id] !== undefined || studentTakesSubject(student, exam.subject))
  );
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

function chunkArray(items, size) {
  const chunks = [];
  const pageSize = Math.max(1, size);
  for (let index = 0; index < items.length; index += pageSize) {
    chunks.push(items.slice(index, index + pageSize));
  }
  return chunks;
}

function branchReportTitle() {
  const branch = (currentBranch || "").trim();
  return branch ? `${branch}${branch.endsWith("分校") ? "" : "分校"} 班級成績單` : "班級成績單";
}

function studentReportTitle() {
  const branch = (currentBranch || "").trim();
  return branch ? `${branch}${branch.endsWith("分校") ? "" : "分校"} 學生生涯報告` : "學生生涯報告";
}

function classReportData(exam) {
  const rows = currentScoreRows(exam);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : NaN;
  const paperCount = Math.max(1, Number(exam.paperCount) || 1);
  const rankedById = new Map(rows.map((row) => [row.student.id, row]));
  const reportRows = state.students.filter((student) =>
    student.grade === exam.grade &&
    (exam.scores?.[student.id] !== undefined || studentTakesSubject(student, exam.subject))
  )
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
  $("#termPeriodSection")?.classList.toggle("active", termSection === "periods");
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

async function refreshRemoteExamsNow() {
  if (!supabaseClient || !currentBranch) return;
  const remoteExamRecords = await loadSupabaseExamRecords().catch(() => []);
  state.exams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
  localStorage.setItem(storageKey(), JSON.stringify(state));
}

async function saveExam(event) {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = "同步儲存中...";
  }
  captureScoreDraft();
  const noExam = $("#examNoTest").checked;
  const mockMode = $("#examMockMode")?.checked || false;
  const paperCount = Math.max(1, Number($("#examPaperCount").value) || 1);
  const scores = {};
  const absences = [];
  studentsForGradeAndSubject($("#examGrade").value, $("#examSubject").value).forEach((student) => {
    const absent = draftAbsenceActive(scoreDraft, student.id) || document.querySelector(`[data-score-absent="${student.id}"]`)?.classList.contains("active");
    if (absent) {
      absences.push(student.id);
      return;
    }
    const values = Array.from({ length: paperCount }, (_, index) => {
      const input = document.querySelector(`[data-score-student="${student.id}"][data-score-paper="${index}"]`);
      const draftValue = draftScoreValue(scoreDraft, student.id, String(index));
      const value = draftValue !== undefined ? draftValue : input?.value;
      return value !== "" && value !== undefined ? parseScoreInput(value, mockMode) : null;
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
    mockMode,
    paperCount,
    paperTopics: paperTopicValues(),
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
  if (supabaseClient && currentBranch) {
    await saveSupabaseExamRecords([exam]);
    await refreshRemoteExamsNow();
  }
  renderAll();
  if (submitter) submitter.disabled = false;
  flashButton(submitter, existing ? "已更新" : "已儲存");
}

function resetExamForm() {
  if (!confirm("確定重設當天成績輸入？尚未儲存的分數會清空。")) return;
  const date = $("#examDate").value || todayISO();
  const grade = $("#examGrade").value || "國一";
  const subject = $("#examSubject").value || "國文";
  editingExamId = null;
  scoreSection = "entry";
  selectedClassReportExamId = null;
  clearScoreDraft();
  $("#examDate").value = date;
  $("#examGrade").value = grade;
  renderExamSubjectOptions();
  if (!Array.from($("#examSubject").options).some((option) => option.value === subject)) {
    $("#examSubject").insertAdjacentHTML("beforeend", `<option value="${subject}">${subject}</option>`);
  }
  $("#examSubject").value = subject;
  $("#examScope").value = "";
  $("#examPaperCount").value = 1;
  renderPaperTopicInputs([]);
  $("#examNoTest").checked = false;
  if ($("#examMockMode")) $("#examMockMode").checked = false;
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
  renderPaperTopicInputs(exam.paperTopics || []);
  $("#examNoTest").checked = Boolean(exam.noExam);
  if ($("#examMockMode")) $("#examMockMode").checked = Boolean(exam.mockMode);
  $("#scoreStudentPicker").value = "";
  $("#scoreStudentFilter").value = "全部";
  updateExamFormMode();
  renderScoreStudentFilter();
  renderScoreEntryList();
  renderClassReport(exam);
}

function renderExamHistory() {
  const period = weeklyPeriodFilter("scoreHistory");
  const historyGrade = $("#scoreHistoryGrade")?.value || "全部";
  const allItems = state.exams
    .filter((exam) => examMatchesWeeklyPeriod(exam, period))
    .filter((exam) => historyGrade === "全部" || exam.grade === historyGrade)
    .sort((a, b) => b.date.localeCompare(a.date));
  const pageSize = 24;
  const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize));
  examHistoryPage = Math.min(Math.max(1, examHistoryPage), totalPages);
  const items = allItems.slice((examHistoryPage - 1) * pageSize, examHistoryPage * pageSize);
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
  if (allItems.length > pageSize) {
    $("#examHistoryList").insertAdjacentHTML("beforeend", `
      <div class="pager-row">
        <button class="ghost" type="button" data-exam-history-page="${examHistoryPage - 1}" ${examHistoryPage <= 1 ? "disabled" : ""}>上一頁</button>
        <span>${examHistoryPage} / ${totalPages}，共 ${allItems.length} 份成績單</span>
        <button class="ghost" type="button" data-exam-history-page="${examHistoryPage + 1}" ${examHistoryPage >= totalPages ? "disabled" : ""}>下一頁</button>
      </div>
    `);
  }
}

function saveTermScore(event) {
  event.preventDefault();
  const year = $("#termYear").value.trim() || activeAcademicPeriod().academicYear;
  const semester = $("#termSemester").value;
  const grade = $("#termGrade").value;
  const stage = $("#termStage").value;
  const term = `${year}${semester}`;
  const meta = { year, semester, grade, stage };
  state.termWeights[termWeightKey(meta)] = readTermWeights();
  const inputs = $$('[data-term-score-student][data-term-score-subject]');
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
      item.grade === grade &&
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
  if (!saved) return alert("請至少輸入一筆段考成績。");
  termSection = "history";
  saveState();
  renderAll();
  flashButton(event.submitter, "已儲存");
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

function renderTermAcademicOptions() {
  const periods = academicPeriodOptions();
  const active = activeAcademicPeriod();
  const years = periods.map((period) => period.academicYear);
  const year = setSelectOptions($("#termYear"), years, active.academicYear);
  const periodYear = setSelectOptions($("#termPeriodYear"), years, year || active.academicYear);
  const termSemesters = periods.filter((period) => period.academicYear === year).map((period) => period.semester);
  const periodSemesters = periods.filter((period) => period.academicYear === periodYear).map((period) => period.semester);
  setSelectOptions($("#termSemester"), termSemesters.length ? termSemesters : ["上學期", "下學期"], active.semester);
  setSelectOptions($("#termPeriodSemester"), periodSemesters.length ? periodSemesters : ["上學期", "下學期"], active.semester);
}

function renderReportRangeOptions() {
  const periods = academicPeriodOptions();
  const active = activeAcademicPeriod();
  const years = [...new Set([
    ...periods.map((period) => period.academicYear),
    ...state.exams.map((exam) => exam.academicYear),
    ...state.termScores.map((score) => score.year),
  ].filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a), "zh-Hant"));
  ["career", "parent"].forEach((prefix) => {
    const year = setSelectOptions($(`#${prefix}ReportYear`), years, active.academicYear);
    const termYear = setSelectOptions($(`#${prefix}TermAnalysisYear`), years, active.academicYear);
    const semesters = periods.filter((period) => period.academicYear === year).map((period) => period.semester);
    const termSemesters = periods.filter((period) => period.academicYear === termYear).map((period) => period.semester);
    setSelectOptions($(`#${prefix}ReportSemester`), semesters.length ? semesters : ["上學期", "下學期"], active.semester);
    setSelectOptions($(`#${prefix}TermAnalysisSemester`), termSemesters.length ? termSemesters : ["上學期", "下學期"], active.semester);
  });
  renderReportRangeFields();
}

function renderReportRangeFields() {
  ["career", "parent"].forEach((prefix) => {
    const mode = $(`#${prefix}ReportRange`)?.value || "all";
    const visible = {
      year: mode === "year" || mode === "semester" || mode === "term-stage",
      semester: mode === "semester" || mode === "term-stage",
      stage: mode === "term-stage",
      start: mode === "date-range",
      end: mode === "date-range",
    };
    Object.entries(visible).forEach(([field, show]) => {
      const target = document.querySelector(`[data-report-field="${prefix}:${field}"]`);
      if (target) target.hidden = !show;
    });
  });
}

function termWeightKey(meta) {
  return [meta.year, meta.semester, meta.grade, meta.stage].join("|");
}

function termWeightsForMeta(meta = currentTermMeta()) {
  const weights = state.termWeights?.[termWeightKey(meta)] || {};
  return Object.fromEntries(termSubjects.map((subject) => {
    const value = Number(weights[subject]);
    return [subject, Number.isFinite(value) && value > 0 ? value : 1];
  }));
}

function readTermWeights() {
  return Object.fromEntries(termSubjects.map((subject) => {
    const value = Number($(`[data-term-weight="${subject}"]`)?.value);
    return [subject, Number.isFinite(value) && value > 0 ? value : 1];
  }));
}

function renderTermWeightControls() {
  const target = $("#termWeightControls");
  if (!target) return;
  const weights = termWeightsForMeta();
  target.innerHTML = termSubjects.map((subject) => `
    <label class="term-weight-card">
      <span>${subject}</span>
      <input type="number" min="0.1" step="0.1" data-term-weight="${subject}" value="${weights[subject]}">
    </label>
  `).join("");
}

function weightedTermAverage(scores, weights) {
  let total = 0;
  let weightTotal = 0;
  Object.entries(scores).forEach(([subject, score]) => {
    const value = Number(score);
    if (!Number.isFinite(value)) return;
    const weight = Number(weights[subject]) || 1;
    total += value * weight;
    weightTotal += weight;
  });
  return weightTotal ? total / weightTotal : NaN;
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
  const weights = termWeightsForMeta(meta);
  const byStudent = new Map();
  rows.forEach((row) => {
    if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, { student: row.student, scores: {} });
    const item = byStudent.get(row.studentId);
    item.scores[row.subject] = Number(row.score);
  });
  return [...byStudent.values()]
    .map((item) => {
      const average = weightedTermAverage(item.scores, weights);
      return { ...item, average, weightedAverage: average };
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
      <thead><tr><th>排名</th><th>班級</th><th>姓名</th>${termSubjects.map((subject) => `<th>${subject}</th>`).join("")}<th>加權成績</th></tr></thead>
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
  (state.academicPeriods || []).forEach((period) => period.academicYear && years.add(String(period.academicYear)));
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
    grade: $("#classOpsGrade")?.value || "全部",
    subject: $("#classOpsSubject")?.value || "全部",
  };
}

function renderLayerVisibility() {
  if ($("#classOpsMenu")) $("#classOpsMenu").hidden = classOpsSection !== "menu";
  if ($("#classOpsGradeMenu")) $("#classOpsGradeMenu").hidden = classOpsSection !== "grade";
  if ($("#classOpsReportPanel")) $("#classOpsReportPanel").hidden = classOpsSection !== "report";
  if ($("#contactBookMenu")) $("#contactBookMenu").hidden = contactBookSection !== "menu";
  if ($("#contactBookPanel")) $("#contactBookPanel").hidden = contactBookSection !== "book";
  if ($("#aboutForm")) $("#aboutForm").hidden = aboutSection !== "settings";
  if ($("#aboutDisplayPanel")) $("#aboutDisplayPanel").hidden = aboutSection !== "display";
}

function setClassOpsSection(section, options = {}) {
  if (!["menu", "grade", "report"].includes(section)) return;
  if (!options.skipHistory) pushTeacherBack();
  classOpsSection = section;
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openClassOpsGrade(grade) {
  if (!grades.includes(grade)) return;
  pushTeacherBack();
  classOpsSelectedGrade = grade;
  classOpsSection = "report";
  if ($("#classOpsGrade")) $("#classOpsGrade").value = grade;
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setContactBookSection(section) {
  if (!["menu", "book"].includes(section)) return;
  pushTeacherBack();
  contactBookSection = section;
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setAboutSection(section) {
  if (!["display", "settings"].includes(section)) return;
  pushTeacherBack();
  aboutSection = section;
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function classOpsWeeklyRows(meta, includeAllGrades = false) {
  return state.exams
    .filter((exam) => !exam.noExam)
    .filter((exam) => String(exam.academicYear || "") === String(meta.year))
    .filter((exam) => meta.semester === "全部" || exam.semester === meta.semester)
    .filter((exam) => includeAllGrades || meta.grade === "全部" || exam.grade === meta.grade)
    .filter((exam) => meta.subject === "全部" || exam.subject === meta.subject)
    .flatMap((exam) => currentScoreRows(exam).map((row) => ({
      source: "週考",
      grade: exam.grade,
      subject: normalizeCourseName(exam.subject),
      score: row.score,
      papers: row.papers,
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
    .filter((item) => includeAllGrades || meta.grade === "全部" || item.grade === meta.grade)
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

function classOpsWeeklyReportRows(meta = classOpsMeta(), date = $("#classOpsWeekDate")?.value || todayISO()) {
  const dates = new Set(weekDates(date));
  return classOpsWeeklyRows(meta)
    .filter((row) => dates.has(row.exam.date))
    .filter((row) => meta.subject === "全部" || row.subject === meta.subject)
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date) || a.subject.localeCompare(b.subject, "zh-Hant") || a.student.name.localeCompare(b.student.name, "zh-Hant"))
    .map((row) => ({
      date: row.exam.date,
      grade: row.grade,
      name: row.student.name,
      subject: row.exam.subject,
      scope: row.exam.scope || "-",
      papers: row.papers?.map(scoreDisplay).join(" / ") || scoreDisplay(row.score),
      average: row.score,
    }));
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

function classOpsEnrollmentHtml(meta) {
  const subjectList = meta.subject === "全部" ? courses : [meta.subject];
  const visibleGrades = meta.grade === "全部" ? grades : [meta.grade];
  const rows = visibleGrades.map((grade) => {
    const students = state.students.filter((student) => student.grade === grade);
    const cells = subjectList.map((subject) => {
      const count = students.filter((student) => studentTakesSubject(student, subject)).length;
      return `<td><strong>${count}</strong></td>`;
    }).join("");
    return `<tr><th>${grade}</th><td>${students.length}</td>${cells}</tr>`;
  }).join("");
  return `
    <div class="table-wrap compact-count-table">
      <table>
        <thead><tr><th>年級</th><th>總學生</th>${subjectList.map((subject) => `<th>${subject}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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

function chartGridLines(width, height, pad) {
  return [20, 40, 60, 80, 100].map((value) => {
    const y = height - pad - (value / 100) * (height - pad * 2);
    return `<g class="chart-grid-row">
      <line x1="${pad}" y1="${y.toFixed(1)}" x2="${width - pad}" y2="${y.toFixed(1)}" class="chart-grid-line"></line>
      <text x="${pad - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-y-label">${value}</text>
    </g>`;
  }).join("");
}

function classOpsTrendSvg(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!row.date || !Number.isFinite(row.score)) return;
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push(row.score);
  });
  const pointsData = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([date, values]) => ({ date, average: averageScore(values) }));
  if (pointsData.length < 2) return `<div class="empty small-empty">至少需要 2 個日期才會形成折線圖。</div>`;
  const width = 520;
  const height = 190;
  const pad = 54;
  const points = pointsData.map((item, index) => {
    const x = pad + index * (width - pad * 2) / Math.max(1, pointsData.length - 1);
    const y = height - pad - Math.max(0, Math.min(100, item.average)) / 100 * (height - pad * 2);
    return { ...item, x, y };
  });
  return `<svg class="score-line-chart class-ops-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="班級平均折線圖">
    ${chartGridLines(width, height, pad)}
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
    <polyline points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}" class="chart-line"></polyline>
    ${points.map((point) => `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" class="chart-dot"></circle><title>${dateLabel(point.date)} 平均 ${scoreDisplay(point.average)}</title></g>`).join("")}
    ${points.map((point, index) => index % 2 === 0 || index === points.length - 1 ? `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${dateLabel(point.date).slice(0, 5)}</text>` : "").join("")}
  </svg>`;
}

function classOpsBarSvg(stats) {
  const items = stats.filter((item) => item.count).sort((a, b) => b.average - a.average).slice(0, 10);
  if (!items.length) return `<div class="empty small-empty">尚無科目統計資料。</div>`;
  const max = Math.max(...items.map((item) => item.average || 0), 100);
  return `<div class="class-bar-chart" role="img" aria-label="各科平均長條圖">
    ${items.map((item) => {
      const width = Math.max(4, Math.min(100, (item.average || 0) / max * 100));
      return `<div class="class-bar-row">
        <span>${escapeHtml(item.subject)}</span>
        <i><b style="width:${width}%"></b></i>
        <strong>${scoreDisplay(item.average)}</strong>
      </div>`;
    }).join("")}
  </div>`;
}

function classOpsLatestPrSummary(meta, rows) {
  const sorted = rows.filter((row) => row.source === "週考" && row.exam && row.student)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  if (!latest) return { label: "-", detail: "尚無最新週考資料" };
  const sameExamRows = currentScoreRows(latest.exam);
  const prValues = sameExamRows.map((row) => examStatsForStudent(latest.exam, row.student.id).pr).filter(Number.isFinite);
  const median = prValues.length ? prValues.sort((a, b) => a - b)[Math.floor(prValues.length / 2)] : NaN;
  return {
    label: Number.isFinite(median) ? `PR ${scoreDisplay(median)}` : "-",
    detail: `${latest.exam.grade}｜${dateLabel(latest.exam.date)}｜${latest.exam.subject}｜${sameExamRows.length} 人`,
  };
}

function renderClassOps() {
  if (!$("#classOpsSummary")) return;
  renderLayerVisibility();
  if (classOpsSection !== "report") return;
  renderClassOpsFilters();
  if (grades.includes(classOpsSelectedGrade) && $("#classOpsGrade")) $("#classOpsGrade").value = classOpsSelectedGrade;
  const meta = classOpsMeta();
  const rows = classOpsRows(meta);
  const stats = classOpsSubjectStats(meta);
  const summary = summarizeScores(rows);
  const best = stats.filter((item) => item.count).sort((a, b) => b.average - a.average)[0];
  const weakest = stats.filter((item) => item.count).sort((a, b) => a.average - b.average)[0];
  const latestPr = classOpsLatestPrSummary(meta, rows);
  $("#classOpsSummary").innerHTML = `
    <article class="metric"><span>班級平均</span><strong>${scoreDisplay(summary.average)}</strong></article>
    <article class="metric"><span>及格率</span><strong>${scoreDisplay(summary.passRate)}%</strong></article>
    <article class="metric"><span>最新年級 PR</span><strong>${latestPr.label}</strong><small>${escapeHtml(latestPr.detail)}</small></article>
    <article class="metric"><span>優先補強</span><strong>${weakest ? weakest.subject : "-"}</strong><small>${best ? `優勢 ${best.subject}` : ""}</small></article>
  `;  if ($("#classOpsEnrollment")) $("#classOpsEnrollment").innerHTML = classOpsEnrollmentHtml(meta);
  if ($("#classOpsAiResult")) $("#classOpsAiResult").innerHTML = "";
  $("#classOpsRadar").innerHTML = classOpsRadarSvg(stats);
  $("#classOpsLevel").innerHTML = stats.filter((item) => item.count).map((item) => `
    <article class="level-row">
      <div><strong>${item.subject}</strong><span>班平均 ${scoreDisplay(item.average)}｜全體 ${scoreDisplay(item.benchmark)}</span></div>
      <b class="${item.gap >= 0 ? "positive-gap" : "negative-gap"}">${Number.isFinite(item.gap) ? `${item.gap >= 0 ? "+" : ""}${scoreDisplay(item.gap)}` : "-"}</b>
    </article>
  `).join("") || `<div class="empty">這個學年學期尚無可比較成績。</div>`;
  $("#classOpsSubjectAnalysis").innerHTML = `
    <div class="class-ops-chart-grid">
      <article class="analysis-card chart-card">
        <div class="analysis-card-head"><strong>班級平均折線</strong><b class="level-badge">趨勢</b></div>
        ${classOpsTrendSvg(rows)}
      </article>
      <article class="analysis-card chart-card">
        <div class="analysis-card-head"><strong>各科平均長條</strong><b class="level-badge">統計</b></div>
        ${classOpsBarSvg(stats)}
      </article>
    </div>
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
      <thead><tr><th>排名</th><th>班級</th><th class="left">姓名</th>${termSubjects.map((subject) => `<th>${escapeHtml(subject)}</th>`).join("")}<th>加權成績</th></tr></thead>
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
      <tr><th>排名</th><th>班級</th><th>姓名</th>${termSubjects.map((subject) => `<th>${escapeHtml(subject)}</th>`).join("")}<th>加權成績</th></tr>
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
    { label: "加權成績", width: 120 },
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
  const examRows = reportExamRows(student);
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
    .forEach((row) => subjects.add(row.exam.subject));
  return reportSubjects.filter((subject) => subjects.has(subject));
}

function activeReportPeriod() {
  const prefix = parentMode ? "parent" : "career";
  const value = $(`#${prefix}ReportRange`)?.value || "current";
  if (value !== "current") return null;
  const settings = normalizeAcademicSettings(state.settings || defaultAcademicSettings());
  return { academicYear: settings.academicYear, semester: settings.semester };
}

function activeReportConfig() {
  const prefix = parentMode ? "parent" : "career";
  const settings = activeAcademicPeriod();
  const mode = $(`#${prefix}ReportRange`)?.value || "current";
  const year = $(`#${prefix}ReportYear`)?.value || settings.academicYear;
  const semester = $(`#${prefix}ReportSemester`)?.value || settings.semester;
  const stage = $(`#${prefix}ReportStage`)?.value || "一段";
  const startDate = $(`#${prefix}ReportStartDate`)?.value || "";
  const endDate = $(`#${prefix}ReportEndDate`)?.value || "";
  return { mode, year, semester, stage, startDate, endDate };
}

function reportExamRows(student) {
  const config = activeReportConfig();
  let rows = studentExamRows(student, null);
  if (config.mode === "date-range") {
    rows = rows
      .filter((row) => !config.startDate || row.exam.date >= config.startDate)
      .filter((row) => !config.endDate || row.exam.date <= config.endDate);
  }
  if (config.mode === "year") {
    rows = rows.filter((row) => row.exam.academicYear === config.year);
  }
  if (config.mode === "semester") {
    rows = rows.filter((row) => row.exam.academicYear === config.year && row.exam.semester === config.semester);
  }
  if (config.mode === "term-stage") {
    const range = termPeriodRange({ year: config.year, semester: config.semester, grade: "全體", stage: config.stage });
    rows = rows
      .filter((row) => row.exam.academicYear === config.year && row.exam.semester === config.semester)
      .filter((row) => !range.startDate || row.exam.date >= range.startDate)
      .filter((row) => !range.endDate || row.exam.date <= range.endDate);
  }
  return rows;
}

function activeReportDetailRange() {
  const prefix = parentMode ? "parent" : "career";
  return $(`#${prefix}ReportDetailRange`)?.value || "period";
}

function reportDetailRows(student) {
  const mode = activeReportDetailRange();
  if (mode === "none") return [];
  let rows = mode === "period" ? reportExamRows(student) : studentExamRows(student, mode === "all" ? null : activeReportPeriod());
  if (mode === "30" || mode === "90") {
    const days = Number(mode);
    const since = addDays(todayISO(), -days);
    rows = studentExamRows(student, null).filter((row) => row.exam.date >= since);
  }
  return rows;
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
  const pad = 56;
  const points = chartRows.map((row, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, chartRows.length - 1);
    const y = height - pad - (Math.max(0, Math.min(100, row.score)) / 100) * (height - pad * 2);
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `
    <svg class="score-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="成績起伏折線圖">
      ${chartGridLines(width, height, pad)}
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
      <polyline points="${polyline}" class="chart-line"></polyline>
      ${points.map((point) => `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" class="chart-dot"></circle><title>${dateLabel(point.row.exam.date)} ${point.row.exam.subject} ${scoreDisplay(point.row.score)}</title></g>`).join("")}
      ${points.map((point, index) => index % 2 === 0 || index === points.length - 1 ? `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${dateLabel(point.row.exam.date).replace("（週", "\n").replace("）", "")}</text>` : "").join("")}
    </svg>
  `;
}

function studentRadarSvg(analyses) {
  const items = analyses.filter((item) => Number.isFinite(item.recentAvg)).slice(0, 8);
  if (items.length < 3) return `<div class="empty small-empty">至少需要 3 科成績才會形成雷達圖。</div>`;
  const cx = 150;
  const cy = 150;
  const radius = 102;
  const axis = items.map((item, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / items.length;
    return { item, angle, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
  const polygon = axis.map(({ item, angle }) => {
    const value = Math.max(0, Math.min(100, item.recentAvg || 0)) / 100 * radius;
    return `${cx + Math.cos(angle) * value},${cy + Math.sin(angle) * value}`;
  }).join(" ");
  return `<svg class="student-radar class-radar" viewBox="0 0 300 300" role="img" aria-label="學生各科雷達圖">
    ${[25, 50, 75, 100].map((value) => `<circle cx="${cx}" cy="${cy}" r="${radius * value / 100}" class="radar-ring"></circle>`).join("")}
    ${axis.map(({ x, y }) => `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis"></line>`).join("")}
    <polygon points="${polygon}" class="radar-area"></polygon>
    ${axis.map(({ item, x, y }) => `<text x="${x}" y="${y}" class="radar-label">${escapeHtml(item.subject)}</text>`).join("")}
  </svg>`;
}

function studentSubjectBarChart(analyses) {
  const items = analyses.filter((item) => Number.isFinite(item.recentAvg)).sort((a, b) => b.recentAvg - a.recentAvg);
  if (!items.length) return `<div class="empty small-empty">尚無科目統計資料。</div>`;
  return `<div class="class-bar-chart student-bar-chart" role="img" aria-label="學生各科近期平均長條圖">
    ${items.map((item) => `<div class="class-bar-row">
      <span>${escapeHtml(item.subject)}</span>
      <i><b style="width:${Math.max(4, Math.min(100, item.recentAvg || 0))}%"></b></i>
      <strong>${scoreDisplay(item.recentAvg)}</strong>
    </div>`).join("")}
  </div>`;
}

function studentWeakUnits(student, analyses = subjectPerformanceRows(student)) {
  const units = [];
  analyses.forEach((analysis) => {
    const grouped = new Map();
    analysis.rows
      .filter((row) => Number.isFinite(row.score) && row.score < 70)
      .forEach((row) => {
        const topic = weakTopicKey(row.exam.scope || "未填重點");
        const key = `${analysis.subject}|${topic}`;
        if (!grouped.has(key)) grouped.set(key, {
          subject: analysis.subject,
          topic,
          count: 0,
          total: 0,
          latestDate: "",
          examples: [],
        });
        const item = grouped.get(key);
        item.count += 1;
        item.total += row.score;
        item.latestDate = !item.latestDate || row.exam.date > item.latestDate ? row.exam.date : item.latestDate;
        if (row.exam.scope && item.examples.length < 3) item.examples.push(row.exam.scope);
      });
    units.push(...grouped.values());
  });
  return units
    .map((item) => ({ ...item, average: item.total / item.count }))
    .sort((a, b) => b.count - a.count || a.average - b.average || b.latestDate.localeCompare(a.latestDate));
}

function studentWeakUnitsHtml(student, analyses) {
  const weakSubjects = analyses
    .filter((item) => Number.isFinite(item.recentAvg))
    .sort((a, b) => a.recentAvg - b.recentAvg)
    .slice(0, 3);
  const units = studentWeakUnits(student, analyses).slice(0, 8);
  return `<section class="student-weak-panel">
    <div class="panel-title">
      <h2>弱點科目與單元</h2>
      <span>依歷史週考低於 70 分統整</span>
    </div>
    <div class="weak-topic-grid">
      ${weakSubjects.map((item) => `<article class="weak-topic-card">
        <strong>${escapeHtml(item.subject)}</strong>
        <span>近期平均 ${scoreDisplay(item.recentAvg)}｜最新 ${scoreDisplay(item.latest)}｜${escapeHtml(item.level)}</span>
        <small>${escapeHtml(item.note)}</small>
      </article>`).join("") || `<div class="empty">目前沒有可判斷的弱科資料。</div>`}
    </div>
    <div class="table-wrap student-weak-table">
      <table>
        <thead><tr><th>科目</th><th>弱點單元</th><th>低分次數</th><th>平均</th><th>最近測驗</th></tr></thead>
        <tbody>${units.map((unit) => `<tr>
          <td>${escapeHtml(unit.subject)}</td>
          <td>${escapeHtml(unit.topic)}</td>
          <td>${unit.count}</td>
          <td class="${scoreClass(unit.average)}">${scoreDisplay(unit.average)}</td>
          <td>${unit.latestDate ? dateLabel(unit.latestDate) : "-"}</td>
        </tr>`).join("") || `<tr><td colspan="5">尚未累積明顯弱點單元。</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function studentAiVisualStripHtml(student, analyses) {
  const weakUnits = studentWeakUnits(student, analyses).slice(0, 4);
  return `<div class="ai-visual-strip">
    <article class="analysis-card">
      <div class="analysis-card-head"><strong>各科雷達</strong><b class="level-badge">定位</b></div>
      ${studentRadarSvg(analyses)}
    </article>
    <article class="analysis-card">
      <div class="analysis-card-head"><strong>近期平均</strong><b class="level-badge">圖表</b></div>
      ${studentSubjectBarChart(analyses)}
    </article>
    <article class="analysis-card">
      <div class="analysis-card-head"><strong>AI 關注弱點</strong><b class="level-badge">補強</b></div>
      <div class="ai-weak-grid">${weakUnits.map((unit) => `
        <span class="ai-weak-chip">
          <em>${escapeHtml(unit.topic)}</em>
        </span>
      `).join("") || `<span class="ai-weak-chip empty-chip"><b>目前未累積明顯弱點單元</b></span>`}</div>
    </article>
  </div>`;
}

function studentReportVisualsHtml(student, analyses) {
  const scores = analyses.flatMap((item) => item.rows.map((row) => row.score).filter(Number.isFinite));
  const average = averageScore(scores);
  const lowCount = scores.filter((score) => score < 70).length;
  const highCount = scores.filter((score) => score >= 85).length;
  return `<section class="student-report-visuals">
    <article class="analysis-card chart-card">
      <div class="analysis-card-head"><strong>各科雷達圖</strong><b class="level-badge">能力面</b></div>
      ${studentRadarSvg(analyses)}
    </article>
    <article class="analysis-card chart-card">
      <div class="analysis-card-head"><strong>各科平均長條</strong><b class="level-badge">統計</b></div>
      ${studentSubjectBarChart(analyses)}
      <div class="student-stat-grid">
        <span>總平均 <b>${scoreDisplay(average)}</b></span>
        <span>高分筆數 <b>${highCount}</b></span>
        <span>低於70 <b>${lowCount}</b></span>
      </div>
    </article>
  </section>`;
}

function termScoreLineChart(rows) {
  const chartRows = rows.slice(-12);
  if (chartRows.length < 2) return `<div class="empty small-empty">至少需要 2 次段考成績才會形成折線圖。</div>`;
  const width = 640;
  const height = 220;
  const pad = 56;
  const points = chartRows.map((row, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, chartRows.length - 1);
    const y = height - pad - (Math.max(0, Math.min(100, Number(row.score))) / 100) * (height - pad * 2);
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `
    <svg class="score-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="段考成績起伏折線圖">
      ${chartGridLines(width, height, pad)}
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
      <polyline points="${polyline}" class="chart-line"></polyline>
      ${points.map((point) => `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" class="chart-dot"></circle><title>${point.row.term} ${point.row.stage} ${point.row.subject} ${scoreDisplay(Number(point.row.score))}</title></g>`).join("")}
      ${points.map((point) => `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${point.row.stage}</text>`).join("")}
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

function examStatsForStudent(exam, studentId) {
  const rows = currentScoreRows(exam);
  const current = rows.find((item) => item.student.id === studentId);
  const scores = rows.map((row) => row.score).filter(Number.isFinite);
  const average = averageScore(scores);
  const rank = current?.rank || "-";
  const pr = current && rows.length ? Math.round(((rows.length - current.rank + 1) / rows.length) * 100) : NaN;
  let segment = "資料不足";
  if (current && rows.length >= 3) {
    segment = pr >= 75 ? "前段" : pr <= 25 ? "後段" : "中段";
  } else if (current) {
    segment = "中段";
  }
  return {
    rank,
    pr,
    segment,
    count: rows.length,
    high: scores.length ? Math.max(...scores) : NaN,
    low: scores.length ? Math.min(...scores) : NaN,
    average,
  };
}

function examStatsInline(stats) {
  return `排名 ${stats.rank}｜PR ${scoreDisplay(stats.pr)}｜${stats.segment}｜班級 ${stats.count} 人｜最高 ${scoreDisplay(stats.high)}｜最低 ${scoreDisplay(stats.low)}｜班平均 ${scoreDisplay(stats.average)}`;
}

function careerScoreLookupHtml(student, queryDate, selectedSubject, options = {}) {
  if (!student) {
    return `<div class="empty">請先選擇學生。</div>`;
  }
  const period = options.period || null;
  const dates = weekDates(queryDate);
  const dateSet = new Set(dates);
  const weekRows = studentExamRows(student, period)
    .filter((row) => dateSet.has(row.exam.date))
    .filter((row) => studentTakesSubject(student, row.exam.subject))
    .filter((row) => selectedSubject === "全部" || row.exam.subject === selectedSubject)
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date) || a.exam.subject.localeCompare(b.exam.subject, "zh-Hant"));
  const termRows = state.termScores
    .filter((item) => item.studentId === student.id)
    .filter((item) => selectedSubject === "全部" || normalizeCourseName(item.subject) === selectedSubject);
  const subjectCardTitle = selectedSubject === "全部" ? "本週各科成績" : `本週${selectedSubject}成績`;
  return `
    <div class="lookup-result">
      <div class="week-browser-head">
        <button class="ghost" type="button" data-career-week="-1">上一週</button>
        <strong>${weekRangeLabel(queryDate)}</strong>
        <button class="ghost" type="button" data-career-week="1">下一週</button>
      </div>
      ${period ? `<span class="badge">${academicPeriodLabel(period)}</span>` : ""}
      <div class="weekly-score-grid">
        ${dates.map((date) => {
          const dateSubjects = scheduledSubjectsForStudentDate(student, date);
          const dayRows = weekRows.filter((row) => row.exam.date === date);
          return `<article class="weekly-score-day ${date === queryDate ? "is-current" : ""}">
            <div class="weekly-day-head">
              <strong>${dateLabel(date)}</strong>
              <span>${scheduledSubjectLabel(dateSubjects)}</span>
            </div>
            ${dayRows.map((row) => {
              const stats = examStatsForStudent(row.exam, student.id);
              return `<div class="score-result-card">
                <b>${row.exam.subject}</b>
                <span>${row.exam.scope || "未填重點"}</span>
                <strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong>
                <small>各卷 ${row.papers.map(scoreDisplay).join(" / ")}</small>
                <div class="score-stat-grid">
                  <span>排名 <b>${stats.rank}</b></span>
                  <span>PR <b>${scoreDisplay(stats.pr)}</b></span>
                  <span>定位 <b>${stats.segment}</b></span>
                  <span>班級 <b>${stats.count}人</b></span>
                  <span>最高 <b>${scoreDisplay(stats.high)}</b></span>
                  <span>最低 <b>${scoreDisplay(stats.low)}</b></span>
                  <span>班平均 <b>${scoreDisplay(stats.average)}</b></span>
                </div>
              </div>`;
            }).join("") || `<div class="empty small-empty">本日尚無成績。</div>`}
          </article>`;
        }).join("")}
      </div>
    </div>
    <section class="career-score-browser">
      <div class="browser-head">
        <strong>${subjectCardTitle}</strong>
        <span>${weekRows.length} 筆</span>
      </div>
      <div class="score-card-rail" aria-label="${subjectCardTitle}">
        ${weekRows.map((row) => {
          const stats = examStatsForStudent(row.exam, student.id);
          return `<article class="exam-mini-card">
            <div class="mini-card-top">
              <b>${row.exam.subject}</b>
              <strong class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</strong>
            </div>
            <span>${row.exam.scope || "未填考試單元"}</span>
            <div class="mini-card-meta">
              <small>${dateLabel(row.exam.date)}</small>
              <small>${stats.segment}</small>
            </div>
            <div class="mini-stat-grid">
              <span>排名 <b>${stats.rank}</b></span>
              <span>PR <b>${scoreDisplay(stats.pr)}</b></span>
              <span>班級 <b>${stats.count}人</b></span>
              <span>最高 <b>${scoreDisplay(stats.high)}</b></span>
              <span>最低 <b>${scoreDisplay(stats.low)}</b></span>
              <span>班平均 <b>${scoreDisplay(stats.average)}</b></span>
            </div>
          </article>`;
        }).join("") || `<div class="empty small-empty">本週尚無符合條件的週考紀錄。</div>`}
      </div>
    </section>
    ${options.hideDateHistory ? "" : `<div class="table-wrap career-history-table">
      <table>
        <thead><tr><th colspan="6">本週成績明細</th></tr></thead>
        <thead><tr><th>日期</th><th>科目</th><th>重點</th><th>各卷</th><th>平均</th><th>當天統計</th></tr></thead>
        <tbody>${weekRows.map((row) => {
          const stats = examStatsForStudent(row.exam, student.id);
          return `<tr><td>${dateLabel(row.exam.date)}</td><td>${row.exam.subject}</td><td>${row.exam.scope || "-"}</td><td>${row.papers.map(scoreDisplay).join(" / ")}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${examStatsInline(stats)}</td></tr>`;
        }).join("") || `<tr><td colspan="6">本週尚無成績</td></tr>`}</tbody>
      </table>
    </div>`}
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

function termPeriodGeneralKey(meta) {
  return termPeriodKey({ ...meta, grade: "全體" });
}

function termPeriodRange(meta) {
  const value = state.termPeriods?.[termPeriodKey(meta)] || state.termPeriods?.[termPeriodGeneralKey(meta)];
  if (typeof value === "string") return { startDate: "", endDate: value };
  return {
    startDate: value?.startDate || "",
    endDate: value?.endDate || "",
  };
}

function currentTermPeriodMeta() {
  return {
    year: $("#termPeriodYear")?.value || activeAcademicPeriod().academicYear,
    semester: $("#termPeriodSemester")?.value || activeAcademicPeriod().semester,
    grade: "全體",
  };
}

function renderTermPeriodSettings() {
  const target = $("#termPeriodStageRows");
  if (!target) return;
  const meta = currentTermPeriodMeta();
  target.innerHTML = termStages.map((stage) => {
    const range = termPeriodRange({ ...meta, stage });
    return `
      <article class="term-period-row">
        <strong>${stage}</strong>
        <label>開始
          <input type="date" data-term-period-start="${stage}" value="${range.startDate || ""}">
        </label>
        <label>結束
          <input type="date" data-term-period-end="${stage}" value="${range.endDate || ""}">
        </label>
      </article>
    `;
  }).join("");
}

function termPeriodGroups() {
  const groups = new Map();
  Object.entries(state.termPeriods || {}).forEach(([key, value]) => {
    const [year, semester, grade, stage] = key.split("|");
    if (!year || !semester || !stage) return;
    const groupKey = [year, semester, grade || "全體"].join("|");
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, year, semester, grade: grade || "全體", ranges: {} });
    groups.get(groupKey).ranges[stage] = typeof value === "string" ? { startDate: "", endDate: value } : value;
  });
  return [...groups.values()].sort((a, b) =>
    `${b.year}${b.semester}${b.grade}`.localeCompare(`${a.year}${a.semester}${a.grade}`, "zh-Hant")
  );
}

function renderTermPeriodList() {
  const target = $("#termPeriodList");
  if (!target) return;
  const groups = termPeriodGroups();
  target.innerHTML = groups.map((group) => `
    <article class="record-card term-period-card">
      <strong>${escapeHtml(group.year)}${escapeHtml(group.semester)}${group.grade === "全體" ? "" : ` ${escapeHtml(group.grade)}`}</strong>
      <div class="meta">
        ${termStages.map((stage) => {
          const range = group.ranges[stage] || {};
          return `<span class="badge">${stage}：${range.startDate || "-"} 到 ${range.endDate || "-"}</span>`;
        }).join("")}
      </div>
      <div class="action-row">
        <button class="ghost" type="button" data-edit-term-period="${group.key}">載入編輯</button>
        <button class="ghost danger" type="button" data-delete-term-period="${group.key}">刪除區間</button>
      </div>
    </article>
  `).join("") || `<div class="empty">尚未設定段考區間。</div>`;
}

function applyTermPeriodGroup(key) {
  const [year, semester] = String(key || "").split("|");
  if ($("#termPeriodYear")) $("#termPeriodYear").value = year || activeAcademicPeriod().academicYear;
  renderTermAcademicOptions();
  if ($("#termPeriodYear")) $("#termPeriodYear").value = year || $("#termPeriodYear").value;
  if ($("#termPeriodSemester")) $("#termPeriodSemester").value = semester || $("#termPeriodSemester").value;
  termSection = "periods";
}

function deleteTermPeriodGroup(key) {
  const [year, semester, grade = "全體"] = String(key || "").split("|");
  termStages.forEach((stage) => delete state.termPeriods[termPeriodKey({ year, semester, grade, stage })]);
}

function saveTermPeriodSettings(event) {
  event.preventDefault();
  const meta = currentTermPeriodMeta();
  termStages.forEach((stage) => {
    const startDate = $(`[data-term-period-start="${stage}"]`)?.value || "";
    const endDate = $(`[data-term-period-end="${stage}"]`)?.value || "";
    const key = termPeriodGeneralKey({ ...meta, stage });
    if (startDate || endDate) {
      state.termPeriods[key] = { startDate, endDate };
    } else {
      delete state.termPeriods[key];
    }
  });
  saveState();
  renderAll();
  flashButton(event.submitter, "已儲存");
}

function previousTermStage(meta) {
  const index = termStages.indexOf(meta.stage);
  return index > 0 ? termStages[index - 1] : "";
}

function termAnalysisRows(student, meta) {
  const range = termPeriodRange(meta);
  const endDate = range.endDate || "";
  if (!student || !endDate) return { endDate, previousDate: "", rows: [] };
  const previousStage = previousTermStage(meta);
  const fallbackStart = previousStage ? termPeriodRange({ ...meta, stage: previousStage }).endDate || "" : "";
  const startDate = range.startDate || fallbackStart;
  const rows = studentExamRows(student)
    .filter((row) => row.exam.subject !== "輔導")
    .filter((row) => row.exam.date <= endDate)
    .filter((row) => !startDate || row.exam.date >= startDate)
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));
  return { endDate, previousDate: startDate, rows };
}

function termScoreForSubject(student, meta, subject) {
  return state.termScores.find((item) =>
    item.studentId === student.id &&
    item.year === meta.year &&
    item.semester === meta.semester &&
    item.stage === meta.stage &&
    normalizeCourseName(item.subject) === normalizeCourseName(subject)
  );
}

function termAnalysisSubjectCards(student, meta, selectedSubject, rows) {
  const subjectSet = new Set([
    ...rows.map((row) => normalizeCourseName(row.exam.subject)),
    ...state.termScores
      .filter((item) => item.studentId === student.id && item.year === meta.year && item.semester === meta.semester && item.stage === meta.stage)
      .map((item) => normalizeCourseName(item.subject)),
  ]);
  return reportSubjects
    .filter((subject) => subjectSet.has(normalizeCourseName(subject)))
    .filter((subject) => selectedSubject === "全部" || normalizeCourseName(subject) === normalizeCourseName(selectedSubject))
    .map((subject) => {
      const subjectRows = rows.filter((row) => normalizeCourseName(row.exam.subject) === normalizeCourseName(subject));
      const analysis = subjectRows.length ? analyzeSubjectPerformance(subject, subjectRows) : null;
      const termScore = termScoreForSubject(student, meta, subject);
      const latestRow = subjectRows.at(-1);
      const latestStats = latestRow ? examStatsForStudent(latestRow.exam, student.id) : null;
      const weakRows = subjectRows.filter((row) => Number(row.score) < 70);
      const weakUnits = weakRows.map((row) => row.exam.scope || dateLabel(row.exam.date)).slice(-5);
      const termScoreValue = Number(termScore?.score);
      const level = Number.isFinite(termScoreValue) ? levelFromScore(termScoreValue) : (analysis?.level || "資料不足");
      const focus = weakUnits.length
        ? `段考備戰先補 ${weakUnits.join("、")}，再用同類題回測穩定度。`
        : subjectRows.length
          ? "段前週考未累積明顯低分單元，建議維持複習節奏並加強錯題整理。"
          : "目前此科段前週考資料不足，建議先補齊近期測驗紀錄後再判斷。";
      return { subject, subjectRows, analysis, termScore, termScoreValue, latestRow, latestStats, weakUnits, level, focus };
    });
}

function termAnalysisReportHtml(student, meta, selectedSubject) {
  if (!student) {
    return `<div class="empty">請先選擇學生。</div>`;
  }
  const { endDate, previousDate, rows } = termAnalysisRows(student, meta);
  if (!endDate) {
    return `<div class="empty">請先設定 ${meta.year}${meta.semester} ${meta.stage} 的段考區間。</div>`;
  }
  const filteredRows = rows.filter((row) => selectedSubject === "全部" || normalizeCourseName(row.exam.subject) === normalizeCourseName(selectedSubject));
  const subjectCards = termAnalysisSubjectCards(student, meta, selectedSubject, rows);
  const periodText = previousDate ? `${dateLabel(previousDate)} 之後至 ${dateLabel(endDate)}` : `${dateLabel(endDate)} 前`;
  return `
    <div class="report-head">
      <strong>${studentLabel(student)}｜${meta.year}${meta.semester} ${meta.stage}</strong>
      <span>${periodText}</span>
      <span>以段前週考配合段考成績、PR 與弱點單元分析</span>
    </div>
    <div class="term-analysis-card-grid">
      ${subjectCards.map((item) => `
        <article class="analysis-card term-analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${item.level}</b>
          </div>
          <div class="term-card-kpis">
            <span>段前週考 <b>${item.subjectRows.length}</b></span>
            <span>段考 <b class="${scoreClass(item.termScoreValue)}">${Number.isFinite(item.termScoreValue) ? scoreDisplay(item.termScoreValue) : "-"}</b></span>
            <span>最新 PR <b>${item.latestStats ? scoreDisplay(item.latestStats.pr) : "-"}</b></span>
            <span>班平均 <b>${item.latestStats ? scoreDisplay(item.latestStats.average) : "-"}</b></span>
          </div>
          ${item.subjectRows.length ? scoreLineChart(item.subjectRows) : `<div class="empty small-empty">此科尚無段前週考趨勢圖。</div>`}
          <div class="term-card-copy">
            <p><b>趨勢：</b>${item.analysis ? `${trendLabel(item.analysis.trend)}，近期平均 ${scoreDisplay(item.analysis.recentAvg)}，最新 ${scoreDisplay(item.analysis.latest)}。` : "段前週考資料不足。"}</p>
            <p><b>定位：</b>${item.latestStats ? `最近一次排名 ${item.latestStats.rank}，PR ${scoreDisplay(item.latestStats.pr)}，屬於${item.latestStats.segment}。` : "尚無可判斷 PR 的近期週考。"}</p>
            <p><b>備戰：</b>${escapeHtml(item.focus)}</p>
          </div>
          <div class="weak-chip-row">
            ${item.weakUnits.map((unit) => `<span>${escapeHtml(unit)}</span>`).join("") || `<span>暫無明顯低分單元</span>`}
          </div>
        </article>
      `).join("")}
      ${!subjectCards.length ? `<div class="empty">此段期間沒有符合補習科目的週考或段考紀錄。</div>` : ""}
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

function renderStudentReportHtml(student, subjectOverride = null, options = {}) {
  const subject = subjectOverride || selectedCareerSubject(student);
  const allAnalyses = subjectPerformanceRows(student);
  const analyses = allAnalyses.filter((item) => subject === "全部" || subject === "?券" || item.subject === subject);
  const latestRow = studentExamRows(student).at(-1);
  const latestStats = latestRow ? examStatsForStudent(latestRow.exam, student.id) : null;
  const levelSummary = analyses.length
    ? analyses.map((item) => `${item.subject} ${item.level}`).join("、")
    : "資料不足";
  const prLabel = latestStats
    ? `${latestRow.exam.grade} PR ${scoreDisplay(latestStats.pr)}｜排名 ${latestStats.rank}/${latestStats.count}｜班平均 ${scoreDisplay(latestStats.average)}`
    : "資料不足";
  const aiMode = options.autoAi ? "auto" : "manual";
  return `
    <div class="report-head">
      <strong>${studentLabel(student)}</strong>
      <span>修課科目：${studentCoursesLabel(student)}</span>
      <span>最新年級 PR：${prLabel}</span>
      <span>各科定位：${levelSummary}</span>
    </div>
    ${studentReportVisualsHtml(student, analyses)}
    ${studentWeakUnitsHtml(student, analyses)}
    <div class="analysis-grid">
      ${analyses.map((item) => {
        const weakUnits = studentWeakUnits(student, [item]).slice(0, 3);
        return `
        <article class="analysis-card subject-analysis-card">
          <div class="analysis-card-head">
            <strong>${item.subject}</strong>
            <b class="level-badge">${item.level}</b>
          </div>
          <span>近期平均 ${scoreDisplay(item.recentAvg)}｜長期平均 ${scoreDisplay(item.longAvg)}｜最新 ${scoreDisplay(item.latest)}</span>
          <small>${trendLabel(item.trend)}｜${stabilityLabel(item.range)}｜累積 ${item.count} 筆</small>
          ${scoreLineChart(item.rows)}
          <p><b>分析：</b>${item.note}</p>
          <p><b>弱點：</b>${weakUnits.length ? weakUnits.map((unit) => `${unit.topic}（${unit.count}次）`).join("、") : "目前未累積明顯弱點單元。"}</p>
        </article>`;
      }).join("")}
      ${!analyses.length ? `<div class="empty">尚無可分析的成績紀錄。</div>` : ""}
    </div>
    ${options.hideAi ? "" : `<section class="ai-analysis-panel compact-ai-panel" data-ai-mode="${aiMode}" data-ai-student-panel="${student.id}">
      <div class="panel-title">
        <h2 class="${options.autoAi ? "parent-report-notice-title" : ""}">${options.autoAi ? "若需詳細報告請與老師作申請，會幫孩子製作詳細紙本報告" : "AI 學習分析"}</h2>
        <span>${options.autoAi ? `金牌躍騰平鎮分校 學生：${escapeHtml(student.name)} 學習摘要` : "依真實成績、PR 與弱點單元生成"}</span>
      </div>
      ${options.autoAi ? studentAiVisualStripHtml(student, analyses) : ""}
      ${options.autoAi ? "" : `<button class="primary" type="button" data-ai-student="${student.id}">產生 AI 分析</button>`}
      <div class="ai-analysis-result">${aiConfigured() ? `<div class="empty">${options.autoAi ? "正在準備 AI 分析..." : "按下按鈕後產生真實 AI 分析。"}</div>` : `<div class="empty">尚未設定 Gemini API Key。</div>`}</div>
    </section>`}
  `;
}function pdfDocument(title, body, layout = "portrait") {
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
    body { margin: 0; color: #161616; background: #f3ead6; font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif; }
    .sheet { width: 100%; }
    .doc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 3px solid #b9872f; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand img { width: 54px; height: 54px; object-fit: cover; border-radius: 50%; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
    h2 { margin: 14px 0 8px; font-size: 17px; color: #7a551a; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .pill { border: 1px solid #d8c291; border-radius: 999px; padding: 6px 10px; font-size: 13px; background: #fff9ea; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { background: #181818; color: #f7df9b; }
    th, td { border: 1px solid #cfcfcf; padding: 6px 6px; text-align: center; }
    td.left, th.left { text-align: left; }
    .fail-score { color: #e60012; font-weight: 900; }
    .absent-score { color: #9a3412; font-weight: 800; }
    .summary { margin-top: 12px; line-height: 1.75; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px; }
    .card { border: 1px solid #d8c291; padding: 10px; border-radius: 6px; break-inside: avoid; }
    .card strong { display: block; margin-bottom: 5px; color: #7a551a; }
    .level { display: inline-block; min-width: 46px; padding: 3px 8px; border-radius: 999px; color: #161616; background: #f3c75f; font-weight: 900; text-align: center; }
    .pdf-page { break-after: page; page-break-after: always; }
    .pdf-page:last-child { break-after: auto; page-break-after: auto; }
    .student-report { color: #1f252d; padding: 10px; border-radius: 12px; background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(255,249,234,.96)); }
    .student-hero { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 16px; border-radius: 10px; color: #fff7df; background: linear-gradient(135deg, #11151a, #2a3039 62%, #9a7330); }
    .student-hero h1 { font-size: 28px; margin-bottom: 8px; }
    .student-hero .subtitle { color: #f7df9b; font-size: 15px; }
    .student-hero .stamp { display: grid; place-content: center; min-width: 118px; padding: 12px; border: 1px solid rgba(255,255,255,.26); border-radius: 8px; text-align: center; }
    .student-hero .stamp b { display: block; font-size: 22px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
    .kpi { padding: 9px; border: 1px solid #e1d0a3; border-radius: 8px; background: #fffaf0; }
    .kpi span { display: block; color: #755927; font-size: 12px; margin-bottom: 4px; }
    .kpi strong { font-size: 21px; }
    .report-section { margin-top: 12px; break-inside: auto; }
    .section-title { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; color: #7a551a; font-size: 17px; }
    .section-title::before { content: ""; width: 7px; height: 20px; border-radius: 999px; background: #b9872f; }
    .subject-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .subject-card { padding: 10px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fffdf7; break-inside: avoid; }
    .subject-card header { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .subject-card h3 { margin: 0; font-size: 16px; }
    .subject-card p { margin: 8px 0 0; line-height: 1.6; }
    .subject-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; font-size: 12px; }
    .subject-metrics span { padding: 7px; border-radius: 6px; background: #f6efd9; }
    .recommendation { padding: 12px 14px; border-left: 5px solid #b9872f; background: #fff9ea; line-height: 1.75; }
    .report-table { font-size: 12px; }
    .report-table th { background: #2a3039; }
    .report-head { display: grid; gap: 6px; padding: 14px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fff9ea; margin: 14px 0; }
    .report-head strong { font-size: 20px; color: #7a551a; }
    .student-report-visuals { display: grid; grid-template-columns: .85fr 1.15fr; gap: 8px; margin: 10px 0; break-inside: avoid; }
    .analysis-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
    .analysis-card { padding: 9px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fffdf7; break-inside: avoid; }
    .analysis-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .level-badge { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #f3c75f; font-weight: 900; }
    .score-line-chart, .class-radar { width: 100%; max-height: 150px; }
    .radar-ring, .radar-axis, .chart-axis, .chart-pass { fill: none; stroke: #d8c291; stroke-width: 1.2; }
    .chart-grid-line { fill: none; stroke: rgba(255,255,255,.72); stroke-width: 1; }
    .radar-area { fill: rgba(49, 208, 112, .18); stroke: #159947; stroke-width: 2.4; }
    .radar-label, .chart-label, .chart-mark { fill: #755927; font-size: 11px; font-weight: 800; }
    .chart-y-label { fill: #ffffff; font-size: 11px; font-weight: 800; }
    .chart-line { fill: none; stroke: #159947; stroke-width: 3; }
    .chart-dot { fill: #b9872f; }
    .chart-pass { stroke-dasharray: 5 5; }
    .class-bar-chart { display: grid; gap: 7px; margin-top: 6px; }
    .class-bar-row { display: grid; grid-template-columns: 58px 1fr 42px; gap: 8px; align-items: center; font-size: 12px; }
    .class-bar-row i { height: 8px; overflow: hidden; border-radius: 99px; background: #efe4c5; }
    .class-bar-row b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #159947, #b9872f); }
    .student-stat-grid, .weak-topic-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
    .student-stat-grid span, .weak-topic-card { padding: 8px; border: 1px solid #dfcfaa; border-radius: 7px; background: #fff9ea; }
    .weak-topic-card strong, .weak-topic-card span, .weak-topic-card small { display: block; margin-bottom: 4px; }
    .segment-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .segment-card { padding: 10px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fffdf7; break-inside: avoid; }
    .segment-card p { margin: 6px 0; line-height: 1.55; }
    .segment-card ul { margin: 6px 0 0; padding-left: 16px; }
    .segment-card li { margin-bottom: 5px; }
    .segment-card li span { display: block; font-size: 11px; color: #755927; }
    .subject-bar { height: 7px; border-radius: 99px; background: #efe4c5; overflow: hidden; margin-top: 8px; }
    .subject-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #159947, #b9872f); }
    .student-weak-panel { margin: 12px 0; padding: 12px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fffdf7; break-inside: avoid; }
    .student-weak-table table { font-size: 11px; }
    .ai-analysis-panel { display: none; }
    .report-cover { min-height: 252mm; display: grid; align-content: center; justify-items: center; gap: 18px; text-align: center; color: #fff7df; background:
      linear-gradient(135deg, rgba(247, 223, 155, .14) 0 1px, transparent 1px 24px),
      linear-gradient(28deg, transparent 0 60%, rgba(185, 135, 47, .22) 60% 60.5%, transparent 60.5%),
      linear-gradient(135deg, #080c11, #202632 56%, #9a7330);
      border-radius: 14px; padding: 24mm 18mm; page-break-after: always; break-after: page; position: relative; overflow: hidden; }
    .report-cover::before { content: ""; position: absolute; inset: 18px; border: 1px solid rgba(247, 223, 155, .45); border-radius: 12px; }
    .report-cover img { width: 158px; height: 158px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 7px rgba(247, 223, 155, .2); }
    .report-cover h1 { font-size: 38px; color: #f7df9b; }
    .report-cover h2 { margin: 0; font-size: 34px; color: #fff7df; }
    .teacher-message-page { min-height: 246mm; padding: 16mm; border: 2px solid #b9872f; border-radius: 12px; page-break-before: always; break-before: page; }
    .message-lines { display: grid; gap: 18px; margin-top: 24px; }
    .message-lines i { display: block; height: 28px; border-bottom: 1px solid #c9b16f; }
    .ai-detail-page { padding: 10px; color: #1f252d; background: linear-gradient(145deg, rgba(255,255,255,.94), rgba(255,249,234,.96)); }
    .ai-detail-page .ai-visual-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
    .ai-detail-page .ai-answer-card { padding: 12px; border: 1px solid #dfcfaa; border-radius: 8px; background: #fffdf7; color: #1f252d; line-height: 1.65; }
    .ai-detail-page .ai-answer-card h2, .ai-detail-page .ai-answer-card h3 { color: #7a551a; margin: 10px 0 6px; }
    .ai-detail-page .class-radar, .ai-detail-page .score-line-chart { max-height: 118px; }
    .ai-weak-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .ai-weak-chip { display: grid; gap: 2px; padding: 7px; border: 1px solid #dfcfaa; border-radius: 7px; background: #fff9ea; }
    .ai-weak-chip b { color: #7a551a; font-size: 11px; }
    .ai-weak-chip em { color: #1f252d; font-size: 12px; font-style: normal; overflow-wrap: anywhere; }
    .ai-weak-chip strong { color: #111; font-size: 14px; }
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
  const reportTitle = branchReportTitle();
  const scope = exam.scope ? `重點：${escapeHtml(exam.scope)}` : "未填考試重點";
  if (exam.noExam) {
    pdfDocument(title, `
      <header class="doc-head">
        <div class="brand"><img src="assets/logo.png" alt=""><div><h1>${escapeHtml(reportTitle)}</h1><div>${escapeHtml(dateLabel(exam.date))} ${escapeHtml(exam.grade)} ${escapeHtml(exam.subject)}</div></div></div>
      </header>
      <div class="meta"><span class="pill">無考試</span><span class="pill">${scope}</span></div>
    `, "portrait");
    return;
  }
  const { average, paperCount, reportRows } = classReportData(exam);
  const layout = paperCount > 2 ? "landscape" : "portrait";
  const rowsPerPage = layout === "landscape" ? 15 : 22;
  const rowPages = chunkArray(reportRows, rowsPerPage);
  const pages = rowPages.length ? rowPages : [[]];
  const totalPages = pages.length;
  const tableHead = `<thead><tr><th>排名</th><th class="left">姓名</th><th>班級</th><th>科目</th>${Array.from({ length: paperCount }, (_, index) => `<th>卷${index + 1}</th>`).join("")}<th>平均</th></tr></thead>`;
  const rowHtml = ({ student, ranked, absent }) => `
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
  `;
  const pagesHtml = pages.map((pageRows, pageIndex) => `
    <section class="pdf-page">
      <header class="doc-head">
        <div class="brand"><img src="assets/logo.png" alt=""><div><h1>${escapeHtml(reportTitle)}</h1><div>${escapeHtml(dateLabel(exam.date))} ${escapeHtml(exam.grade)} ${escapeHtml(exam.subject)}</div></div></div>
        <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
      </header>
      <div class="meta">
        <span class="pill">班平均 ${scoreDisplay(average)}</span>
        <span class="pill">${paperCount} 份考卷</span>
        <span class="pill">${scope}</span>
        <span class="pill">各卷：${escapeHtml((exam.paperTopics || []).filter(Boolean).join(" / ") || "未填各卷主題")}</span>
        <span class="pill">第 ${pageIndex + 1} / ${totalPages} 頁</span>
      </div>
      <table>
        ${tableHead}
        <tbody>${pageRows.map(rowHtml).join("") || `<tr><td colspan="${5 + paperCount}">尚無成績</td></tr>`}</tbody>
      </table>
    </section>
  `).join("");
  pdfDocument(title, `
    ${pagesHtml}
  `, layout);
}

function printClassOpsWeeklyReportPdf() {
  const meta = classOpsMeta();
  const rows = classOpsRows(meta);
  const stats = classOpsSubjectStats(meta);
  const summary = summarizeScores(rows);
  const weakUnits = classOpsWeakUnits(meta);
  const weakHistory = classOpsWeakHistory(meta);
  const best = stats.filter((item) => item.count).sort((a, b) => b.average - a.average)[0];
  const weakest = stats.filter((item) => item.count).sort((a, b) => a.average - b.average)[0];
  const latestPr = classOpsLatestPrSummary(meta, rows);
  const title = `${meta.grade} 班級經營分析報告`;
  const reportTitle = `${branchReportTitle().replace("班級成績單", "").trim()} ${meta.grade} 班級經營分析報告`.trim();
  const subjectLabel = meta.subject === "全部" ? "全部科目" : meta.subject;
  const semesterLabel = meta.semester === "全部" ? "全部學期" : meta.semester;
  const statRows = stats.filter((item) => item.count);
  const weakUnitRows = weakUnits.slice(0, 10);
  const body = `
    <header class="doc-head">
      <div class="brand"><img src="assets/logo.png" alt=""><div><h1>${escapeHtml(reportTitle)}</h1><div>${escapeHtml(meta.year)} ${escapeHtml(semesterLabel)}｜${escapeHtml(subjectLabel)}</div></div></div>
      <div>列印日期：${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
    </header>
    <div class="meta">
      <span class="pill">${escapeHtml(meta.year)} ${escapeHtml(semesterLabel)}</span>
      <span class="pill">${escapeHtml(meta.grade)}</span>
      <span class="pill">${escapeHtml(subjectLabel)}</span>
      <span class="pill">資料 ${rows.length} 筆</span>
    </div>
    <section class="grid">
      <article class="card"><strong>班級平均</strong><span class="level">${scoreDisplay(summary.average)}</span></article>
      <article class="card"><strong>及格率</strong><span class="level">${scoreDisplay(summary.passRate)}%</span></article>
      <article class="card"><strong>最新年級 PR</strong><span class="level">${escapeHtml(latestPr.label)}</span><p>${escapeHtml(latestPr.detail)}</p></article>
      <article class="card"><strong>優先補強</strong><span class="level">${escapeHtml(weakest?.subject || "-")}</span><p>${best ? `優勢科目：${escapeHtml(best.subject)}` : "尚無足夠科目資料"}</p></article>
    </section>
    <section class="report-section">
      <h2 class="section-title">圖表分析</h2>
      <div class="student-report-visuals">
        <article class="analysis-card">
          <div class="analysis-card-head"><strong>整班雷達</strong><b class="level-badge">各科平均</b></div>
          ${classOpsRadarSvg(stats)}
        </article>
        <article class="analysis-card">
          <div class="analysis-card-head"><strong>班級平均折線</strong><b class="level-badge">趨勢</b></div>
          ${classOpsTrendSvg(rows)}
        </article>
      </div>
      <article class="analysis-card">
        <div class="analysis-card-head"><strong>各科平均長條</strong><b class="level-badge">統計</b></div>
        ${classOpsBarSvg(stats)}
      </article>
    </section>
    <section class="report-section">
      <h2 class="section-title">各科狀況</h2>
      <table class="report-table">
        <thead><tr><th>科目</th><th>平均</th><th>及格率</th><th>低於 70</th><th>最高</th><th>最低</th><th>資料量</th></tr></thead>
        <tbody>${statRows.map((item) => `<tr><td>${escapeHtml(item.subject)}</td><td class="${scoreClass(item.average)}">${scoreDisplay(item.average)}</td><td>${scoreDisplay(item.passRate)}%</td><td>${scoreDisplay(item.lowRate)}%</td><td>${scoreDisplay(item.high)}</td><td>${scoreDisplay(item.low)}</td><td>${item.count}</td></tr>`).join("") || `<tr><td colspan="7">目前沒有符合條件的班級成績。</td></tr>`}</tbody>
      </table>
    </section>
    <section class="report-section">
      <h2 class="section-title">前中後段生與協助方向</h2>
      ${classOpsSegmentReport(meta)}
    </section>
    <section class="report-section">
      <h2 class="section-title">弱點科目與弱點單元</h2>
      <div class="weak-topic-grid">
        ${weakHistory.map((topic) => `<article class="weak-topic-card"><strong>${escapeHtml(topic.subject)}｜${escapeHtml(topic.topic)}</strong><span>歷史平均 ${scoreDisplay(topic.average)}｜低分 ${topic.lowCount} / ${topic.count}</span><small>${topic.examples.map(escapeHtml).join("、")}</small></article>`).join("") || `<article class="weak-topic-card"><strong>目前沒有明顯弱點單元</strong><span>週考範圍累積後會自動整理。</span></article>`}
      </div>
      <table class="report-table">
        <thead><tr><th>科目</th><th class="left">弱點單元</th><th>平均</th><th>低分次數</th><th>最近測驗</th></tr></thead>
        <tbody>${weakUnitRows.map((unit) => `<tr><td>${escapeHtml(unit.subject)}</td><td class="left">${escapeHtml(unit.scope)}</td><td class="${scoreClass(unit.average)}">${scoreDisplay(unit.average)}</td><td>${unit.lowCount} / ${unit.count}</td><td>${unit.latestDate ? dateLabel(unit.latestDate) : "-"}</td></tr>`).join("") || `<tr><td colspan="5">目前沒有明顯弱點單元。</td></tr>`}</tbody>
      </table>
    </section>
  `;
  pdfDocument(title, body, "portrait");
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

function canvasWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const chars = [...String(text ?? "")];
  const lines = [];
  let line = "";
  chars.forEach((char) => {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  visible.forEach((item, index) => canvasText(ctx, index === maxLines - 1 && lines.length > maxLines ? `${item.slice(0, -1)}…` : item, x, y + index * lineHeight, maxWidth));
  return y + visible.length * lineHeight;
}

function studentReportFileName(student, pageIndex = null) {
  const suffix = pageIndex === null ? "" : `_第${pageIndex}頁`;
  return `${student.name}_學生生涯報告${suffix}.png`;
}

function drawStudentReportGeometry(ctx, width, height) {
  ctx.save();
  ctx.fillStyle = "#f7f1e3";
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = .55;
  ctx.fillStyle = "#efe0b8";
  ctx.beginPath();
  ctx.moveTo(width - 210, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, 250);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = .42;
  ctx.fillStyle = "#d7b766";
  ctx.beginPath();
  ctx.moveTo(0, height - 220);
  ctx.lineTo(260, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = .18;
  ctx.strokeStyle = "#9a7330";
  ctx.lineWidth = 1;
  for (let x = -120; x < width + 120; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 260, height);
    ctx.stroke();
  }
  ctx.globalAlpha = .28;
  ctx.strokeStyle = "#11151a";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, width - 56, height - 56);
  ctx.globalAlpha = .22;
  ctx.fillStyle = "#11151a";
  [120, 410, 690].forEach((x, index) => {
    ctx.beginPath();
    ctx.arc(x, 960 - index * 92, 34 + index * 8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function downloadStudentReportImage(student = getStudent($("#careerStudent")?.value)) {
  if (!student) return alert("請先選擇學生。");
  const examRows = studentExamRows(student);
  const analyses = subjectPerformanceRows(student);
  const scores = examRows.map((row) => row.score).filter(Number.isFinite);
  const recentScores = examRows.slice(-6).map((row) => row.score).filter(Number.isFinite);
  const recentAverage = averageScore(recentScores);
  const overallAverage = averageScore(scores);
  const latestRow = examRows.at(-1);
  const latestStats = latestRow ? examStatsForStudent(latestRow.exam, student.id) : null;
  const strongest = analyses.slice().sort((a, b) => b.recentAvg - a.recentAvg)[0];
  const priority = analyses.slice().sort((a, b) => a.recentAvg - b.recentAvg)[0];
  const reportTitle = studentReportTitle();
  const scale = 2;
  const width = 794;
  const height = 1123;
  const margin = 46;
  const tableRows = examRows.slice().reverse();
  const historyPages = chunkArray(tableRows, 18);
  const totalPages = Math.max(1, 1 + historyPages.length);

  const makeCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    drawStudentReportGeometry(ctx, width, height);
    return { canvas, ctx };
  };

  const drawFooter = (ctx, page) => {
    ctx.fillStyle = "#76623a";
    ctx.font = "13px Microsoft JhengHei, Arial";
    canvasText(ctx, "本報告依週考、段考與趨勢輔助判讀，實際輔導仍以課堂狀況與訂正品質為準。", margin, height - 24, width - margin * 2 - 80);
    canvasText(ctx, `${page}/${totalPages}`, width - margin - 44, height - 24, 44);
  };

  const { canvas, ctx } = makeCanvas();
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#11151a");
  gradient.addColorStop(.62, "#2a3039");
  gradient.addColorStop(1, "#9a7330");
  ctx.fillStyle = gradient;
  drawRoundRect(ctx, margin, 38, width - margin * 2, 142, 14);
  ctx.fill();
  ctx.fillStyle = "#f5d47a";
  ctx.font = "bold 30px Microsoft JhengHei, Arial";
  canvasText(ctx, reportTitle, margin + 24, 82, width - margin * 2 - 48);
  ctx.fillStyle = "#fff7df";
  ctx.font = "18px Microsoft JhengHei, Arial";
  canvasText(ctx, `${studentLabel(student)}｜補習科目：${studentCoursesLabel(student)}`, margin + 24, 118, width - margin * 2 - 48);
  ctx.font = "14px Microsoft JhengHei, Arial";
  canvasText(ctx, `產出日期：${new Date().toLocaleDateString("zh-TW")}`, margin + 24, 150, 260);

  const kpis = [
    ["近期週考平均", scoreDisplay(recentAverage)],
    ["歷程總平均", scoreDisplay(overallAverage)],
    ["最新成績", latestRow ? `${latestRow.exam.subject} ${scoreDisplay(latestRow.score)}` : "-"],
    ["最新定位", latestStats ? `${latestStats.segment}｜PR ${scoreDisplay(latestStats.pr)}` : "-"],
  ];
  const kpiY = 204;
  const kpiW = (width - margin * 2 - 24) / 4;
  kpis.forEach(([label, value], index) => {
    const x = margin + index * (kpiW + 8);
    ctx.fillStyle = "#fffaf0";
    drawRoundRect(ctx, x, kpiY, kpiW, 76, 8);
    ctx.fill();
    ctx.strokeStyle = "#e1d0a3";
    ctx.stroke();
    ctx.fillStyle = "#755927";
    ctx.font = "12px Microsoft JhengHei, Arial";
    canvasText(ctx, label, x + 12, kpiY + 25, kpiW - 24);
    ctx.fillStyle = "#1f252d";
    ctx.font = "bold 19px Microsoft JhengHei, Arial";
    canvasWrappedText(ctx, value, x + 12, kpiY + 52, kpiW - 24, 20, 1);
  });

  let y = 318;
  ctx.fillStyle = "#7a551a";
  ctx.font = "bold 18px Microsoft JhengHei, Arial";
  canvasText(ctx, "顧問摘要", margin, y, 160);
  y += 18;
  ctx.fillStyle = "#fff9ea";
  ctx.fillRect(margin, y, width - margin * 2, 76);
  ctx.fillStyle = "#1f252d";
  ctx.font = "14px Microsoft JhengHei, Arial";
  const suggestion = priority ? `前中後段定位依每次週考當天排名判斷。優先追蹤 ${priority.subject}：${priority.note} 建議下一週鎖定錯題與低分單元，搭配短測確認是否回穩。` : "目前週考資料不足，建議先建立每週固定成績紀錄。";
  canvasWrappedText(ctx, suggestion, margin + 14, y + 24, width - margin * 2 - 28, 21, 3);

  if (latestStats) {
    y += 94;
    ctx.fillStyle = "#fffdf7";
    drawRoundRect(ctx, margin, y, width - margin * 2, 58, 8);
    ctx.fill();
    ctx.strokeStyle = "#dfcfaa";
    ctx.stroke();
    ctx.fillStyle = "#1f252d";
    ctx.font = "bold 15px Microsoft JhengHei, Arial";
    canvasText(ctx, `最近一次當天統計：最高 ${scoreDisplay(latestStats.high)}｜最低 ${scoreDisplay(latestStats.low)}｜班平均 ${scoreDisplay(latestStats.average)}｜排名 ${latestStats.rank}｜PR ${scoreDisplay(latestStats.pr)}｜班級 ${latestStats.count} 人｜${latestStats.segment}`, margin + 14, y + 36, width - margin * 2 - 28);
  }

  y += latestStats ? 92 : 112;
  ctx.fillStyle = "#7a551a";
  ctx.font = "bold 18px Microsoft JhengHei, Arial";
  canvasText(ctx, "各科概況", margin, y, 160);
  y += 16;
  const cardW = (width - margin * 2 - 12) / 2;
  analyses.slice(0, 6).forEach((item, index) => {
    const x = margin + (index % 2) * (cardW + 12);
    const cy = y + Math.floor(index / 2) * 126;
    ctx.fillStyle = "#fffdf7";
    drawRoundRect(ctx, x, cy, cardW, 110, 8);
    ctx.fill();
    ctx.strokeStyle = "#dfcfaa";
    ctx.stroke();
    ctx.fillStyle = "#1f252d";
    ctx.font = "bold 16px Microsoft JhengHei, Arial";
    canvasText(ctx, `${item.subject}｜${item.level}`, x + 12, cy + 26, cardW - 24);
    ctx.font = "13px Microsoft JhengHei, Arial";
    canvasText(ctx, `近期 ${scoreDisplay(item.recentAvg)}｜長期 ${scoreDisplay(item.longAvg)}｜最新 ${scoreDisplay(item.latest)}`, x + 12, cy + 52, cardW - 24);
    canvasWrappedText(ctx, item.note, x + 12, cy + 76, cardW - 24, 17, 2);
  });
  drawFooter(ctx, 1);
  canvas.toBlob((blob) => blob && downloadBlob(blob, "image/png", studentReportFileName(student, totalPages > 1 ? 1 : null)), "image/png");

  historyPages.forEach((pageRows, pageIndex) => {
    const { canvas: pageCanvas, ctx: pageCtx } = makeCanvas();
    pageCtx.fillStyle = "#11151a";
    pageCtx.fillRect(0, 0, width, 72);
    pageCtx.fillStyle = "#f5d47a";
    pageCtx.font = "bold 22px Microsoft JhengHei, Arial";
    canvasText(pageCtx, `${student.name} 週考紀錄`, margin, 44, 360);
    pageCtx.fillStyle = "#fff7df";
    pageCtx.font = "14px Microsoft JhengHei, Arial";
    canvasText(pageCtx, reportTitle, width - margin - 250, 44, 250);
    const cols = [68, 58, 134, 80, 48, 42, 42, 44, 44, 44, 54];
    const headers = ["日期", "科目", "重點", "各卷", "平均", "排名", "PR", "人數", "最高", "最低", "班平均"];
    let x = margin;
    let ty = 104;
    pageCtx.fillStyle = "#2a3039";
    pageCtx.fillRect(margin, ty, width - margin * 2, 34);
    pageCtx.fillStyle = "#f7df9b";
    pageCtx.font = "bold 13px Microsoft JhengHei, Arial";
    headers.forEach((header, index) => {
      canvasText(pageCtx, header, x + 8, ty + 22, cols[index] - 10);
      x += cols[index];
    });
    ty += 34;
    pageRows.forEach((row, rowIndex) => {
      x = margin;
      pageCtx.fillStyle = rowIndex % 2 ? "#f4ead2" : "#fffaf0";
      pageCtx.fillRect(margin, ty, width - margin * 2, 42);
      pageCtx.fillStyle = "#1f252d";
      pageCtx.font = "13px Microsoft JhengHei, Arial";
      const stats = examStatsForStudent(row.exam, student.id);
      const values = [dateLabel(row.exam.date), row.exam.subject, row.exam.scope || "-", row.papers.map(scoreDisplay).join(" / "), scoreDisplay(row.score), stats.rank, scoreDisplay(stats.pr), stats.count, scoreDisplay(stats.high), scoreDisplay(stats.low), scoreDisplay(stats.average)];
      values.forEach((value, index) => {
        if (index === 4 && row.score < 60) pageCtx.fillStyle = "#e60012";
        canvasText(pageCtx, value, x + 8, ty + 26, cols[index] - 10);
        pageCtx.fillStyle = "#1f252d";
        x += cols[index];
      });
      ty += 42;
    });
    drawFooter(pageCtx, pageIndex + 2);
    pageCanvas.toBlob((blob) => blob && downloadBlob(blob, "image/png", studentReportFileName(student, pageIndex + 2)), "image/png");
  });
}

function downloadClassReportImage() {
  const exam = displayedClassReportExam();
  if (!exam) return alert("尚無成績單可匯出。");
  const { average, paperCount, rows } = classReportExportRows(exam);
  const landscape = paperCount > 2;
  const scale = 2;
  const width = landscape ? 1123 : 794;
  const height = landscape ? 794 : 1123;
  const margin = landscape ? 44 : 42;
  const rowHeight = landscape ? 34 : 39;
  const headerBandHeight = landscape ? 190 : 232;
  const tableY = landscape ? 226 : 278;
  const footerHeight = 46;
  const tableHeaderHeight = 42;
  const rowsPerPage = Math.max(1, Math.floor((height - tableY - tableHeaderHeight - footerHeight - 18) / rowHeight));
  const pages = rows.length ? chunkArray(rows, rowsPerPage) : [[]];
  const totalPages = pages.length;
  const baseFileName = classReportFileName(exam, "png").replace(/\.png$/i, "");
  const reportTitle = branchReportTitle();

  pages.forEach((pageRows, pageIndex) => {
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
    ctx.fillRect(0, 0, width, headerBandHeight);

    ctx.fillStyle = "#f5d47a";
    ctx.font = `bold ${landscape ? 28 : 30}px Microsoft JhengHei, Arial`;
    canvasText(ctx, reportTitle, margin, 58, width - margin * 2);
    ctx.fillStyle = "#fff7df";
    ctx.font = `${landscape ? 17 : 18}px Microsoft JhengHei, Arial`;
    canvasText(ctx, `${dateLabel(exam.date)}　${exam.grade}　${exam.subject}`, margin, 94, width - margin * 2 - 210);
    canvasText(ctx, `列印日期：${new Date().toLocaleDateString("zh-TW")}`, width - margin - 205, 94, 205);

    ctx.fillStyle = "rgba(255,255,255,.08)";
    drawRoundRect(ctx, margin, landscape ? 116 : 126, width - margin * 2, landscape ? 52 : 72, 10);
    ctx.fill();
    ctx.fillStyle = "#fff7df";
    ctx.font = `bold ${landscape ? 17 : 18}px Microsoft JhengHei, Arial`;
    canvasText(ctx, `班平均 ${scoreDisplay(average)}`, margin + 22, landscape ? 149 : 170, 150);
    canvasText(ctx, `${paperCount} 份考卷`, margin + 176, landscape ? 149 : 170, 130);
    canvasText(ctx, `第 ${pageIndex + 1} / ${totalPages} 頁`, width - margin - 126, landscape ? 149 : 170, 120);
    ctx.font = `${landscape ? 15 : 16}px Microsoft JhengHei, Arial`;
    canvasText(ctx, `重點：${exam.scope || "未填考試重點"}`, margin + 318, landscape ? 149 : 170, width - margin * 2 - 470);

    const tableX = margin;
    const tableWidth = width - margin * 2;
    const columns = [
      { key: "rank", label: "排名", width: 68 },
      { key: "name", label: "姓名", width: landscape ? 168 : 128 },
      { key: "grade", label: "班級", width: 82 },
      { key: "subject", label: "科目", width: 98 },
      ...Array.from({ length: paperCount }, (_item, index) => ({ key: `p${index}`, label: `卷${index + 1}`, width: Math.max(66, Math.floor((landscape ? 270 : 170) / paperCount)) })),
      { key: "average", label: "平均", width: 88 },
    ];
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    columns.forEach((column) => { column.width = column.width * tableWidth / total; });

    ctx.fillStyle = "#171b21";
    drawRoundRect(ctx, tableX, tableY, tableWidth, tableHeaderHeight, 7);
    ctx.fill();
    ctx.font = `bold ${landscape ? 15 : 14}px Microsoft JhengHei, Arial`;
    ctx.fillStyle = "#f5d47a";
    let cursor = tableX;
    columns.forEach((column) => {
      canvasText(ctx, column.label, cursor + 10, tableY + 27, column.width - 14);
      cursor += column.width;
    });

    if (!rows.length) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(tableX, tableY + tableHeaderHeight, tableWidth, rowHeight);
      ctx.fillStyle = "#333";
      ctx.font = "16px Microsoft JhengHei, Arial";
      canvasText(ctx, exam.noExam ? "當日無考試" : "尚無成績", tableX + 14, tableY + tableHeaderHeight + 25, tableWidth - 28);
    } else {
      pageRows.forEach((row, rowIndex) => {
        const y = tableY + tableHeaderHeight + rowIndex * rowHeight;
        ctx.fillStyle = rowIndex % 2 ? "#f4ead2" : "#fffaf0";
        ctx.fillRect(tableX, y, tableWidth, rowHeight);
        ctx.strokeStyle = "#dfd0aa";
        ctx.beginPath();
        ctx.moveTo(tableX, y + rowHeight);
        ctx.lineTo(tableX + tableWidth, y + rowHeight);
        ctx.stroke();
        ctx.font = row.rank === 1 ? `bold ${landscape ? 15 : 14}px Microsoft JhengHei, Arial` : `${landscape ? 14 : 13}px Microsoft JhengHei, Arial`;
        cursor = tableX;
        const values = [row.rank, row.name, row.grade, row.subject, ...row.papers, row.average];
        values.forEach((value, index) => {
          ctx.fillStyle = index === values.length - 1 && row.failing ? "#e60012" : "#1e2329";
          canvasText(ctx, value, cursor + 10, y + Math.round(rowHeight * .64), columns[index].width - 14);
          cursor += columns[index].width;
        });
      });
    }

    ctx.fillStyle = "#76623a";
    ctx.font = "13px Microsoft JhengHei, Arial";
    canvasText(ctx, "不及格分數以紅字標示｜本圖檔可直接傳送家長群組", margin, height - 20, width - margin * 2 - 100);
    canvasText(ctx, `${pageIndex + 1}/${totalPages}`, width - margin - 48, height - 20, 48);
    canvas.toBlob((blob) => {
      if (!blob) return alert("圖片生成失敗，請再試一次。");
      const suffix = totalPages > 1 ? `_第${pageIndex + 1}頁` : "";
      downloadBlob(blob, "image/png", `${baseFileName}${suffix}.png`);
    }, "image/png");
  });
}

async function printStudentReportPdf() {
  const student = getStudent($("#careerStudent")?.value || parentStudentId);
  if (!student) {
    alert("請先選擇學生。");
    return;
  }
  const payload = studentAiPayload(student);
  const analyses = subjectPerformanceRows(student);
  let aiReportHtml = `<div class="empty">尚未設定 Gemini API Key，無法產生 AI 詳細報告。</div>`;
  if (aiConfigured()) {
    const button = $("#printStudentReport");
    if (button) {
      button.disabled = true;
      button.textContent = "AI 報告生成中...";
    }
    try {
      const text = await callGeminiAnalysis(detailedStudentAiPrompt(student, payload));
      aiReportHtml = `<article class="ai-answer-card">${markdownToHtml(text)}</article>`;
    } catch (error) {
      aiReportHtml = `<div class="empty">${escapeHtml(error.message || "AI 詳細報告生成失敗")}</div>`;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "下載 PDF";
      }
    }
  }
  const examRows = reportDetailRows(student);
  const termRows = state.termScores.filter((item) => item.studentId === student.id);
  const weeklyRows = examRows.slice().reverse().map((row) => {
    const stats = examStatsForStudent(row.exam, student.id);
    const paperTopics = row.papers.map((_value, index) => row.exam.paperTopics?.[index] || `卷${index + 1}`).join(" / ");
    return `<tr><td>${escapeHtml(dateLabel(row.exam.date))}</td><td>${escapeHtml(row.exam.subject)}</td><td class="left">${escapeHtml(row.exam.scope || "-")}<br><small>${escapeHtml(paperTopics)}</small></td><td>${escapeHtml(row.papers.map(scoreDisplay).join(" / "))}</td><td class="${scoreClass(row.score)}">${scoreDisplay(row.score)}</td><td>${escapeHtml(examStatsInline(stats))}</td></tr>`;
  }).join("");
  pdfDocument(`${student.name} 生涯分析報告`, `
    <section class="report-cover">
      <img src="assets/logo.png" alt="金牌躍騰">
      <h1>金牌躍騰平鎮分校</h1>
      <h2>${escapeHtml(student.name)} 綜合成績報告</h2>
      <p>${escapeHtml(student.grade)}｜${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</p>
    </section>
    <section class="pdf-page ai-detail-page">
      <header class="student-hero">
        <div>
          <h1>金牌躍騰平鎮分校 學生：${escapeHtml(student.name)} 專屬報告</h1>
          <div class="subtitle">AI 詳細分析｜${escapeHtml(studentLabel(student))}｜${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</div>
        </div>
      </header>
      ${studentAiVisualStripHtml(student, analyses)}
      ${aiReportHtml}
    </section>
    <article class="student-report">
      <header class="student-hero">
        <div>
          <h1>${escapeHtml(studentReportTitle())}</h1>
          <div class="subtitle">${escapeHtml(studentLabel(student))}｜修課 ${escapeHtml(studentCoursesLabel(student))}</div>
        </div>
        <div class="stamp"><span>產出日期</span><b>${escapeHtml(new Date().toLocaleDateString("zh-TW"))}</b></div>
      </header>
      ${renderStudentReportHtml(student, null, { hideAi: true })}
      ${activeReportDetailRange() === "none" ? "" : `<section class="report-section">
        <h2 class="section-title">週考明細</h2>
        <table class="report-table"><thead><tr><th>日期</th><th>科目</th><th class="left">範圍 / 單元</th><th>各卷</th><th>平均</th><th>當天統計</th></tr></thead><tbody>${weeklyRows || `<tr><td colspan="6">尚無週考紀錄</td></tr>`}</tbody></table>
      </section>`}
      <section class="report-section">
        <h2 class="section-title">段考明細</h2>
        <table class="report-table"><thead><tr><th>學期</th><th>段別</th><th>科目</th><th>成績</th></tr></thead><tbody>${termRows.map((item) => `<tr><td>${escapeHtml(item.term || `${item.year || ""}${item.semester || ""}`)}</td><td>${escapeHtml(item.stage || "-")}</td><td>${escapeHtml(item.subject)}</td><td class="${scoreClass(Number(item.score))}">${scoreDisplay(Number(item.score))}</td></tr>`).join("") || `<tr><td colspan="4">尚無段考紀錄</td></tr>`}</tbody></table>
      </section>
    </article>
    <section class="teacher-message-page">
      <h1>老師留言板</h1>
      <p>給家長與學生的提醒、鼓勵、備戰方向與下階段目標。</p>
      <div class="message-lines">${Array.from({ length: 12 }, () => "<i></i>").join("")}</div>
    </section>
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

function imageFileToDataUrl(file, maxWidth = 1200, quality = .82) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function imageFilesToDataUrls(fileList, maxWidth = 1200) {
  const files = [...(fileList || [])].filter((file) => file.type.startsWith("image/"));
  const urls = [];
  for (const file of files) urls.push(await imageFileToDataUrl(file, maxWidth));
  return urls.filter(Boolean);
}

function resetLeaveForm() {
  $("#leaveStudentPicker").value = "";
  $("#leaveStudent").value = "";
  $("#leaveStartDate").value = todayISO();
  $("#leaveEndDate").value = todayISO();
  if ($("#leaveType")) $("#leaveType").value = "請假";
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

function currentTeacherView() {
  const activePage = $(".page.active");
  if (!activePage) return null;
  return {
    tab: activePage.id,
    classOpsSection,
    classOpsSelectedGrade,
    contactBookSection,
    aboutSection,
  };
}

function restoreTeacherView(view) {
  if (!view?.tab) return;
  classOpsSection = view.classOpsSection || classOpsSection;
  classOpsSelectedGrade = view.classOpsSelectedGrade || classOpsSelectedGrade;
  contactBookSection = view.contactBookSection || contactBookSection;
  aboutSection = view.aboutSection || aboutSection;
  navigateToTab(view.tab, { skipHistory: true });
}

function pushTeacherBack(view = currentTeacherView()) {
  if (view) teacherBackStack.push(view);
}

function goTeacherBack(fallback = "dashboard") {
  const previous = teacherBackStack.pop();
  if (previous) {
    restoreTeacherView(previous);
    return;
  }
  navigateToTab(fallback, { skipHistory: true });
}

function navigateToTab(tabId, options = {}) {
  if (!tabId || !$(`#${tabId}`)) return;
  if ($("#scores")?.classList.contains("active")) captureScoreDraft();
  const previous = currentTeacherView();
  if (!options.skipHistory && previous?.tab && previous.tab !== tabId) teacherBackStack.push(previous);
  $$(".tab-button").forEach((tab) => {
    const activeTop = tab.dataset.tab === tabId || tab.dataset.tab === parentTabs[tabId];
    tab.classList.toggle("active", activeTop);
  });
  $$(".page").forEach((page) => page.classList.remove("active"));
  $(`#${tabId}`).classList.add("active");
  document.body.classList.remove("nav-open");
  renderAll();
  if (!options.preserveScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.tab === "class-ops") classOpsSection = "menu";
      if (button.dataset.tab === "contact-book") contactBookSection = "menu";
      if (button.dataset.tab === "about-admin") aboutSection = "display";
      if (button.dataset.tab === "seat-settings") seatSettingsSection = "menu";
      if (button.dataset.tab === "retention-report") {
        $("#retentionGradeMenu") && ($("#retentionGradeMenu").hidden = false);
        $("#retentionReportPanel") && ($("#retentionReportPanel").hidden = true);
      }
      if (button.dataset.tab === "scores" && !editingExamId && $("#examDate")) $("#examDate").value = todayISO();
      navigateToTab(button.dataset.tab);
    });
  });
  $$(".back-button").forEach((button) => {
    button.addEventListener("click", () => goTeacherBack(button.dataset.backTab || "dashboard"));
  });
  $$(".portal-tile[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.tab === "events") contactBookSection = "menu";
      if (button.dataset.tab === "seat-settings") seatSettingsSection = "menu";
      if (button.dataset.tab === "retention-report") {
        $("#retentionGradeMenu") && ($("#retentionGradeMenu").hidden = false);
        $("#retentionReportPanel") && ($("#retentionReportPanel").hidden = true);
      }
      if (button.dataset.tab === "scores" && !editingExamId && $("#examDate")) $("#examDate").value = todayISO();
      navigateToTab(button.dataset.tab);
    });
  });
  $$("[data-class-ops-section]").forEach((button) => {
    button.addEventListener("click", () => setClassOpsSection(button.dataset.classOpsSection));
  });
  $$("[data-class-ops-grade]").forEach((button) => {
    button.addEventListener("click", () => openClassOpsGrade(button.dataset.classOpsGrade));
  });
  $$("[data-contact-section]").forEach((button) => {
    button.addEventListener("click", () => setContactBookSection(button.dataset.contactSection));
  });
  $$("[data-about-section]").forEach((button) => {
    button.addEventListener("click", () => setAboutSection(button.dataset.aboutSection));
  });
  $$("[data-roll-grade]").forEach((button) => {
    button.addEventListener("click", () => {
      rollCallGrade = button.dataset.rollGrade;
      $("#rollGrade").value = rollCallGrade;
      $("#rollCallGradeMenu").hidden = true;
      $("#rollCallPanel").hidden = false;
      chooseDefaultRollSubject();
      renderRollCall();
    });
  });
  $$("[data-retention-grade]").forEach((button) => {
    button.addEventListener("click", () => {
      retentionGrade = button.dataset.retentionGrade;
      retentionDate = $("#retentionDate")?.value || todayISO();
      retentionSubject = "全部";
      $("#retentionGradeMenu").hidden = true;
      $("#retentionReportPanel").hidden = false;
      renderRetentionReport();
    });
  });
  $("[data-retention-back]")?.addEventListener("click", () => {
    $("#retentionGradeMenu").hidden = false;
    $("#retentionReportPanel").hidden = true;
  });
  $("#retentionPrevDay")?.addEventListener("click", () => {
    retentionDate = addDays(retentionDate || todayISO(), -1);
    renderRetentionReport();
  });
  $("#retentionNextDay")?.addEventListener("click", () => {
    retentionDate = addDays(retentionDate || todayISO(), 1);
    renderRetentionReport();
  });
  $("#rollPrevDay")?.addEventListener("click", () => {
    $("#rollDate").value = addDays($("#rollDate").value || todayISO(), -1);
    chooseDefaultRollSubject();
    renderRollCall();
  });
  $("#rollNextDay")?.addEventListener("click", () => {
    $("#rollDate").value = addDays($("#rollDate").value || todayISO(), 1);
    chooseDefaultRollSubject();
    renderRollCall();
  });
  $("#exportRollCallPdf")?.addEventListener("click", printRollCallPdf);
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
  $("#eventStartDate").value = todayISO();
  $("#eventEndDate").value = todayISO();
  $("#eventTitle").value = "";
  $("#eventNote").value = "";
  $("#eventForm .primary").textContent = "張貼公告";
  $("#cancelEventEdit").hidden = true;
}

function fillEventForm(record) {
  editingEventId = record.id;
  $("#eventGrade").value = record.grade;
  $("#eventType").value = record.type;
  $("#eventStartDate").value = record.startDate || record.date;
  $("#eventEndDate").value = record.endDate || record.startDate || record.date;
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

  ["classOpsYear", "classOpsSemester", "classOpsGrade", "classOpsSubject", "classOpsWeekDate"].forEach((id) => {
    onInputChange(id, () => {
      if (id === "classOpsGrade" && grades.includes($("#classOpsGrade")?.value)) classOpsSelectedGrade = $("#classOpsGrade").value;
      renderClassOps();
    });
  });
  ["contactDate", "contactGrade"].forEach((id) => {
    onInputChange(id, renderContactSubjectOptions);
  });
  $("#printClassOpsWeeklyReport")?.addEventListener("click", printClassOpsWeeklyReportPdf);
  $("#generateClassOpsAi")?.addEventListener("click", generateClassOpsAiAnalysis);

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

  $("#courseForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextName = normalizeCourseName($("#courseName").value);
    if (!nextName) return alert("請輸入課程名稱");
    const catalog = normalizeCourseCatalog(state.courseCatalog);
    if (editingCourseName && coreCourses.includes(editingCourseName)) return alert("核心課程不可編輯");
    if (!editingCourseName && catalog.some((item) => item.name === nextName)) return alert("課程已存在");
    state.courseCatalog = catalog
      .filter((item) => item.name !== editingCourseName)
      .concat({ name: nextName, core: coreCourses.includes(nextName) });
    state.deletedCourseNames = (state.deletedCourseNames || []).filter((name) => name !== nextName);
    applyCourseCatalog(state.courseCatalog);
    clearCourseForm();
    saveState();
    renderAll();
  });

  $("#cancelCourseEdit")?.addEventListener("click", () => {
    clearCourseForm();
    renderCourseAdmin();
  });

  $("#seatSettingForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCurrentSeatSetting();
    flashButton(event.submitter, "已儲存");
  });
  $("#clearSeatAssignments")?.addEventListener("click", () => {
    if (!confirm("確定清除這個年級科目的全部座位安排？教室格局不會被刪除。")) return;
    $$("[data-seat-student]").forEach((field) => { field.value = ""; });
    $$("[data-seat-student-search]").forEach((field) => { field.value = ""; });
    saveCurrentSeatSetting();
  });
  $("#printSeatAssignment")?.addEventListener("click", printSeatAssignmentPdf);
  $("#addRoomLayout")?.addEventListener("click", () => {
    const name = ($("#roomLayoutName")?.value || "").trim();
    if (!name) return alert("請輸入教室名稱。");
    if (state.roomLayouts?.[name]) return alert("這個教室已存在。");
    state.roomLayouts = normalizeRoomLayouts({
      ...(state.roomLayouts || {}),
      [name]: { name, layoutSeats: defaultLayoutSeatIdsFromSize(4, 6), updatedAt: new Date().toISOString() },
    }, state.seatSettings);
    roomLayouts = state.roomLayouts;
    $("#roomLayoutName").value = "";
    saveState();
    renderSeatSettingBoard();
    if ($("#roomLayoutRoom")) $("#roomLayoutRoom").value = name;
    renderRoomLayoutBoard();
  });
  $("#deleteRoomLayout")?.addEventListener("click", () => {
    const room = $("#roomLayoutRoom")?.value || "";
    if (!room) return;
    if (defaultRoomLayouts[room]) return alert("預設教室不可刪除，但可以調整格局。");
    const inUse = Object.values(state.seatSettings || {}).some((setting) => setting.room === room);
    if (inUse) return alert("這間教室已有位置安排使用，請先把班級改到其他教室再刪除。");
    if (!confirm(`確定刪除「${room}」教室格局？`)) return;
    const next = { ...(state.roomLayouts || {}) };
    delete next[room];
    state.roomLayouts = normalizeRoomLayouts(next, state.seatSettings);
    roomLayouts = state.roomLayouts;
    saveState();
    renderSeatSettingBoard();
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
      type: $("#leaveType")?.value || "請假",
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
    const startDate = $("#eventStartDate").value;
    const endDate = $("#eventEndDate").value;
    const payload = {
      grade: $("#eventGrade").value,
      type: $("#eventType").value,
      date: startDate,
      startDate,
      endDate,
      title: $("#eventTitle").value.trim(),
      note: $("#eventNote").value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (!payload.title) return alert("請輸入公告標題");
    if (!startDate || !endDate) return alert("請選擇開課日期與結束日期");
    if (endDate < startDate) return alert("結束日期不能早於開課日期");
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

  $("#contactBookForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const wasEditing = Boolean(editingContactId);
    const payload = normalizeContactBooks([{
      id: editingContactId || crypto.randomUUID(),
      date: $("#contactDate").value,
      grade: $("#contactGrade").value,
      subject: $("#contactSubject").value,
      todayTest: $("#contactTodayTest").value.trim(),
      nextTest: $("#contactNextTest").value.trim(),
      homework: $("#contactHomework").value.trim(),
      createdAt: editingContactId ? state.contactBooks.find((item) => item.id === editingContactId)?.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }])[0];
    if (editingContactId) {
      state.contactBooks = state.contactBooks.map((item) => item.id === editingContactId ? payload : item);
    } else {
      state.contactBooks.push(payload);
    }
    clearContactForm();
    saveState();
    renderAll();
    flashButton(event.submitter, wasEditing ? "已更新" : "已儲存");
  });

  $("#cancelContactEdit")?.addEventListener("click", () => {
    clearContactForm();
    renderContactBooks();
  });
  $("#paperAnalysisForm")?.addEventListener("submit", submitPaperAnalysis);
  $("#paperAnalysisImage")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    paperAnalysisImageData = file ? await fileToDataUrl(file) : "";
    if ($("#paperAnalysisPreview")) {
      $("#paperAnalysisPreview").innerHTML = paperAnalysisImageData
        ? `<img src="${paperAnalysisImageData}" alt="考卷預覽"><span>已讀取圖片，按下掃描後產生 PDF。</span>`
        : "";
    }
  });

  ["contactFilterGrade", "contactFilterSubject"].forEach((id) => {
    onInputChange(id, renderContactBooks);
  });
  $("#aiSettingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.aiSettings = normalizeAiSettings({
      geminiApiKey: $("#geminiApiKey").value.trim(),
      model: $("#geminiModel").value.trim(),
    });
    saveState();
    renderAiSettings();
    flashButton(event.submitter, "已儲存");
  });

  $("#academicForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = normalizeAcademicSettings({
      academicYear: $("#academicYear").value.trim(),
      semester: $("#academicSemester").value,
    });
    upsertAcademicPeriod(state.settings);
    saveState();
    renderAll();
    flashButton(event.submitter, "已儲存");
  });

  $("#promoteGradesButton")?.addEventListener("click", promoteGrades);

  $("#examForm").addEventListener("submit", saveExam);
  $("#scoreEntryList")?.addEventListener("input", () => {
    touchScoreActivity();
  });
  $("#resetExamForm").addEventListener("click", resetExamForm);
  $("#termScoreForm").addEventListener("submit", saveTermScore);
  $("#termPeriodForm")?.addEventListener("submit", saveTermPeriodSettings);
  $("#saveSchedule").addEventListener("click", (event) => {
    saveSchedule();
    flashButton(event.currentTarget, "已儲存");
  });
  $("#printClassReport").addEventListener("click", printClassReportPdf);
  $("#returnCurrentClassReport").addEventListener("click", returnCurrentClassReport);
  $("#downloadClassReportImage").addEventListener("click", downloadClassReportImage);
  $("#downloadClassReportExcel").addEventListener("click", downloadClassReportExcel);
  $("#printStudentReport").addEventListener("click", printStudentReportPdf);
  $("#downloadStudentReportImage")?.addEventListener("click", () => downloadStudentReportImage());
  $("#downloadParentReportImage")?.addEventListener("click", () => downloadStudentReportImage(getStudent(parentStudentId)));
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
  $("#termWeightControls")?.addEventListener("input", () => {
    const meta = currentTermMeta();
    state.termWeights[termWeightKey(meta)] = readTermWeights();
    saveState();
    renderTermReport();
  });

  ["examScope", "examPaperCount", "examPaperTopics", "examNoTest", "examMockMode"].forEach((id) => {
    onInputChange(id, () => updateScoreDraftMeta({ immediate: id !== "examScope" }));
  });
  ["scoreStudentPicker"].forEach((id) => {
    onInputChange(id, renderScoreEntryList);
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
  $("#scoreEntryList").addEventListener("input", (event) => {
    const input = event.target.closest("[data-score-student]");
    if (input) updateScoreDraftCell(input);
  });
  $("#scoreEntryList").addEventListener("change", (event) => {
    const input = event.target.closest("[data-score-student]");
    if (input) updateScoreDraftCell(input);
  });
  $("#scoreEntryList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-score-absent]");
    if (!button) return;
    setScoreAbsentButton(button, !button.classList.contains("active"));
    updateScoreDraftAbsence(button);
  });
  $("#seatSettingBoard")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-seat-student-search]");
    if (input) applySeatSearchInput(input);
  });
  $("#seatSettingBoard")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest("[data-seat-student-search]");
    if (!input) return;
    event.preventDefault();
    applySeatSearchInput(input);
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

  ["studentFilter", "studentSearch", "leaveManageSearch", "lateGrade", "historyType", "historySearch", "scheduleGrade", "examGrade", "examSubject", "examPaperCount", "examNoTest", "examMockMode", "scoreHistoryYear", "scoreHistorySemester", "scoreHistoryGrade", "careerQueryDate", "careerExamYear", "careerExamSemester", "careerTermYear", "careerTermAnalysisYear", "careerTermAnalysisSemester", "careerTermAnalysisStage", "careerReportRange", "careerReportYear", "careerReportSemester", "careerReportStage", "careerReportStartDate", "careerReportEndDate", "careerReportDetailRange", "termYear", "termSemester", "termGrade", "termStage", "termPeriodYear", "termPeriodSemester", "seatSettingGrade", "seatSettingSubject", "seatSettingRoom", "roomLayoutRoom", "rollDate", "rollGrade", "rollSubject", "retentionDate", "retentionSubject"].forEach((id) => {
    onInputChange(id, () => {
      if (id.startsWith("scoreHistory")) examHistoryPage = 1;
      if (id === "rollGrade") rollCallGrade = $("#rollGrade").value;
      if ($("#scores")?.classList.contains("active") && ["examDate", "examGrade"].includes(id)) {
        if (!editingExamId) selectedClassReportExamId = null;
        chooseDefaultExamSubject();
        $("#scoreStudentFilter").value = "全部";
        $("#scoreStudentPicker").value = "";
        renderScoreStudentFilter();
        renderScoreEntryList();
        renderClassReport();
        updateScoreDraftMeta({ immediate: true });
        return;
      }
      if ($("#scores")?.classList.contains("active") && id === "examSubject") {
        if (!editingExamId) selectedClassReportExamId = null;
        $("#scoreStudentFilter").value = "全部";
        $("#scoreStudentPicker").value = "";
        renderScoreStudentFilter();
        renderScoreEntryList();
        renderClassReport();
        updateScoreDraftMeta({ immediate: true });
        return;
      }
      if ($("#scores")?.classList.contains("active") && ["examPaperCount", "examNoTest", "examMockMode"].includes(id)) {
        renderScoreEntryList();
        return;
      }
      if (id.startsWith("seatSetting")) {
        renderSeatSettingBoard();
        return;
      }
      if (id === "roomLayoutRoom") {
        renderRoomLayoutBoard();
        return;
      }
      if (["rollDate", "rollGrade"].includes(id)) {
        chooseDefaultRollSubject();
        renderRollCall();
        return;
      }
      if (id === "retentionDate") {
        retentionDate = $("#retentionDate")?.value || todayISO();
        retentionSubject = "全部";
        renderRetentionReport();
        return;
      }
      if (id === "retentionSubject") {
        retentionSubject = $("#retentionSubject")?.value || "全部";
        renderRetentionReport();
        return;
      }
      renderAll();
    });
  });

  document.addEventListener("change", (event) => {
    const seatSelect = event.target.closest("[data-seat-student]");
    if (!seatSelect) return;
    $$("[data-seat-student]").forEach((select) => {
      if (select !== seatSelect && select.value === seatSelect.value) select.value = "";
    });
    refreshSeatSelectAvailability();
    saveCurrentSeatSetting({ render: false });
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
  ["parentScoreDate", "parentExamYear", "parentExamSemester", "parentTermYear", "parentTermAnalysisYear", "parentTermAnalysisSemester", "parentTermAnalysisStage", "parentReportRange", "parentReportYear", "parentReportSemester", "parentReportStage", "parentReportStartDate", "parentReportEndDate", "parentReportDetailRange", "parentContactWeekDate"].forEach((id) => {
    onInputChange(id, () => {
      if (id === "parentContactWeekDate") parentContactWeekDate = $("#parentContactWeekDate")?.value || todayISO();
      if (parentStudentId) renderParentPortal();
    });
  });
  onInputChange("parentContactSubjectFilter", () => {
    if (parentStudentId) renderParentPortal();
  });
  $("#parentContactPrevWeek")?.addEventListener("click", () => {
    parentContactWeekDate = addDays(parentContactWeekDate || todayISO(), -7);
    if ($("#parentContactWeekDate")) $("#parentContactWeekDate").value = parentContactWeekDate;
    if (parentStudentId) renderParentPortal();
  });
  $("#parentContactNextWeek")?.addEventListener("click", () => {
    parentContactWeekDate = addDays(parentContactWeekDate || todayISO(), 7);
    if ($("#parentContactWeekDate")) $("#parentContactWeekDate").value = parentContactWeekDate;
    if (parentStudentId) renderParentPortal();
  });
}

function closeParentDrawer() {
  document.body.classList.remove("parent-nav-open");
}

function renderParentReportView() {
  const views = {
    menu: $("#parentReportMenu"),
    weekly: $("#parentWeeklyReportPanel"),
    term: $("#parentTermReportPanel"),
  };
  Object.entries(views).forEach(([key, element]) => {
    if (element) element.hidden = key !== parentReportView;
  });
  if (parentActiveSection === "parentReportSection" && parentReportView === "weekly" && parentStudentId) {
    autoGenerateVisibleStudentAi(parentStudentId);
  }
}

function openParentReportSection(view = "menu") {
  parentReportView = view;
  setParentSection("parentReportSection");
}

function setParentSection(sectionId, options = {}) {
  if (!sectionId || !$(`#${sectionId}`)) return;
  if (!options.skipHistory && parentActiveSection && parentActiveSection !== sectionId) parentBackStack.push(parentActiveSection);
  parentActiveSection = sectionId;
  $$(".parent-page-section").forEach((section) => {
    section.classList.toggle("is-active", section.id === parentActiveSection);
  });
  $$(".parent-drawer-nav [data-parent-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.parentSection === parentActiveSection);
  });
  if (parentActiveSection === "parentReportSection") renderParentReportView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goParentBack() {
  const previous = parentBackStack.pop();
  setParentSection(previous || "parentHomeSection", { skipHistory: true });
}

function setupParentDrawer() {
  $("#parentMenuButton")?.addEventListener("click", () => {
    document.body.classList.toggle("parent-nav-open");
  });
  $("#parentScrim")?.addEventListener("click", closeParentDrawer);
  $$(".parent-drawer-nav [data-parent-section]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.parentSection === "parentReportSection") openParentReportSection();
      else setParentSection(button.dataset.parentSection);
      closeParentDrawer();
    });
  });
  $$(".parent-home-grid [data-parent-section]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.parentSection === "parentReportSection") openParentReportSection();
      else setParentSection(button.dataset.parentSection);
    });
  });
  $$("#parentReportSection [data-parent-report-view]").forEach((button) => {
    button.addEventListener("click", () => {
      parentReportView = button.dataset.parentReportView || "menu";
      renderParentReportView();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  $("#parentBackButton")?.addEventListener("click", goParentBack);
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

function normalizeLeaveType(value) {
  return leaveTypes.includes(value) ? value : "請假";
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
        <tr class="${student.withdrawn ? "withdrawn-student" : ""}">
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
              <button class="ghost" data-toggle-withdrawn="${student.id}">${student.withdrawn ? "恢復就讀" : "退班"}</button>
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
        <span class="badge gold">${escapeHtml(normalizeLeaveType(record.type))}</span>
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
    .filter((student) => ids.has(student.id) && studentHasClassOnDate(student, today) && student.fixedLate.some((item) => item.day === todayWeekday))
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
      const student = getStudent(record.studentId);
      if (record.dismissedAt || !ids.has(record.studentId) || !student) return false;
      if (dashboardMode === "today") return record.date === today && studentHasClassOnDate(student, today);
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
  const leaveKeyword = $("#leaveManageSearch")?.value.trim() || "";
  $("#leaveManageList").innerHTML = state.leaves
    .slice()
    .filter((record) => leaveDayCount(record) > 0)
    .filter((record) => {
      const student = getStudent(record.studentId);
      const haystack = `${student ? studentLabel(student) : ""}${record.note || ""}${getLeaveStart(record)}${getLeaveEnd(record)}${normalizeLeaveType(record.type)}`;
      return !leaveKeyword || haystack.includes(leaveKeyword);
    })
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
    const aStart = a.startDate || a.date || "";
    const bStart = b.startDate || b.date || "";
    return fixedOrder || bStart.localeCompare(aStart) || (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

function eventDateRangeLabel(record) {
  const start = record.startDate || record.date;
  const end = record.endDate || start;
  if (!start && !end) return "-";
  if (!end || start === end) return dateLabel(start);
  return `${dateLabel(start)} ～ ${dateLabel(end)}`;
}

function renderEventCard(record, withActions = false) {
  return `
    <article class="record-card event-card ${record.type === "臨時重大事件" ? "ending" : ""}">
      <strong>${record.title}</strong>
      <div class="meta">
        <span class="badge">${record.type}</span>
        <span class="badge">${record.grade}</span>
        <span class="badge">${eventDateRangeLabel(record)}</span>
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

function renderContactSubjectOptions() {
  const target = $("#contactSubject");
  if (!target) return;
  const previous = target.value;
  const date = $("#contactDate")?.value || todayISO();
  const grade = $("#contactGrade")?.value || "全體";
  const day = weekdayFromDate(date);
  const visibleGrades = grade === "全體" ? grades : [grade];
  const scheduled = new Set();
  visibleGrades.forEach((itemGrade) => {
    periods.forEach((period) => {
      const subject = normalizeCourseName(state.schedule?.[itemGrade]?.[day]?.[period]);
      if (courses.includes(subject)) scheduled.add(subject);
      if (subject === "數A") scheduled.add("數B");
      if (subject === "數B") scheduled.add("數A");
    });
  });
  const subjects = scheduled.size ? [...scheduled] : courses;
  target.innerHTML = subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
  target.value = previous && subjects.includes(previous) ? previous : subjects[0];
}

function contactSubjectOptions(records = state.contactBooks, student = null) {
  const allLabel = "全部";
  const subjects = new Set([allLabel]);
  if (student) {
    (student.courses || []).forEach((course) => subjects.add(course));
    records.forEach((record) => {
      if (!(record.grade === "全體" || record.grade === student.grade)) return;
      if (record.subject && studentTakesSubject(student, record.subject)) subjects.add(record.subject);
    });
  } else {
    records.forEach((record) => {
      if (record.subject) subjects.add(record.subject);
    });
    courses.forEach((course) => subjects.add(course));
  }
  return [...subjects];
}

function parentContactRecordVisible(record, student) {
  return Boolean(student) &&
    (record.grade === "全體" || record.grade === student.grade) &&
    studentTakesSubject(student, record.subject);
}
function renderContactFilters(student = null) {
  const teacherSubject = $("#contactFilterSubject");
  if (teacherSubject) {
    const previous = teacherSubject.value || "全部";
    const subjects = contactSubjectOptions(state.contactBooks);
    teacherSubject.innerHTML = subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
    teacherSubject.value = subjects.includes(previous) ? previous : "全部";
  }
  const parentSubject = $("#parentContactSubjectFilter");
  if (parentSubject && student) {
    const previous = parentSubject.value || "全部";
    const subjects = contactSubjectOptions(state.contactBooks, student);
    parentSubject.innerHTML = subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
    parentSubject.value = subjects.includes(previous) ? previous : "全部";
  }
}

function contactRecordMatchesFilters(record) {
  const grade = $("#contactFilterGrade")?.value || "全部";
  const subject = $("#contactFilterSubject")?.value || "全部";
  return (grade === "全部" || record.grade === grade || record.grade === "全體") &&
    (subject === "全部" || record.subject === subject);
}

function clearContactForm() {
  editingContactId = null;
  $("#contactTodayTest").value = "";
  $("#contactNextTest").value = "";
  $("#contactHomework").value = "";
  $("#cancelContactEdit")?.setAttribute("hidden", "");
}

function fillContactForm(record) {
  editingContactId = record.id;
  $("#contactDate").value = record.date || todayISO();
  $("#contactGrade").value = record.grade || "全體";
  renderContactSubjectOptions();
  if (record.subject && !Array.from($("#contactSubject").options).some((option) => option.value === record.subject)) {
    $("#contactSubject").insertAdjacentHTML("beforeend", `<option value="${record.subject}">${record.subject}</option>`);
  }
  $("#contactSubject").value = record.subject || $("#contactSubject").value;
  $("#contactTodayTest").value = record.todayTest || "";
  $("#contactNextTest").value = record.nextTest || "";
  $("#contactHomework").value = record.homework || "";
  $("#cancelContactEdit")?.removeAttribute("hidden");
  $("#contactBookForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function contactExamSummary(record, student = null) {
  const exams = state.exams.filter((exam) =>
    exam.date === record.date &&
    (record.grade === "全體" || exam.grade === record.grade) &&
    exam.subject === record.subject &&
    !exam.noExam
  );
  return exams.map((exam) => {
    const score = student ? averageScore(scoreValuesForStudent(exam, student.id)) : NaN;
    const topics = (exam.paperTopics || []).filter(Boolean).join(" / ");
    return `<span class="badge gold">今日考試內容：${escapeHtml(exam.scope || topics || "未填")}${student ? `｜成績 ${scoreDisplay(score)}` : ""}</span>`;
  }).join("");
}

function renderContactBookCard(record, withActions = false, student = null) {
  return `
    <article class="record-card contact-card">
      <strong>${dateLabel(record.date)} ${record.grade} ${record.subject}</strong>
      <div class="meta">
        <span class="badge">今天考試：${record.todayTest || "無"}</span>
        <span class="badge">下次考試：${record.nextTest || "未填"}</span>
        <span class="badge gold">作業：${record.homework || "未填"}</span>
        ${contactExamSummary(record, student)}
      </div>
      ${withActions ? `<div class="action-row"><button class="ghost" data-edit-contact="${record.id}">編輯</button><button class="ghost danger" data-delete-contact="${record.id}">刪除</button></div>` : ""}
    </article>
  `;
}
function sortedContactBooks(records = state.contactBooks) {
  return records.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function renderContactBooks() {
  renderLayerVisibility();
  const target = $("#contactBookList");
  if (!target) return;
  renderContactSubjectOptions();
  renderContactFilters();
  target.innerHTML = sortedContactBooks()
    .filter(contactRecordMatchesFilters)
    .map((record) => renderContactBookCard(record, true))
    .join("") || `<div class="empty">目前沒有符合條件的聯絡本。</div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("圖片讀取失敗。"));
    reader.readAsDataURL(file);
  });
}

function paperAnalysisPrompt(meta) {
  return `請用繁體中文分析這張考卷圖片，輸出給補習班老師製作 PDF 使用。
考卷名稱：${meta.title}
年級：${meta.grade}
科目：${meta.subject}
日期：${meta.date}
補充說明：${meta.note || "無"}

請依照以下格式，務必根據圖片真實內容，不要編造看不到的題目：
# 考卷重點整理
- 條列此考卷涵蓋的主要單元與概念

# 核心考點
- 條列會考/段考常考觀念、解題關鍵、題型特徵

# 易錯提醒
- 條列學生容易失分的地方

# 老師備課建議
- 條列講解順序、需要補強的先備知識、可安排的練習方向`;
}

function printPaperAnalysisPdf(record) {
  pdfDocument(`${record.title} 考卷分析`, `
    <section class="report-head">
      <strong>金牌躍騰平鎮分校｜考卷分析</strong>
      <span>${escapeHtml(dateLabel(record.date))}</span>
      <span>${escapeHtml(record.grade)}｜${escapeHtml(record.subject)}</span>
      <span>${escapeHtml(record.title)}</span>
    </section>
    <section class="summary ai-answer-card">${markdownToHtml(record.analysis)}</section>
  `);
}

async function submitPaperAnalysis(event) {
  event.preventDefault();
  if (!aiConfigured()) {
    alert("請先到 AI 設定填入 Gemini API Key，才能掃描考卷。");
    return;
  }
  if (!paperAnalysisImageData) {
    alert("請先拍照或上傳考卷圖片。");
    return;
  }
  const submitter = event.submitter;
  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = "掃描中...";
  }
  try {
    const meta = {
      id: crypto.randomUUID(),
      date: $("#paperAnalysisDate")?.value || todayISO(),
      title: cleanCellText($("#paperAnalysisTitle")?.value) || "未命名考卷",
      grade: $("#paperAnalysisGrade")?.value || "國一",
      subject: normalizeCourseName($("#paperAnalysisSubject")?.value || "國文"),
      note: cleanCellText($("#paperAnalysisNote")?.value),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const analysis = await callGeminiImageAnalysis(paperAnalysisPrompt(meta), paperAnalysisImageData);
    const record = normalizePaperAnalyses([{ ...meta, analysis }])[0];
    state.paperAnalyses.unshift(record);
    saveState();
    renderPaperAnalyses();
    printPaperAnalysisPdf(record);
    $("#paperAnalysisForm")?.reset();
    $("#paperAnalysisDate").value = todayISO();
    renderPaperAnalysisSubjectOptions();
    paperAnalysisImageData = "";
    if ($("#paperAnalysisPreview")) $("#paperAnalysisPreview").innerHTML = "";
  } catch (error) {
    alert(error.message || "考卷分析失敗，請稍後再試。");
  } finally {
    if (submitter) {
      submitter.disabled = false;
      submitter.textContent = "掃描並產生 PDF";
    }
  }
}

function renderPaperAnalysisSubjectOptions() {
  const target = $("#paperAnalysisSubject");
  if (!target) return;
  const previous = target.value || "國文";
  target.innerHTML = reportSubjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
  target.value = reportSubjects.includes(previous) ? previous : "國文";
}

function renderPaperAnalyses() {
  renderPaperAnalysisSubjectOptions();
  const target = $("#paperAnalysisList");
  if (!target) return;
  const records = normalizePaperAnalyses(state.paperAnalyses || [])
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  target.innerHTML = records.map((record) => `
    <article class="record-card paper-analysis-card">
      <strong>${escapeHtml(record.title)}</strong>
      <div class="meta">
        <span class="badge">${escapeHtml(dateLabel(record.date))}</span>
        <span class="badge">${escapeHtml(record.grade)}</span>
        <span class="badge gold">${escapeHtml(record.subject)}</span>
      </div>
      <p>${escapeHtml(record.analysis.replace(/[#*\-]/g, "").split(/\n/).find(Boolean) || "已完成考卷分析。")}</p>
      <div class="action-row">
        <button class="ghost" type="button" data-print-paper-analysis="${record.id}">產生 PDF</button>
        <button class="ghost danger" type="button" data-delete-paper-analysis="${record.id}">刪除</button>
      </div>
    </article>
  `).join("") || `<div class="empty">尚無考卷分析紀錄。</div>`;
}
function aboutImageGrid(text) {
  const urls = String(text || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  if (!urls.length) return "";
  return `<div class="about-photo-grid">${urls.map((url) => `<img src="${escapeHtml(url)}" alt="金牌躍騰照片">`).join("")}</div>`;
}

function aboutHtml(settings = state.about) {
  settings = normalizeAboutSettings(settings || {});
  if (settings.publicEnabled === false) return `<div class="empty">關於我們更新中。</div>`;
  const teacherCards = settings.teacherCards || [];
  return `
    <article class="about-showcase">
      <section class="about-hero">
        <div>
          <p class="eyebrow">金牌躍騰教育集團 ${escapeHtml(settings.branch || "平鎮分校")}</p>
          <h2>${escapeHtml(settings.slogan || defaultAboutSettings().slogan)}</h2>
          <p>${escapeHtml(settings.intro || "")}</p>
        </div>
      </section>
      <div class="about-info-grid">
        <article class="about-info-card"><strong>課程介紹</strong><span>${escapeHtml(settings.courses || "-")}</span></article>
        <article class="about-info-card"><strong>對學生的規劃</strong><span>${escapeHtml(settings.planning || "-")}</span></article>
        <article class="about-info-card"><strong>師資特色</strong><span>${escapeHtml(settings.teachers || "可於設定層新增完整師資卡")}</span></article>
      </div>
      ${teacherCards.length ? `<section class="teacher-showcase-grid">${teacherCards.map((teacher) => `
        <article class="teacher-showcase-card">
          ${teacher.photo ? `<img class="teacher-photo" src="${escapeHtml(teacher.photo)}" alt="${escapeHtml(teacher.name)}">` : `<div class="teacher-photo placeholder-photo">${escapeHtml((teacher.name || "師").slice(0, 1))}</div>`}
          <div class="teacher-copy">
            <p class="eyebrow">${escapeHtml(teacher.role || "專任教師")}</p>
            <h3>${escapeHtml(teacher.name)}</h3>
            <strong>${escapeHtml(teacher.specialty || "專長待補")}</strong>
            <p>${escapeHtml(teacher.experience || "")}</p>
            ${teacher.certificates?.length ? `<div class="certificate-strip">${teacher.certificates.slice(0, 4).map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(teacher.name)} 獎狀">`).join("")}</div>` : ""}
          </div>
        </article>
      `).join("")}</section>` : ""}
      <div class="meta">
        ${settings.address ? `<span class="badge">地址：${escapeHtml(settings.address)}</span>` : ""}
        ${settings.phone ? `<span class="badge">電話：${escapeHtml(settings.phone)}</span>` : ""}
        ${settings.lineUrl ? `<a class="badge gold" href="${escapeHtml(settings.lineUrl)}" target="_blank" rel="noopener">官方 LINE</a>` : ""}
        ${settings.facebookUrl ? `<a class="badge gold" href="${escapeHtml(settings.facebookUrl)}" target="_blank" rel="noopener">官方 Facebook</a>` : ""}
      </div>
      ${aboutImageGrid(settings.environmentPhotos)}
      ${aboutImageGrid(settings.teacherPhotos)}
    </article>
  `;
}

function renderAboutSettings() {
  const about = normalizeAboutSettings(state.about || {});
  state.about = about;
  renderLayerVisibility();
  if (!$("#aboutForm")) return;
  $("#aboutPublicEnabled").checked = about.publicEnabled !== false;
  $("#aboutBranch").value = about.branch || "";
  $("#aboutPhone").value = about.phone || "";
  $("#aboutAddress").value = about.address || "";
  $("#aboutSlogan").value = about.slogan || "";
  $("#aboutLineUrl").value = about.lineUrl || "";
  $("#aboutFacebookUrl").value = about.facebookUrl || "";
  $("#aboutIntro").value = about.intro || "";
  $("#aboutCourses").value = about.courses || "";
  $("#aboutTeachers").value = about.teachers || "";
  $("#aboutPlanning").value = about.planning || "";
  $("#aboutEnvironmentPhotos").value = about.environmentPhotos || "";
  $("#aboutTeacherPhotos").value = about.teacherPhotos || "";
  if ($("#teacherCardList")) {
    $("#teacherCardList").innerHTML = about.teacherCards.map((teacher) => `
      <article class="teacher-admin-card">
        ${teacher.photo ? `<img src="${escapeHtml(teacher.photo)}" alt="${escapeHtml(teacher.name)}">` : `<div class="teacher-admin-avatar">${escapeHtml((teacher.name || "師").slice(0, 1))}</div>`}
        <div>
          <strong>${escapeHtml(teacher.name)}</strong>
          <span>${escapeHtml(teacher.role || "未填職位")}｜${escapeHtml(teacher.specialty || "未填專長")}</span>
          <small>${escapeHtml(teacher.experience || "")}</small>
          ${teacher.certificates?.length ? `<small>獎狀照片 ${teacher.certificates.length} 張</small>` : ""}
        </div>
        <button class="ghost danger" type="button" data-delete-teacher="${teacher.id}">刪除</button>
      </article>
    `).join("") || `<div class="empty">尚未新增師資卡。</div>`;
  }
  $("#aboutPreview").innerHTML = aboutHtml(about);
}

function renderAiSettings() {
  state.aiSettings = normalizeAiSettings(state.aiSettings || {});
  if ($("#geminiApiKey")) $("#geminiApiKey").value = state.aiSettings.geminiApiKey || "";
  if ($("#geminiModel")) {
    const model = state.aiSettings.model || defaultAiSettings().model;
    const options = geminiModelOptions.some((item) => item.value === model)
      ? geminiModelOptions
      : [...geminiModelOptions, { value: model, label: `${model}（目前使用）` }];
    $("#geminiModel").innerHTML = options.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
    $("#geminiModel").value = model;
  }
}

function aiConfigured() {
  return Boolean(normalizeAiSettings(state.aiSettings || {}).geminiApiKey);
}

function markdownToHtml(text) {
  return escapeHtml(text)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n- /g, "\n• ")
    .replace(/\n/g, "<br>");
}

async function callGeminiAnalysis(prompt) {
  const settings = normalizeAiSettings(state.aiSettings || {});
  if (!settings.geminiApiKey) throw new Error("尚未設定 Gemini API Key。");
  const model = settings.model || defaultAiSettings().model;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 1800 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini 回應失敗：${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini 沒有回傳分析內容。");
  return text;
}

async function callGeminiImageAnalysis(prompt, imageDataUrl) {
  const settings = normalizeAiSettings(state.aiSettings || {});
  if (!settings.geminiApiKey) throw new Error("尚未設定 Gemini API Key。");
  const model = settings.model || defaultAiSettings().model;
  const match = String(imageDataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("圖片格式讀取失敗，請重新拍照或上傳。");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: match[1], data: match[2] } },
        ],
      }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 2200 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini 回應失敗：${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini 沒有回傳考卷分析內容。");
  return text;
}

function classOpsAiPayload(meta = classOpsMeta()) {
  const stats = classOpsSubjectStats(meta).filter((item) => item.count);
  const rows = classOpsRows(meta).slice(-160).map((row) => ({
    source: row.source,
    date: row.date,
    grade: row.grade,
    subject: row.subject,
    score: Number(row.score?.toFixed?.(1) ?? row.score),
    scope: row.scope,
    paperTopics: row.exam?.paperTopics || [],
    student: row.student?.name || "",
  }));
  return {
    meta,
    subjectStats: stats.map((item) => ({
      subject: item.subject,
      count: item.count,
      average: scoreDisplay(item.average),
      passRate: scoreDisplay(item.passRate),
      lowRate: scoreDisplay(item.lowRate),
      high: scoreDisplay(item.high),
      low: scoreDisplay(item.low),
      benchmark: scoreDisplay(item.benchmark),
      gap: scoreDisplay(item.gap),
    })),
    weakUnits: classOpsWeakHistory(meta),
    segments: classOpsStudentSegments(meta),
    recentRows: rows,
  };
}

async function generateClassOpsAiAnalysis() {
  const target = $("#classOpsAiResult");
  if (!target) return;
  if (!aiConfigured()) {
    target.innerHTML = `<div class="empty">請先到 AI設定 填入 Gemini API Key；未設定時不會產生模板分析。</div>`;
    return;
  }
  target.innerHTML = `<div class="empty">AI 分析中，請稍候...</div>`;
  const payload = classOpsAiPayload();
  const prompt = `你是補習班教學主任，請用繁體中文根據真實資料產生班級分析。禁止套模板、禁止捏造資料。請包含：1.整體趨勢 2.各科狀況 3.PR/前中後段策略 4.弱點單元補救 5.下週教學行動 6.段考/下次考試備戰策略。若有各卷主題，請分辨考卷主題內容再分析。資料如下：\n${JSON.stringify(payload, null, 2)}`;
  try {
    const text = await callGeminiAnalysis(prompt);
    target.innerHTML = `<article class="ai-answer-card">${markdownToHtml(text)}</article>`;
  } catch (error) {
    target.innerHTML = `<div class="empty">${escapeHtml(error.message || "AI 分析失敗")}</div>`;
  }
}

function studentAiPayload(student) {
  const rows = studentExamRows(student).slice(-80).map((row) => ({
    date: row.exam.date,
    grade: row.exam.grade,
    subject: row.exam.subject,
    scope: row.exam.scope,
    paperTopics: row.exam.paperTopics || [],
    score: scoreDisplay(row.score),
    papers: row.papers.map(scoreDisplay),
    stats: examStatsForStudent(row.exam, student.id),
  }));
  return {
    student: { name: student.name, grade: student.grade, courses: student.courses },
    subjectAnalyses: subjectPerformanceRows(student),
    weeklyRows: rows,
    termRows: state.termScores.filter((item) => item.studentId === student.id),
  };
}

function detailedStudentAiPrompt(student, payload) {
  return `你是金牌躍騰平鎮分校的班導師，請用繁體中文產生完整學生學習分析報告。標題必須是「金牌躍騰平鎮分校 學生：${student.name} 專屬報告」。

嚴格規則：
1. 禁止套模板、禁止捏造資料；只能根據資料中的成績、PR、排名、班平均、各卷主題、考試範圍、弱點單元與段考資料分析。
2. 若資料不足，請明確說明哪一科或哪一段資料不足，不要硬編。
3. 內容要像正式給家長看的專業報告，語氣溫和但具體。
4. 不要寫「家長協助」段落，不要寫「老師下週行動」或內部教學安排。
5. 必須保留具體數據，例如分數、PR、排名、班平均、前中後段定位、考卷主題或單元名稱。

請依下列格式輸出：

一、整體狀況與定位分析
- 說明學生目前年級、修課科目、整體表現。
- 彙整 PR / 排名 / 前中後段定位。
- 分出前段亮點、中段穩定表現、後段或需關注項目。

二、各科趨勢與單元解析
- 逐科分析，不要只列摘要。
- 每科包含：趨勢與水準、近期/長期平均、最新分數、PR 或排名定位、各卷主題/考試範圍、弱點單元。
- 若某科有明顯進步或退步，要指出是哪一次考試造成。

三、下次考試備戰策略
- 依弱科、弱單元和最近趨勢提出具體備戰方向。
- 每一點要能對應到真實資料，例如某科某單元、某次測驗、某個 PR 或分數表現。
- 最後用 1 小段總結學生的學習特質與下一階段目標。

資料如下：
${JSON.stringify(payload, null, 2)}`;
}

function parentStudentAiPrompt(student, payload) {
  return `請用繁體中文產生家長端可閱讀的簡明學習摘要。標題必須是「若需詳細報告請與老師作申請」。

規則：
1. 禁止套模板、禁止捏造資料，只能根據真實資料。
2. 請控制在 4 到 6 個重點，讓家長快速理解。
3. 要包含：目前定位、主要優勢、最需要留意的科目/單元、下一次考試備戰方向。
4. 可以引用分數、PR、排名、班平均或單元名稱，但不要逐筆攤開全部歷史。
5. 不要寫「家長協助」、不要寫「老師下週行動」或內部教學安排。

資料如下：
${JSON.stringify(payload, null, 2)}`;
}

function studentAiCacheKey(student, payload) {
  const settings = normalizeAiSettings(state.aiSettings || {});
  return `${student.id}|${settings.model}|${JSON.stringify(payload)}`;
}

function autoGenerateVisibleStudentAi(studentId) {
  if (!aiConfigured()) return;
  const panel = document.querySelector(`[data-ai-mode="auto"][data-ai-student-panel="${studentId}"]`);
  const output = panel?.querySelector(".ai-analysis-result");
  if (!output || output.dataset.aiLoading === "1") return;
  output.dataset.aiLoading = "1";
  generateStudentAiAnalysis(studentId, output).finally(() => {
    output.dataset.aiLoading = "0";
  });
}

async function generateStudentAiAnalysis(studentId, output) {
  const student = getStudent(studentId);
  if (!student || !output) return;
  if (!aiConfigured()) {
    output.innerHTML = `<div class="empty">尚未設定 Gemini API Key，設定後才會產生真實 AI 分析。</div>`;
    return;
  }
  const payload = studentAiPayload(student);
  const isParentReport = Boolean(output.closest('[data-ai-mode="auto"]'));
  const cacheKey = `${studentAiCacheKey(student, payload)}|${isParentReport ? "parent" : "teacher"}`;
  if (studentAiCache.has(cacheKey)) {
    output.innerHTML = studentAiCache.get(cacheKey);
    return;
  }
  output.innerHTML = `<div class="empty">AI 正在依真實成績、PR、排名與弱點單元分析...</div>`;
  const prompt = isParentReport
    ? parentStudentAiPrompt(student, payload)
    : `你是補習班班導師，請用繁體中文根據真實資料產生學生生涯分析。禁止套模板、禁止捏造資料。請包含：整體狀況、各科趨勢、PR/前中後段定位、弱點單元、段考/下次考試備戰策略。若有各卷主題，請分辨考卷主題內容再分析。資料如下：\n${JSON.stringify(payload, null, 2)}`;
  try {
    const text = await callGeminiAnalysis(prompt);
    const html = `<article class="ai-answer-card">${markdownToHtml(text)}</article>`;
    studentAiCache.set(cacheKey, html);
    output.innerHTML = html;
  } catch (error) {
    output.innerHTML = `<div class="empty">${escapeHtml(error.message || "AI 分析失敗")}</div>`;
  }
}function setupActions() {
  document.addEventListener("click", (event) => {
    const deleteStudentId = event.target.dataset.deleteStudent;
    const editStudentId = event.target.dataset.editStudent;
    const toggleWithdrawnId = event.target.dataset.toggleWithdrawn;
    const editCourseName = event.target.dataset.editCourse;
    const deleteCourseName = event.target.dataset.deleteCourse;
    const cleanArchiveYear = event.target.dataset.cleanArchiveYear;
    const seatSection = event.target.closest("[data-seat-section]")?.dataset.seatSection;
    const addSeatRight = event.target.dataset.addLayoutSeatRight;
    const addSeatDown = event.target.dataset.addLayoutSeatDown;
    const addAisleRight = event.target.dataset.addLayoutAisleRight;
    const addAisleDown = event.target.dataset.addLayoutAisleDown;
    const addColumnRight = event.target.dataset.addLayoutColumnRight;
    const deleteSeat = event.target.dataset.deleteLayoutCell;
    const rollSeatStudentId = event.target.closest("[data-roll-seat]")?.dataset.rollSeat;
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
    const editTermPeriodKey = event.target.dataset.editTermPeriod;
    const deleteTermPeriodKey = event.target.dataset.deleteTermPeriod;
    const editEventId = event.target.dataset.editEvent;
    const deleteEventId = event.target.dataset.deleteEvent;
    const editContactId = event.target.dataset.editContact;
    const deleteContactId = event.target.dataset.deleteContact;
    const deleteTeacherId = event.target.dataset.deleteTeacher;
    const printPaperAnalysisId = event.target.dataset.printPaperAnalysis;
    const deletePaperAnalysisId = event.target.dataset.deletePaperAnalysis;
    const aiStudentId = event.target.dataset.aiStudent;
    const applyAcademicPeriod = event.target.dataset.applyAcademicPeriod;
    const editAcademicPeriod = event.target.dataset.editAcademicPeriod;
    const openClassOpsPeriod = event.target.dataset.openClassOpsPeriod;
    const careerWeek = event.target.dataset.careerWeek;
    const examHistoryPageTarget = event.target.dataset.examHistoryPage;

    if (examHistoryPageTarget) {
      examHistoryPage = Math.max(1, Number(examHistoryPageTarget) || 1);
      renderExamHistory();
    }
    if (seatSection) {
      seatSettingsSection = seatSection;
      renderSeatSettingBoard();
      return;
    }
    if (addSeatRight) {
      changeRoomLayout(addSeatRight, "right");
      return;
    }
    if (addSeatDown) {
      changeRoomLayout(addSeatDown, "down");
      return;
    }
    if (addAisleRight) {
      changeRoomLayout(addAisleRight, "aisle-right");
      return;
    }
    if (addAisleDown) {
      changeRoomLayout(addAisleDown, "aisle-down");
      return;
    }
    if (addColumnRight) {
      changeRoomLayout(addColumnRight, "column-right");
      return;
    }
    if (event.target.closest("[data-copy-roll-report]")) {
      const text = event.target.closest(".roll-summary")?.querySelector(".copy-box")?.value || "";
      navigator.clipboard?.writeText(text).then(() => flashButton(event.target.closest("button"), "已複製")).catch(() => {
        const box = event.target.closest(".roll-summary")?.querySelector(".copy-box");
        box?.select();
        document.execCommand("copy");
        flashButton(event.target.closest("button"), "已複製");
      });
      return;
    }
    if (deleteSeat) {
      deleteRoomLayoutCell(deleteSeat);
      return;
    }
    if (aiStudentId) {
      generateStudentAiAnalysis(aiStudentId, event.target.closest(".ai-analysis-panel")?.querySelector(".ai-analysis-result"));
    }
    if (rollSeatStudentId) {
      const record = currentRollRecord();
      record.statuses[rollSeatStudentId] = record.statuses[rollSeatStudentId] === "present" ? "" : "present";
      if (!record.statuses[rollSeatStudentId]) delete record.statuses[rollSeatStudentId];
      record.updatedAt = new Date().toISOString();
      saveState();
      scheduleSupabaseRefresh();
      renderRollCall();
      renderTodayClassAttendance();
    }
    if (printPaperAnalysisId) {
      const record = state.paperAnalyses.find((item) => item.id === printPaperAnalysisId);
      if (record) printPaperAnalysisPdf(record);
    }
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
    if (toggleWithdrawnId) {
      const student = getStudent(toggleWithdrawnId);
      if (student) {
        student.withdrawn = !student.withdrawn;
        student.withdrawnAt = student.withdrawn ? new Date().toISOString() : "";
      }
    }
    if (editCourseName) {
      editingCourseName = editCourseName;
      $("#courseName").value = editCourseName;
      $("#cancelCourseEdit").hidden = false;
      navigateToTab("course-admin");
    }
    if (deleteCourseName && !coreCourses.includes(deleteCourseName) && confirm(`確定刪除課程「${deleteCourseName}」？歷史成績不會刪除。`)) {
      state.courseCatalog = normalizeCourseCatalog(state.courseCatalog).filter((item) => item.name !== deleteCourseName);
      state.deletedCourseNames = [...new Set([...(state.deletedCourseNames || []), deleteCourseName])];
      applyCourseCatalog(state.courseCatalog);
    }
    if (cleanArchiveYear) {
      if (Number(cleanArchiveYear) > currentRocYear() - 3) return alert("尚未滿三年，不能清理。");
      const password = prompt(`清理 ${cleanArchiveYear} 學年資料需輸入密碼`);
      if (password !== "44775709") return alert("密碼錯誤，已取消。");
      if (confirm(`確定清理 ${cleanArchiveYear} 學年的請假紀錄與週考成績單？`)) {
        const removedExamIds = state.exams.filter((exam) => exam.academicYear === cleanArchiveYear).map((exam) => exam.id);
        state.deletedExamIds = [...new Set([...(state.deletedExamIds || []), ...removedExamIds])];
        removedExamIds.forEach((id) => deleteSupabaseExamRecord(id).catch(() => {}));
        state.exams = state.exams.filter((exam) => exam.academicYear !== cleanArchiveYear);
        const removedLeaveIds = state.leaves.filter((record) => academicPeriodForDate(getLeaveStart(record)).academicYear === cleanArchiveYear).map((record) => record.id);
        state.deletedLeaveIds = [...new Set([...(state.deletedLeaveIds || []), ...removedLeaveIds])];
        state.leaves = state.leaves.filter((record) => academicPeriodForDate(getLeaveStart(record)).academicYear !== cleanArchiveYear);
      }
    }
    if (careerWeek) {
      const isParentWeek = Boolean(event.target.closest("#parentScoreList"));
      const target = isParentWeek ? $("#parentScoreDate") : $("#careerQueryDate");
      const amount = Number(careerWeek) * 7;
      if (target) {
        target.value = addDays(target.value || todayISO(), amount);
        if (isParentWeek && parentStudentId) renderParentPortal();
        else renderStudentReport();
      }
    }
    if (editStudentId) {
      const student = getStudent(editStudentId);
      if (student) {
        fillStudentForm(student);
        navigateToTab("students");
        window.scrollTo({ top: 0, behavior: "smooth" });
        $("#studentName").focus({ preventScroll: true });
      }
    }
    if (deleteStudentId && confirm("確定移除這位學生檔案？相關請假與晚到紀錄也會一起移除。")) {
      const removedLeaveIds = state.leaves.filter((record) => record.studentId === deleteStudentId).map((record) => record.id);
      const removedLateIds = state.lateRecords.filter((record) => record.studentId === deleteStudentId).map((record) => record.id);
      state.students = state.students.filter((student) => student.id !== deleteStudentId);
      state.deletedStudentIds = [...new Set([...(state.deletedStudentIds || []), deleteStudentId])];
      state.leaves = state.leaves.filter((record) => record.studentId !== deleteStudentId);
      state.deletedLeaveIds = [...new Set([...(state.deletedLeaveIds || []), ...removedLeaveIds])];
      state.lateRecords = state.lateRecords.filter((record) => record.studentId !== deleteStudentId);
      state.deletedLateIds = [...new Set([...(state.deletedLateIds || []), ...removedLateIds])];
      if (editingStudentId === deleteStudentId) clearStudentForm();
    }
    if (dismissLeaveId) {
      const leave = state.leaves.find((record) => record.id === dismissLeaveId);
      if (leave) leave.dismissedAt = new Date().toISOString();
    }
    if (deleteLeaveId && confirm("確定移除這筆請假？這會從歷史紀錄中刪除。")) {
      state.leaves = state.leaves.filter((record) => record.id !== deleteLeaveId);
      state.deletedLeaveIds = [...new Set([...(state.deletedLeaveIds || []), deleteLeaveId])];
    }
    if (removeLateId) {
      const late = state.lateRecords.find((record) => record.id === removeLateId);
      if (late) late.dismissedAt = new Date().toISOString();
    }
    if (deleteLateId && confirm("確定刪除這筆晚到紀錄？刪除後不會保留在歷史紀錄。")) {
      state.lateRecords = state.lateRecords.filter((record) => record.id !== deleteLateId);
      state.deletedLateIds = [...new Set([...(state.deletedLateIds || []), deleteLateId])];
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
      state.deletedExamIds = [...new Set([...(state.deletedExamIds || []), deleteExamId])];
      deleteSupabaseExamRecord(deleteExamId).catch(() => {});
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
    if (applyAcademicPeriod) {
      applyAcademicPeriodKey(applyAcademicPeriod);
    }
    if (editAcademicPeriod) {
      const [academicYear, semester] = String(editAcademicPeriod).split("|");
      if ($("#academicYear")) $("#academicYear").value = academicYear;
      if ($("#academicSemester")) $("#academicSemester").value = semester;
      navigateToTab("academic");
      $("#academicYear")?.focus();
    }
    if (openClassOpsPeriod) {
      applyAcademicPeriodKey(openClassOpsPeriod, true);
      classOpsSection = "grade";
      navigateToTab("class-ops");
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
    if (deleteContactId && confirm("確定刪除這筆聯絡本？")) {
      state.contactBooks = state.contactBooks.filter((item) => item.id !== deleteContactId);
    }
    if (editContactId) {
      const record = state.contactBooks.find((item) => item.id === editContactId);
      if (record) {
        setContactBookSection("book");
        fillContactForm(record);
      }
    }
    if (editTermPeriodKey) {
      applyTermPeriodGroup(editTermPeriodKey);
      navigateToTab("term");
      renderAll();
      $("#termPeriodForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (deleteTermPeriodKey && confirm("確定刪除這組段考區間？成績不會被刪除，只會移除分析用日期範圍。")) {
      deleteTermPeriodGroup(deleteTermPeriodKey);
      saveState();
      renderAll();
    }
    if (deleteTeacherId && confirm("確定刪除這張師資卡？")) {
      state.about = normalizeAboutSettings(state.about || {});
      state.about.teacherCards = state.about.teacherCards.filter((teacher) => teacher.id !== deleteTeacherId);
    }
    if (deletePaperAnalysisId && confirm("確定刪除這筆考卷分析？")) {
      state.paperAnalyses = state.paperAnalyses.filter((item) => item.id !== deletePaperAnalysisId);
    }

    if (deleteStudentId || toggleWithdrawnId || deleteCourseName || cleanArchiveYear || dismissLeaveId || deleteLeaveId || removeLateId || deleteLateId || deleteExamId || deleteEventId || deleteContactId || deleteTeacherId || deletePaperAnalysisId) {
      saveState();
      renderAll();
    }
  });
}

function showLogin() {
  closeParentDrawer();
  $("#loginScreen").hidden = false;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = true;
  $("#appShell").hidden = true;
  $("#loginPassword").value = "";
  $("#loginPassword").focus();
}

function showApp() {
  closeParentDrawer();
  $("#loginScreen").hidden = true;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = true;
  $("#appShell").hidden = false;
  $("#currentBranchLabel").textContent = `${currentBranch}分校`;
}

function showParentLogin() {
  closeParentDrawer();
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = true;
  $("#parentShell").hidden = true;
  $("#parentLoginScreen").hidden = false;
  $("#parentCode").focus();
}

function showParentShell() {
  closeParentDrawer();
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = true;
  $("#parentLoginScreen").hidden = true;
  $("#parentShell").hidden = false;
}

async function loadParentBranchState(branch) {
  cleanupCloudSync();
  currentBranch = branch;
  state = loadState();
  if (hasSupabaseConfig()) {
    const { createClient } = await import(`https://esm.sh/@supabase/supabase-js@${SUPABASE_SDK_VERSION}`);
    supabaseClient = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    const remote = await loadSupabaseState();
    const remoteExamRecords = await loadSupabaseExamRecords().catch(() => []);
    if (remote) {
      state = normalizeState(remote.data || emptyState());
      state.exams = mergeExams(state.exams, remoteExamRecords, state.deletedExamIds);
      lastRemoteUpdatedAt = remote.updatedAt || "";
    }
    syncReady = true;
    supabasePollTimer = setInterval(checkSupabaseState, 500);
  }
  localStorage.setItem(storageKey(), JSON.stringify(state));
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
  if ($("#parentDrawerStudent")) $("#parentDrawerStudent").textContent = `${student.grade} ${student.name}`;
  $("#parentOwnCode").value = student.parentCode || "";
  $("#parentCodeUpdateError").hidden = true;
  $("#parentEventList").innerHTML = sortedEvents(state.events.filter((record) => eventVisibleToStudent(record, student)))
    .map((record) => renderEventCard(record))
    .join("") || `<div class="empty">目前尚無重大行事曆公告。</div>`;
  renderContactFilters(student);
  if ($("#parentContactBookList")) {
    const contactSubject = $("#parentContactSubjectFilter")?.value || "全部";
    const queryDate = parentContactWeekDate || $("#parentContactWeekDate")?.value || todayISO();
    const week = weekDates(queryDate);
    parentContactWeekDate = queryDate;
    if ($("#parentContactWeekDate")) $("#parentContactWeekDate").value = queryDate;
    if ($("#parentContactWeekLabel")) $("#parentContactWeekLabel").textContent = weekRangeLabel(queryDate);
    $("#parentContactBookList").innerHTML = sortedContactBooks(state.contactBooks.filter((record) =>
      parentContactRecordVisible(record, student) &&
      week.includes(record.date) &&
      (contactSubject === "全部" || record.subject === contactSubject)
    ))
      .map((record) => renderContactBookCard(record, false, student))
      .join("") || `<div class="empty">本週沒有符合科目的聯絡本。</div>`;
  }  if ($("#parentAboutContent")) $("#parentAboutContent").innerHTML = aboutHtml(normalizeAboutSettings(state.about || {}));
  $("#parentLeaveList").innerHTML = state.leaves
    .filter((record) => record.studentId === student.id)
    .sort((a, b) => getLeaveStart(b).localeCompare(getLeaveStart(a)))
    .map(renderLeaveCard)
    .join("") || `<div class="empty">尚無請假紀錄。</div>`;
  if (parentCareerSubject !== "全部" && !careerSubjectsForStudent(student).includes(parentCareerSubject)) parentCareerSubject = "全部";
  renderReportRangeOptions();
  renderParentCareerSubjectButtons(student);
  const period = weeklyPeriodFilter("parentExam", student);
  $("#parentScoreList").innerHTML = careerScoreLookupHtml(student, $("#parentScoreDate")?.value || todayISO(), selectedParentCareerSubject(student), { hideDateHistory: true, period });
  renderParentTermTrend(student);
  renderParentTermAnalysisReport(student);
  $("#parentReport").innerHTML = renderStudentReportHtml(student, selectedParentCareerSubject(student), { hideAi: true });
  setParentSection(parentActiveSection);
  renderParentReportView();
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
    parentActiveSection = "parentHomeSection";
    parentBackStack = [];
    parentReportView = "menu";
    parentContactWeekDate = todayISO();
    $("#parentLoginError").hidden = true;
    showParentShell();
    renderParentPortal();
    setupCloudSync();
  });

  $("#parentCodeForm")?.addEventListener("submit", updateParentOwnCode);

  $("#parentLogout").addEventListener("click", () => {
    parentStudentId = null;
    parentReportView = "menu";
    parentContactWeekDate = todayISO();
    cleanupCloudSync();
    showParentLogin();
  });
  $("#backTeacherLogin")?.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    showLogin();
  });
}

function renderAll() {
  roomLayouts = state.roomLayouts || normalizeRoomLayouts({}, state.seatSettings);
  applyCourseCatalog(state.courseCatalog);
  $("#studentCount").textContent = dashboardStudents().length;
  renderAcademicSettings();
  renderAcademicPeriodList();
  renderArchiveCleanup();
  renderExamSubjectOptions();
  renderReportRangeOptions();
  renderScoreStudentFilter();
  renderExpectedAttendance();
  renderTodayClassAttendance();
  renderStudentOptions();
  renderStudents();
  renderSchedule();
  renderCourseAdmin();
  renderSeatSettingBoard();
  renderRollCall();
  renderPaperTopicInputs(paperTopicValues());
  renderScoreEntryList();
  renderScoreLiveStatus();
  renderScoreSections();
  renderClassReport();
  renderExamHistory();
  renderStudentReport();
  renderTermSections();
  renderTermAcademicOptions();
  renderTermWeightControls();
  renderTermScoreEntryList();
  renderTermReport();
  renderTermHistoryList();
  renderTermPeriodSettings();
  renderTermPeriodList();
  renderClassOps();
  renderRetentionReport();
  renderPromotionPreview();
  renderEventManageList();
  renderContactBooks();
  renderPaperAnalyses();
  renderAboutSettings();
  renderAiSettings();
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
  $("#classOpsWeekDate").value = todayISO();
  if ($("#rollDate")) $("#rollDate").value = todayISO();
  $("#parentScoreDate").value = todayISO();
  if ($("#parentContactWeekDate")) $("#parentContactWeekDate").value = todayISO();
  parentContactWeekDate = todayISO();
  if ($("#paperAnalysisDate")) $("#paperAnalysisDate").value = todayISO();
  $("#termYear").value = String(new Date().getFullYear() - 1911);
  $("#careerTermAnalysisYear").value = String(new Date().getFullYear() - 1911);
  $("#parentTermAnalysisYear").value = String(new Date().getFullYear() - 1911);
  state.settings = normalizeAcademicSettings(state.settings);
  renderAcademicSettings();
  renderExamSubjectOptions();
  $("#lateDate").value = todayISO();
  $("#contactDate").value = todayISO();
  renderContactSubjectOptions();
  renderSeatSubjectOptions();
  renderPaperAnalysisSubjectOptions();
  $("#eventStartDate").value = todayISO();
  $("#eventEndDate").value = todayISO();
  setupTabs();
  mobileQuery.addEventListener("change", enforceMobilePages);
  setupDashboardFilter();
  setupForms();
  setupActions();
  setupLogin();
  setupParentDrawer();
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
