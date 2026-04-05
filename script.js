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

function compareTextStat(name, charStat, targetStat) {
  const same = charStat.raw === targetStat.raw;

  return {
    name,
    status: same ? "match" : "mismatch",
    label: same ? "일치" : "불일치",
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`
  };
}

function compareNumberStat(name, charStat, targetStat) {
  const cMin = charStat.min;
  const cMax = charStat.max;
  const tMin = targetStat.min;
  const tMax = targetStat.max;

  if (charStat.type === "fixed" && targetStat.type === "fixed") {
    const diff = cMin - tMin;
    const direction = diff === 0 ? "동일" : diff > 0 ? `${diff} 상회` : `${Math.abs(diff)} 미달`;

    return {
      name,
      status: diff >= 0 ? "pass" : "fail",
      label: direction,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw} / ${direction}`
    };
  }

  if (charStat.type === "range" && targetStat.type === "fixed") {
    const minDiff = cMin - tMin;
    const maxDiff = cMax - tMin;

    const minText = minDiff === 0 ? "최소값 동일" : minDiff > 0 ? `최소값 ${minDiff} 상회` : `최소값 ${Math.abs(minDiff)} 미달`;
    const maxText = maxDiff === 0 ? "최대값 동일" : maxDiff > 0 ? `최대값 ${maxDiff} 상회` : `최대값 ${Math.abs(maxDiff)} 미달`;

    let status = "pass";
    if (minDiff < 0 || maxDiff < 0) {
      status = "fail";
    }

    return {
      name,
      status,
      label: `${minText} / ${maxText}`,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw} / ${minText}, ${maxText}`
    };
  }

  const minDiff = cMin - tMin;
  const maxDiff = cMax - tMax;

  const minText = minDiff === 0 ? "최소값 동일" : minDiff > 0 ? `최소값 ${minDiff} 상회` : `최소값 ${Math.abs(minDiff)} 미달`;
  const maxText = maxDiff === 0 ? "최대값 동일" : maxDiff > 0 ? `최대값 ${maxDiff} 상회` : `최대값 ${Math.abs(maxDiff)} 미달`;

  let status = "pass";
  if (minDiff < 0 || maxDiff < 0) {
    status = "fail";
  }

  return {
    name,
    status,
    label: `${minText} / ${maxText}`,
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw} / ${minText}, ${maxText}`
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
        label: "캐릭터 누락",
        detail: `캐릭터 입력에 ${key} 항목이 없다.`
      });
      return;
    }

    if (!targetStat) {
      results.push({
        name: key,
        status: "warn",
        label: "기준 누락",
        detail: `기준 입력에 ${key} 항목이 없다.`
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

function getBadgeClass(status) {
  if (status === "pass" || status === "match") {
    return "badge ok";
  }

  if (status === "fail" || status === "mismatch") {
    return "badge fail";
  }

  return "badge warn";
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
      return `<div class="parsed-line"><strong>${key}</strong>: ${value.raw} <span style="color:#777;">(${typeLabel})</span></div>`;
    }

    return `<div class="parsed-line"><strong>${key}</strong>: ${value.raw} <span style="color:#777;">(${typeLabel} / min ${value.min}, max ${value.max})</span></div>`;
  }).join("");

  return lines || '<div class="parsed-line">읽힌 항목이 없다.</div>';
}

function renderResults(character, target, results) {
  const passCount = results.filter(r => r.status === "pass" || r.status === "match").length;
  const failCount = results.filter(r => r.status === "fail" || r.status === "mismatch").length;
  const warnCount = results.filter(r => r.status === "warn").length;

  const resultHtml = results.map(item => `
    <div class="result-item">
      <div class="result-top">
        <div class="stat-name">${item.name}</div>
        <div class="${getBadgeClass(item.status)}">${item.label}</div>
      </div>
      <div class="stat-detail">${item.detail}</div>
    </div>
  `).join("");

  return `
    <div class="summary">
      <div class="mini-box">
        <div class="mini-label">기준 이상 / 일치</div>
        <div class="mini-value">${passCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">기준 미달 / 불일치</div>
        <div class="mini-value">${failCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">누락 / 확인 필요</div>
        <div class="mini-value">${warnCount}</div>
      </div>
    </div>

    <div class="meta">
      <div class="tag">캐릭터 제목: ${character.title || "없음"}</div>
      <div class="tag">기준 제목: ${target.title || "없음"}</div>
    </div>

    <div class="section-title">비교 상세</div>
    <div class="result-list">${resultHtml || '<div class="empty">비교 결과가 없다.</div>'}</div>

    <div class="section-title">캐릭터 파싱 결과</div>
    <div class="parsed-box">${renderParsed(character)}</div>

    <div class="section-title">기준 파싱 결과</div>
    <div class="parsed-box">${renderParsed(target)}</div>
  `;
}

const characterInput = document.getElementById("characterInput");
const targetInput = document.getElementById("targetInput");
const resultArea = document.getElementById("resultArea");
const compareBtn = document.getElementById("compareBtn");
const sampleBtn = document.getElementById("sampleBtn");
const clearBtn = document.getElementById("clearBtn");

compareBtn.addEventListener("click", () => {
  const character = parseBlock(characterInput.value);
  const target = parseBlock(targetInput.value);
  const results = compareBlocks(character, target);

  resultArea.innerHTML = renderResults(character, target, results);
});

sampleBtn.addEventListener("click", () => {
  characterInput.value = `캐릭터 스텟
등급\t차원표류
체력\t310
공격력\t28
방어력\t8
치명타 확률\t15
명중률\t100
민첩\t4~7`;

  targetInput.value = `기준 스텟
등급\t차원표류
체력\t300
공격력\t30
방어력\t10
치명타 확률\t12
명중률\t100
민첩\t5~7`;

  resultArea.innerHTML = '<div class="empty">샘플을 넣었다. 비교하기를 누르면 결과가 나온다.</div>';
});

clearBtn.addEventListener("click", () => {
  characterInput.value = "";
  targetInput.value = "";
  resultArea.innerHTML = '<div class="empty">입력창을 비웠다.</div>';
});
