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
  if (/신탁/.test(joined)) notes.push("신탁");
  if (/환매/.test(joined)) notes.push("환매특약");
  const ageM = joined.match(/(\d+)\s*년차/); if (ageM) notes.push(ageM[1] + "년차");
  const owM = joined.match(/소유권이전일?[:\s]*([\d년월일.\s]+)/); if (owM) notes.push("소유권이전 " + owM[1].trim());
  if (/지분\s*대출|지분.*검토/.test(joined)) notes.push("지분대출 검토 요청");
  if (/배우자\s*공동/.test(joined)) notes.push("배우자 공동소유");

  if (notes.length) d.special = (d.special ? d.special + " / " : "") + notes.join(" / ");
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
// 등기부 정규식 파서
// ========================
function parseRegistry(rawText) {
  const r = { address: "", type: "", area: "", totalFloors: "", unitFloor: "", landRight: "", owners: [], mortgages: [], risks: [], transferDate: "", transferCause: "" };
  let text = rawText.replace(/\[\s*주\s*의\s*사\s*항\s*\][\s\S]*?(?=고유번호|\d+\.\s|$)/g, " ").replace(/\[\s*참\s*고\s*사\s*항\s*\][\s\S]*?(?=\d+\.\s|$)/g, " ").replace(/본\s*주요\s*등기사항[\s\S]*?바랍니다\.?/g, " ").replace(/가\.\s*등기기록에서[\s\S]*?표시합니다\./g, " ").replace(/나\.\s*최종지분은[\s\S]*?하였습니다\./g, " ");
  const j = text.replace(/\s+/g, " ").trim();

  // 주소
  const addrM = j.match(/\[집합건물\]\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^1]*?제?\d+호)/);
  if (addrM) r.address = addrM[1].replace(/\s+/g, " ").trim();
  else { const addrM2 = j.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣\d\s\-.,()]*?제?\d+호)/); if (addrM2) r.address = addrM2[1].replace(/\s+/g, " ").trim(); }
  if (r.address.length > 120) r.address = r.address.slice(0, 120);

  // 면적
  const jeonyu = rawText.match(/전유부분의\s*건물의\s*표시[\s\S]*?(?=대지권|갑\s*구|$)/);
  if (jeonyu) { const jyArea = jeonyu[0].match(/([\d.]+)\s*㎡/); if (jyArea && parseFloat(jyArea[1]) > 10 && parseFloat(jyArea[1]) < 300) r.area = parseFloat(jyArea[1]).toFixed(2) + "㎡"; }
  if (!r.area) { const arm = j.match(/(?:전용면적|전용|면적)\s*([\d.]+)\s*㎡/); if (arm && parseFloat(arm[1]) > 10) r.area = arm[1] + "㎡"; }

  // 층수
  const floorM = rawText.match(/지상\s*(\d+)\s*층/);
  if (floorM) r.totalFloors = floorM[1] + "층";
  const unitFloorM = j.match(/제(\d+)층\s*제\d+호/);
  if (unitFloorM) r.unitFloor = unitFloorM[1] + "층";
  if (/대지권/.test(j)) r.landRight = "있음";

  // 소유자
  const ownerSection = rawText.match(/1\.\s*소유지분현황[\s\S]*?(?=2\.\s*소유지분을|$)/);
  const ownerText = ownerSection ? ownerSection[0] : j;
  const ownerMatches = [...ownerText.matchAll(/([가-힣]{2,4})\s*\((소유자|공유자)\)\s*(\d{6}[-]?\*{0,7}\d{0,7})/g)];
  for (const m of ownerMatches) {
    r.owners.push({ name: m[1], birth: m[3].replace(/[-]*\*+$/, "").replace(/-$/, ""), role: m[2], share: "단독소유" });
  }
  if (r.owners.length === 0) { const owM = j.match(/([가-힣]{2,4})\s*\(소유자\)/); if (owM) r.owners.push({ name: owM[1], birth: "", role: "소유자", share: "단독소유" }); }
  if (r.owners.length > 1) r.owners.forEach(o => { const after = ownerText.slice(ownerText.indexOf(o.name)); const shareM = after.match(/(\d+)\s*분의\s*(\d+)/); if (shareM) o.share = shareM[0]; });

  // 이전
  const trM = j.match(/소유권이전[^\d]*(20\d{2}[년.\s/-]\d{1,2}[월.\s/-]\d{1,2}일?)/); if (trM) r.transferDate = trM[1].replace(/\s/g, "");
  const caM = j.match(/소유권이전.*?(매매|분양|상속|증여|신탁|경매)/); if (caM) r.transferCause = caM[1];

  // 위험 (갑구)
  let gapguText = "";
  const gapguM = rawText.match(/소유지분을\s*제외한[\s\S]*?(?=\(근\)\s*저당권|\d+\.\s*\(근\)|을\s*구|$)/i);
  if (gapguM) gapguText = gapguM[0];
  if (gapguText && !/기록사항\s*없음/.test(gapguText)) {
    const riskDefs = [[/가압류/, "가압류"], [/가처분/, "가처분"], [/경매개시|임의경매|강제경매/, "경매개시결정"], [/신탁(?!.*보험)/, "신탁"], [/환매/, "환매특약"], [/예고등기/, "예고등기"], [/가등기/, "가등기"]];
    for (const [pat, label] of riskDefs) { if (pat.test(gapguText)) r.risks.push(label); }
  }

  // 근저당 (을구, 말소 제외)
  let eulgu = "";
  const eulguM = rawText.match(/(근\s*\)?\s*저당권\s*및[\s\S]*?)(?=\[\s*참\s*고|\[\s*주\s*의|$)/);
  if (eulguM) eulgu = eulguM[1]; else eulgu = text;
  const eulguBlocks = eulgu.split(/(?=순위번호|\d+\s+근저당권설정)/g);
  for (const block of eulguBlocks) {
    if (/말소|해지됨|해제|취하/.test(block)) continue;
    const maxM = block.match(/채권최고액\s*금?\s*([\d,]+)\s*원/); if (!maxM) continue;
    const amt = parseInt(maxM[1].replace(/,/g, "")); if (amt < 1000000) continue;
    const mg = { holder: "", maxAmount: Math.round(amt / 10000), date: "" };
    const hm = block.match(/근저당권자\s+([가-힣()]+(?:주식회사|은행|금고|보험|캐피탈|저축|신협|농협|수협|생명|화재|카드|대부)[가-힣()]*)/);
    if (hm) mg.holder = hm[1].replace(/주식회사/g, "㈜").trim();
    else { const hm2 = block.match(/([\w가-힣]+(?:은행|금고|보험|캐피탈|저축|신협|농협|수협|생명|화재|카드|대부|해상))/); if (hm2) mg.holder = hm2[1]; }
    const dm = block.match(/(20\d{2}년\d{1,2}월\d{1,2}일)/); if (dm) mg.date = dm[1];
    r.mortgages.push(mg);
  }
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
  d.special = ai.special || "";
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

  // 주소 병합
  const isDoroName = (addr) => /[가-힣]+(?:로|길)\s*\d/.test(addr || "");
  const hasBuildingName = (addr) => /[가-힣]+(?:빌|파크|캐슬|아파트|빌라|타워|하이츠|센트럴|자이|래미안|아이파크|푸르지오)/.test(addr || "");
  if (regParsed.address && f.address && regParsed.address !== f.address) {
    if (isDoroName(f.address) !== isDoroName(regParsed.address)) {
      if (isDoroName(f.address)) f.addressRegistry = regParsed.address;
      else { f.addressRegistry = f.address; f.address = regParsed.address; }
    } else {
      if (hasBuildingName(regParsed.address) && !hasBuildingName(f.address)) f.address = regParsed.address;
    }
  } else if (!f.address && regParsed.address) f.address = regParsed.address;

  // 소유자
  if (regParsed.owners?.length > 0 && f.owners.length === 0) f.owners = regParsed.owners;
  if (!f.name && regParsed.owners?.length > 0) f.name = regParsed.owners[0].name;

  // 물건 정보
  if (regParsed.area && !f.area) f.area = regParsed.area;
  if (regParsed.totalFloors && !f.totalFloors) f.totalFloors = regParsed.totalFloors;
  if (regParsed.unitFloor && !f.unitFloor) f.unitFloor = regParsed.unitFloor;
  if (regParsed.landRight && !f.landRight) f.landRight = regParsed.landRight;
  if (regParsed.transferDate && !f.transferDate) f.transferDate = regParsed.transferDate;
  if (regParsed.transferCause && !f.transferCause) f.transferCause = regParsed.transferCause;

  // 근저당 (등기부 우선)
  if (regParsed.mortgages?.length > 0) f.mortgages = regParsed.mortgages;
  // 위험
  if (regParsed.risks?.length > 0) f.risks = [...new Set([...(f.risks || []), ...regParsed.risks])];

  // 특이사항 보충
  const specials = f.special ? [f.special] : [];
  if (regParsed.owners?.length > 1) specials.push("공동소유: " + regParsed.owners.map(o => `${o.name}(${o.share})`).join(", "));
  if (regParsed.area && !f.special?.includes(regParsed.area)) specials.push("전용 " + regParsed.area);
  if (regParsed.totalFloors) specials.push("총 " + regParsed.totalFloors);
  if (regParsed.unitFloor) specials.push("해당 " + regParsed.unitFloor);
  if (regParsed.landRight) specials.push("대지권: " + regParsed.landRight);
  if (regParsed.transferDate) specials.push("소유권이전: " + regParsed.transferDate + (regParsed.transferCause ? "(" + regParsed.transferCause + ")" : ""));
  if (regParsed.risks?.length > 0) specials.push(regParsed.risks.map(r => "⚠️ " + r).join(", "));
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
  if (d.addressRegistry) { const label = /[가-힣]+(?:로|길)\s*\d/.test(d.addressRegistry) ? "도로명" : "지번"; o += `${label}: ${d.addressRegistry}\n`; }
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
  const fileRef = useRef(null);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

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
    const kp = kakaoText.trim() ? parseKakao(kakaoText) : { ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] };
    if (regText.trim() && !regParsed) { const rp = parseRegistry(regText); setRegParsed(rp); }
    const m = mergeData(kp, regParsed); setMerged(m); setMode("review");
    showToast("빠른 분석 완료!");
  }

  // AI 메인 파서
  async function handleAIParse() {
    if (!kakaoText.trim() && !regText.trim() && !regFile) return;
    setAiParsing(true);
    try {
      // 등기부 정규식 먼저
      if (regText.trim() && !regParsed) { const rp = parseRegistry(regText); setRegParsed(rp); }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 22000);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: kakaoText.slice(0, 2500), registryText: regText.trim() ? regText.slice(0, 4000) : undefined }),
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: regText.slice(0, 4000), kb: merged.kb || "", hint: regParsed ? { owners: regParsed.owners?.map(o => `${o.name}(${o.role}, ${o.share})`).join(", ") || "", area: regParsed.area || "", totalFloors: regParsed.totalFloors || "", unitFloor: regParsed.unitFloor || "", mortgages: regParsed.mortgages?.map(m => `${m.holder}: ${m.maxAmount}만`).join(", ") || "", risks: regParsed.risks?.join(", ") || "없음" } : null }),
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
  function handleReset() { setKakaoText(""); setRegText(""); setRegFile(null); setRegParsed(null); setMerged({ ...EMPTY, seniorLoans: [], replacementLoans: [], seniorTotal: { maxAmount: null, estimatedBalance: null }, replacementTotal: { maxAmount: null, estimatedBalance: null }, owners: [], mortgages: [], risks: [] }); setOutput(""); setAnalysis(""); setAiModel(""); setMode("input"); }
  const set = (k) => (e) => setMerged({ ...merged, [k]: e.target.value });
  const TYPES = ["아파트", "빌라/다세대", "오피스텔", "단독/다가구", "상가", "토지", "기타"];
  const RANKS = ["1순위", "2순위", "3순위"];
  const LTYPES = ["일반담보", "분양담보", "후순위", "동시설정", "대환", "매매잔금", "생활안정자금", "전세퇴거자금", "기타"];

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
        </div>
      </div>

      <div style={s.body}>
        {/* === 접수입력 === */}
        {mode === "input" && (<>
          <div style={s.section}>◆ 카톡 내용 붙여넣기</div><div style={s.divider} />
          <p style={{ fontSize: 12, color: textMuted, marginBottom: 10, lineHeight: 1.5 }}>업체에서 받은 카톡 메시지를 그대로 붙여넣으세요. AI가 자동 분석합니다.</p>
          <textarea style={s.textarea} placeholder={"홍명선 / 770504\nKB 하 39,500만 / 일 43,000만 (일)\n▶ 선순위\n1. 우리은행 5,940만 (5,400만)\n▶ 대환/말소대상\n4. 더라이즈대부 3,900만\n..."} value={kakaoText} onChange={(e) => setKakaoText(e.target.value)} />
          {kakaoText.trim() && <div style={{ fontSize: 12, color: "#7fdb7f", marginTop: 6 }}>✓ 카톡 데이터 입력됨</div>}

          <div style={{ ...s.section, marginTop: 24 }}>◆ 등기부등본 (선택)</div><div style={s.divider} />
          <input ref={fileRef} type="file" accept=".pdf" onChange={handlePdf} style={{ display: "none" }} />
          <div style={{ ...s.uploadBox, borderColor: regFile ? "#7fdb7f" : border }} onClick={() => fileRef.current?.click()}>
            {loading ? <span style={{ color: goldLight }}>⟳ PDF 분석 중...</span>
              : regFile ? <div><div style={{ color: "#7fdb7f", fontWeight: 700 }}>✓ {regFile}</div><div style={{ color: textMuted, fontSize: 12, marginTop: 4 }}>{regParsed ? `근저당 ${regParsed.mortgages.length}건 / 위험 ${regParsed.risks.length}건` : ""}</div></div>
              : <div><div style={{ fontSize: 28, marginBottom: 6 }}>📄</div><div style={{ color: goldLight, fontWeight: 600 }}>등기부 PDF 업로드</div></div>}
          </div>
          {!regFile && <><div style={{ textAlign: "center", padding: "10px 0", fontSize: 11, color: textMuted }}>— 또는 텍스트 직접 붙여넣기 —</div><textarea style={{ ...s.textarea, minHeight: 80 }} placeholder="등기부등본 텍스트..." value={regText} onChange={(e) => setRegText(e.target.value)} /></>}

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
      </div>
    </div>
  );
}
