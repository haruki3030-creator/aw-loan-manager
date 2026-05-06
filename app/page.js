"use client";
import { useState, useRef } from "react";

// ========================
// PDF.js
// ========================
let pdfJsLoaded = false;
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (pdfJsLoaded && window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; pdfJsLoaded = true; resolve(window.pdfjsLib); };
    s.onerror = () => reject(new Error("PDF.js 로딩 실패"));
    document.head.appendChild(s);
  });
}
async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let t = "";
  for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i); const c = await page.getTextContent(); t += c.items.map(x => x.str).join(" ") + "\n"; }
  return t;
}

// ========================
// 초기값
// ========================
const EMPTY = {
  type: "아파트", rank: "1순위", loanType: "일반담보",
  name: "", birth: "", phone: "", address: "", addressRegistry: "",
  // 시세 구조화
  kbLow: null, kbMid: null, kbHigh: null,
  kbApplied: null, kbAppliedValue: null,
  housemuch: null, housemuchGrade: null,
  actualPrice: null, actualDate: null,
  kb: "", // 레거시 표시용
  // 대출 구조화
  seniorLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null },
  replacementLoans: [], replacementTotal: { maxAmount: null, estimatedBalance: null },
  senior: "", seniorDetail: "",
  amount: "", job: "", salary: "", credit: "",
  purpose: "", period: "", special: "", note: "",
  // 등기부
  owners: [], area: "", totalFloors: "", unitFloor: "",
  landRight: "", transferDate: "", transferCause: "",
  mortgages: [], risks: [],
};

// ========================
// 카톡 정규식 파서 (폴백용)
// ========================
function parseKakao(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const d = { ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] };
  const joined = lines.join(" ");
  const notes = [];

  // 유형/순위
  const br = joined.match(/\[([^\]]+)\]/);
  if (br) {
    const tag = br[1];
    if (/오피스텔/.test(tag)) d.type = "오피스텔";
    else if (/빌라|다세대/.test(tag)) d.type = "빌라/다세대";
    else if (/단독|다가구/.test(tag)) d.type = "단독/다가구";
    else if (/상가/.test(tag)) d.type = "상가";
    if (/3순위/.test(tag)) d.rank = "3순위";
    else if (/2순위/.test(tag)) d.rank = "2순위";
  } else {
    if (/오피스텔/.test(joined)) d.type = "오피스텔";
    else if (/빌라|다세대/.test(joined)) d.type = "빌라/다세대";
    else if (/단독|다가구/.test(joined)) d.type = "단독/다가구";
    else if (/상가/.test(joined)) d.type = "상가";
    if (/2순위/.test(joined)) d.rank = "2순위";
    else if (/3순위/.test(joined)) d.rank = "3순위";
  }
  if (/일반\s*담보/.test(joined)) d.loanType = "일반담보";
  else if (/분양/.test(joined)) d.loanType = "분양담보";
  else if (/대환/.test(joined)) d.loanType = "대환";
  else if (/후순위/.test(joined)) d.loanType = "후순위";

  // 이름
  for (const line of lines) {
    if (/^(분양자|차주|이름|성명|성함|신청인|채무자|소유자)\s*[:\s]/.test(line)) {
      const m = line.match(/[:\s]+([가-힣]{2,4})/); if (m) { d.name = m[1]; break; }
    }
  }
  if (!d.name) { const nm = lines[0]?.match(/^([가-힣]{2,4})\s*[/·]\s*\d{6}/); if (nm) d.name = nm[1]; }
  if (!d.name) { const nm2 = lines[0]?.match(/^([가-힣]{2,4})\s+\d{6}/); if (nm2) d.name = nm2[1]; }
  if (!d.name) { const nm3 = lines[0]?.match(/^([가-힣]{2,4})$/); if (nm3) d.name = nm3[1]; }

  // 생년
  const birthM1 = joined.match(/(\d{6})\s*[-]\s*(\d)/);
  if (birthM1) d.birth = birthM1[1];
  else { const birthM2 = joined.match(/(\d{6})(?=\s|$|[^-\d])/); if (birthM2) d.birth = birthM2[1]; }

  // 연락처
  const phM = joined.match(/(01\d[\s-]?\d{3,4}[\s-]?\d{4})/);
  if (phM) d.phone = phM[1].replace(/\s/g, "");

  // 주소
  for (const line of lines) {
    if (/^(물건지|주소|소재지)\s*[:\s]/.test(line)) { d.address = line.replace(/^(물건지|주소|소재지)\s*[:\s]+/, "").trim(); break; }
  }
  if (!d.address) {
    for (const line of lines) {
      if (/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(line) && line.length > 12) { d.address = line.trim(); break; }
    }
  }

  // KB 시세 구조화
  let kbBlock = "";
  for (let idx = 0; idx < lines.length; idx++) {
    if (/^(시세|KB|kb|▶.*KB|KB\s*AI)/i.test(lines[idx])) { kbBlock = lines.slice(idx, idx + 3).join(" "); break; }
  }
  if (!kbBlock) kbBlock = joined;

  if (/KB\s*미등재|kb\s*미등재/i.test(kbBlock)) {
    // KB 미등재
  } else {
    const kbAI = kbBlock.match(/KB\s*(?:AI\s*)?시세\s*([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/i);
    if (kbAI) {
      d.kbLow = parseInt(kbAI[1].replace(/,/g, ""));
      d.kbMid = parseInt(kbAI[2].replace(/,/g, ""));
      d.kbHigh = parseInt(kbAI[3].replace(/,/g, ""));
    } else {
      const kbHa = kbBlock.match(/KB\s*하\s*([\d,.]+)\s*만?/i);
      const kbIl = kbBlock.match(/(?:KB\s*)?일\s*([\d,.]+)\s*만?/i);
      const kbSang = kbBlock.match(/(?:KB\s*)?상\s*([\d,.]+)\s*만?/i);
      if (kbHa) d.kbLow = parseInt(kbHa[1].replace(/,/g, ""));
      if (kbIl) d.kbMid = parseInt(kbIl[1].replace(/,/g, ""));
      if (kbSang) d.kbHigh = parseInt(kbSang[1].replace(/,/g, ""));
      if (!d.kbLow && !d.kbMid && !d.kbHigh) {
        const kbSingle = kbBlock.match(/KB\s*[:\s]*\s*([\d,.]+)\s*(만|억)?/i);
        if (kbSingle) d.kbMid = parseInt(kbSingle[1].replace(/,/g, ""));
      }
    }
    // (일) 적용가
    const appliedM = kbBlock.match(/\((일|하|상)\)/);
    if (appliedM) {
      d.kbApplied = appliedM[1] === "일" ? "일반가" : appliedM[1] === "하" ? "하한가" : "상한가";
      d.kbAppliedValue = appliedM[1] === "일" ? d.kbMid : appliedM[1] === "하" ? d.kbLow : d.kbHigh;
    }
  }
  // 하우스머치
  const hmM = kbBlock.match(/하우스머치\s*(중|상|하)?\s*([\d,.]+)/);
  if (hmM) { d.housemuch = parseInt(hmM[2].replace(/,/g, "")); d.housemuchGrade = hmM[1] || "중"; }

  // 실거래
  const silM = joined.match(/실거래[:\s]*([\d,.]+)\s*만?\s*(?:\(([^)]+)\))?/);
  if (silM) { d.actualPrice = parseInt(silM[1].replace(/,/g, "")); d.actualDate = silM[2] || ""; }

  // KB 표시 문자열 (레거시 호환)
  d.kb = buildKbDisplay(d);

  // 기대출 - 선순위/대환 분리
  let section = "senior"; // default
  let currentLoans = d.seniorLoans;
  const seniorNotes = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/▶\s*선순위/.test(line)) { section = "senior"; currentLoans = d.seniorLoans; continue; }
    if (/▶\s*대환|▶\s*말소/.test(line)) { section = "replacement"; currentLoans = d.replacementLoans; continue; }
    if (/^기대출\s*[:\s]*$/.test(line)) { continue; }
    if (/^(특이사항|시세|주소|직업|필요|요청|용도)\s*[:\s]/.test(line)) continue;

    // 합계
    if (/총\s*합계|::\s*총|::\s*합계/.test(line)) {
      const amts = [...line.matchAll(/([\d,.]+)\s*만/g)];
      const total = { maxAmount: null, estimatedBalance: null };
      if (amts.length >= 2) { total.maxAmount = parseInt(amts[0][1].replace(/,/g, "")); total.estimatedBalance = parseInt(amts[1][1].replace(/,/g, "")); }
      else if (amts.length === 1) { total.maxAmount = parseInt(amts[0][1].replace(/,/g, "")); }
      if (section === "senior") d.seniorTotal = total;
      else d.replacementTotal = total;
      continue;
    }

    // 대출 항목 파싱
    const loan = parseLoanLine(line);
    if (loan) { currentLoans.push(loan); continue; }

    // 괄호 메모
    const noteM = line.match(/\(([가-힣\s]+(?:채무|대출|금거|가능|필요|예정|확인|부탁)[가-힣\s]*)\)/);
    if (noteM) seniorNotes.push(noteM[1].trim());
  }

  if (seniorNotes.length > 0) d.special = seniorNotes.join(" / ");

  // 레거시 seniorDetail 생성
  d.seniorDetail = buildSeniorDetail(d);
  d.senior = buildSeniorSummary(d);

  // 요청금액
  for (const line of lines) {
    if (/필요\s*자금|필요\s*금액|필요\s*[\d]/.test(line)) { const m = line.match(/([\d,.]+)\s*(만|억)?/); if (m) { d.amount = m[1].replace(/,/g, "") + (m[2] || "만"); break; } }
  }
  if (!d.amount) { for (const line of lines) { if (/희망\s*금|요청\s*금|추가.*한도|대출.*희망/.test(line)) { const m = line.match(/([\d,.]+)\s*(만|억)/); if (m) { d.amount = m[1].replace(/,/g, "") + m[2]; break; } } } }
  if (!d.amount) { const revM = joined.match(/([\d,.]+)\s*(만|억)\s*(?:필요|부탁|요청|해주세요)/); if (revM) d.amount = revM[1].replace(/,/g, "") + revM[2]; }
  if (!d.amount && /최대\s*요청|추가.*한도|추가.*부탁|대납.*최대/.test(joined)) d.amount = joined.match(/((?:\d순위\s*)?(?:대납\s*)?최대\s*요청|추가.*한도.*부탁[가-힣]*)/)?.[1] || "최대 요청";
  if (!d.amount) { const reqM = joined.match(/((?:\d순위\s*)?가능사?\s*확인\s*부탁[가-힣]*)/); if (reqM) d.amount = reqM[1]; }
  if (!d.amount) { const hdM = joined.match(/((?:\d순위\s*)?한도\s*요청)/); if (hdM) d.amount = hdM[1]; }

  // URL 제거 (KB시세 링크 등은 특이사항에 넣지 않음)
  
  // 직업
  for (const line of lines) { if (/^직업\s*[:\s]/.test(line)) { const m = line.match(/[:\s]+(.+)/); if (m) { d.job = m[1].trim(); break; } } }
  if (!d.job) { const jm = joined.match(/(4대\s*직장인|개인사업자|자영업자?|직장인|회사원|공무원|프리랜서|무직|주부|일용직|법인대표)/); if (jm) d.job = jm[1]; }

  // 급여/신용
  const salM = joined.match(/월\s*급여\s*([\d,]+)\s*만?/); if (salM) d.salary = salM[1].replace(/,/g, "") + "만";
  const crM = joined.match(/(?:KCB|NICE|kcb|nice|나이스)\s*(\d{3,4})\s*(점|점수)?/);
  if (crM) { const src = /나이스|nice/i.test(crM[0]) ? "NICE" : "KCB"; d.credit = src + " " + crM[1] + (crM[2] || "점"); }
  else { const crM2 = joined.match(/(?:KCB|NICE|나이스|kcb|nice)\s*(\d+)\s*등급/i); if (crM2) { const src2 = /나이스|nice/i.test(crM2[0]) ? "NICE" : "KCB"; d.credit = src2 + " " + crM2[1] + "등급"; } else { const crM3 = joined.match(/(\d+)\s*등급/); if (crM3) d.credit = crM3[1] + "등급"; } }

  // 용도
  if (/대환/.test(joined)) d.purpose = "대환";
  else if (/생활자금/.test(joined)) d.purpose = "생활자금";
  else if (/잔금/.test(joined)) d.purpose = "잔금";

  // 특이사항
  const areaDouble = joined.match(/([\d.]+)\s*(?:㎡|m²)\s*\/\s*([\d.]+)\s*(?:㎡|m²)/);
  if (areaDouble) notes.push("공급 " + areaDouble[1] + "㎡ / 전용 " + areaDouble[2] + "㎡");
  else { const areaM = joined.match(/전용\s*([\d.]+)\s*(?:㎡|m²)/); if (areaM) notes.push("전용 " + areaM[1] + "㎡"); }
  const sedae = joined.match(/(\d+)\s*세대/); if (sedae) notes.push(sedae[1] + "세대");
  const floorM = joined.match(/(\d+)\s*층\s*중\s*(\d+)\s*층/); if (floorM) notes.push(floorM[1] + "층 중 " + floorM[2] + "층");
  if (d.actualPrice && d.actualDate) notes.push("실거래 " + d.actualPrice.toLocaleString() + "만(" + d.actualDate + ")");
  else if (d.actualPrice) notes.push("실거래 " + d.actualPrice.toLocaleString() + "만");
  if (/신탁/.test(joined) && !/신탁.*해제|귀속|말소/.test(joined)) notes.push("신탁");
  if (/환매/.test(joined)) notes.push("환매특약");
  const ageM = joined.match(/(\d+)\s*년차/); if (ageM) notes.push(ageM[1] + "년차");
  const owM = joined.match(/소유권이전일?\s*[:\s]\s*(20[\d년월일.\s]+)/); if (owM) { notes.push("소유권이전 " + owM[1].trim()); d.transferDate = owM[1].trim(); }
  if (/지분\s*대출|지분.*검토/.test(joined)) notes.push("지분대출 검토 요청");
  if (/배우자\s*공동/.test(joined)) notes.push("배우자 공동소유");
  const kbNameM = joined.match(/KB상\s*물건지명[:\s]*([가-힣\d().\-]+)/); if (kbNameM) notes.push("KB: " + kbNameM[1]);

  // URL 제거
  const filtered = notes.filter(n => !/https?:\/\//.test(n) && !/kbland/.test(n));
  if (filtered.length) d.special = (d.special ? d.special + " / " : "") + filtered.join(" / ");
  return d;
}

function parseLoanLine(line) {
  // "1. 우리은행 5,940만 (5,400만) / 110.0%"
  let m = line.match(/^\d+\.\s*([가-힣A-Za-z]+(?:은행|금고|캐피탈|저축|보험|새마을|신협|농협|수협|화재|생명|대부|해상|카드)?[가-힣]*)\s+([\d,.]+)\s*만?\s*(?:\(([\d,.]+)\s*만?\))?\s*(?:[/]\s*([\d.]+)\s*%)?/);
  if (m) return { lender: m[1].trim(), maxAmount: parseInt(m[2].replace(/,/g, "")), estimatedBalance: m[3] ? parseInt(m[3].replace(/,/g, "")) : null, rate: m[4] ? parseFloat(m[4]) : null };

  // "신한 : 35400 / 29500 (사촌 채무)"
  m = line.match(/^([가-힣A-Za-z]+(?:은행|금고|캐피탈|저축|보험|새마을|신협|농협|수협|화재|생명|대부|해상|카드)?[가-힣]*)\s*[-:]\s*([\d,.]+)\s*(?:만\s*)?(?:[/]\s*([\d,.]+))?/);
  if (m) {
    const v1 = parseInt(m[2].replace(/,/g, "")), v2 = m[3] ? parseInt(m[3].replace(/,/g, "")) : null;
    if (v2) {
      const max = Math.max(v1, v2), est = Math.min(v1, v2);
      return { lender: m[1].trim(), maxAmount: max, estimatedBalance: est, rate: null };
    }
    return { lender: m[1].trim(), maxAmount: v1, estimatedBalance: null, rate: null };
  }

  // "미래대부 1,500"
  m = line.match(/^([가-힣A-Za-z]+(?:대부|캐피탈|저축|금고))\s+([\d,.]+)/);
  if (m) return { lender: m[1].trim(), maxAmount: parseInt(m[2].replace(/,/g, "")), estimatedBalance: null, rate: null };

  // "농협 4,000 (4,800) 차주 본인"
  m = line.match(/^([가-힣A-Za-z]+)\s+([\d,.]+)\s*(?:만\s*)?\(([\d,.]+)\s*만?\)/);
  if (m) {
    const v1 = parseInt(m[2].replace(/,/g, "")), v2 = parseInt(m[3].replace(/,/g, ""));
    return { lender: m[1].trim(), maxAmount: Math.max(v1, v2), estimatedBalance: Math.min(v1, v2), rate: null };
  }

  return null;
}

// ========================
// 시세/대출 표시 헬퍼
// ========================
function buildKbDisplay(d) {
  const parts = [];
  if (d.kbLow || d.kbMid || d.kbHigh) {
    if (d.kbLow && d.kbMid && d.kbHigh) parts.push(`KB 하 ${num(d.kbLow)}만 / 일 ${num(d.kbMid)}만 / 상 ${num(d.kbHigh)}만`);
    else if (d.kbLow && d.kbMid) parts.push(`KB 하 ${num(d.kbLow)}만 / 일 ${num(d.kbMid)}만`);
    else if (d.kbMid) parts.push(`KB ${num(d.kbMid)}만`);
    else if (d.kbLow) parts.push(`KB 하 ${num(d.kbLow)}만`);
    if (d.kbApplied) parts[0] += ` (${d.kbApplied})`;
  } else if (!d.housemuch) {
    // KB 미등재 check
  }
  if (d.housemuch) parts.push(`하우스머치(${d.housemuchGrade || "중"}) ${num(d.housemuch)}만`);
  if (parts.length === 0 && !d.kbMid && !d.kbLow) {
    if (d.housemuch) return `KB 미등재 / 하우스머치(${d.housemuchGrade || "중"}) ${num(d.housemuch)}만`;
    return "";
  }
  return parts.join(" / ");
}

function buildSeniorDetail(d) {
  const lines = [];
  if (d.seniorLoans.length > 0) {
    if (d.replacementLoans.length > 0) lines.push("▶ 선순위");
    d.seniorLoans.forEach((l, i) => {
      let s = `${i + 1}. ${l.lender} ${num(l.maxAmount)}만`;
      if (l.estimatedBalance) s += ` (${num(l.estimatedBalance)}만)`;
      if (l.rate) s += ` / ${l.rate}%`;
      lines.push(s);
    });
    if (d.seniorTotal.maxAmount) {
      let s = `:: 합계 ${num(d.seniorTotal.maxAmount)}만`;
      if (d.seniorTotal.estimatedBalance) s += ` (${num(d.seniorTotal.estimatedBalance)}만)`;
      lines.push(s);
    }
  }
  if (d.replacementLoans.length > 0) {
    lines.push("▶ 대환/말소대상");
    const startNo = d.seniorLoans.length;
    d.replacementLoans.forEach((l, i) => {
      let s = `${startNo + i + 1}. ${l.lender} ${num(l.maxAmount)}만`;
      if (l.estimatedBalance) s += ` (${num(l.estimatedBalance)}만)`;
      if (l.rate) s += ` / ${l.rate}%`;
      lines.push(s);
    });
    if (d.replacementTotal.maxAmount) {
      let s = `:: 합계 ${num(d.replacementTotal.maxAmount)}만`;
      if (d.replacementTotal.estimatedBalance) s += ` (${num(d.replacementTotal.estimatedBalance)}만)`;
      lines.push(s);
    }
  }
  return lines.join("\n");
}

function buildSeniorSummary(d) {
  const totalMax = d.seniorTotal.maxAmount || d.seniorLoans.reduce((s, l) => s + (l.maxAmount || 0), 0);
  const totalEst = d.seniorTotal.estimatedBalance || d.seniorLoans.reduce((s, l) => s + (l.estimatedBalance || 0), 0);
  if (!totalMax && !totalEst) return "";
  let s = num(totalMax) + "만";
  if (totalEst) s += " (" + num(totalEst) + "만)";
  return s;
}

function num(n) { return n ? n.toLocaleString() : "0"; }
function fmtW(a) { if (!a) return "0만"; const e = Math.floor(a / 10000), r = a % 10000; if (a >= 10000) return `${Math.floor(a / 10000)}억 ${(a % 10000).toLocaleString()}만`; return `${a.toLocaleString()}만`; }

// ========================
// LTV 계산 엔진
// ========================
function calcLTV(data) {
  const result = { basePrice: null, basePriceLabel: "", seniorMaxTotal: 0, seniorEstTotal: 0, replacementMaxTotal: 0, replacementEstTotal: 0, ltvCurrentMax: null, ltvCurrentEst: null, ltvAfterReplace: null, availableAtLTV70: null, availableAtLTV80: null, availableAtLTV90: null, grade: "", gradeColor: "" };

  // 기준 시세 결정: kbAppliedValue > kbMid > kbLow > housemuch
  if (data.kbAppliedValue) { result.basePrice = data.kbAppliedValue; result.basePriceLabel = `KB ${data.kbApplied}`; }
  else if (data.kbMid) { result.basePrice = data.kbMid; result.basePriceLabel = "KB 일반가"; }
  else if (data.kbLow) { result.basePrice = data.kbLow; result.basePriceLabel = "KB 하한가"; }
  else if (data.housemuch) { result.basePrice = data.housemuch; result.basePriceLabel = `하우스머치(${data.housemuchGrade || "중"})`; }

  if (!result.basePrice) return result;

  // 선순위 합산
  if (data.seniorTotal?.maxAmount) result.seniorMaxTotal = data.seniorTotal.maxAmount;
  else result.seniorMaxTotal = (data.seniorLoans || []).reduce((s, l) => s + (l.maxAmount || 0), 0);
  if (data.seniorTotal?.estimatedBalance) result.seniorEstTotal = data.seniorTotal.estimatedBalance;
  else result.seniorEstTotal = (data.seniorLoans || []).reduce((s, l) => s + (l.estimatedBalance || l.maxAmount || 0), 0);

  // 대환대상 합산
  if (data.replacementTotal?.maxAmount) result.replacementMaxTotal = data.replacementTotal.maxAmount;
  else result.replacementMaxTotal = (data.replacementLoans || []).reduce((s, l) => s + (l.maxAmount || 0), 0);
  if (data.replacementTotal?.estimatedBalance) result.replacementEstTotal = data.replacementTotal.estimatedBalance;
  else result.replacementEstTotal = (data.replacementLoans || []).reduce((s, l) => s + (l.estimatedBalance || l.maxAmount || 0), 0);

  // 등기부 근저당도 고려 (카톡 대출 정보가 없을 때)
  let mortgageTotal = 0;
  if (result.seniorMaxTotal === 0 && (data.mortgages || []).length > 0) {
    mortgageTotal = data.mortgages.reduce((s, m) => s + (m.maxAmount || 0), 0);
    result.seniorMaxTotal = mortgageTotal;
    result.seniorEstTotal = Math.round(mortgageTotal / 1.2); // 추정
  }

  const totalMax = result.seniorMaxTotal + result.replacementMaxTotal;
  const totalEst = result.seniorEstTotal + result.replacementEstTotal;

  // LTV 계산
  result.ltvCurrentMax = Math.round((totalMax / result.basePrice) * 100 * 10) / 10;
  result.ltvCurrentEst = Math.round((totalEst / result.basePrice) * 100 * 10) / 10;

  // 대환 후 LTV (선순위만 유지)
  if (result.replacementMaxTotal > 0) {
    result.ltvAfterReplace = Math.round((result.seniorEstTotal / result.basePrice) * 100 * 10) / 10;
  }

  // 여유한도 계산 (추정잔액 기준)
  const basisForCalc = result.replacementMaxTotal > 0 ? result.seniorEstTotal : totalEst;
  result.availableAtLTV70 = Math.max(0, Math.round(result.basePrice * 0.7 - basisForCalc));
  result.availableAtLTV80 = Math.max(0, Math.round(result.basePrice * 0.8 - basisForCalc));
  result.availableAtLTV90 = Math.max(0, Math.round(result.basePrice * 0.9 - basisForCalc));

  // 등급 (추정잔액 기준 LTV)
  const refLtv = result.replacementMaxTotal > 0 ? result.ltvAfterReplace : result.ltvCurrentEst;
  if (refLtv <= 70) { result.grade = "✅ 안전"; result.gradeColor = "#2ecc71"; }
  else if (refLtv <= 80) { result.grade = "🟡 보통"; result.gradeColor = "#f1c40f"; }
  else if (refLtv <= 90) { result.grade = "⚠️ 주의"; result.gradeColor = "#e67e22"; }
  else { result.grade = "🚨 위험"; result.gradeColor = "#e74c3c"; }

  return result;
}

// ========================
// 등기부 정규식 파서 (v4 — 첫 장(표제부) + 마지막 장(요약) 전략)
// ========================
function parseRegistry(rawText) {
  const r = { address: "", type: "", area: "", totalFloors: "", unitFloor: "", landRight: "", owners: [], mortgages: [], risks: [], transferDate: "", transferCause: "", summaryCleanGapgu: false, summaryCleanEulgu: false };

  // ============================================
  // PART 1: 마지막 장 — 주요등기사항 요약 (권리 판단의 핵심)
  // ============================================
  const summarySection = rawText.match(/주요\s*등기\s*사항\s*요약[\s\S]*/);
  if (summarySection) {
    const summary = summarySection[0];

    // 1-1. 소유자 (가장 정확한 출처)
    const ownerMatches = [...summary.matchAll(/([가-힣]{2,4})\s*\((소유자|공유자)\)\s*(\d{6}[-]?\*{0,7}\d{0,7})/g)];
    for (const m of ownerMatches) {
      r.owners.push({ name: m[1], birth: m[3].replace(/[-]*\*+$/, "").replace(/-$/, ""), role: m[2], share: "단독소유" });
    }
    // 지분 (공동소유 시)
    if (r.owners.length > 1) {
      const shareMatches = [...summary.matchAll(/(\d+)\s*분의\s*(\d+)/g)];
      r.owners.forEach((o, i) => { if (shareMatches[i]) o.share = shareMatches[i][0]; });
    }

    // 1-2. 순위번호 추출 — 요약 테이블에서 순위번호는 소유자 행 끝에 나옴
    // "순위번호\n김미선 (소유자)\n690720-*******\n단독소유\n주소...\n12" 형태
    let ownerRank = null;
    // 방법1: "순위번호" 다음 블록에서 독립된 숫자 찾기
    const rankSection = summary.match(/순위번호[\s\S]*?(?=2\.\s*소유지분을|$)/);
    if (rankSection) {
      // 소유자 정보 뒤에 오는 독립 숫자 (1~999)
      const nums = [...rankSection[0].matchAll(/(?:^|\n)\s*(\d{1,3})\s*(?:\n|$)/gm)];
      if (nums.length > 0) ownerRank = parseInt(nums[nums.length - 1][1]);
    }
    // 방법2: 직접 "순위번호 N" 패턴
    if (!ownerRank) {
      const directM = summary.match(/순위번호\s+(\d{1,3})/);
      if (directM) ownerRank = parseInt(directM[1]);
    }

    if (ownerRank) {
      // PDF.js 추출: "12\n소유권이전\n2024년11월27일\n...\n매매"
      const patterns = [
        new RegExp(`(?:^|\\n)${ownerRank}\\s*\\n?\\s*소유권이전[\\s\\S]{0,300}?(20\\d{2}년\\s*\\d{1,2}월\\s*\\d{1,2}일)[\\s\\S]{0,300}?(매매|상속|증여|경매|강제경매로\\s*인한\\s*매각|신탁)`, "m"),
        new RegExp(`${ownerRank}[\\s\\n]+소유권이전[\\s\\S]*?(20\\d{2}년\\s*\\d{1,2}월\\s*\\d{1,2}일)[\\s\\S]{0,300}?(매매|상속|증여|경매)`, "m"),
      ];
      for (const pat of patterns) {
        const m = rawText.match(pat);
        if (m) {
          r.transferDate = m[1].replace(/\s/g, "");
          r.transferCause = m[2].replace(/강제경매로\s*인한\s*매각/, "경매");
          break;
        }
      }
      // 거래가액
      const pricePattern = new RegExp(`(?:^|\\n)${ownerRank}[\\s\\n]+소유권이전[\\s\\S]{0,500}?거래가액\\s*금?\\s*([\\d,]+)\\s*원`, "m");
      const priceM = rawText.match(pricePattern);
      if (priceM) r.tradePrice = Math.round(parseInt(priceM[1].replace(/,/g, "")) / 10000);
    }

    // 폴백: ownerRank 검출 실패 또는 위 패턴 매칭 실패 시 → 가장 마지막 소유권이전 찾기
    if (!r.transferDate) {
      const allTransfers = [...rawText.matchAll(/소유권이전[\s\S]{0,200}?(20\d{2}년\s*\d{1,2}월\s*\d{1,2}일)[\s\S]{0,300}?(매매|상속|증여|경매|강제경매로\s*인한\s*매각|신탁|판결|협의분할)/g)];
      if (allTransfers.length > 0) {
        const last = allTransfers[allTransfers.length - 1];
        r.transferDate = last[1].replace(/\s/g, "");
        r.transferCause = last[2].replace(/강제경매로\s*인한\s*매각/, "경매");
      }
    }
    if (!r.tradePrice) {
      const allPrices = [...rawText.matchAll(/소유권이전[\s\S]{0,500}?거래가액\s*금?\s*([\d,]+)\s*원/g)];
      if (allPrices.length > 0) {
        const lastP = allPrices[allPrices.length - 1];
        r.tradePrice = Math.round(parseInt(lastP[1].replace(/,/g, "")) / 10000);
      }
    }

    // 1-3. 갑구 "기록사항 없음" 체크
    const gapguSummary = summary.match(/소유지분을\s*제외한[\s\S]*?(?=3\.\s*\(근\)|$)/);
    if (gapguSummary && /기록사항\s*없음/.test(gapguSummary[0])) r.summaryCleanGapgu = true;

    // 1-4. 을구 "기록사항 없음" 체크
    const eulguSummary = summary.match(/(?:저당권|전세권)[\s\S]*?(?=\[\s*참|$)/);
    if (eulguSummary && /기록사항\s*없음/.test(eulguSummary[0])) r.summaryCleanEulgu = true;

    // 1-5. 을구에 유효 근저당이 있는 경우 (요약에서 추출)
    if (!r.summaryCleanEulgu) {
      // 패턴1: "채권최고액 금NNN원 ... 근저당권자 OOO"
      const eulguEntries = [...summary.matchAll(/채권최고액\s*금?\s*([\d,]+)\s*원[\s\S]*?근저당권자\s+([가-힣()A-Za-z\s]+?)(?=\s+\d{6}|\s+채권|$)/g)];
      for (const e of eulguEntries) {
        const amt = parseInt(e[1].replace(/,/g, ""));
        if (amt >= 1000000) r.mortgages.push({ holder: e[2].replace(/주식회사/g, "㈜").trim(), maxAmount: Math.round(amt / 10000), date: "" });
      }
      // 패턴2: 요약 테이블에서 "근저당권설정" 행
      if (r.mortgages.length === 0) {
        const tableEntries = [...summary.matchAll(/근저당권설정[\s\S]*?금\s*([\d,]+)\s*원[\s\S]*?(?:근저당권자|채무자)\s*([가-힣]+)/g)];
        for (const e of tableEntries) {
          const amt = parseInt(e[1].replace(/,/g, ""));
          if (amt >= 1000000) r.mortgages.push({ holder: e[2].trim(), maxAmount: Math.round(amt / 10000), date: "" });
        }
      }
    }

    // 1-6. 갑구에 유효 위험이 있는 경우 (요약에서 추출)
    if (!r.summaryCleanGapgu) {
      const gapguBlock = summary.match(/소유지분을\s*제외한[\s\S]*?(?=3\.\s*\(근\)|$)/);
      if (gapguBlock && !/기록사항\s*없음/.test(gapguBlock[0])) {
        const riskDefs = [[/강제경매/, "강제경매개시결정"], [/임의경매/, "임의경매개시결정"], [/가압류/, "가압류"], [/가처분/, "가처분"], [/압류/, "압류"], [/신탁(?!.*보험|재산|귀속)/, "신탁"], [/환매/, "환매특약"], [/예고등기/, "예고등기"], [/가등기/, "가등기"]];
        for (const [pat, label] of riskDefs) {
          if (pat.test(gapguBlock[0])) r.risks.push(label);
        }
      }
    }
  }

  // ============================================
  // PART 2: 첫 장 — 표제부 (물건 정보)
  // ============================================
  const j = rawText.replace(/\s+/g, " ").trim();

  // 2-1. 주소 ([집합건물]에서)
  const addrM = j.match(/\[집합건물\]\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^【]*?제?\d+호)/);
  if (addrM) r.address = addrM[1].replace(/\s+/g, " ").trim();
  if (r.address.length > 120) r.address = r.address.slice(0, 120);

  // 2-2. 도로명 주소 (PDF 추출에서 층수 정보가 섞일 수 있음)
  const doroIdx = rawText.indexOf("도로명주소");
  if (doroIdx > -1) {
    const doroBlock = rawText.slice(doroIdx, doroIdx + 300);
    // 시/도 + ~길/로 + 번호 패턴 조합
    const cityM = doroBlock.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북도|충청남도|경상북도|경상남도|전라북도|전라남도|강원특별자치도)[가-힣\s]*(?:시|군|구))/);
    const roadM = doroBlock.match(/([가-힣\d]+(?:로|길)\s*\d+[가-힣\d\-]*)/);
    if (cityM && roadM) {
      r.doroAddress = (cityM[1] + " " + roadM[1]).replace(/\s+/g, " ").trim();
    }
    // 도로명만 못 찾으면 "읍/면 + 길/로 + 번호" 조합 시도
    if (!r.doroAddress && cityM) {
      const eupM = doroBlock.match(/([가-힣]+(?:읍|면|동))\s*\n?\s*([가-힣\d]+(?:로|길)\s*\d+)/);
      if (eupM) r.doroAddress = cityM[1] + " " + eupM[1] + " " + eupM[2];
    }
  }

  // 2-3. 전용면적 (전유부분에서)
  const jeonyu = rawText.match(/전유부분의\s*건물의\s*표시[\s\S]*?(?=대지권|갑\s*구|$)/);
  if (jeonyu) {
    const jyArea = jeonyu[0].match(/([\d.]+)\s*㎡/);
    if (jyArea && parseFloat(jyArea[1]) > 10 && parseFloat(jyArea[1]) < 300) r.area = parseFloat(jyArea[1]).toFixed(2) + "㎡";
  }

  // 2-4. 총층수 (1동 건물 내역에서)
  const buildingDesc = rawText.match(/1동의\s*건물의\s*표시[\s\S]*?전유부분/);
  if (buildingDesc) {
    const floorNums = [...buildingDesc[0].matchAll(/(\d{1,2})층\s+[\d.]+㎡/g)];
    if (floorNums.length > 0) r.totalFloors = Math.max(...floorNums.map(m => parseInt(m[1]))) + "층";
    else {
      const flM = buildingDesc[0].match(/(\d+)\s*층\s*$/m) || buildingDesc[0].match(/(\d+)\s*층\s*(?:공동주택|업무|근린)/);
      if (flM) r.totalFloors = flM[1] + "층";
    }
  }

  // 2-5. 해당 층/호 (제N층 제NNN호)
  const unitFloorM = j.match(/제(\d+)층\s*제\d+호/);
  if (unitFloorM) r.unitFloor = unitFloorM[1] + "층";

  // 2-6. 대지권
  if (/대지권/.test(j)) r.landRight = "있음";

  // 2-7. 건물 유형
  if (/집합건물/.test(rawText)) r.type = "집합건물";
  const typeM = j.match(/(아파트|오피스텔|빌라|다세대|연립|단독|다가구|상가|근린생활|사무실|공동주택)/);
  if (typeM) r.type = typeM[1];

  return r;
}

// ========================
// AI → 내부 데이터 변환
// ========================
function aiToInternal(ai) {
  const d = { ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] };

  d.type = ai.type || "아파트";
  if (/빌라|다세대/.test(d.type)) d.type = "빌라/다세대";
  if (/단독|다가구/.test(d.type)) d.type = "단독/다가구";
  d.rank = ai.rank || "1순위";
  d.loanType = ai.loanType || "일반담보";
  d.name = ai.name || "";
  d.birth = ai.birth ? String(ai.birth).replace(/[-]\d*$/, "") : "";
  d.phone = ai.phone && /^01\d/.test(String(ai.phone).replace(/[-\s]/g, "")) ? String(ai.phone) : "";
  d.address = ai.address || "";
  d.job = ai.job || "";
  d.salary = ai.salary ? (String(ai.salary).includes("만") ? ai.salary : ai.salary + "만") : "";
  d.credit = ai.credit || "";
  if (d.credit && !/점|등급/.test(d.credit)) { if (/\d{3,4}$/.test(d.credit)) d.credit += "점"; else if (/\d{1,2}$/.test(d.credit)) d.credit += "등급"; }

  // 시세
  d.kbLow = ai.kbLow || null;
  d.kbMid = ai.kbMid || null;
  d.kbHigh = ai.kbHigh || null;
  d.kbApplied = ai.kbApplied || null;
  d.kbAppliedValue = ai.kbAppliedValue || null;
  d.housemuch = ai.housemuch || null;
  d.housemuchGrade = ai.housemuchGrade || null;
  d.actualPrice = ai.actualPrice || null;
  d.actualDate = ai.actualDate || null;
  d.kb = buildKbDisplay(d);

  // 대출
  d.seniorLoans = (ai.seniorLoans || []).map((l, i) => ({ ...l, no: i + 1 }));
  d.replacementLoans = (ai.replacementLoans || []).map((l, i) => ({ ...l, no: i + 1 }));
  d.seniorTotal = ai.seniorTotal || { maxAmount: null, estimatedBalance: null };
  d.replacementTotal = ai.replacementTotal || { maxAmount: null, estimatedBalance: null };
  d.seniorDetail = buildSeniorDetail(d);
  d.senior = buildSeniorSummary(d);

  d.amount = ai.amount || "";
  d.purpose = ai.purpose || "";
  d.special = (ai.special || "").split(/\s*[\/,]\s*/).filter(s => {
    if (!s.trim()) return false;
    if (/https?:\/\//.test(s)) return false;
    if (/kbland|KB시세\s*조회/.test(s)) return false;
    if (/한도\s*요청|가능사.*확인|최대.*요청/.test(s)) return false;
    return true;
  }).join(" / ");
  d.note = ai.note || "";

  // 등기부 (AI가 함께 분석한 경우)
  if (ai.registryAddress) d.addressRegistry = ai.registryAddress;
  if (ai.owners) d.owners = ai.owners;
  if (ai.area) d.area = ai.area;
  if (ai.totalFloors) d.totalFloors = String(ai.totalFloors);
  if (ai.unitFloor) d.unitFloor = String(ai.unitFloor);
  if (ai.landRight) d.landRight = ai.landRight;
  if (ai.transferDate) d.transferDate = ai.transferDate;
  if (ai.transferCause) d.transferCause = ai.transferCause;
  if (ai.mortgages) d.mortgages = ai.mortgages;
  if (ai.risks) d.risks = ai.risks;

  return d;
}

// ========================
// 병합 (AI/정규식 + 등기부)
// ========================
function mergeData(parsed, regParsed) {
  const f = { ...parsed };

  if (!regParsed) return f;

  // 주소 병합 — ★ 등기부 주소가 물건 실주소, 카톡 주소는 수탁자/채권자 주소일 수 있음
  const isDoroName = (addr) => /[가-힣]+(?:로|길)\s*\d/.test(addr || "");
  if (regParsed.address) {
    // 등기부 주소를 메인으로
    if (f.address && f.address !== regParsed.address) {
      // 카톡 주소가 등기부 주소와 다르면: 등기부가 물건 주소, 카톡은 도로명이면 보조로
      if (isDoroName(f.address) && !isDoroName(regParsed.address)) {
        // 카톡이 도로명, 등기부가 지번 → 둘 다 표시할 수도 있지만,
        // 수탁자 주소 혼동 방지: 카톡 주소가 물건과 같은 시/도인지 체크
        const regCity = regParsed.address.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청)/);
        const kakaoCity = f.address.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청)/);
        if (regCity && kakaoCity && regCity[1] === kakaoCity[1]) {
          // 같은 지역이면 둘 다 표시
          f.addressRegistry = f.address;
          f.address = regParsed.address;
        } else {
          // 다른 지역이면 카톡 주소는 수탁자/채권자 주소일 가능성 → 등기부만
          f.address = regParsed.address;
          f.addressRegistry = "";
        }
      } else {
        // 등기부 주소 우선
        f.address = regParsed.address;
        f.addressRegistry = "";
      }
    } else {
      f.address = regParsed.address;
    }
  }

  // 소유자
  if (regParsed.owners?.length > 0 && f.owners.length === 0) f.owners = regParsed.owners;
  if (!f.name && regParsed.owners?.length > 0) f.name = regParsed.owners[0].name;

  // 도로명 주소를 보조 주소로 (지번과 다를 때만)
  if (regParsed.doroAddress && !f.addressRegistry) {
    f.addressRegistry = regParsed.doroAddress;
  }

  // 물건 정보
  if (regParsed.area && !f.area) f.area = regParsed.area;
  if (regParsed.totalFloors && !f.totalFloors) f.totalFloors = regParsed.totalFloors;
  if (regParsed.unitFloor && !f.unitFloor) f.unitFloor = regParsed.unitFloor;
  if (regParsed.landRight && !f.landRight) f.landRight = regParsed.landRight;
  if (regParsed.transferDate && !f.transferDate) f.transferDate = regParsed.transferDate;
  if (regParsed.transferCause && !f.transferCause) f.transferCause = regParsed.transferCause;

  // 근저당 (등기부 우선 — 요약이 깨끗하면 빈 배열 유지)
  if (regParsed.summaryCleanEulgu) {
    f.mortgages = [];
  } else if (regParsed.mortgages?.length > 0) {
    f.mortgages = regParsed.mortgages;
  }
  // 위험
  if (regParsed.risks?.length > 0) f.risks = [...new Set([...(f.risks || []), ...regParsed.risks])];

  // 특이사항 보충 (중복 제거)
  const specials = [];
  // 카톡 특이사항에서 등기부와 겹치는 항목 제거 후 추가
  if (f.special) {
    f.special.split(/\s*\/\s*/).forEach(item => {
      const t = item.trim();
      if (!t) return;
      // 등기부에서 더 정확한 값이 있으면 카톡 버전 스킵
      if (regParsed.area && /전용/.test(t)) return;
      if (regParsed.totalFloors && /총.*층/.test(t)) return;
      if (regParsed.unitFloor && /해당.*층/.test(t)) return;
      if (regParsed.transferDate && /소유권이전/.test(t)) return;
      if (regParsed.landRight && /대지권/.test(t)) return;
      if (/층\s*중\s*\d+층/.test(t) && regParsed.totalFloors && regParsed.unitFloor) return;
      // 요청금액은 특이사항이 아님
      if (/한도\s*요청|가능사.*확인|최대.*요청|필요.*자금/.test(t)) return;
      // URL 제거
      if (/https?:\/\/|kbland/.test(t)) return;
      specials.push(t);
    });
  }
  if (regParsed.area) specials.push("전용 " + regParsed.area);
  if (regParsed.totalFloors && regParsed.unitFloor) specials.push(regParsed.totalFloors + " 중 " + regParsed.unitFloor);
  else { if (regParsed.totalFloors) specials.push("총 " + regParsed.totalFloors); if (regParsed.unitFloor) specials.push("해당 " + regParsed.unitFloor); }
  if (regParsed.landRight) specials.push("대지권: " + regParsed.landRight);
  if (regParsed.transferDate) specials.push("소유권이전: " + regParsed.transferDate + (regParsed.transferCause ? "(" + regParsed.transferCause + ")" : "") + (regParsed.tradePrice ? " / 거래가 " + num(regParsed.tradePrice) + "만" : ""));
  if (regParsed.owners?.length > 1) specials.push("공동소유: " + regParsed.owners.map(o => `${o.name}(${o.share})`).join(", "));
  if (regParsed.summaryCleanGapgu && regParsed.summaryCleanEulgu) specials.push("✅ 등기부 깨끗");
  else { if (regParsed.summaryCleanGapgu) specials.push("✅ 갑구 깨끗"); if (regParsed.summaryCleanEulgu) specials.push("✅ 을구 깨끗"); }
  if (!regParsed.summaryCleanGapgu && regParsed.risks?.length > 0) {
    f.risks = [...new Set([...(f.risks || []), ...regParsed.risks])];
    specials.push(regParsed.risks.map(r => "⚠️ " + r).join(", "));
  } else { f.risks = []; }
  f.special = specials.join(" / ");

  // 순위 자동 판단
  const totalMortgages = (f.seniorLoans?.length || 0) + (regParsed.mortgages?.length || 0);
  if (totalMortgages === 0) f.rank = "1순위";
  else if (totalMortgages === 1) f.rank = "2순위";
  else if (totalMortgages >= 2) f.rank = (parseInt(f.rank) || 1) >= 2 ? f.rank : "2순위";

  return f;
}

// ========================
// 발송 양식
// ========================
function toOutput(d) {
  const birth = d.birth ? d.birth.replace(/[-]\d*$/, "") : "";
  let o = "◈ 올웨더파트너스대부\n\n";
  o += `[ ${d.loanType} / ${d.type} / ${d.rank} ]\n\n`;
  o += "▶ 신청인\n";
  if (d.name) o += `성명: ${d.name}\n`;
  if (birth) o += `생년: ${birth}\n`;
  if (d.phone) o += `연락처: ${d.phone}\n`;
  if (d.job) o += `직업: ${d.job}\n`;
  if (d.salary) o += `월소득: ${d.salary}\n`;
  if (d.credit) o += `신용: ${d.credit}\n`;
  o += "\n▶ 담보물\n";
  if (d.address) o += `주소: ${d.address}\n`;
  if (d.addressRegistry && d.addressRegistry !== d.address) { const label = /[가-힣\d]+(?:로|길)\s*\d/.test(d.addressRegistry) ? "도로명" : "지번"; o += `${label}: ${d.addressRegistry}\n`; }
  if (d.kb) o += `시세: ${d.kb}\n`;
  o += "\n";
  if (d.special || d.note || (d.risks || []).length > 0) {
    o += "▶ 특이사항\n";
    if (d.special) d.special.split(/\s*\/\s*/).forEach(item => { if (item.trim()) o += `* ${item.trim()}\n`; });
    if (d.note) o += `* ${d.note}\n`;
    o += "\n";
  }
  o += "▶ 대출현황\n";
  if (d.seniorDetail) { d.seniorDetail.split("\n").forEach(l => { o += `${l}\n`; }); }
  else if (d.senior) o += `선순위: ${d.senior}\n`;
  if (d.amount) o += `요청: ${d.amount}\n`;
  if (d.purpose) o += `용도: ${d.purpose}\n`;
  if (d.period) o += `기간: ${d.period}\n`;
  o += "\n㈜올웨더파트너스대부\n☎ 010-7485-3357";
  return o;
}

// ========================
// 색상
// ========================
const gold = "#d4a843", goldLight = "#f0d080", navy = "#141c2e", navyLight = "#1c2840", navyMid = "#1a2236";
const border = "rgba(212,168,67,0.2)", textMuted = "#8a9bb5";

// ========================
// 메인 컴포넌트
// ========================
export default function Home() {
  const [mode, setMode] = useState("input");
  const [kakaoText, setKakaoText] = useState("");
  const [regText, setRegText] = useState("");
  const [regFile, setRegFile] = useState(null);
  const [regParsed, setRegParsed] = useState(null);
  const [merged, setMerged] = useState({ ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] });
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [priceData, setPriceData] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const fileRef = useRef(null);
  const kakaoFileRef = useRef(null);
  const [kakaoFile, setKakaoFile] = useState(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkFilters, setBulkFilters] = useState({ types: { "아파트": true, "빌라/다세대": true, "오피스텔": false, "주상복합": true }, maxRank: 2, minKb: 5000, riskExclude: true, regions: { "수도권": true, "충청": true, "대구경북": true, "부산경남울산": true, "호남": true, "강원": true, "제주": true, "기타": false } });
  const [bulkExpanded, setBulkExpanded] = useState({ pass: true, review: true, fail: false });
  const [bulkDetailOpen, setBulkDetailOpen] = useState({});

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  async function handleKakaoPdf(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      let text;
      if (file.type === "application/pdf") {
        text = await extractPdfText(file);
      } else {
        // 이미지 → Gemini Vision OCR
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        text = data.text;
      }
      setKakaoText(text); setKakaoFile(file.name);
      showToast(`텍스트 추출 완료 (${file.name})`);
    } catch (err) { showToast("파일 오류: " + err.message); }
    finally { setLoading(false); if (kakaoFileRef.current) kakaoFileRef.current.value = ""; }
  }

  async function handlePdf(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const text = await extractPdfText(file); setRegText(text); setRegFile(file.name);
      const parsed = parseRegistry(text); setRegParsed(parsed);
      showToast(`등기부 분석: 근저당 ${parsed.mortgages.length}건`);
    } catch (err) { showToast("PDF 오류: " + err.message); }
    finally { setLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  // 정규식만 (빠른 분석)
  function handleQuickParse() {
    if (!kakaoText.trim() && !regText.trim()) { showToast("카톡 또는 등기부 입력 필요"); return; }
    // 이전 분석 결과 초기화
    setPriceData(null); setAnalysis(""); setAiModel("");
    const kp = kakaoText.trim() ? parseKakao(kakaoText) : { ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] };
    let rp = regParsed;
    if (regText.trim() && !regParsed) { rp = parseRegistry(regText); setRegParsed(rp); }
    const m = mergeData(kp, rp); setMerged(m); setMode("review");
    showToast(`빠른 분석 완료${kp.name ? " — " + kp.name : ""}`);
  }

  // AI 메인 파서
  async function handleAIParse() {
    if (!kakaoText.trim() && !regText.trim() && !regFile) { showToast("카톡 또는 등기부 입력 필요"); return; }
    // 이전 분석 결과 초기화
    setPriceData(null); setAnalysis(""); setAiModel("");
    setAiParsing(true);
    try {
      // 등기부 정규식 먼저
      if (regText.trim() && !regParsed) { const rp = parseRegistry(regText); setRegParsed(rp); }

      // 등기부는 첫장(표제부)+마지막장(요약)만 AI에 전달
      let slimRegistry = undefined;
      if (regText.trim()) {
        const summaryIdx = regText.search(/주요\s*등기\s*사항\s*요약/);
        const gapguIdx = regText.search(/【\s*갑\s*구\s*】|갑\s*구/);
        const firstPage = regText.slice(0, gapguIdx > 0 ? gapguIdx : 1200);
        const summaryPage = summaryIdx > -1 ? regText.slice(summaryIdx) : "";
        slimRegistry = (firstPage + "\n---\n" + summaryPage).slice(0, 2000);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 28000);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: kakaoText.slice(0, 2500), registryText: slimRegistry }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("응답 파싱 실패"); }
      if (data.error) throw new Error(data.error);

      setAiModel(data.model || "");
      const aiData = aiToInternal(data.result);

      // 정규식으로 빈 값 보충
      if (kakaoText.trim()) {
        const regex = parseKakao(kakaoText);
        for (const k of ["name", "birth", "phone", "job", "salary", "credit", "address", "amount", "purpose"]) {
          if (!aiData[k] && regex[k]) aiData[k] = regex[k];
        }
        // 시세 보충
        if (!aiData.kbMid && !aiData.kbLow && !aiData.housemuch) {
          aiData.kbLow = regex.kbLow; aiData.kbMid = regex.kbMid; aiData.kbHigh = regex.kbHigh;
          aiData.kbApplied = regex.kbApplied; aiData.kbAppliedValue = regex.kbAppliedValue;
          aiData.housemuch = regex.housemuch; aiData.housemuchGrade = regex.housemuchGrade;
          aiData.kb = buildKbDisplay(aiData);
        }
        // 대출 보충
        if (aiData.seniorLoans.length === 0 && regex.seniorLoans.length > 0) {
          aiData.seniorLoans = regex.seniorLoans;
          aiData.replacementLoans = regex.replacementLoans;
          aiData.seniorTotal = regex.seniorTotal;
          aiData.replacementTotal = regex.replacementTotal;
          aiData.seniorDetail = regex.seniorDetail;
          aiData.senior = regex.senior;
        }
        // 신용 소스 보충
        if (aiData.credit && !/KCB|NICE/i.test(aiData.credit) && regex.credit && /KCB|NICE/i.test(regex.credit)) aiData.credit = regex.credit;
      }

      // 시세=요청 혼동 체크
      if (aiData.kb && aiData.amount) {
        const kbD = aiData.kb.replace(/[^\d]/g, ""), amtD = aiData.amount.replace(/[^\d]/g, "");
        if (kbD && amtD && kbD === amtD) aiData.amount = "";
      }
      if (!aiData.amount) {
        if (/추가.*한도|추가.*부탁/.test(kakaoText)) aiData.amount = "추가 한도 부탁드립니다";
        else if (/가능사.*확인|확인.*부탁/.test(kakaoText)) { const reqM = kakaoText.match(/((?:\d순위\s*)?가능사?\s*확인\s*부탁[가-힣]*)/); if (reqM) aiData.amount = reqM[1]; }
        else if (/대납.*최대|최대.*요청/.test(kakaoText)) aiData.amount = "대납 최대 요청";
      }

      const m = mergeData(aiData, regParsed);
      setMerged(m); setMode("review");
      showToast(`AI 분석 완료 (${data.model || ""})`);
    } catch (err) {
      console.error(err);
      handleQuickParse();
      showToast("AI 실패 → 정규식 (" + (err.name === "AbortError" ? "타임아웃" : err.message.slice(0, 30)) + ")");
    } finally { setAiParsing(false); }
  }

  // AI 등기부 권리분석
  async function handleAIRegistry() {
    if (!regText.trim()) { showToast("등기부 데이터가 없습니다"); return; }
    setAiParsing(true);
    try {
      // ★ AI에는 요약 페이지만 전달 — 갑구/을구 본문은 절대 보내지 않음 (말소 혼동 방지)
      const summaryIdx = regText.search(/주요\s*등기\s*사항\s*요약/);
      const slimText = summaryIdx > -1 ? regText.slice(summaryIdx, summaryIdx + 1500) : regText.slice(0, 800);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 28000);
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: slimText,
          kb: merged.kb || "",
          hint: regParsed ? {
            owners: regParsed.owners?.map(o => `${o.name}(${o.role}, ${o.share})`).join(", ") || "",
            area: regParsed.area || "", totalFloors: regParsed.totalFloors || "", unitFloor: regParsed.unitFloor || "",
            mortgages: regParsed.mortgages?.length > 0 ? regParsed.mortgages.map(m => `${m.holder}: ${m.maxAmount}만`).join(", ") : "없음",
            risks: regParsed.risks?.length > 0 ? regParsed.risks.join(", ") : "없음",
            gapgu: regParsed.summaryCleanGapgu ? "기록사항 없음 (깨끗)" : "확인 필요",
            eulgu: regParsed.summaryCleanEulgu ? "기록사항 없음 (깨끗)" : "확인 필요",
            transferDate: regParsed.transferDate || "", transferCause: regParsed.transferCause || "",
            tradePrice: regParsed.tradePrice ? regParsed.tradePrice + "만" : "",
          } : null
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("응답 파싱 실패"); }
      if (data.error) throw new Error(data.error);
      setAnalysis(data.result); showToast("권리분석 완료!");
    } catch (err) {
      setAnalysis("❌ 분석 실패: " + (err.name === "AbortError" ? "타임아웃" : err.message));
    } finally { setAiParsing(false); }
  }

  function handleGenerate() { setOutput(toOutput(merged)); setMode("output"); }
  function handleCopy() {
    try { navigator.clipboard?.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); } catch { showToast("복사 실패"); }
  }
  function handleReset() { setKakaoText(""); setKakaoFile(null); setRegText(""); setRegFile(null); setRegParsed(null); setMerged({ ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] }); setOutput(""); setAnalysis(""); setAiModel(""); setPriceData(null); setMode("input"); if (fileRef.current) fileRef.current.value = ""; if (kakaoFileRef.current) kakaoFileRef.current.value = ""; }
  const set = (k) => (e) => setMerged({ ...merged, [k]: e.target.value });
  const TYPES = ["아파트", "빌라/다세대", "오피스텔", "단독/다가구", "상가", "토지", "기타"];
  const RANKS = ["1순위", "2순위", "3순위"];
  const LTYPES = ["일반담보", "분양담보", "후순위", "동시설정", "대환", "매매잔금", "생활안정자금", "전세퇴거자금", "기타"];

  // 법정동코드 매핑 (실거래가 API용) — 전국 완전판
  const LAWD_MAP = [
    // 서울 (25개 자치구)
    ["종로구",11110],["서울 중구",11140],["용산구",11170],["성동구",11200],["광진구",11215],
    ["동대문구",11230],["중랑구",11260],["성북구",11290],["강북구",11305],["도봉구",11320],
    ["노원구",11350],["은평구",11380],["서대문구",11410],["마포구",11440],["양천구",11470],
    ["강서구",11500],["구로구",11530],["금천구",11545],["영등포구",11560],["동작구",11590],
    ["관악구",11620],["서초구",11650],["강남구",11680],["송파구",11710],["강동구",11740],
    // 부산 (15개 구 + 1개 군) — 정확한 코드
    ["부산 중구",26110],["부산 서구",26140],["부산 동구",26170],["부산 영도구",26200],
    ["부산진구",26230],["동래구",26260],["부산 남구",26290],["부산 북구",26320],
    ["해운대구",26350],["사하구",26380],["금정구",26410],["부산 강서구",26440],
    ["연제구",26470],["수영구",26500],["사상구",26530],["기장군",26710],
    // 대구 (7개 구 + 2개 군)
    ["대구 중구",27110],["대구 동구",27140],["대구 서구",27170],["대구 남구",27200],
    ["대구 북구",27230],["수성구",27260],["달서구",27290],["달성군",27710],["군위군",27720],
    // 인천 (8개 구 + 2개 군)
    ["인천 중구",28110],["인천 동구",28140],["미추홀구",28177],["연수구",28185],
    ["남동구",28200],["부평구",28237],["계양구",28245],["인천 서구",28260],
    ["강화군",28710],["옹진군",28720],
    // 광주 (5개 자치구)
    ["광주 동구",29110],["광주 서구",29140],["광주 남구",29155],["광주 북구",29170],["광산구",29200],
    // 대전 (5개 자치구)
    ["대전 동구",30110],["대전 중구",30140],["대전 서구",30170],["유성구",30200],["대덕구",30230],
    // 울산 (4개 구 + 1개 군)
    ["울산 중구",31110],["울산 남구",31140],["울산 동구",31170],["울산 북구",31200],["울주군",31710],
    // 세종
    ["세종",36110],
    // 경기 (28개 시 + 3개 군)
    ["의정부",41150],["수원 장안구",41111],["수원 권선구",41113],["수원 팔달구",41115],["수원 영통구",41117],
    ["성남 수정구",41131],["성남 중원구",41133],["성남 분당구",41135],
    ["안양 만안구",41171],["안양 동안구",41173],
    ["부천",41190],["광명",41210],["평택",41220],["동두천",41250],
    ["안산 상록구",41271],["안산 단원구",41273],
    ["고양 덕양구",41281],["고양 일산동구",41285],["고양 일산서구",41287],
    ["과천",41290],["구리",41310],["남양주",41360],["오산",41370],
    ["시흥",41390],["군포",41410],["의왕",41430],["하남",41450],
    ["용인 처인구",41461],["용인 기흥구",41463],["용인 수지구",41465],
    ["파주",41480],["이천",41500],["안성",41550],["김포",41570],
    ["화성",41590],["경기 광주",41610],["양주",41630],["포천",41650],
    ["여주",41670],["연천",41800],["가평",41820],["양평",41840],
    // 충북 (3개 시 + 8개 군)
    ["청주 상당구",43111],["청주 서원구",43112],["청주 흥덕구",43113],["청주 청원구",43114],
    ["충주",43130],["제천",43150],["보은",43720],["옥천",43730],["영동",43740],
    ["증평",43745],["진천",43750],["괴산",43760],["음성",43770],["단양",43800],
    // 충남 (8개 시 + 7개 군)
    ["천안 동남구",44131],["천안 서북구",44133],["공주",44150],["보령",44180],
    ["아산",44200],["서산",44210],["논산",44230],["계룡",44250],["당진",44270],
    ["금산",44710],["부여",44760],["서천",44770],["청양",44790],["홍성",44800],["예산",44810],["태안",44825],
    // 전북 (6개 시 + 8개 군)
    ["전주 완산구",45111],["전주 덕진구",45113],["군산",45130],["익산",45140],
    ["정읍",45180],["남원",45190],["김제",45210],
    ["완주",45710],["진안",45720],["무주",45730],["장수",45740],["임실",45750],["순창",45770],["고창",45790],["부안",45800],
    // 전남 (5개 시 + 17개 군)
    ["목포",46110],["여수",46130],["순천",46150],["나주",46170],["광양",46230],
    ["담양",46710],["곡성",46720],["구례",46730],["고흥",46770],["보성",46780],
    ["화순",46790],["장흥",46800],["강진",46810],["해남",46820],["영암",46830],
    ["무안",46840],["함평",46860],["영광",46870],["장성",46880],["완도",46890],["진도",46900],["신안",46910],
    // 경북 (10개 시 + 13개 군)
    ["포항 북구",47111],["포항 남구",47113],["경주",47130],["김천",47150],["안동",47170],
    ["구미",47190],["영주",47210],["영천",47230],["상주",47250],["문경",47280],["경산",47290],
    ["의성",47730],["청송",47760],["영양",47770],["영덕",47780],["청도",47820],
    ["고령",47830],["성주",47840],["칠곡",47850],["예천",47900],["봉화",47920],["울진",47930],["울릉",47940],
    // 경남 (8개 시 + 10개 군)
    ["창원 의창구",48121],["창원 성산구",48123],["창원 마산합포구",48125],["창원 마산회원구",48127],["창원 진해구",48129],
    ["진주",48170],["통영",48220],["사천",48240],["김해",48250],["밀양",48270],["거제",48310],["양산",48330],
    ["의령",48720],["함안",48730],["창녕",48740],["경남 고성",48820],["남해",48840],["하동",48850],["산청",48860],["함양",48870],["거창",48880],["합천",48890],
    // 강원 (7개 시 + 11개 군)
    ["춘천",51110],["원주",51130],["강릉",51150],["동해",51170],["태백",51190],
    ["속초",51210],["삼척",51230],["홍천",51720],["횡성",51730],["영월",51750],
    ["평창",51760],["정선",51770],["철원",51780],["화천",51790],["양구",51800],
    ["인제",51810],["강원 고성",51820],["양양",51830],
    // 제주
    ["제주",50110],["서귀포",50130],
  ];

  function findLawdCd(address) {
    if (!address) return null;
    // 광역시/특별시/도 등 행정구역 접두어 제거
    const addr = address
      .replace(/광역시|특별자치시|특별자치도|특별시/g, "")
      .replace(/경상북도|경상남도|전라북도|전라남도|충청북도|충청남도|강원특별자치도|강원도|제주특별자치도|경기도|전라도|충청도/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const sorted = [...LAWD_MAP].sort((a, b) => b[0].length - a[0].length);
    for (const [name, code] of sorted) {
      if (addr.includes(name)) return { code: String(code), name };
    }
    return null;
  }

  // 주소에서 단지명 추출: "논현동 749-1 논현센트럴뷰 제401동 제6층 제604호" → "논현센트럴뷰"
  function extractAptName(addr) {
    if (!addr) return "";
    // 패턴1: 지번(123-45) 뒤 단지명 + 동
    let m = addr.match(/\d+(?:-\d+)?\s+([가-힣A-Za-z0-9·]+(?:\s[가-힣A-Za-z0-9·]+)?)\s+제?\d+\s*동/);
    if (m) return m[1].replace(/\s+/g, "");
    // 패턴2: 동/호 직전 한글 단어
    m = addr.match(/([가-힣A-Za-z0-9·]{3,})\s+(?:제\s*)?\d+\s*동\s*(?:제\s*)?\d+\s*층/);
    if (m) return m[1];
    // 패턴3: 알려진 브랜드 키워드 포함 단어
    m = addr.match(/([가-힣A-Za-z0-9·]*(?:센트럴|자이|푸르지오|아이파크|래미안|힐스테이트|더샵|이편한|이안|롯데캐슬|위브|아너스|파크리오|한신|뷰|타운|마을|타워|팰리스|에이치|엘에이치)[가-힣A-Za-z0-9·]*)/);
    if (m) return m[1];
    return "";
  }

  // 면적 문자열에서 숫자 추출: "59.84㎡" → 59.84
  function parseArea(s) {
    if (!s) return 0;
    const m = String(s).match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  }

  async function fetchPrice(address) {
    const found = findLawdCd(address);
    if (!found) { showToast("법정동코드 매핑 실패 — 주소 확인"); return; }
    setPriceLoading(true);
    try {
      const now = new Date();
      // 6개월 조회
      const months = [0, 1, 2, 3, 4, 5].map((offset) => {
        const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      });
      const aptHint = extractAptName(address);
      const targetArea = parseArea(merged.area);

      const results = await Promise.all(months.map((ym) =>
        fetch("/api/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lawdCd: found.code, dealYmd: ym, targetArea, aptHint }) }).then((r) => r.json())
      ));
      const allItems = results.flatMap((r) => r.items || []);
      const allMatched = results.flatMap((r) => r.matched || []);
      // 매칭은 최신순 정렬
      allMatched.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

      // 6개월 통합 면적별 요약 재계산
      const areaGroups = {};
      for (const item of allItems) {
        if (item.cancel) continue;
        const k = Math.round(item.area);
        if (!areaGroups[k]) areaGroups[k] = [];
        areaGroups[k].push(parseInt((item.amount || "0").replace(/,/g, "")) || 0);
      }
      const summary = Object.entries(areaGroups)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([area, prices]) => ({
          area: parseInt(area),
          pyeong: Math.round(parseInt(area) / 3.305),
          count: prices.length,
          avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        }));

      setPriceData({ items: allItems, matched: allMatched, summary, region: found.name, aptHint, targetArea });
      const matchMsg = allMatched.length > 0 ? ` · 매칭 ${allMatched.length}건` : "";
      showToast(`실거래가 ${allItems.length}건 (${found.name}, 6개월)${matchMsg}`);
    } catch (err) {
      showToast("실거래가 조회 실패: " + err.message);
    } finally {
      setPriceLoading(false);
    }
  }

  function openNaverSearch(address) {
    if (!address) { showToast("주소가 없습니다"); return; }
    const aptHint = extractAptName(address);
    // 지역명 추출 (구/시 단위) → 정확도 향상
    const regionMatch = address.match(/([가-힣]+(?:특별시|광역시|특별자치시|도)?)\s*([가-힣]+(?:시|군|구))/);
    const region = regionMatch ? `${regionMatch[1].replace(/광역시|특별자치시|특별시/, "")} ${regionMatch[2]}`.trim() : "";
    // 단지명 우선 + 지역 보조, 없으면 주소 일부
    const keyword = aptHint
      ? (region ? `${region} ${aptHint}` : aptHint)
      : address.split(/제?\d+\s*동/)[0].trim();
    const url = `https://m.land.naver.com/search/result/${encodeURIComponent(keyword)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    showToast(`네이버 검색: "${keyword}"`);
  }

  // LTV 계산
  const ltv = calcLTV(merged);

  const s = {
    wrap: { fontFamily: "'Noto Sans KR',sans-serif", background: navy, minHeight: "100vh", color: "#e0dcd0", maxWidth: 600, margin: "0 auto" },
    header: { background: `linear-gradient(135deg,${navy},${navyLight})`, borderBottom: `1px solid ${border}`, padding: "20px 24px 16px" },
    brand: { display: "flex", alignItems: "center", gap: 10 },
    brandIcon: { width: 36, height: 36, borderRadius: "50%", border: `2px solid ${gold}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: gold, background: "rgba(212,168,67,0.08)" },
    brandText: { fontSize: 13, color: gold, fontWeight: 700 },
    brandSub: { fontSize: 11, color: textMuted },
    tabs: { display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${border}` },
    tab: (a) => ({ flex: 1, padding: "10px 2px", textAlign: "center", fontSize: 12, fontWeight: a ? 700 : 400, background: a ? "rgba(212,168,67,0.12)" : "transparent", color: a ? goldLight : textMuted, border: "none", cursor: "pointer", borderRight: `1px solid ${border}` }),
    body: { padding: "20px 24px 100px" },
    section: { fontSize: 13, color: gold, fontWeight: 700, margin: "20px 0 10px" },
    divider: { height: 1, background: border, margin: "8px 0 16px" },
    label: { fontSize: 12, color: gold, fontWeight: 600, marginBottom: 6, display: "block" },
    input: { width: "100%", padding: "11px 14px", background: navyMid, border: `1px solid ${border}`, borderRadius: 8, color: "#e0dcd0", fontSize: 14, outline: "none", boxSizing: "border-box" },
    select: { width: "100%", padding: "11px 14px", background: navyMid, border: `1px solid ${border}`, borderRadius: 8, color: "#e0dcd0", fontSize: 14, outline: "none", boxSizing: "border-box", appearance: "none" },
    textarea: { width: "100%", minHeight: 140, padding: "14px", background: navyMid, border: `1px solid ${border}`, borderRadius: 8, color: "#e0dcd0", fontSize: 13, lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box" },
    btnPrimary: { width: "100%", padding: "14px", background: `linear-gradient(135deg,${gold},#b8922e)`, border: "none", borderRadius: 8, color: navy, fontSize: 15, fontWeight: 800, cursor: "pointer", marginTop: 8 },
    btnSecondary: { width: "100%", padding: "12px", background: "rgba(212,168,67,0.1)", border: `1px solid ${border}`, borderRadius: 8, color: goldLight, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 },
    resultBox: { background: navyMid, border: `1px solid ${border}`, borderRadius: 10, padding: "16px", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8, color: "#e0dcd0", marginBottom: 12 },
    row: { display: "flex", gap: 12 },
    half: { flex: 1 },
    fieldGroup: { marginBottom: 14 },
    badge: (c) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c === "gold" ? "rgba(212,168,67,0.15)" : c === "red" ? "rgba(255,80,80,0.12)" : c === "blue" ? "rgba(100,160,255,0.12)" : "rgba(100,200,100,0.12)", color: c === "gold" ? goldLight : c === "red" ? "#ff7b7b" : c === "blue" ? "#7ab3ff" : "#7fdb7f", marginRight: 6 }),
    toast: { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: gold, color: navy, padding: "10px 24px", borderRadius: 30, fontSize: 12, fontWeight: 700, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", maxWidth: "90%", textAlign: "center" },
    uploadBox: { border: `2px dashed ${border}`, borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", background: "rgba(212,168,67,0.03)" },
    sourceTag: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, marginLeft: 8, background: c === "kakao" ? "rgba(255,220,50,0.12)" : "rgba(100,200,100,0.12)", color: c === "kakao" ? "#ffe066" : "#7fdb7f" }),
  };

  // LTV 바 컴포넌트
  const LtvBar = ({ label, value, maxVal }) => {
    if (value === null || value === undefined) return null;
    const pct = Math.min(value, 120);
    const barColor = value <= 70 ? "#2ecc71" : value <= 80 ? "#f1c40f" : value <= 90 ? "#e67e22" : "#e74c3c";
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: textMuted }}>{label}</span>
          <span style={{ color: barColor, fontWeight: 700 }}>{value}%</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 8, overflow: "hidden", position: "relative" }}>
          <div style={{ width: `${Math.min(pct / 1.2 * 100, 100)}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width 0.5s" }} />
          {/* 70/80/90 구간선 */}
          <div style={{ position: "absolute", left: `${70 / 1.2}%`, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.3)" }} />
          <div style={{ position: "absolute", left: `${80 / 1.2}%`, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.3)" }} />
          <div style={{ position: "absolute", left: `${90 / 1.2}%`, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.3)" }} />
        </div>
      </div>
    );
  };

  return (
    <div style={s.wrap}>
      {toast && <div style={s.toast}>{toast}</div>}
      {copied && <div style={{ position: "fixed", top: 20, right: 20, background: "#2ecc71", color: "#fff", padding: "8px 20px", borderRadius: 30, fontSize: 13, fontWeight: 700, zIndex: 999 }}>복사 완료!</div>}

      <div style={s.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={s.brand}><div style={s.brandIcon}>AW</div><div><div style={s.brandText}>올웨더파트너스대부</div><div style={s.brandSub}>물건접수 종합분석기 v2</div></div></div>
          <span style={{ background: "rgba(100,200,100,0.1)", border: "1px solid rgba(100,200,100,0.25)", borderRadius: 20, padding: "4px 12px", color: "#7fdb7f", fontSize: 11, fontWeight: 600 }}>AI 메인</span>
        </div>
        <div style={s.tabs}>
          <button style={s.tab(mode === "input")} onClick={() => setMode("input")}>접수입력</button>
          <button style={s.tab(mode === "review")} onClick={() => setMode("review")}>검토수정</button>
          <button style={s.tab(mode === "analysis")} onClick={() => setMode("analysis")}>📊 분석</button>
          <button style={s.tab(mode === "output")} onClick={() => setMode("output")}>발송양식</button>
          <button style={{...s.tab(mode === "bulk"), background: mode === "bulk" ? gold : "transparent"}} onClick={() => setMode("bulk")}>⚡대량</button>
        </div>
      </div>

      <div style={s.body}>
        {/* === 접수입력 === */}
        {mode === "input" && (<>
          <div style={s.section}>◆ 카톡 내용 붙여넣기</div><div style={s.divider} />
          <p style={{ fontSize: 12, color: textMuted, marginBottom: 10, lineHeight: 1.5 }}>업체에서 받은 카톡 메시지를 붙여넣거나, PDF 파일을 업로드하세요.</p>
          <input ref={kakaoFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleKakaoPdf} style={{ display: "none" }} />
          <textarea style={s.textarea} placeholder={"홍명선 / 770504\nKB 하 39,500만 / 일 43,000만 (일)\n▶ 선순위\n1. 우리은행 5,940만 (5,400만)\n▶ 대환/말소대상\n4. 더라이즈대부 3,900만\n..."} value={kakaoText} onChange={(e) => { setKakaoText(e.target.value); if (e.target.value === "") setKakaoFile(null); }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            {kakaoFile
              ? <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7fdb7f" }}>
                  <span>✓ {kakaoFile}</span>
                  <button onClick={() => { setKakaoFile(null); setKakaoText(""); if (kakaoFileRef.current) kakaoFileRef.current.value = ""; }} style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff7b7b", borderRadius: 4, fontSize: 11, padding: "1px 7px", cursor: "pointer" }}>×</button>
                </div>
              : kakaoText.trim()
                ? <div style={{ fontSize: 12, color: "#7fdb7f" }}>✓ 카톡 데이터 입력됨</div>
                : null}
            {loading && kakaoFile === null
              ? null
              : <button onClick={() => kakaoFileRef.current?.click()} style={{ marginLeft: "auto", background: "rgba(255,214,0,0.08)", border: "1px solid rgba(255,214,0,0.3)", color: "#ffd600", borderRadius: 4, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>📄 PDF / 이미지 업로드</button>}
          </div>

          <div style={{ ...s.section, marginTop: 24 }}>◆ 등기부등본 (선택)</div><div style={s.divider} />
          <input ref={fileRef} type="file" accept=".pdf" onChange={handlePdf} style={{ display: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ ...s.uploadBox, borderColor: regFile ? "#7fdb7f" : border }} onClick={() => { if (!regFile) fileRef.current?.click(); }}>
              {loading ? <span style={{ color: goldLight }}>⟳ PDF 분석 중...</span>
                : regFile ? <div><div style={{ color: "#7fdb7f", fontWeight: 700 }}>✓ {regFile}</div><div style={{ color: textMuted, fontSize: 12, marginTop: 4 }}>{regParsed ? `근저당 ${regParsed.mortgages.length}건 / 위험 ${regParsed.risks.length}건` : ""}</div></div>
                : <div><div style={{ fontSize: 28, marginBottom: 6 }}>📄</div><div style={{ color: goldLight, fontWeight: 600 }}>등기부 PDF 업로드</div></div>}
            </div>
            {regFile && !loading && (
              <button
                onClick={(e) => { e.stopPropagation(); setRegFile(null); setRegText(""); setRegParsed(null); if (fileRef.current) fileRef.current.value = ""; showToast("등기부 제거됨"); }}
                style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%", background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff7b7b", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}
                title="등기부 제거"
              >×</button>
            )}
          </div>
          {!regFile && <><div style={{ textAlign: "center", padding: "10px 0", fontSize: 11, color: textMuted }}>— 또는 텍스트 직접 붙여넣기 —</div><textarea style={{ ...s.textarea, minHeight: 80 }} placeholder="등기부등본 텍스트..." value={regText} onChange={(e) => setRegText(e.target.value)} /></>}
          {regText.trim() && !regFile && (
            <button
              onClick={() => { setRegText(""); setRegParsed(null); showToast("등기부 텍스트 비움"); }}
              style={{ marginTop: 6, padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: 6, color: "#ff7b7b", fontSize: 11, cursor: "pointer" }}
            >× 등기부 텍스트 지우기</button>
          )}

          {aiParsing && <div style={{ textAlign: "center", padding: "16px 0", color: goldLight, fontSize: 14, fontWeight: 600 }}><span style={{ display: "inline-block", animation: "spin 1s linear infinite", marginRight: 8 }}>⟳</span>AI 분석 중...<style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div>}
          <button style={{ ...s.btnPrimary, marginTop: 20, opacity: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? 1 : 0.4, pointerEvents: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? "auto" : "none" }} onClick={handleAIParse}>🤖 AI 종합 분석</button>
          <button style={{ ...s.btnSecondary, opacity: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? 1 : 0.4 }} onClick={handleQuickParse}>⚡ 빠른 분석 (정규식)</button>
          <button style={s.btnSecondary} onClick={handleReset}>초기화</button>
        </>)}

        {/* === 검토수정 === */}
        {mode === "review" && (<>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {aiModel && <span style={s.badge("green")}>AI: {aiModel}</span>}
            {regParsed && <span style={s.badge("blue")}>등기부</span>}
            {(merged.risks || []).length > 0 && <span style={s.badge("red")}>위험 {merged.risks.length}건</span>}
          </div>
          {(merged.risks || []).length > 0 && <div style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}><div style={{ fontSize: 12, color: "#ff6b6b", fontWeight: 700, marginBottom: 6 }}>🚨 위험요소</div>{merged.risks.map((r, i) => <div key={i} style={{ fontSize: 13, marginBottom: 2 }}>⚠️ {r}</div>)}</div>}

          {/* LTV 미니 대시보드 */}
          {ltv.basePrice && (
            <div style={{ background: "rgba(100,160,255,0.04)", border: `1px solid rgba(100,160,255,0.15)`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#7ab3ff", fontWeight: 700 }}>📊 LTV 분석</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: ltv.gradeColor }}>{ltv.grade}</span>
              </div>
              <div style={{ fontSize: 11, color: textMuted, marginBottom: 8 }}>기준시세: {ltv.basePriceLabel} {num(ltv.basePrice)}만</div>
              <LtvBar label="현재 LTV (추정잔액)" value={ltv.ltvCurrentEst} />
              <LtvBar label="현재 LTV (채권최고액)" value={ltv.ltvCurrentMax} />
              {ltv.ltvAfterReplace !== null && <LtvBar label="대환 후 LTV" value={ltv.ltvAfterReplace} />}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, background: "rgba(46,204,113,0.08)", borderRadius: 6, padding: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#2ecc71" }}>70% 여유</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#2ecc71" }}>{num(ltv.availableAtLTV70)}만</div>
                </div>
                <div style={{ flex: 1, background: "rgba(241,196,15,0.08)", borderRadius: 6, padding: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#f1c40f" }}>80% 여유</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f1c40f" }}>{num(ltv.availableAtLTV80)}만</div>
                </div>
                <div style={{ flex: 1, background: "rgba(231,76,60,0.08)", borderRadius: 6, padding: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#e74c3c" }}>90% 여유</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e74c3c" }}>{num(ltv.availableAtLTV90)}만</div>
                </div>
              </div>
            </div>
          )}

          <div style={s.section}>◆ 접수 구분</div><div style={s.divider} />
          <div style={s.row}><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>유형</label><select style={s.select} value={merged.type} onChange={set("type")}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></div></div><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>순위</label><select style={s.select} value={merged.rank} onChange={set("rank")}>{RANKS.map(r => <option key={r}>{r}</option>)}</select></div></div></div>
          <div style={s.fieldGroup}><label style={s.label}>대출구분</label><select style={s.select} value={merged.loanType} onChange={set("loanType")}>{LTYPES.map(t => <option key={t}>{t}</option>)}</select></div>

          <div style={s.section}>◆ 신청인</div><div style={s.divider} />
          <div style={s.row}><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>성함</label><input style={s.input} value={merged.name} onChange={set("name")} /></div></div><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>생년</label><input style={s.input} value={merged.birth} onChange={set("birth")} /></div></div></div>
          <div style={s.fieldGroup}><label style={s.label}>연락처</label><input style={s.input} value={merged.phone} onChange={set("phone")} /></div>
          <div style={s.row}><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>직업</label><input style={s.input} value={merged.job} onChange={set("job")} /></div></div><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>월소득</label><input style={s.input} value={merged.salary} onChange={set("salary")} /></div></div></div>
          <div style={s.fieldGroup}><label style={s.label}>신용</label><input style={s.input} value={merged.credit} onChange={set("credit")} /></div>

          <div style={s.section}>◆ 담보물</div><div style={s.divider} />
          <div style={s.fieldGroup}><label style={s.label}>주소</label><input style={s.input} value={merged.address} onChange={set("address")} /></div>
          {merged.addressRegistry && <div style={s.fieldGroup}><label style={s.label}>지번 <span style={s.sourceTag("reg")}>등기부</span></label><input style={{ ...s.input, fontSize: 12, color: textMuted }} value={merged.addressRegistry} onChange={set("addressRegistry")} /></div>}
          <div style={s.fieldGroup}><label style={s.label}>시세</label><input style={s.input} value={merged.kb} onChange={set("kb")} /></div>

          {/* 시세 조회 버튼 2개 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              style={{ flex: 1, padding: "10px", background: "rgba(100,160,255,0.08)", border: "1px solid rgba(100,160,255,0.25)", borderRadius: 8, color: "#7ab3ff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: priceLoading ? 0.5 : 1 }}
              onClick={() => fetchPrice(merged.address || merged.addressRegistry)}
              disabled={priceLoading}
            >
              {priceLoading ? "⟳" : "🏠 실거래가 (국토부)"}
            </button>
            <button
              style={{ flex: 1, padding: "10px", background: "rgba(60,200,80,0.08)", border: "1px solid rgba(60,200,80,0.3)", borderRadius: 8, color: "#7fdb7f", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              onClick={() => openNaverSearch(merged.address || merged.addressRegistry)}
            >
              📱 네이버 부동산 열기 ↗
            </button>
          </div>

          {/* 실거래가 결과 */}
          <div style={{ marginBottom: 16 }}>
            {priceData && (<>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 6, marginBottom: 8 }}>
                📍 {priceData.region} · 최근 6개월 {priceData.items.length}건{priceData.aptHint ? ` · 단지: ${priceData.aptHint}` : ""}{priceData.targetArea ? ` · 기준 ${priceData.targetArea}㎡` : ""}
              </div>

              {/* 같은 단지·같은 평수 매칭 (최상단 강조) */}
              {priceData.matched && priceData.matched.length > 0 && (
                <div style={{ background: "rgba(212,168,67,0.08)", border: `2px solid ${gold}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: goldLight, fontWeight: 700, marginBottom: 8 }}>
                    🎯 같은 단지·같은 평수 매칭 ({priceData.matched.length}건)
                  </div>
                  <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    {priceData.matched.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", borderBottom: "1px solid rgba(212,168,67,0.15)", fontSize: 12 }}>
                        <div>
                          <span style={{ color: "#e0dcd0", fontWeight: 700 }}>{item.aptNm}</span>
                          <span style={{ color: textMuted, marginLeft: 6 }}>{item.area}㎡ {item.floor}층</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ color: gold, fontWeight: 700 }}>{item.amount ? (parseInt(item.amount.replace(/,/g,"")) / 10000).toFixed(2) + "억" : "—"}</span>
                          <span style={{ color: textMuted, marginLeft: 6, fontSize: 11 }}>{item.date}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {priceData.matched.length > 0 && (() => {
                    const prices = priceData.matched.filter(x => !x.cancel).map(x => parseInt((x.amount||"0").replace(/,/g,""))||0).filter(x => x > 0);
                    if (prices.length === 0) return null;
                    const avg = Math.round(prices.reduce((a,b) => a+b, 0) / prices.length);
                    const max = Math.max(...prices);
                    const min = Math.min(...prices);
                    return (
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}`, fontSize: 12 }}>
                        <span style={{ color: textMuted }}>평균 <span style={{ color: gold, fontWeight: 700 }}>{(avg/10000).toFixed(2)}억</span> · 최고 {(max/10000).toFixed(2)}억 · 최저 {(min/10000).toFixed(2)}억</span>
                        <button
                          style={{ padding: "3px 10px", background: gold, border: "none", borderRadius: 4, color: navy, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                          onClick={() => { setMerged({ ...merged, kb: String(avg), actualPrice: avg }); showToast("매칭 평균 적용"); }}
                        >매칭 평균 적용</button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {priceData.matched && priceData.matched.length === 0 && (priceData.aptHint || priceData.targetArea) && (
                <div style={{ background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#ff9b9b" }}>
                  ⚠️ 같은 단지·같은 평수 매칭 0건 (6개월) — 아래 면적별 요약 참고
                </div>
              )}

              {priceData.summary.length > 0 && (
                <div style={{ background: "rgba(100,160,255,0.05)", border: "1px solid rgba(100,160,255,0.15)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#7ab3ff", fontWeight: 700, marginBottom: 8 }}>면적별 시세 요약</div>
                  {priceData.summary.map((row, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: textMuted }}>{row.area}㎡ ({row.pyeong}평) · {row.count}건</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ color: "#e0dcd0" }}>평균 {(row.avg / 10000).toFixed(1)}억</span>
                        <button
                          style={{ padding: "2px 8px", background: "rgba(212,168,67,0.15)", border: `1px solid ${border}`, borderRadius: 4, color: goldLight, fontSize: 11, cursor: "pointer" }}
                          onClick={() => { setMerged({ ...merged, kb: String(row.avg), actualPrice: row.avg }); showToast("시세 적용 완료"); }}
                        >적용</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${border}`, borderRadius: 8 }}>
                {priceData.items.slice(0, 20).map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 12px", borderBottom: `1px solid ${border}`, fontSize: 12, opacity: item.cancel ? 0.4 : 1, textDecoration: item.cancel ? "line-through" : "none" }}>
                    <div>
                      <span style={{ color: "#e0dcd0", fontWeight: 600 }}>{item.aptNm || "—"}</span>
                      <span style={{ color: textMuted, marginLeft: 6 }}>{item.area}㎡ {item.floor}층</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ color: goldLight, fontWeight: 700 }}>{item.amount ? (parseInt(item.amount.replace(/,/g,"")) / 10000).toFixed(1) + "억" : "—"}</span>
                      <span style={{ color: textMuted, marginLeft: 6, fontSize: 11 }}>{item.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>)}
          </div>

          <div style={s.section}>◆ 특이사항</div><div style={s.divider} />
          <div style={s.fieldGroup}><label style={s.label}>특이사항</label><textarea style={{ ...s.textarea, minHeight: 60 }} value={merged.special} onChange={set("special")} /></div>
          <div style={s.fieldGroup}><label style={s.label}>비고</label><input style={s.input} value={merged.note} onChange={set("note")} /></div>

          <div style={s.section}>◆ 대출현황</div><div style={s.divider} />
          <div style={s.fieldGroup}><label style={s.label}>기대출 상세</label><textarea style={{ ...s.textarea, minHeight: 70 }} value={merged.seniorDetail} onChange={set("seniorDetail")} /></div>
          <div style={s.row}><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>선순위 합계</label><input style={s.input} value={merged.senior} onChange={set("senior")} /></div></div><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>요청금액</label><input style={s.input} value={merged.amount} onChange={set("amount")} /></div></div></div>
          <div style={s.row}><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>자금용도</label><input style={s.input} value={merged.purpose} onChange={set("purpose")} /></div></div><div style={s.half}><div style={s.fieldGroup}><label style={s.label}>이용기간</label><input style={s.input} value={merged.period} onChange={set("period")} /></div></div></div>

          {regText.trim() && (<>
            <div style={{ ...s.section, marginTop: 24 }}>◆ AI 권리분석</div><div style={s.divider} />
            {!analysis ? (
              <button style={{ ...s.btnSecondary, background: "rgba(100,160,255,0.1)", borderColor: "rgba(100,160,255,0.3)", color: "#7ab3ff" }} onClick={handleAIRegistry} disabled={aiParsing}>{aiParsing ? "⟳ 분석 중..." : "🤖 등기부 위험사항 분석"}</button>
            ) : (<>
              <div style={{ ...s.resultBox, background: "rgba(100,160,255,0.04)", border: "1px solid rgba(100,160,255,0.15)" }}>{analysis}</div>
              <button style={{ ...s.btnSecondary, fontSize: 12, color: textMuted }} onClick={() => setAnalysis("")}>다시 분석</button>
            </>)}
          </>)}

          <button style={{ ...s.btnPrimary, marginTop: 20 }} onClick={handleGenerate}>카톡 발송 양식 생성</button>
          <button style={s.btnSecondary} onClick={() => setMode("input")}>← 입력으로</button>
        </>)}

        {/* === 📊 분석 탭 === */}
        {mode === "analysis" && (<>
          <div style={s.section}>📊 대출 실행 분석</div><div style={s.divider} />

          {!ltv.basePrice ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>시세 데이터가 필요합니다</div>
              <div style={{ fontSize: 12 }}>접수입력에서 카톡 데이터를 분석하세요</div>
            </div>
          ) : (<>
            {/* 물건 요약 */}
            <div style={{ background: navyMid, border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: goldLight, marginBottom: 10 }}>{merged.name || "미확인"} — {merged.type} {merged.rank}</div>
              <div style={{ fontSize: 12, color: textMuted, lineHeight: 1.8 }}>
                {merged.address && <div>📍 {merged.address}</div>}
                {merged.area && <div>📐 전용 {merged.area}{merged.totalFloors ? ` / ${merged.totalFloors} 중 ${merged.unitFloor || "?"}` : ""}</div>}
                {merged.job && <div>👤 {merged.job}{merged.salary ? ` / 월 ${merged.salary}` : ""}{merged.credit ? ` / ${merged.credit}` : ""}</div>}
              </div>
            </div>

            {/* 시세 비교 */}
            <div style={{ background: navyMid, border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: goldLight, marginBottom: 10 }}>💰 시세</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {merged.kbLow && <div style={{ background: "rgba(100,160,255,0.06)", borderRadius: 6, padding: "6px 12px", fontSize: 12 }}><span style={{ color: textMuted }}>KB 하</span> <span style={{ color: "#7ab3ff", fontWeight: 700 }}>{num(merged.kbLow)}만</span></div>}
                {merged.kbMid && <div style={{ background: merged.kbApplied === "일반가" ? "rgba(100,160,255,0.15)" : "rgba(100,160,255,0.06)", borderRadius: 6, padding: "6px 12px", fontSize: 12, border: merged.kbApplied === "일반가" ? "1px solid rgba(100,160,255,0.3)" : "none" }}><span style={{ color: textMuted }}>KB 일</span> <span style={{ color: "#7ab3ff", fontWeight: 700 }}>{num(merged.kbMid)}만</span>{merged.kbApplied === "일반가" && <span style={{ color: "#7fdb7f", fontSize: 10, marginLeft: 4 }}>적용</span>}</div>}
                {merged.kbHigh && <div style={{ background: "rgba(100,160,255,0.06)", borderRadius: 6, padding: "6px 12px", fontSize: 12 }}><span style={{ color: textMuted }}>KB 상</span> <span style={{ color: "#7ab3ff", fontWeight: 700 }}>{num(merged.kbHigh)}만</span></div>}
                {merged.housemuch && <div style={{ background: "rgba(100,160,255,0.06)", borderRadius: 6, padding: "6px 12px", fontSize: 12 }}><span style={{ color: textMuted }}>하우스머치({merged.housemuchGrade})</span> <span style={{ color: "#7ab3ff", fontWeight: 700 }}>{num(merged.housemuch)}만</span></div>}
                {merged.actualPrice && <div style={{ background: "rgba(100,160,255,0.06)", borderRadius: 6, padding: "6px 12px", fontSize: 12 }}><span style={{ color: textMuted }}>실거래{merged.actualDate ? `(${merged.actualDate})` : ""}</span> <span style={{ color: "#7ab3ff", fontWeight: 700 }}>{num(merged.actualPrice)}만</span></div>}
              </div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 6 }}>LTV 기준: {ltv.basePriceLabel} {num(ltv.basePrice)}만</div>
            </div>

            {/* 선순위/대환 구조 */}
            {(merged.seniorLoans?.length > 0 || merged.replacementLoans?.length > 0 || merged.mortgages?.length > 0) && (
              <div style={{ background: navyMid, border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: goldLight, marginBottom: 10 }}>🏦 대출 구조</div>
                {merged.seniorLoans?.length > 0 && (<>
                  <div style={{ fontSize: 11, color: "#7fdb7f", fontWeight: 600, marginBottom: 6 }}>▶ 유지 선순위</div>
                  {merged.seniorLoans.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "#e0dcd0" }}>{i + 1}. {l.lender}</span>
                      <span style={{ color: "#7ab3ff" }}>{num(l.maxAmount)}만{l.estimatedBalance ? ` (${num(l.estimatedBalance)}만)` : ""}</span>
                    </div>
                  ))}
                  {ltv.seniorEstTotal > 0 && <div style={{ fontSize: 11, color: textMuted, textAlign: "right", marginTop: 4 }}>선순위 합계: {num(ltv.seniorEstTotal)}만 (채권최고액 {num(ltv.seniorMaxTotal)}만)</div>}
                </>)}
                {merged.replacementLoans?.length > 0 && (<>
                  <div style={{ fontSize: 11, color: "#e67e22", fontWeight: 600, marginTop: 10, marginBottom: 6 }}>▶ 대환/말소 대상</div>
                  {merged.replacementLoans.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "#e0dcd0" }}>{merged.seniorLoans.length + i + 1}. {l.lender}</span>
                      <span style={{ color: "#e67e22" }}>{num(l.maxAmount)}만{l.estimatedBalance ? ` (${num(l.estimatedBalance)}만)` : ""}</span>
                    </div>
                  ))}
                  {ltv.replacementEstTotal > 0 && <div style={{ fontSize: 11, color: textMuted, textAlign: "right", marginTop: 4 }}>대환 합계: {num(ltv.replacementEstTotal)}만</div>}
                </>)}
                {merged.seniorLoans?.length === 0 && merged.mortgages?.length > 0 && (<>
                  <div style={{ fontSize: 11, color: "#7ab3ff", fontWeight: 600, marginBottom: 6 }}>▶ 등기부 근저당</div>
                  {merged.mortgages.map((m, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                      <span>{m.holder || "불명"}</span>
                      <span style={{ color: "#7ab3ff" }}>{num(m.maxAmount)}만</span>
                    </div>
                  ))}
                </>)}
              </div>
            )}

            {/* LTV 분석 */}
            <div style={{ background: navyMid, border: `2px solid ${ltv.gradeColor}22`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: goldLight }}>📊 LTV 분석</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: ltv.gradeColor }}>{ltv.grade}</span>
              </div>
              <LtvBar label="현재 LTV (추정잔액 기준)" value={ltv.ltvCurrentEst} />
              <LtvBar label="현재 LTV (채권최고액 기준)" value={ltv.ltvCurrentMax} />
              {ltv.ltvAfterReplace !== null && (<>
                <div style={{ borderTop: `1px solid ${border}`, margin: "8px 0", paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: "#e67e22", marginBottom: 4 }}>대환 후 (선순위만 유지 시)</div>
                </div>
                <LtvBar label="대환 후 LTV" value={ltv.ltvAfterReplace} />
              </>)}
            </div>

            {/* 실행 가능 한도 */}
            <div style={{ background: navyMid, border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: goldLight, marginBottom: 12 }}>💡 실행 가능 한도 (추정)</div>
              <div style={{ fontSize: 11, color: textMuted, marginBottom: 10 }}>
                {ltv.replacementMaxTotal > 0 ? "대환 후 선순위 기준으로 계산" : "현재 기대출 추정잔액 기준으로 계산"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, background: "rgba(46,204,113,0.06)", border: "1px solid rgba(46,204,113,0.15)", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#2ecc71", marginBottom: 4 }}>LTV 70%</div>
                  <div style={{ fontSize: 10, color: textMuted, marginBottom: 2 }}>안전</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#2ecc71" }}>{num(ltv.availableAtLTV70)}<span style={{ fontSize: 11 }}>만</span></div>
                </div>
                <div style={{ flex: 1, background: "rgba(241,196,15,0.06)", border: "1px solid rgba(241,196,15,0.15)", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#f1c40f", marginBottom: 4 }}>LTV 80%</div>
                  <div style={{ fontSize: 10, color: textMuted, marginBottom: 2 }}>보통</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#f1c40f" }}>{num(ltv.availableAtLTV80)}<span style={{ fontSize: 11 }}>만</span></div>
                </div>
                <div style={{ flex: 1, background: "rgba(231,76,60,0.06)", border: "1px solid rgba(231,76,60,0.15)", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#e74c3c", marginBottom: 4 }}>LTV 90%</div>
                  <div style={{ fontSize: 10, color: textMuted, marginBottom: 2 }}>위험</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#e74c3c" }}>{num(ltv.availableAtLTV90)}<span style={{ fontSize: 11 }}>만</span></div>
                </div>
              </div>
              {merged.amount && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(212,168,67,0.08)", borderRadius: 6 }}>
                  <span style={{ fontSize: 12, color: textMuted }}>차주 요청: </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: goldLight }}>{merged.amount}</span>
                  {merged.amount.match(/^\d/) && ltv.basePrice && (() => {
                    const reqAmt = parseInt(merged.amount.replace(/[^\d]/g, ""));
                    const basisForCalc = ltv.replacementMaxTotal > 0 ? ltv.seniorEstTotal : (ltv.seniorEstTotal + ltv.replacementEstTotal);
                    const afterLtv = Math.round(((basisForCalc + reqAmt) / ltv.basePrice) * 100 * 10) / 10;
                    const color = afterLtv <= 70 ? "#2ecc71" : afterLtv <= 80 ? "#f1c40f" : afterLtv <= 90 ? "#e67e22" : "#e74c3c";
                    return <span style={{ marginLeft: 8, fontSize: 12, color }}>(실행 시 LTV {afterLtv}%)</span>;
                  })()}
                </div>
              )}
            </div>

            {/* 위험요소 */}
            {(merged.risks || []).length > 0 && (
              <div style={{ background: "rgba(255,80,80,0.06)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ff6b6b", marginBottom: 8 }}>🚨 위험요소</div>
                {merged.risks.map((r, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0" }}>⚠️ {r}</div>)}
              </div>
            )}

            {/* AI 권리분석 */}
            {regText.trim() && (<>
              {!analysis ? (
                <button style={{ ...s.btnSecondary, background: "rgba(100,160,255,0.1)", borderColor: "rgba(100,160,255,0.3)", color: "#7ab3ff" }} onClick={handleAIRegistry} disabled={aiParsing}>{aiParsing ? "⟳ 분석 중..." : "🤖 AI 등기부 종합분석"}</button>
              ) : (
                <div style={{ ...s.resultBox, background: "rgba(100,160,255,0.04)", border: "1px solid rgba(100,160,255,0.15)" }}>{analysis}</div>
              )}
            </>)}
          </>)}

          <button style={{ ...s.btnPrimary, marginTop: 20 }} onClick={handleGenerate}>카톡 발송 양식 생성</button>
        </>)}

        {/* === 발송양식 === */}
        {mode === "output" && (<>
          <div style={s.section}>◆ 카톡 발송 양식</div><div style={s.divider} />
          <div style={{ ...s.resultBox, userSelect: "text", WebkitUserSelect: "text" }}>{output}</div>
          <button style={s.btnPrimary} onClick={handleCopy}>{copied ? "✓ 복사 완료!" : "클립보드에 복사"}</button>
          <button style={s.btnSecondary} onClick={() => setMode("review")}>수정하기</button>
          <button style={{ ...s.btnSecondary, color: textMuted }} onClick={handleReset}>새 물건 접수</button>
        </>)}

        {/* === 대량접수 === */}
        {mode === "bulk" && (<BulkTab
          bulkText={bulkText} setBulkText={setBulkText}
          bulkResults={bulkResults} setBulkResults={setBulkResults}
          bulkLoading={bulkLoading} setBulkLoading={setBulkLoading}
          bulkProgress={bulkProgress} setBulkProgress={setBulkProgress}
          bulkFilters={bulkFilters} setBulkFilters={setBulkFilters}
          bulkExpanded={bulkExpanded} setBulkExpanded={setBulkExpanded}
          bulkDetailOpen={bulkDetailOpen} setBulkDetailOpen={setBulkDetailOpen}
          setKakaoText={setKakaoText} setMode={setMode} showToast={showToast}
          s={s} gold={gold} textMuted={textMuted} navyMid={navyMid}
        />)}
      </div>
    </div>
  );
}

// ========================
// 대량접수 컴포넌트 (독립)
// ========================
function BulkTab({ bulkText, setBulkText, bulkResults, setBulkResults, bulkLoading, setBulkLoading, bulkProgress, setBulkProgress, bulkFilters, setBulkFilters, bulkExpanded, setBulkExpanded, bulkDetailOpen, setBulkDetailOpen, setKakaoText, setMode, showToast, s, gold, textMuted, navyMid }) {
  const accent = "#60a5fa";

  function splitBulkMessages(raw) {
    var blocks = [], current = "";
    var lines = raw.split("\n");
    var emptyCount = 0;

    // 분리 패턴 (각각 새 블록 시작)
    // 1. [모든] [날짜] 헤더
    // 2. [이름] [오후 H:MM] 카톡 export (PC)
    // 3. "2025.4.29 오후 3:24, 이름 :" 카톡 export (Mac)
    // 4. "===" 또는 "---" 구분선
    var headerPatterns = [
      /^\[모든\]/,
      /^\[[가-힣A-Za-z0-9\s_·]+\]\s*\[\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*\]/,
      /^\d{4}[.년]\s*\d{1,2}[.월]\s*\d{1,2}[.일]?\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*[,，]?\s*[가-힣A-Za-z]+\s*:/,
      /^[=]{3,}\s*$/,
      /^[-]{3,}\s*$/,
    ];
    function isHeaderLine(s) {
      for (var i = 0; i < headerPatterns.length; i++) if (headerPatterns[i].test(s)) return true;
      return false;
    }
    function stripHeader(s) {
      return s
        .replace(/^\[모든\]\s*\[[\s\S]*?\]\s*/, "")
        .replace(/^\[[가-힣A-Za-z0-9\s_·]+\]\s*\[\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*\]\s*/, "")
        .replace(/^\d{4}[.년]\s*\d{1,2}[.월]\s*\d{1,2}[.일]?\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*[,，]?\s*[가-힣A-Za-z]+\s*:\s*/, "")
        .replace(/^[=\-]{3,}\s*/, "")
        .trim();
    }

    for (var li = 0; li < lines.length; li++) {
      var trimmed = lines[li].trim();
      if (!trimmed) {
        emptyCount++;
        if (emptyCount >= 2 && current.trim()) { blocks.push(current.trim()); current = ""; }
        continue;
      }
      emptyCount = 0;
      if (isHeaderLine(trimmed)) {
        if (current.trim()) blocks.push(current.trim());
        current = stripHeader(trimmed);
      } else {
        current += (current ? "\n" : "") + trimmed;
      }
    }
    if (current.trim()) blocks.push(current.trim());

    var SIDO = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상/;

    // 폴백: 분리 안 됐는데 한 덩이가 명백히 여러 건이면 SIDO+주민번호 패턴으로 재분리
    if (blocks.length <= 1 && raw.trim()) {
      var allText = raw.trim();
      // 주민번호 패턴(YYMMDD-N)이 2개 이상이면 그 위치로 분리
      var pivots = [];
      var rrnRe = /(?:[가-힣]{2,4}\s*[\/\s·]\s*)?\d{6}\s*[-]\s*[1-49]/g;
      var m;
      while ((m = rrnRe.exec(allText)) !== null) {
        // 사람 이름이 직전에 오는 위치 찾기 (이전 줄의 시작)
        var start = allText.lastIndexOf("\n", m.index);
        pivots.push(start === -1 ? 0 : start + 1);
      }
      if (pivots.length >= 2) {
        blocks = [];
        for (var pi = 0; pi < pivots.length; pi++) {
          var seg = allText.slice(pivots[pi], pivots[pi + 1] || allText.length).trim();
          if (seg) blocks.push(seg);
        }
      } else {
        blocks = [allText];
      }
    }

    var deals = [], pendingMemo = "";
    function hasDealMarker(b) {
      return /\[(?:아파트|빌라|연립|다세대|빌라연립다세대|오피스텔|주상복합|단독|다가구|도생|도시형|재건축)/.test(b)
        || (SIDO.test(b) && /시세|kb|KB|기대출|선순위|순위|근저당|대출|한도|대환/i.test(b))
        || (/[가-힣]{2,4}\s*[\/\s]\s*\d{6}/.test(b) && SIDO.test(b))
        || /\d{6}\s*[-]\s*[1-49]/.test(b);
    }
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      if (/^파일:/.test(block)) continue;
      if (/^(사진|이모티콘|동영상|음성메시지)$/.test(block)) continue;
      // ★로 시작하고 거래 정보가 없으면 메모, 있으면 거래(메모+거래 합본) 처리
      if (/^★/.test(block) && !hasDealMarker(block)) { pendingMemo = block; continue; }
      var isDeal = hasDealMarker(block);
      if (isDeal) {
        deals.push(pendingMemo ? pendingMemo + "\n" + block : block);
        pendingMemo = "";
      } else { pendingMemo = block; }
    }
    // 분류된 deal 0건이면 전체를 1건으로 처리 (기존 동작 보존)
    if (deals.length === 0 && blocks.length > 0) deals.push(blocks.join("\n").trim());
    return deals;
  }

  async function handleBulkRun() {
    var deals = splitBulkMessages(bulkText);
    if (deals.length === 0) { showToast("분류할 물건이 없습니다"); return; }
    setBulkLoading(true);
    setBulkProgress({ done: 0, total: deals.length });
    setBulkResults(null);
    var results = [];
    for (var i = 0; i < deals.length; i += 3) {
      var batch = deals.slice(i, i + 3);
      var batchResults = await Promise.all(batch.map(function(raw) {
        return fetch("/api/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: raw }) })
          .then(function(res) { return res.json(); })
          .then(function(data) { return data.result ? { data: data.result, raw: raw, error: null } : { data: null, raw: raw, error: data.error || "파싱실패" }; })
          .catch(function(err) { return { data: null, raw: raw, error: err.message }; });
      }));
      results = results.concat(batchResults);
      setBulkProgress({ done: Math.min(i + 3, deals.length), total: deals.length });
    }
    setBulkResults(results);
    setBulkLoading(false);
    setBulkDetailOpen({});
    showToast(deals.length + "건 분류 완료!");
  }

  function matchType(rawType, filterTypes) {
    if (!rawType) return { ok: false, reason: "유형 불명" };
    var t = String(rawType).trim();
    // 정확 일치
    if (filterTypes[t]) return { ok: true };
    // 변형 매칭
    if (/빌라|다세대|연립/.test(t) && filterTypes["빌라/다세대"]) return { ok: true };
    if (/주상복합/.test(t) && filterTypes["주상복합"]) return { ok: true };
    if (/오피스텔/.test(t) && filterTypes["오피스텔"]) return { ok: true };
    if (/아파트/.test(t) && filterTypes["아파트"]) return { ok: true };
    // 단독/다가구/상가/토지 등 — filter에 없으면 fail
    return { ok: false, reason: "유형: " + t };
  }

  function classifyBulk(results, filters) {
    var pass = [], review = [], fail = [];
    for (var ri = 0; ri < results.length; ri++) {
      var item = results[ri];
      if (!item.data) { review.push({ data: {}, raw: item.raw, reasons: ["파싱 실패"] }); continue; }
      var d = item.data;
      var reasons = [], warnings = [];

      var tm = matchType(d.type, filters.types);
      if (!tm.ok) reasons.push(tm.reason);

      var rankNum = parseInt(String(d.rank || "")) || 99;
      if (d.rank === "불명") warnings.push("순위 불명");
      else if (rankNum > filters.maxRank) reasons.push(d.rank + " (" + filters.maxRank + "순위까지)");

      // region이 비어있거나 "기타"면 경고만 (fail 아님)
      if (d.region && d.region !== "기타" && !filters.regions[d.region]) reasons.push("지역: " + d.region);
      else if (!d.region) warnings.push("지역 불명");

      var kb = d.kbAppliedValue || d.kbMid || d.kbLow || d.housemuch || 0;
      if (kb > 0 && kb < filters.minKb) reasons.push("시세 " + num(kb) + "만 < " + num(filters.minKb) + "만");
      if (kb === 0) warnings.push("시세 없음");

      if (filters.riskExclude && (d.risks || []).length > 0) reasons.push("위험: " + d.risks.join(","));

      if (!d.name) warnings.push("이름 없음");
      if (!d.address) warnings.push("주소 없음");
      ["매입자금","소득증빙불가","증여","지층","지분대출","공동소유","신탁"].forEach(function(f) { if ((d.flags||[]).indexOf(f) >= 0) warnings.push(f); });

      if (reasons.length > 0) fail.push({ data: d, raw: item.raw, reasons: reasons.concat(warnings) });
      else if (warnings.length > 0) review.push({ data: d, raw: item.raw, reasons: warnings });
      else pass.push({ data: d, raw: item.raw, reasons: [] });
    }
    return { pass: pass, review: review, fail: fail };
  }

  var grouped = bulkResults ? classifyBulk(bulkResults, bulkFilters) : null;

  return (<>
    <div style={s.section}>◆ 대량 접수 자동 필터링 <span style={{ fontSize: 10, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "2px 6px", borderRadius: 4, marginLeft: 6 }}>BETA</span></div>
    <div style={s.divider} />
    <p style={{ fontSize: 12, color: textMuted, marginBottom: 10, lineHeight: 1.5 }}>카톡방 메시지를 통째로 붙여넣으면 건별 분리 → AI 파싱 → 필터 자동 분류합니다.</p>

    <details style={{ marginBottom: 10, background: navyMid, border: "1px solid rgba(212,168,67,0.2)", borderRadius: 8, padding: "8px 12px" }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: textMuted, fontWeight: 600 }}>
        ⚙️ 필터: {Object.entries(bulkFilters.types).filter(function(e){return e[1]}).map(function(e){return e[0]}).join("·")} / {bulkFilters.maxRank}순위↓ / {bulkFilters.minKb.toLocaleString()}만↑
      </summary>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, color: textMuted, marginBottom: 4 }}>물건유형</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {Object.keys(bulkFilters.types).map(function(k) { return (
            <button key={k} onClick={function(){setBulkFilters(function(f){return{...f,types:{...f.types,[k]:!f.types[k]}}})}}
              style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: bulkFilters.types[k] ? accent+"22" : navyMid, color: bulkFilters.types[k] ? accent : textMuted }}>
              {bulkFilters.types[k] ? "☑" : "☐"} {k}
            </button>);
          })}
        </div>
        <div style={{ fontSize: 11, color: textMuted, marginBottom: 4 }}>최대순위</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {[1,2,3,4,5].map(function(n) { return (
            <button key={n} onClick={function(){setBulkFilters(function(f){return{...f,maxRank:n}})}}
              style={{ padding: "3px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: bulkFilters.maxRank===n ? accent+"22" : navyMid, color: bulkFilters.maxRank===n ? accent : textMuted, fontWeight: bulkFilters.maxRank===n ? 700 : 400 }}>
              {n}순위
            </button>);
          })}
        </div>
        <div style={{ fontSize: 11, color: textMuted, marginBottom: 4 }}>지역</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {Object.keys(bulkFilters.regions).map(function(k) { return (
            <button key={k} onClick={function(){setBulkFilters(function(f){return{...f,regions:{...f.regions,[k]:!f.regions[k]}}})}}
              style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: bulkFilters.regions[k] ? accent+"22" : navyMid, color: bulkFilters.regions[k] ? accent : textMuted }}>
              {bulkFilters.regions[k] ? "☑" : "☐"} {k}
            </button>);
          })}
        </div>
        <div style={{ fontSize: 11, color: textMuted, marginBottom: 4 }}>최소 KB시세: {bulkFilters.minKb.toLocaleString()}만</div>
        <input type="range" min={0} max={30000} step={1000} value={bulkFilters.minKb} onChange={function(e){setBulkFilters(function(f){return{...f,minKb:parseInt(e.target.value)}})}} style={{ width: "100%", accentColor: accent }} />
        <div style={{ display: "flex", marginTop: 4 }}>
          <button onClick={function(){setBulkFilters(function(f){return{...f,riskExclude:!f.riskExclude}})}}
            style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: bulkFilters.riskExclude ? "#7f1d1d" : navyMid, color: bulkFilters.riskExclude ? "#fca5a5" : textMuted }}>
            {bulkFilters.riskExclude ? "🛑 압류/경매 자동제외 ON" : "⭕ 위험제외 OFF"}
          </button>
        </div>
      </div>
    </details>

    <textarea value={bulkText} onChange={function(e){setBulkText(e.target.value);setBulkResults(null)}}
      placeholder="카톡방 메시지를 통째로 붙여넣으세요... (어떤 형식이든 AI가 분석합니다)"
      style={{ ...s.textarea, height: 160 }} />
    <button onClick={handleBulkRun} disabled={!bulkText.trim() || bulkLoading}
      style={{ ...s.btnPrimary, marginTop: 8, opacity: bulkText.trim() && !bulkLoading ? 1 : 0.5 }}>
      {bulkLoading ? "⏳ 분석 중... " + bulkProgress.done + "/" + bulkProgress.total : "🔍 대량 분류 시작"}
    </button>

    {grouped && (<div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["pass","✅ 통과","#166534","#22c55e"],["review","⚠️ 검토","#713f12","#eab308"],["fail","❌ 제외","#7f1d1d","#ef4444"]].map(function(arr) {
          var k=arr[0],label=arr[1],bg=arr[2],clr=arr[3];
          return (<div key={k} style={{ flex: 1, background: bg+"22", border: "1px solid "+bg, borderRadius: 8, padding: "8px 0", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: clr+"99" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: clr }}>{grouped[k].length}</div>
          </div>);
        })}
      </div>
      {[["pass","✅ 통과","#166534","#22c55e","#bbf7d0"],["review","⚠️ 검토","#713f12","#eab308","#fef08a"],["fail","❌ 제외","#7f1d1d","#ef4444","#fca5a5"]].map(function(arr) {
        var key=arr[0],label=arr[1],bg=arr[2],badgeClr=arr[3],txtClr=arr[4];
        return (<div key={key} style={{ marginBottom: 8 }}>
          <button onClick={function(){setBulkExpanded(function(e){var n={...e};n[key]=!n[key];return n})}}
            style={{ width: "100%", background: bg+"22", border: "1px solid "+bg, borderRadius: bulkExpanded[key] ? "6px 6px 0 0" : 6, padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: txtClr }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{label} ({grouped[key].length}건)</span>
            <span style={{ fontSize: 10 }}>{bulkExpanded[key] ? "▲" : "▼"}</span>
          </button>
          {bulkExpanded[key] && grouped[key].length > 0 && (
            <div style={{ border: "1px solid "+bg, borderTop: "none", borderRadius: "0 0 6px 6px" }}>
              {grouped[key].map(function(item, i) {
                var d = item.data || {};
                var kb = d.kbAppliedValue || d.kbMid || d.kbLow || d.housemuch || 0;
                var dKey = key + "-" + i;
                return (<div key={i} style={{ borderBottom: i < grouped[key].length - 1 ? "1px solid "+bg+"44" : "none" }}>
                  <button onClick={function(){setBulkDetailOpen(function(o){var n={...o};n[dKey]=!n[dKey];return n})}}
                    style={{ width: "100%", background: "transparent", border: "none", padding: "8px 12px", cursor: "pointer", textAlign: "left", color: "#e0dcd0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{d.name || "?"}</span>
                      <span style={{ fontSize: 10, color: textMuted, background: navyMid, padding: "1px 5px", borderRadius: 3 }}>{d.type || ""}{d.rank && d.rank !== "불명" ? " "+d.rank : ""}</span>
                      <span style={{ fontSize: 10, color: textMuted }}>{d.region || ""}</span>
                      {kb > 0 && <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>{fmtW(kb)}</span>}
                      {(d.flags||[]).indexOf("급건") >= 0 && <span style={{ fontSize: 9, background: "#7f1d1d", color: "#fca5a5", padding: "1px 4px", borderRadius: 2, fontWeight: 700 }}>급건</span>}
                    </div>
                    {d.summary && <div style={{ fontSize: 10, color: textMuted, marginTop: 2 }}>{d.summary}</div>}
                    {item.reasons.length > 0 && <div style={{ fontSize: 10, color: badgeClr, marginTop: 2 }}>{item.reasons.join(" · ")}</div>}
                  </button>
                  {bulkDetailOpen[dKey] && (
                    <div style={{ padding: "0 12px 10px", fontSize: 11, color: textMuted, lineHeight: 1.7 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: "2px 8px" }}>
                        {d.name && <><span>신청인</span><span style={{color:"#e0dcd0"}}>{d.name}{d.birth ? " / "+d.birth : ""}{d.job ? " / "+d.job : ""}</span></>}
                        {d.address && <><span>주소</span><span style={{color:"#e0dcd0",wordBreak:"break-all"}}>{d.address}</span></>}
                        {kb > 0 && <><span>시세</span><span style={{color:"#e0dcd0"}}>{d.kbLow ? "KB하 "+num(d.kbLow)+"만" : ""}{d.kbMid ? " / 일 "+num(d.kbMid)+"만" : ""}{d.housemuch ? " 하우스머치 "+num(d.housemuch)+"만" : ""}</span></>}
                        {d.seniorMaxTotal > 0 && <><span>선순위</span><span style={{color:"#e0dcd0"}}>최고액 {num(d.seniorMaxTotal)}만{d.seniorEstTotal ? " (잔액 "+num(d.seniorEstTotal)+"만)" : ""}</span></>}
                        {d.replacementMaxTotal > 0 && <><span>대환대상</span><span style={{color:"#e0dcd0"}}>최고액 {num(d.replacementMaxTotal)}만</span></>}
                        {(d.risks||[]).length > 0 && <><span>위험</span><span style={{color:"#ef4444"}}>{d.risks.join(", ")}</span></>}
                        {(d.flags||[]).length > 0 && <><span>특이사항</span><span style={{color:"#e0dcd0"}}>{d.flags.join(", ")}</span></>}
                      </div>
                      {kb > 0 && (<div style={{ marginTop: 6, background: bg+"11", borderRadius: 4, padding: "6px 8px" }}>
                        <div style={{ fontSize: 10, color: textMuted, marginBottom: 3, fontWeight: 600 }}>LTV 간이분석 (시세 {fmtW(kb)})</div>
                        {[70,80,90].map(function(pct) {
                          var limit = Math.floor(kb * pct / 100);
                          var used = d.seniorMaxTotal || 0;
                          var remain = limit - used;
                          return (<div key={pct} style={{ display: "flex", gap: 6, fontSize: 10 }}>
                            <span style={{ width: 32 }}>{pct}%</span>
                            <span style={{ width: 60 }}>한도 {fmtW(limit)}</span>
                            <span style={{ color: remain > 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{remain > 0 ? "+" : ""}{fmtW(remain)}</span>
                          </div>);
                        })}
                      </div>)}
                      <button onClick={function(){setKakaoText(item.raw);setMode("input");showToast("카톡 입력으로 이동")}}
                        style={{ ...s.btnSecondary, marginTop: 8, fontSize: 11, padding: "5px 12px" }}>→ 상세분석으로 이동</button>
                    </div>
                  )}
                </div>);
              })}
            </div>
          )}
        </div>);
      })}
    </div>)}
  </>);
}
