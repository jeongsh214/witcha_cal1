let displayMode = "value";
let latestRenderData = null;
let characterRows = [];

const CHARACTER_CSV_PATH = "./characters.csv";
const CHARACTER_HEADERS = [
  "이름",
  "등급",
  "체력",
  "공격력",
  "방어력",
  "치명타 확률",
  "명중률",
  "민첩",
  "기각여부"
];

function normalizeKey(key) {
  return String(key).replace(/\s+/g, " ").trim();
}

function parseValue(rawValue) {
  const text = String(rawValue).trim();

  const rangeMatch = text.match(/^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);

    return {
      type: "range",
      raw: text,
      min: Math.min(min, max),
      max: Math.max(min, max)
    };
  }

  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  if (numberMatch) {
    const num = Number(text);

    return {
      type: "fixed",
      raw: text,
      min: num,
      max: num
    };
  }

  return {
    type: "text",
    raw: text,
    min: null,
    max: null
  };
}

function splitLine(line) {
  if (line.includes("\t")) {
    const parts = line.split("\t").map(v => v.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        key: parts[0],
        value: parts.slice(1).join(" ")
      };
    }
  }

  if (line.includes(":")) {
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (key && value) {
      return { key, value };
    }
  }

  const parts = line.split(/\s{2,}/).map(v => v.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      key: parts[0],
      value: parts.slice(1).join(" ")
    };
  }

  return null;
}

function parseBlock(text) {
  const lines = String(text)
    .split("\n")
    .map(line => line.replace(/\r/g, "").trim())
    .filter(Boolean);

  const parsed = {
    title: "",
    fields: {}
  };

  lines.forEach((line, index) => {
    const pair = splitLine(line);

    if (!pair) {
      if (index === 0 && !parsed.title) {
        parsed.title = line;
      }
      return;
    }

    const key = normalizeKey(pair.key);
    parsed.fields[key] = parseValue(pair.value);
  });

  return parsed;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsvText(csvText) {
  const lines = String(csvText)
    .split("\n")
    .map(line => line.replace(/\r/g, ""))
    .filter(line => line.trim() !== "");

  if (lines.length < 2) {
    return {};
  }

  const headers = parseCsvLine(lines[0]);
  const result = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const grade = cols[0];

    if (!grade) continue;

    const fields = {
      등급: {
        type: "text",
        raw: grade,
        min: null,
        max: null
      }
    };

    for (let j = 1; j < headers.length; j++) {
      const key = normalizeKey(headers[j]);
      const value = cols[j] ?? "";

      if (!value) continue;
      fields[key] = parseValue(value);
    }

    result[grade] = {
      title: `${grade} 기준 스텟`,
      fields
    };
  }

  return result;
}

async function loadTargetStats() {
  const response = await fetch("./target-stats.csv", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("기준 CSV 파일을 불러오지 못했다.");
  }

  const csvText = await response.text();
  return parseCsvText(csvText);
}

function formatDiff(diff, baseValue) {
  if (displayMode === "percent") {
    if (!baseValue) {
      return "0%";
    }

    const percent = Math.round((Math.abs(diff) / baseValue) * 100);
    return `${percent}%`;
  }

  return String(Math.abs(diff));
}

function makePart(title, diff, fixedLabel, baseValue) {
  if (fixedLabel !== undefined) {
    return {
      title,
      text: fixedLabel,
      className: fixedLabel === "동일" ? "equal" : "under"
    };
  }

  const amount = formatDiff(diff, baseValue);

  if (diff > 0) {
    return {
      title,
      text: `${amount} 초과`,
      className: "over"
    };
  }

  if (diff < 0) {
    return {
      title,
      text: `${amount} 미달`,
      className: "under"
    };
  }

  return {
    title,
    text: "동일",
    className: "equal"
  };
}

function compareTextStat(name, charStat, targetStat) {
  const same = charStat.raw === targetStat.raw;

  return {
    name,
    status: same ? "equal" : "under",
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
    parts: [
      makePart("값", null, same ? "동일" : "불일치")
    ]
  };
}

function compareNumberStat(name, charStat, targetStat) {
  const cMin = charStat.min;
  const cMax = charStat.max;
  const tMin = targetStat.min;
  const tMax = targetStat.max;

  if (charStat.type === "fixed" && targetStat.type === "fixed") {
    const valuePart = makePart("값", cMin - tMin, undefined, tMin);

    return {
      name,
      status: valuePart.className,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [valuePart]
    };
  }

  if (charStat.type === "range" && targetStat.type === "fixed") {
    const minPart = makePart("최소", cMin - tMin, undefined, tMin);
    const maxPart = makePart("최대", cMax - tMin, undefined, tMin);

    let status = "equal";
    if (minPart.className === "under" || maxPart.className === "under") {
      status = "under";
    } else if (minPart.className === "over" || maxPart.className === "over") {
      status = "over";
    }

    return {
      name,
      status,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [minPart, maxPart]
    };
  }

  if (charStat.type === "fixed" && targetStat.type === "range") {
    const minPart = makePart("기준 최소 대비", cMin - tMin, undefined, tMin);
    const maxPart = makePart("기준 최대 대비", cMin - tMax, undefined, tMax);

    let status = "equal";
    if (minPart.className === "under" || maxPart.className === "under") {
      status = "under";
    } else if (minPart.className === "over" || maxPart.className === "over") {
      status = "over";
    }

    return {
      name,
      status,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [minPart, maxPart]
    };
  }

  const minPart = makePart("최소", cMin - tMin, undefined, tMin);
  const maxPart = makePart("최대", cMax - tMax, undefined, tMax);

  let status = "equal";
  if (minPart.className === "under" || maxPart.className === "under") {
    status = "under";
  } else if (minPart.className === "over" || maxPart.className === "over") {
    status = "over";
  }

  return {
    name,
    status,
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
    parts: [minPart, maxPart]
  };
}

function compareBlocks(character, target) {
  const results = [];
  const allKeys = [...new Set([
    ...Object.keys(character.fields),
    ...Object.keys(target.fields)
  ])];

  allKeys.forEach(key => {
    const charStat = character.fields[key];
    const targetStat = target.fields[key];

    if (!charStat) {
      results.push({
        name: key,
        status: "warn",
        detail: `캐릭터 입력에 ${key} 항목이 없다.`,
        parts: [
          {
            title: "상태",
            text: "캐릭터 누락",
            className: "warn"
          }
        ]
      });
      return;
    }

    if (!targetStat) {
      results.push({
        name: key,
        status: "warn",
        detail: `기준 데이터에 ${key} 항목이 없다.`,
        parts: [
          {
            title: "상태",
            text: "기준 누락",
            className: "warn"
          }
        ]
      });
      return;
    }

    if (charStat.type === "text" || targetStat.type === "text") {
      results.push(compareTextStat(key, charStat, targetStat));
      return;
    }

    results.push(compareNumberStat(key, charStat, targetStat));
  });

  return results;
}

function renderParsed(parsed) {
  const lines = Object.entries(parsed.fields).map(([key, value]) => {
    let typeLabel = "텍스트";

    if (value.type === "fixed") {
      typeLabel = "고정값";
    }

    if (value.type === "range") {
      typeLabel = "범위값";
    }

    if (value.type === "text") {
      return `<div class="parsed-line"><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value.raw)} <span class="parsed-type">(${typeLabel})</span></div>`;
    }

    return `<div class="parsed-line"><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value.raw)} <span class="parsed-type">(${typeLabel} / min ${value.min}, max ${value.max})</span></div>`;
  }).join("");

  return lines || '<div class="parsed-line">읽힌 항목이 없다.</div>';
}

function renderResults(character, target, results) {
  const overCount = results.filter(r => r.status === "over").length;
  const underCount = results.filter(r => r.status === "under").length;
  const equalCount = results.filter(r => r.status === "equal").length;
  const warnCount = results.filter(r => r.status === "warn").length;

  const resultHtml = results.map(item => {
    const partsHtml = (item.parts || []).map(part => `
      <div class="compare-part">
        <div class="compare-part-title">${escapeHtml(part.title)}</div>
        <div class="badge ${part.className}">${escapeHtml(part.text)}</div>
      </div>
    `).join("");

    return `
      <div class="result-item">
        <div class="result-top">
          <div class="stat-name">${escapeHtml(item.name)}</div>
        </div>
        <div class="compare-parts">${partsHtml}</div>
        <div class="stat-detail">${escapeHtml(item.detail)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="summary">
      <div class="mini-box">
        <div class="mini-label">초과</div>
        <div class="mini-value">${overCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">미달</div>
        <div class="mini-value">${underCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">동일</div>
        <div class="mini-value">${equalCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">누락</div>
        <div class="mini-value">${warnCount}</div>
      </div>
    </div>

    <div class="meta">
      <div class="tag">캐릭터 제목: ${escapeHtml(character.title || "없음")}</div>
      <div class="tag">기준 제목: ${escapeHtml(target.title || "없음")}</div>
      <div class="tag">표시 방식: ${displayMode === "percent" ? "%" : "수치"}</div>
    </div>

    <div class="section-title">비교 상세</div>
    <div class="result-list">${resultHtml || '<div class="empty">비교 결과가 없다.</div>'}</div>

    <div class="section-title">캐릭터 파싱 결과</div>
    <div class="parsed-box">${renderParsed(character)}</div>

    <div class="section-title">기준 파싱 결과</div>
    <div class="parsed-box">${renderParsed(target)}</div>
  `;
}

function getCharacterGrade(character) {
  const gradeField = character.fields["등급"];
  return gradeField ? String(gradeField.raw).trim() : "";
}

function setDisplayMode(mode) {
  displayMode = mode;

  if (valueModeBtn && percentModeBtn) {
    valueModeBtn.classList.toggle("active", mode === "value");
    percentModeBtn.classList.toggle("active", mode === "percent");
  }

  if (latestRenderData && resultArea) {
    const { character, target } = latestRenderData;
    const refreshedResults = compareBlocks(character, target);
    latestRenderData = { character, target, results: refreshedResults };
    resultArea.innerHTML = renderResults(character, target, refreshedResults);
  }
}

function applyTheme(theme) {
  document.body.classList.toggle("dark-mode", theme === "dark");

  if (themeToggleBtn) {
    themeToggleBtn.innerText = theme === "dark" ? "일반모드" : "다크모드";
  }

  localStorage.setItem("theme", theme);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(text) {
  return escapeHtml(text);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function getStatusText(code) {
  switch (String(code)) {
    case "1": return "승인";
    case "2": return "기각";
    case "3": return "보류";
    default: return "미심사";
  }
}

function normalizeStatus(code) {
  const text = String(code ?? "").trim();
  return ["0", "1", "2", "3"].includes(text) ? text : "0";
}

function getFieldRaw(parsed, key) {
  return parsed.fields[key] ? String(parsed.fields[key].raw).trim() : "";
}

function parsedCharacterToRow(parsed) {
  return {
    이름: getFieldRaw(parsed, "이름"),
    등급: getFieldRaw(parsed, "등급"),
    체력: getFieldRaw(parsed, "체력"),
    공격력: getFieldRaw(parsed, "공격력"),
    방어력: getFieldRaw(parsed, "방어력"),
    "치명타 확률": getFieldRaw(parsed, "치명타 확률"),
    명중률: getFieldRaw(parsed, "명중률"),
    민첩: getFieldRaw(parsed, "민첩"),
    기각여부: normalizeStatus(getFieldRaw(parsed, "기각여부") || "0")
  };
}

function rowToInputText(row) {
  return [
    "캐릭터 스텟",
    `이름\t${row.이름 || ""}`,
    `등급\t${row.등급 || ""}`,
    `체력\t${row.체력 || ""}`,
    `공격력\t${row.공격력 || ""}`,
    `방어력\t${row.방어력 || ""}`,
    `치명타 확률\t${row["치명타 확률"] || ""}`,
    `명중률\t${row.명중률 || ""}`,
    `민첩\t${row.민첩 || ""}`,
    `기각여부\t${normalizeStatus(row.기각여부)}`
  ].join("\n");
}

function parseCharactersCsv(csvText) {
  const lines = String(csvText)
    .split("\n")
    .map(line => line.replace(/\r/g, ""))
    .filter(line => line.trim() !== "");

  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });

    return {
      이름: row["이름"] || "",
      등급: row["등급"] || "",
      체력: row["체력"] || "",
      공격력: row["공격력"] || "",
      방어력: row["방어력"] || "",
      "치명타 확률": row["치명타 확률"] || "",
      명중률: row["명중률"] || "",
      민첩: row["민첩"] || "",
      기각여부: normalizeStatus(row["기각여부"] || "0")
    };
  }).filter(row => row.이름);
}

function buildCharactersCsv(rows) {
  const headerLine = CHARACTER_HEADERS.join(",");
  const bodyLines = rows.map(row =>
    CHARACTER_HEADERS.map(header => csvEscape(row[header] ?? "")).join(",")
  );
  return [headerLine, ...bodyLines].join("\n");
}

async function loadCharactersCsv() {
  const response = await fetch(CHARACTER_CSV_PATH, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("characters.csv 파일을 불러오지 못했다.");
  }

  const csvText = await response.text();
  return parseCharactersCsv(csvText);
}

function updateCharacterListInfo() {
  if (!characterListInfo) return;

  const total = characterRows.length;
  const pending = characterRows.filter(row => normalizeStatus(row.기각여부) === "0").length;
  const approved = characterRows.filter(row => normalizeStatus(row.기각여부) === "1").length;
  const rejected = characterRows.filter(row => normalizeStatus(row.기각여부) === "2").length;
  const hold = characterRows.filter(row => normalizeStatus(row.기각여부) === "3").length;

  characterListInfo.textContent = `전체 ${total}명 / 미심사 ${pending} / 승인 ${approved} / 기각 ${rejected} / 보류 ${hold}`;
}

function renderCharacterList() {
  if (!characterList) return;

  if (!characterRows.length) {
    characterList.innerHTML = '<div class="empty">캐릭터 목록이 없다.</div>';
    updateCharacterListInfo();
    return;
  }

  characterList.innerHTML = characterRows.map(row => {
    const status = normalizeStatus(row.기각여부);
    const summary = [
      row.체력 ? `체력 ${row.체력}` : "",
      row.공격력 ? `공격력 ${row.공격력}` : "",
      row.방어력 ? `방어력 ${row.방어력}` : ""
    ].filter(Boolean).join(" / ");

    return `
      <div class="character-row status-${status}" data-name="${escapeHtmlAttr(row.이름)}">
        <div class="character-check-wrap">
          <input class="char-check" type="checkbox" data-name="${escapeHtmlAttr(row.이름)}" />
        </div>

        <div class="character-main">
          <div class="character-name">${escapeHtml(row.이름)}</div>
          <div class="character-grade">등급: ${escapeHtml(row.등급 || "-")}</div>
        </div>

        <div class="character-status-text">${escapeHtml(getStatusText(status))}</div>

        <div class="character-stats">${escapeHtml(summary || "스탯 요약 없음")}</div>

        <select class="status-select" data-name="${escapeHtmlAttr(row.이름)}">
          <option value="0" ${status === "0" ? "selected" : ""}>미심사</option>
          <option value="1" ${status === "1" ? "selected" : ""}>승인</option>
          <option value="2" ${status === "2" ? "selected" : ""}>기각</option>
          <option value="3" ${status === "3" ? "selected" : ""}>보류</option>
        </select>

        <button class="secondary load-btn" type="button" data-load-name="${escapeHtmlAttr(row.이름)}">불러오기</button>
      </div>
    `;
  }).join("");

  updateCharacterListInfo();
}

async function reloadCharacterList() {
  if (characterList) {
    characterList.innerHTML = '<div class="empty">목록을 불러오는 중...</div>';
  }
  if (characterListInfo) {
    characterListInfo.textContent = "목록을 불러오는 중...";
  }

  try {
    characterRows = await loadCharactersCsv();
    renderCharacterList();

    if (resultArea) {
      resultArea.innerHTML = '<div class="empty">characters.csv를 다시 불러왔다.</div>';
    }
  } catch (error) {
    characterRows = [];
    renderCharacterList();

    if (resultArea) {
      resultArea.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }
}

function upsertCharacterRow(row) {
  const existingIndex = characterRows.findIndex(item => item.이름 === row.이름);

  if (existingIndex >= 0) {
    const prevStatus = normalizeStatus(characterRows[existingIndex].기각여부);
    characterRows[existingIndex] = {
      ...characterRows[existingIndex],
      ...row,
      기각여부: row.기각여부 ? normalizeStatus(row.기각여부) : prevStatus
    };
  } else {
    characterRows.push({
      ...row,
      기각여부: normalizeStatus(row.기각여부)
    });
  }

  characterRows.sort((a, b) => a.이름.localeCompare(b.이름, "ko"));
  renderCharacterList();
}

function addComparedCharacterToList() {
  if (!latestRenderData || !latestRenderData.character || !resultArea) {
    resultArea.innerHTML = '<div class="empty">먼저 비교하기를 눌러 캐릭터를 비교해라.</div>';
    return;
  }

  const row = parsedCharacterToRow(latestRenderData.character);

  if (!row.이름) {
    resultArea.innerHTML = '<div class="empty">비교한 캐릭터에 "이름" 항목이 없어서 목록에 추가할 수 없다.</div>';
    return;
  }

  upsertCharacterRow(row);
  resultArea.innerHTML = `<div class="empty">"${escapeHtml(row.이름)}" 캐릭터를 목록에 추가했다. CSV 다운로드 후 GitHub에 덮어쓰면 반영된다.</div>`;
}

function loadCharacterByName(name) {
  const found = characterRows.find(item => item.이름 === name);

  if (!found || !characterInput || !resultArea) {
    resultArea.innerHTML = `<div class="empty">"${escapeHtml(name)}" 캐릭터를 찾지 못했다.</div>`;
    return;
  }

  characterInput.value = rowToInputText(found);
  latestRenderData = null;
  resultArea.innerHTML = `<div class="empty">"${escapeHtml(name)}" 캐릭터를 입력창에 불러왔다.</div>`;
}

function updateCharacterStatus(name, status) {
  const found = characterRows.find(item => item.이름 === name);
  if (!found) return;

  found.기각여부 = normalizeStatus(status);
  renderCharacterList();

  if (resultArea) {
    resultArea.innerHTML = `<div class="empty">"${escapeHtml(name)}" 상태를 ${escapeHtml(getStatusText(status))}로 변경했다. CSV 다운로드 시 반영된다.</div>`;
  }
}

function getCheckedNames() {
  return Array.from(document.querySelectorAll(".char-check:checked"))
    .map(input => input.dataset.name)
    .filter(Boolean);
}

function selectAllCharacters(checked) {
  document.querySelectorAll(".char-check").forEach(input => {
    input.checked = checked;
  });
}

function selectReviewedCharacters() {
  document.querySelectorAll(".char-check").forEach(input => {
    const name = input.dataset.name;
    const found = characterRows.find(item => item.이름 === name);
    const status = normalizeStatus(found?.기각여부);

    input.checked = status === "1" || status === "2";
  });
}

function deleteSelectedCharacters() {
  const checkedNames = getCheckedNames();

  if (!checkedNames.length) {
    if (resultArea) {
      resultArea.innerHTML = '<div class="empty">삭제할 캐릭터를 먼저 선택해라.</div>';
    }
    return;
  }

  characterRows = characterRows.filter(row => !checkedNames.includes(row.이름));
  renderCharacterList();

  if (resultArea) {
    resultArea.innerHTML = `<div class="empty">${checkedNames.length}개 캐릭터를 목록에서 삭제했다. CSV 다운로드 후 GitHub에 덮어쓰면 반영된다.</div>`;
  }
}

function downloadCharactersCsv() {
  const csvText = buildCharactersCsv(characterRows);
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "characters.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (resultArea) {
    resultArea.innerHTML = '<div class="empty">현재 목록 상태로 characters.csv를 다운로드했다.</div>';
  }
}

const characterInput = document.getElementById("characterInput");
const resultArea = document.getElementById("resultArea");
const compareBtn = document.getElementById("compareBtn");
const sampleBtn = document.getElementById("sampleBtn");
const clearBtn = document.getElementById("clearBtn");
const valueModeBtn = document.getElementById("valueModeBtn");
const percentModeBtn = document.getElementById("percentModeBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const addComparedCharacterBtn = document.getElementById("addComparedCharacterBtn");
const reloadCharactersBtn = document.getElementById("reloadCharactersBtn");
const downloadCharactersBtn = document.getElementById("downloadCharactersBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const selectReviewedBtn = document.getElementById("selectReviewedBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const characterList = document.getElementById("characterList");
const characterListInfo = document.getElementById("characterListInfo");

const savedTheme = localStorage.getItem("theme") || "light";
applyTheme(savedTheme);
reloadCharacterList();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
    applyTheme(nextTheme);
  });
}

if (valueModeBtn) {
  valueModeBtn.addEventListener("click", () => {
    setDisplayMode("value");
  });
}

if (percentModeBtn) {
  percentModeBtn.addEventListener("click", () => {
    setDisplayMode("percent");
  });
}

if (reloadCharactersBtn) {
  reloadCharactersBtn.addEventListener("click", () => {
    reloadCharacterList();
  });
}

if (downloadCharactersBtn) {
  downloadCharactersBtn.addEventListener("click", () => {
    downloadCharactersCsv();
  });
}

if (selectAllBtn) {
  selectAllBtn.addEventListener("click", () => {
    selectAllCharacters(true);
  });
}

if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", () => {
    selectAllCharacters(false);
  });
}

if (selectReviewedBtn) {
  selectReviewedBtn.addEventListener("click", () => {
    selectReviewedCharacters();
  });
}

if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener("click", () => {
    deleteSelectedCharacters();
  });
}

if (addComparedCharacterBtn) {
  addComparedCharacterBtn.addEventListener("click", () => {
    addComparedCharacterToList();
  });
}

if (characterList) {
  characterList.addEventListener("click", event => {
    const loadButton = event.target.closest("[data-load-name]");
    if (loadButton) {
      loadCharacterByName(loadButton.dataset.loadName);
    }
  });

  characterList.addEventListener("change", event => {
    const select = event.target.closest(".status-select");
    if (select) {
      updateCharacterStatus(select.dataset.name, select.value);
    }
  });
}

if (compareBtn) {
  compareBtn.addEventListener("click", async () => {
    if (!characterInput || !resultArea) return;

    try {
      const character = parseBlock(characterInput.value);
      const grade = getCharacterGrade(character);

      if (!grade) {
        latestRenderData = null;
        resultArea.innerHTML = '<div class="empty">입력값에서 등급 항목을 찾지 못했다.</div>';
        return;
      }

      const allTargets = await loadTargetStats();
      const target = allTargets[grade];

      if (!target) {
        latestRenderData = null;
        resultArea.innerHTML = `<div class="empty">기준 CSV에서 "${escapeHtml(grade)}" 등급을 찾지 못했다.</div>`;
        return;
      }

      const results = compareBlocks(character, target);
      latestRenderData = { character, target, results };
      resultArea.innerHTML = renderResults(character, target, results);
    } catch (error) {
      latestRenderData = null;
      resultArea.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  });
}

if (sampleBtn) {
  sampleBtn.addEventListener("click", () => {
    if (!characterInput || !resultArea) return;

    characterInput.value = `캐릭터 스텟
이름\t테스트캐릭
등급\t차원표류
체력\t310
공격력\t28
방어력\t8
치명타 확률\t15
명중률\t100
민첩\t4~7
기각여부\t0`;

    latestRenderData = null;
    resultArea.innerHTML = '<div class="empty">샘플을 넣었다. 비교하기를 누르면 결과가 나온다.</div>';
  });
}

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (!characterInput || !resultArea) return;

    characterInput.value = "";
    latestRenderData = null;
    resultArea.innerHTML = '<div class="empty">입력창을 비웠다.</div>';
  });
}