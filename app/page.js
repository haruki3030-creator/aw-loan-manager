"use client";
import { useState, useEffect, useRef } from "react";

// ========================
// PDF.js 로딩
// ========================
let pdfJsLoaded = false;
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (pdfJsLoaded && window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      pdfJsLoaded = true;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("PDF.js 로딩 실패"));
    document.head.appendChild(s);
  });
}

async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let t = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    t += c.items.map(x => x.str).join(" ") + "\n";
  }
  return t;
}

// ========================
// 폼 초기값
// ========================
const EMPTY = {
  type: "아파트", rank: "1순위", loanType: "일반담보",
  name: "", birth: "", phone: "", address: "", addressRegistry: "",
  kb: "", senior: "", seniorDetail: "",
  amount: "", job: "", salary: "", credit: "",
  purpose: "", period: "", special: "", note: "",
};

// ========================
// 카톡 파서 (정규식 — AI 실패 폴백용)
// ========================
function parseKakao(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const d = { ...EMPTY };
  const joined = lines.join(" ");
  const notes = [];

  const br = joined.match(/\[([^\]]+)\]/);
  if (br) {
    const tag = br[1];
    if (/오피스텔/.test(tag)) d.type = "오피스텔";
    else if (/빌라|다세대/.test(tag)) d.type = "빌라/다세대";
    else if (/단독|다가구/.test(tag)) d.type = "단독/다가구";
    else if (/상가/.test(tag)) d.type = "상가";
    else if (/토지/.test(tag)) d.type = "토지";
    if (/3순위/.test(tag)) d.rank = "3순위";
    else if (/2순위/.test(tag)) d.rank = "2순위";
    if (/분양/.test(tag)) notes.push("분양건");
    if (/동시/.test(tag)) notes.push("후순위 동시설정");
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
  else if (/동시설정/.test(joined)) d.loanType = "동시설정";
  else if (/매매잔금|잔금/.test(joined)) d.loanType = "매매잔금";

  for (const line of lines) {
    if (/^(분양자|차주|이름|성명|성함|신청인|채무자|소유자)\s*[:\s]/.test(line)) {
      const m = line.match(/[:\s]+([가-힣]{2,4})/);
      if (m) { d.name = m[1]; break; }
    }
  }
  if (!d.name) { const nm = lines[0]?.match(/^([가-힣]{2,4})\s*[/·]\s*\d{6}/); if (nm) d.name = nm[1]; }
  if (!d.name) { const nm2 = lines[0]?.match(/^([가-힣]{2,4})\s+\d{6}/); if (nm2) d.name = nm2[1]; }

  const birthM1 = joined.match(/(\d{6})\s*[-]\s*(\d)/);
  if (birthM1) d.birth = birthM1[1] + "-" + birthM1[2];
  else { const birthM2 = joined.match(/(\d{6})(?=\s|$|[^-\d])/); if (birthM2) d.birth = birthM2[1]; }

  const phM = joined.match(/(01\d[\s-]?\d{3,4}[\s-]?\d{4})/);
  if (phM) d.phone = phM[1].replace(/\s/g, "");

  for (const line of lines) {
    if (/^(물건지|주소|소재지)\s*[:\s]/.test(line)) { d.address = line.replace(/^(물건지|주소|소재지)\s*[:\s]+/, "").trim(); break; }
  }
  if (!d.address) {
    for (const line of lines) {
      if (/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(line) && line.length > 12) { d.address = line.trim(); break; }
    }
  }

  // KB/시세
  let kbBlock = "";
  for (let idx = 0; idx < lines.length; idx++) {
    if (/^(시세|KB|kb|▶.*KB)/i.test(lines[idx])) { kbBlock = lines.slice(idx, idx + 3).join(" "); break; }
  }
  if (!kbBlock) kbBlock = joined;
  const kbParts = [];
  if (/KB\s*미등재|kb\s*미등재/i.test(kbBlock)) {
    kbParts.push("KB 미등재");
  } else {
    const kbHa = kbBlock.match(/KB\s*하\s*([\d,.]+)\s*만?/i);
    const kbIl = kbBlock.match(/KB\s*일\s*([\d,.]+)\s*만?/i);
    const kbSang = kbBlock.match(/KB\s*상\s*([\d,.]+)\s*만?/i);
    if (kbHa || kbIl || kbSang) {
      const vals = [];
      if (kbHa) vals.push("하 " + kbHa[1].replace(/,/g, "") + "만");
      if (kbIl) vals.push("일 " + kbIl[1].replace(/,/g, "") + "만");
      if (kbSang) vals.push("상 " + kbSang[1].replace(/,/g, "") + "만");
      kbParts.push("KB " + vals.join(" / "));
    } else {
      const kbSingle = kbBlock.match(/KB\s*[:\s]*\s*([\d,.]+)\s*(만|억)?/i);
      if (kbSingle) { const num = kbSingle[1].replace(/,/g, ""); const unit = kbSingle[2] || (parseInt(num) > 100 ? "만" : ""); kbParts.push("KB " + num + unit); }
    }
  }
  const altSources = [
    { pat: /하우스머치[^\d]*([\d,.]+)\s*만?/, label: "하우스머치" },
    { pat: /감정가[^\d]*([\d,.]+)\s*만?/, label: "감정가" },
  ];
  for (const src of altSources) { const m = kbBlock.match(src.pat); if (m) kbParts.push(src.label + " " + m[1].replace(/,/g, "") + "만"); }
  if (kbParts.length > 0) d.kb = kbParts.join(" / ");

  // 선순위
  for (const line of lines) {
    if (/총\s*합계|::\s*총/.test(line)) {
      const amts = [...line.matchAll(/([\d,.]+)\s*만/g)];
      if (amts.length >= 2) d.senior = amts[0][1].replace(/,/g, "") + "만 / " + amts[1][1].replace(/,/g, "") + "만";
      else if (amts.length === 1) d.senior = amts[0][1].replace(/,/g, "") + "만";
      break;
    }
  }
  const seniorLines = [];
  const seniorNotes = [];
  for (const line of lines) {
    if (/^\d+\.\s*.*(금고|은행|캐피탈|저축|보험|새마을|신협|농협|수협|화재|생명|대부|해상)/.test(line)) { seniorLines.push(line.trim()); }
    else if (/^(신한|국민|우리|하나|기업|농협|수협|SC|씨티|새마을|신협|현대|삼성|KB|카카오|토스|케이|캐피탈)\s*[:\s]+[\d,.]+/.test(line)) { seniorLines.push(line.trim()); }
    const noteM = line.match(/\(([가-힣\s]+(?:채무|대출|금거|가능|필요|예정|확인|부탁)[가-힣\s]*)\)/);
    if (noteM) seniorNotes.push(noteM[1].trim());
  }
  if (seniorLines.length > 0) d.seniorDetail = seniorLines.join("\n");
  if (seniorNotes.length > 0) { d.special = (d.special ? d.special + " / " : "") + seniorNotes.join(" / "); }

  // 요청금액
  for (const line of lines) {
    if (/필요\s*자금|필요\s*금액|필요\s*[\d]/.test(line)) { const m = line.match(/([\d,.]+)\s*(만|억)?/); if (m) { d.amount = m[1].replace(/,/g, "") + (m[2] || "만"); break; } }
  }
  if (!d.amount) { for (const line of lines) { if (/희망\s*금|요청\s*금|추가.*한도|대출.*희망/.test(line)) { const m = line.match(/([\d,.]+)\s*(만|억)/); if (m) { d.amount = m[1].replace(/,/g, "") + m[2]; break; } } } }
  if (!d.amount) { const revM = joined.match(/([\d,.]+)\s*(만|억)\s*(?:필요|부탁|요청|해주세요|가능할까요)/); if (revM) d.amount = revM[1].replace(/,/g, "") + revM[2]; }
  if (!d.amount && /최대\s*요청|추가.*한도|추가.*부탁/.test(joined)) d.amount = "최대 요청";
  if (!d.amount) { const reqM = joined.match(/((?:\d순위\s*)?가능사?\s*확인\s*부탁[가-힣]*)/); if (reqM) d.amount = reqM[1]; }
  if (!d.amount) { const needM = joined.match(/필요\s*자금\s*[:\s]\s*([\d,.]+)/); if (needM) d.amount = needM[1].replace(/,/g, "") + "만"; }

  // 직업
  for (const line of lines) { if (/^직업\s*[:\s]/.test(line)) { const m = line.match(/[:\s]+(.+)/); if (m) { d.job = m[1].trim(); break; } } }
  if (!d.job) { const jm = joined.match(/(4대\s*직장인|개인사업자|자영업자?|직장인|회사원|공무원|프리랜서|무직|주부|일용직|법인대표)/); if (jm) d.job = jm[1]; }

  const salM = joined.match(/월\s*급여\s*([\d,]+)\s*만?/); if (salM) d.salary = salM[1].replace(/,/g, "") + "만";
  const crM = joined.match(/(?:KCB|NICE|kcb|nice)\s*(\d{3,4})\s*(점|점수)?/);
  if (crM) d.credit = (crM[0].match(/KCB|NICE|kcb|nice/)?.[0]?.toUpperCase() || "") + " " + crM[1] + (crM[2] || "점");
  else { const crM3 = joined.match(/(\d+)\s*등급/); if (crM3) d.credit = crM3[1] + "등급"; }

  if (/대환/.test(joined)) d.purpose = "대환";
  else if (/생활자금/.test(joined)) d.purpose = "생활자금";
  else if (/잔금/.test(joined)) d.purpose = "잔금";

  const areaM = joined.match(/전용\s*([\d.]+)\s*㎡/);
  if (areaM) notes.push("전용 " + areaM[1] + "㎡");
  else { const areaM2 = joined.match(/(?:아파트|오피스텔|빌라)\s*([\d.]+)/); if (areaM2 && parseFloat(areaM2[1]) > 10 && parseFloat(areaM2[1]) < 300) notes.push("전용 " + areaM2[1] + "㎡"); }
  const sedae = joined.match(/(\d+)\s*세대/); if (sedae) notes.push(sedae[1] + "세대");
  const silM = joined.match(/실거래[:\s]*([\d,.]+)\s*만/); if (silM) notes.push("실거래 " + silM[1].replace(/,/g, "") + "만");
  const bunM = joined.match(/분양가\s*([\d,.]+)\s*(만|억)/); if (bunM) notes.push("분양가 " + bunM[1] + bunM[2]);
  if (/신탁/.test(joined)) notes.push("신탁");
  if (/환매/.test(joined)) notes.push("환매특약");
  const owM = joined.match(/소유권이전일?[:\s]*([\d년월일.\s]+)/); if (owM) notes.push("소유권이전 " + owM[1].trim());

  if (notes.length) d.special = (d.special ? d.special + " / " : "") + notes.join(" / ");
  return d;
}

// ========================
// 등기부 파서 (정규식)
// ========================
function parseRegistry(rawText) {
  const r = { address: "", type: "", area: "", landRight: "", owners: [], owner: "", ownerBirth: "", ownership: "단독소유", transferDate: "", transferCause: "", mortgages: [], totalMax: 0, totalEst: 0, risks: [] };
  let text = rawText.replace(/\[\s*주\s*의\s*사\s*항\s*\][\s\S]*?(?=고유번호|\d+\.\s|$)/g, " ").replace(/\[\s*참\s*고\s*사\s*항\s*\][\s\S]*?(?=\d+\.\s|$)/g, " ").replace(/본\s*주요\s*등기사항[\s\S]*?바랍니다\.?/g, " ").replace(/가\.\s*등기기록에서[\s\S]*?표시합니다\./g, " ").replace(/나\.\s*최종지분은[\s\S]*?하였습니다\./g, " ").replace(/다\.\s*지분이[\s\S]*?것입니다\./g, " ").replace(/라\.\s*대상소유자[\s\S]*?있습니다\./g, " ").replace(/정확한\s*권리사항은[\s\S]*?(?=\n|$)/g, " ");
  const j = text.replace(/\s+/g, " ").trim();

  const addrM1 = j.match(/\[집합건물\]\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^1]*?제?\d+호)/);
  if (addrM1) r.address = addrM1[1].replace(/\s+/g, " ").trim();
  else { const addrM4 = j.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣\d\s\-.,()]*?제?\d+호)/); if (addrM4) r.address = addrM4[1].replace(/\s+/g, " ").trim(); }
  r.address = r.address.replace(/\s+\d+\.\s.*$/, "").replace(/\s+소유.*$/, "").trim();
  if (r.address.length > 120) r.address = r.address.slice(0, 120);

  if (/집합건물/.test(rawText)) r.type = "집합건물";
  const tm = j.match(/(아파트|오피스텔|빌라|다세대|연립|단독|다가구|상가|근린생활|사무실)/); if (tm) r.type = tm[1];
  const arm = j.match(/(?:전용면적|전용|면적)\s*([\d.]+)\s*㎡/); if (arm && parseFloat(arm[1]) > 10 && parseFloat(arm[1]) < 300) r.area = arm[1] + "㎡";
  if (/대지권/.test(j)) r.landRight = "있음";

  // 소유자 — 소유지분현황에서만
  const ownerSection = rawText.match(/1\.\s*소유지분현황[\s\S]*?(?=2\.\s*소유지분을|$)/);
  const ownerText = ownerSection ? ownerSection[0] : j;
  const ownerMatches = [...ownerText.matchAll(/([가-힣]{2,4})\s*\((소유자|공유자)\)\s*(\d{6}[-]?\*{0,7}\d{0,7})/g)];
  if (ownerMatches.length > 0) {
    for (const m of ownerMatches) {
      const birth = m[3].replace(/[-]*\*+$/, "").replace(/-$/, "");
      let share = "단독소유";
      const after = ownerText.slice(ownerText.indexOf(m[0]) + m[0].length, ownerText.indexOf(m[0]) + m[0].length + 50);
      const shareM = after.match(/(\d+)\s*분의\s*(\d+)|(\d+\/\d+)/); if (shareM) share = shareM[0];
      r.owners.push({ name: m[1], birth, share, role: m[2] });
    }
  } else {
    const owM1 = j.match(/([가-힣]{2,4})\s*\(소유자\)/); if (owM1) r.owners.push({ name: owM1[1], birth: "", share: "단독소유", role: "소유자" });
  }
  if (r.owners.length > 1) r.ownership = "공동소유 (" + r.owners.length + "인)";
  if (r.owners.length > 0) { r.owner = r.owners.map(o => o.name).join(" · "); r.ownerBirth = r.owners[0].birth; }

  const trM = j.match(/소유권이전[^\d]*(20\d{2}[년.\s/-]\d{1,2}[월.\s/-]\d{1,2}일?)/); if (trM) r.transferDate = trM[1].replace(/\s/g, "");
  const caM = j.match(/소유권이전.*?(매매|분양|상속|증여|신탁|경매)/); if (caM) r.transferCause = caM[1];

  // 위험 — 갑구에서만
  let gapguText = "";
  const gapguM = rawText.match(/소유지분을\s*제외한[\s\S]*?(?=\(근\)\s*저당권|\d+\.\s*\(근\)|을\s*구|$)/i);
  if (gapguM) gapguText = gapguM[0];
  const gapguSafe = /기록사항\s*없음/.test(gapguText);
  if (!gapguSafe && gapguText) {
    const riskDefs = [[/가압류/, "⚠️ 가압류"], [/가처분/, "⚠️ 가처분"], [/경매개시|임의경매|강제경매/, "🚨 경매개시결정"], [/신탁(?!.*보험)/, "⚠️ 신탁"], [/환매/, "⚠️ 환매특약"], [/예고등기/, "⚠️ 예고등기"], [/가등기/, "⚠️ 가등기"]];
    for (const [pat, label] of riskDefs) { if (pat.test(gapguText)) r.risks.push(label); }
  }

  // 을구 근저당 (말소 제외)
  let eulgu = "";
  const eulguM = rawText.match(/(근\s*\)?\s*저당권\s*및[\s\S]*?)(?=\[\s*참\s*고|\[\s*주\s*의|$)/);
  if (eulguM) eulgu = eulguM[1]; else eulgu = text;
  const eulguBlocks = eulgu.split(/(?=순위번호|\d+\s+근저당권설정)/g);
  for (const block of eulguBlocks) {
    if (/말소|해지됨|해제|취하/.test(block)) continue;
    const maxM = block.match(/채권최고액\s*금?\s*([\d,]+)\s*원/); if (!maxM) continue;
    const amt = parseInt(maxM[1].replace(/,/g, "")); if (amt < 1000000) continue;
    const mg = { rank: r.mortgages.length + 1, holder: "", maxAmount: amt, date: "" };
    const hm = block.match(/근저당권자\s+([가-힣()]+(?:주식회사|은행|금고|보험|캐피탈|저축|신협|농협|수협|생명|화재|카드|대부)[가-힣()]*)/);
    if (hm) mg.holder = hm[1].replace(/주식회사/g, "㈜").trim();
    else { const hm2 = block.match(/([\w가-힣]+(?:은행|금고|보험|캐피탈|저축|신협|농협|수협|생명|화재|카드|대부|해상))/); if (hm2) mg.holder = hm2[1]; }
    const dm = block.match(/(20\d{2}년\d{1,2}월\d{1,2}일)/); if (dm) mg.date = dm[1];
    r.mortgages.push(mg); r.totalMax += amt;
  }
  r.totalEst = Math.round(r.totalMax / 1.2);
  return r;
}

// ========================
// 유틸
// ========================
function fmtW(a) { if (!a) return "0원"; const e = Math.floor(a / 1e8), m = Math.round((a % 1e8) / 1e4); if (e > 0 && m > 0) return `${e}억 ${m.toLocaleString()}만`; if (e > 0) return `${e}억`; return `${m.toLocaleString()}만`; }
function shortName(name) { return name.replace(/주식회사|㈜|\(주\)/g, "").replace(/화재보험$/, "").replace(/생명보험$/, "").replace(/손해보험$/, "").replace(/상호저축은행$/, "저축은행").trim(); }
function normalizeType(t) { if (/오피스텔/.test(t)) return "오피스텔"; if (/빌라|다세대|연립/.test(t)) return "빌라/다세대"; if (/단독|다가구/.test(t)) return "단독/다가구"; if (/상가|근린/.test(t)) return "상가"; return "아파트"; }

function mergeData(kakao, reg) {
  const f = { ...EMPTY };
  f.name = kakao.name || reg?.owner || "";
  f.birth = (kakao.birth && kakao.birth.length >= 6) ? kakao.birth : reg?.ownerBirth || kakao.birth || "";
  f.phone = kakao.phone || ""; f.job = kakao.job || ""; f.salary = kakao.salary || "";
  f.credit = kakao.credit || ""; f.purpose = kakao.purpose || ""; f.period = kakao.period || "";
  f.amount = kakao.amount || ""; f.loanType = kakao.loanType || "일반담보";
  if (reg?.address && kakao.address && reg.address !== kakao.address) { f.address = kakao.address; f.addressRegistry = reg.address; }
  else f.address = kakao.address || reg?.address || "";
  f.type = reg?.type ? normalizeType(reg.type) : kakao.type || "아파트";
  f.kb = kakao.kb || "";
  if (reg && reg.mortgages.length > 0) {
    f.seniorDetail = reg.mortgages.map((m, i) => `${i + 1}. ${shortName(m.holder) || "불명"} — 채권최고액 ${fmtW(m.maxAmount)}${m.date ? " (" + m.date + ")" : ""}`).join("\n");
    f.senior = `채권최고액 합계 ${fmtW(reg.totalMax)}`;
    f.rank = reg.mortgages.length === 0 ? "1순위" : reg.mortgages.length === 1 ? "2순위" : "3순위";
  } else { f.seniorDetail = kakao.seniorDetail || ""; f.senior = kakao.senior || ""; f.rank = kakao.rank || "1순위"; }
  const specials = [];
  if (kakao.special) specials.push(kakao.special);
  if (reg) {
    if (reg.owners.length > 1) specials.push("공동소유: " + reg.owners.map(o => `${o.name}(${o.share})`).join(", "));
    if (reg.area) specials.push("전용 " + reg.area);
    if (reg.landRight) specials.push("대지권: " + reg.landRight);
    if (reg.transferDate) specials.push("소유권이전: " + reg.transferDate + (reg.transferCause ? "(" + reg.transferCause + ")" : ""));
    if (reg.risks.length > 0) specials.push(reg.risks.join(", "));
  }
  f.special = specials.join(" / "); f.note = kakao.note || "";
  return f;
}

function toOutput(d) {
  let o = "◈ 올웨더파트너스대부\n\n";
  o += `[ ${d.loanType} / ${d.type} / ${d.rank} ]\n\n`;
  o += `▶ 신청인\n`;
  if (d.name) o += `  성명: ${d.name}\n`; if (d.birth) o += `  생년: ${d.birth}\n`;
  if (d.phone) o += `  연락처: ${d.phone}\n`; if (d.job) o += `  직업: ${d.job}\n`;
  if (d.salary) o += `  월소득: ${d.salary}\n`; if (d.credit) o += `  신용: ${d.credit}\n`;
  o += `\n▶ 담보물\n`;
  if (d.address) o += `  주소: ${d.address}\n`;
  if (d.addressRegistry && d.addressRegistry !== d.address) o += `  지번: ${d.addressRegistry}\n`;
  if (d.kb) o += `  시세: ${d.kb}\n`;
  o += `\n`;
  if (d.special || d.note) {
    o += `▶ 특이사항\n`;
    if (d.special) d.special.split(/\s*\/\s*/).forEach(item => { if (item.trim()) o += `  * ${item.trim()}\n`; });
    if (d.note) o += `  * ${d.note}\n`;
    o += `\n`;
  }
  o += `▶ 대출현황\n`;
  if (d.seniorDetail) { d.seniorDetail.split("\n").forEach(l => { o += `  ${l}\n`; }); const mc = (d.seniorDetail.match(/^\s*\d+\./gm) || []).length; if (mc >= 2 && d.senior) o += `  :: 합계 ${d.senior}\n`; }
  else if (d.senior) o += `  선순위: ${d.senior}\n`;
  if (d.amount) o += `  요청: ${d.amount}\n`; if (d.purpose) o += `  용도: ${d.purpose}\n`; if (d.period) o += `  기간: ${d.period}\n`;
  o += `\n㈜올웨더파트너스대부\n☎ 010-7485-3357`;
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
  const [kakaoParsed, setKakaoParsed] = useState(null);
  const [merged, setMerged] = useState({ ...EMPTY });
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [records, setRecords] = useState([]);
  const [aiParsing, setAiParsing] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const fileRef = useRef(null);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  // PDF 업로드
  async function handlePdf(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const text = await extractPdfText(file); setRegText(text); setRegFile(file.name);
      const parsed = parseRegistry(text); setRegParsed(parsed);
      showToast(`등기부 분석 완료! 근저당 ${parsed.mortgages.length}건`);
    } catch (err) { showToast("PDF 읽기 실패: " + err.message); }
    finally { setLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  // 정규식 분석
  function handleAnalyze() {
    const kp = kakaoText.trim() ? parseKakao(kakaoText) : null; setKakaoParsed(kp);
    if (regText.trim() && !regParsed) { const rp = parseRegistry(regText); setRegParsed(rp); }
    const m = mergeData(kp || { ...EMPTY }, regParsed); setMerged(m); setMode("review");
    showToast("분석 완료!");
  }

  // AI 카톡 파싱
  async function handleAIParse() {
    if (!kakaoText.trim() && !regText.trim() && !regFile) return;
    setAiParsing(true);
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: kakaoText.slice(0, 3000) }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const parsed = data.result;
      const m = { ...EMPTY };
      for (const k of Object.keys(EMPTY)) { if (parsed[k] && parsed[k] !== "") m[k] = String(parsed[k]); }
      if (/빌라|다세대/.test(m.type)) m.type = "빌라/다세대";
      if (/단독|다가구/.test(m.type)) m.type = "단독/다가구";
      setKakaoParsed(m);
      const merged2 = mergeData(m, regParsed); setMerged(merged2); setMode("review");
      showToast("AI 분석 완료!");
    } catch (err) {
      console.error(err); handleAnalyze();
      showToast("AI 실패 → 정규식 (" + err.message.slice(0, 40) + ")");
    } finally { setAiParsing(false); }
  }

  // AI 등기부 권리분석
  async function handleAIRegistry() {
    if (!regText.trim()) { showToast("등기부 데이터가 없습니다"); return; }
    setAiParsing(true);
    try {
      const res = await fetch("/api/registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: regText.slice(0, 5000), kb: merged.kb || "" }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data.result); showToast("권리분석 완료!");
    } catch (err) { setAnalysis("❌ 분석 실패: " + err.message); showToast("권리분석 실패"); }
    finally { setAiParsing(false); }
  }

  function handleGenerate() { const out = toOutput(merged); setOutput(out); setMode("output"); }

  function copyText(text) {
    try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return true; } } catch {}
    try { const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 99999); const ok = document.execCommand("copy"); document.body.removeChild(ta); if (ok) return true; } catch {}
    return false;
  }
  function handleCopy() {
    if (copyText(output)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    else showToast("텍스트를 선택 후 Ctrl+C");
  }
  function handleReset() { setKakaoText(""); setRegText(""); setRegFile(null); setRegParsed(null); setKakaoParsed(null); setMerged({ ...EMPTY }); setOutput(""); setAnalysis(""); setMode("input"); }

  const set = (k) => (e) => setMerged({ ...merged, [k]: e.target.value });
  const TYPES = ["아파트", "빌라/다세대", "오피스텔", "단독/다가구", "상가", "토지", "기타"];
  const RANKS = ["1순위", "2순위", "3순위"];
  const LTYPES = ["일반담보", "분양담보", "후순위", "동시설정", "대환", "매매잔금", "생활안정자금", "전세퇴거자금", "기타"];

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
    badge: (c) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c === "gold" ? "rgba(212,168,67,0.15)" : c === "red" ? "rgba(255,80,80,0.12)" : "rgba(100,160,255,0.12)", color: c === "gold" ? goldLight : c === "red" ? "#ff7b7b" : "#7ab3ff", marginRight: 6 }),
    toast: { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: gold, color: navy, padding: "10px 24px", borderRadius: 30, fontSize: 12, fontWeight: 700, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", maxWidth: "90%", textAlign: "center" },
    uploadBox: { border: `2px dashed ${border}`, borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", background: "rgba(212,168,67,0.03)" },
    sourceTag: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, marginLeft: 8, background: c === "kakao" ? "rgba(255,220,50,0.12)" : "rgba(100,200,100,0.12)", color: c === "kakao" ? "#ffe066" : "#7fdb7f" }),
  };

  return (
    <div style={s.wrap}>
      {toast && <div style={s.toast}>{toast}</div>}
      {copied && <div style={{ position: "fixed", top: 20, right: 20, background: "#2ecc71", color: "#fff", padding: "8px 20px", borderRadius: 30, fontSize: 13, fontWeight: 700, zIndex: 999 }}>복사 완료!</div>}

      <div style={s.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={s.brand}><div style={s.brandIcon}>AW</div><div><div style={s.brandText}>올웨더파트너스대부</div><div style={s.brandSub}>물건접수 종합분석기</div></div></div>
          <span style={{ background: "rgba(100,200,100,0.1)", border: "1px solid rgba(100,200,100,0.25)", borderRadius: 20, padding: "4px 12px", color: "#7fdb7f", fontSize: 11, fontWeight: 600 }}>AI 연동</span>
        </div>
        <div style={s.tabs}>
          <button style={s.tab(mode === "input")} onClick={() => setMode("input")}>접수입력</button>
          <button style={s.tab(mode === "review")} onClick={() => setMode("review")}>검토수정</button>
          <button style={s.tab(mode === "output")} onClick={() => setMode("output")}>발송양식</button>
        </div>
      </div>

      <div style={s.body}>
        {/* === 접수입력 === */}
        {mode === "input" && (<>
          <div style={s.section}>◆ 카톡 내용 붙여넣기</div><div style={s.divider} />
          <p style={{ fontSize: 12, color: textMuted, marginBottom: 10, lineHeight: 1.5 }}>업체에서 받은 카톡 메시지를 그대로 붙여넣으세요.</p>
          <textarea style={s.textarea} placeholder={"홍상민 760213-1 직장인\n울산광역시 중구 복산동...\nkb : 51000\n신한 : 35400 / 29500\n...\n\n아무 형식이나 OK!"} value={kakaoText} onChange={(e) => setKakaoText(e.target.value)} />
          {kakaoText.trim() && <div style={{ fontSize: 12, color: "#7fdb7f", marginTop: 6 }}>✓ 카톡 데이터 입력됨</div>}

          <div style={{ ...s.section, marginTop: 24 }}>◆ 등기부등본 (선택)</div><div style={s.divider} />
          <input ref={fileRef} type="file" accept=".pdf" onChange={handlePdf} style={{ display: "none" }} />
          <div style={{ ...s.uploadBox, borderColor: regFile ? "#7fdb7f" : border }} onClick={() => fileRef.current?.click()}>
            {loading ? <span style={{ color: goldLight }}>⟳ PDF 분석 중...</span>
              : regFile ? <div><div style={{ color: "#7fdb7f", fontWeight: 700 }}>✓ {regFile}</div><div style={{ color: textMuted, fontSize: 12, marginTop: 4 }}>{regParsed ? `근저당 ${regParsed.mortgages.length}건 / 위험요소 ${regParsed.risks.length}건` : ""}</div></div>
              : <div><div style={{ fontSize: 28, marginBottom: 6 }}>📄</div><div style={{ color: goldLight, fontWeight: 600 }}>등기부 PDF 업로드</div></div>}
          </div>
          {!regFile && <><div style={{ textAlign: "center", padding: "10px 0", fontSize: 11, color: textMuted }}>— 또는 텍스트 직접 붙여넣기 —</div><textarea style={{ ...s.textarea, minHeight: 80 }} placeholder="등기부등본 텍스트..." value={regText} onChange={(e) => setRegText(e.target.value)} /></>}

          {aiParsing && <div style={{ textAlign: "center", padding: "16px 0", color: goldLight, fontSize: 14, fontWeight: 600 }}><span style={{ display: "inline-block", animation: "spin 1s linear infinite", marginRight: 8 }}>⟳</span>AI 분석 중...<style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div>}
          <button style={{ ...s.btnPrimary, marginTop: 20, opacity: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? 1 : 0.4, pointerEvents: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? "auto" : "none" }} onClick={handleAIParse}>🤖 AI 종합 분석</button>
          <button style={{ ...s.btnSecondary, opacity: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? 1 : 0.4, pointerEvents: (kakaoText.trim() || regText.trim() || regFile) && !aiParsing ? "auto" : "none" }} onClick={handleAnalyze}>⚡ 빠른 분석 (정규식)</button>
          <button style={s.btnSecondary} onClick={handleReset}>초기화</button>
        </>)}

        {/* === 검토/수정 === */}
        {mode === "review" && (<>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {kakaoParsed && <span style={s.badge("gold")}>카톡 반영</span>}
            {regParsed && <span style={s.badge("blue")}>등기부 반영</span>}
            {regParsed?.risks.length > 0 && <span style={s.badge("red")}>위험 {regParsed.risks.length}건</span>}
          </div>
          {regParsed?.risks.length > 0 && <div style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}><div style={{ fontSize: 12, color: "#ff6b6b", fontWeight: 700, marginBottom: 6 }}>🚨 위험요소</div>{regParsed.risks.map((r, i) => <div key={i} style={{ fontSize: 13, marginBottom: 2 }}>{r}</div>)}</div>}

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

          {/* AI 등기부 권리분석 */}
          {regText.trim() && (<>
            <div style={{ ...s.section, marginTop: 24 }}>◆ AI 권리분석</div><div style={s.divider} />
            {!analysis ? (
              <button style={{ ...s.btnSecondary, background: "rgba(100,160,255,0.1)", borderColor: "rgba(100,160,255,0.3)", color: "#7ab3ff" }} onClick={handleAIRegistry} disabled={aiParsing}>{aiParsing ? "⟳ 분석 중..." : "🤖 등기부 위험사항 분석"}</button>
            ) : (<>
              <div style={{ ...s.resultBox, background: "rgba(100,160,255,0.04)", border: "1px solid rgba(100,160,255,0.15)", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8 }}>{analysis}</div>
              <button style={{ ...s.btnSecondary, fontSize: 12, color: textMuted }} onClick={() => setAnalysis("")}>다시 분석</button>
            </>)}
          </>)}

          <button style={{ ...s.btnPrimary, marginTop: 20 }} onClick={handleGenerate}>카톡 발송 양식 생성</button>
          <button style={s.btnSecondary} onClick={() => setMode("input")}>← 입력으로</button>
        </>)}

        {/* === 발송양식 === */}
        {mode === "output" && (<>
          <div style={s.section}>◆ 카톡 발송 양식</div><div style={s.divider} />
          <div id="out-text" style={{ ...s.resultBox, userSelect: "text", WebkitUserSelect: "text" }}>{output}</div>
          <button style={s.btnPrimary} onClick={handleCopy}>{copied ? "✓ 복사 완료!" : "클립보드에 복사"}</button>
          <button style={s.btnSecondary} onClick={() => setMode("review")}>수정하기</button>
          <button style={{ ...s.btnSecondary, color: textMuted }} onClick={handleReset}>새 물건 접수</button>
        </>)}
      </div>
    </div>
  );
}
