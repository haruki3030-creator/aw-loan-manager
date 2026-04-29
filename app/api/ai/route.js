import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const { text, registryText } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const prompt = `당신은 대부업 물건접수 전문가입니다. 카톡 메시지에서 대출 물건 정보를 정확하게 추출하세요.
${registryText ? `\n등기부등본 텍스트도 함께 분석하세요.

## 등기부 분석 핵심 규칙 (매우 중요)
1. 물건 주소는 반드시 [집합건물] 뒤의 주소를 사용. 수탁자/채권자/근저당권자의 주소를 물건 주소로 착각하지 말 것!
2. "주요등기사항 요약"이 있으면 그것을 최우선 참조:
   - "기록사항 없음"이면 해당 구의 위험요소/근저당은 0건
3. 말소 판단: "N번~등기말소"가 있으면 N번은 말소된 것. 말소된 근저당/위험은 결과에서 제외
4. 소유권이전일: 최종 소유자의 이전일 사용 (가장 나중 순위번호)
5. 신탁: "신탁재산의귀속"으로 말소되었거나, 이후 매매로 소유권이 이전되었으면 현재 신탁 아님` : ""}

## 추출 규칙

### 이름/생년
- "김한동 / 910516-1" → name: "김한동", birth: "910516"
- 주민번호 뒷자리는 제거, 생년 6자리만

### 시세 (매우 중요 — 구조화 필수)
- "KB 하 39,500만 / 일 43,000만 (일)" → kbLow: 39500, kbMid: 43000, kbHigh: null, kbApplied: "일반가", kbAppliedValue: 43000
- "KB AI시세 15,400 15,600 15,700" → kbLow: 15400, kbMid: 15600, kbHigh: 15700
- "kb : 51000" → kbMid: 51000
- "KB 미등재 하우스머치 중 43,600" → kbMid: null, housemuch: 43600, housemuchGrade: "중"
- 실거래가: "실거래: 42,000만(26.04.22)" → actualPrice: 42000, actualDate: "26.04.22"
- 모든 시세 숫자는 만원 단위 정수 (콤마 제거)

### 기대출 (선순위 vs 대환대상 구분 — 핵심)
카톡에 "▶ 선순위" / "▶ 대환/말소대상" 구분이 있으면 반드시 분리.
각 대출 항목:
{ "no": 1, "lender": "우리은행", "maxAmount": 5940, "estimatedBalance": 5400, "rate": 110.0 }
- maxAmount: 채권최고액 (만원), estimatedBalance: 추정잔액 (괄호 안 숫자, 만원), rate: 설정비율 %
- "현대해상 - 26.500 / 31,920" → lender: "현대해상", estimatedBalance: 26500 (또는 첫번째 숫자), maxAmount: 31920 (큰 숫자가 채권최고액)
- "신한 : 35400 / 29500" → 큰 숫자가 채권최고액: maxAmount: 35400, estimatedBalance: 29500
- "미래대부 1,500" → maxAmount: 1500
- "농협 4,000 (4,800) 차주 본인" → estimatedBalance: 4000, maxAmount: 4800

구분 없으면 전부 seniorLoans.
":: 총 합계 26,180만 (23,800만)" → seniorTotal: { maxAmount: 26180, estimatedBalance: 23800 }

### 요청금액 (우선순위)
1. "필요자금/필요금액/필요 N" → 최우선
2. "희망금/요청금/추가한도" + 숫자
3. "N만 필요/부탁" (역순)
4. "최대 요청" / "추가 한도 부탁" → 텍스트 그대로
5. "가능사 확인 부탁" → 텍스트 그대로
- 시세와 같은 숫자면 요청 아님 (비우기)

### 직업
- "직업 : 4대 직장인" → "4대 직장인"
- 키워드: 개인사업자, 주부, 직장인 등

### 신용
- "KCB 590" → "KCB 590점", "나이스 7등급" → "NICE 7등급"
- 출처(KCB/NICE) 반드시 포함

### 특이사항
- 면적, 세대수, 층수, 대지권, 소유권이전일, 건물연식
- 기대출 괄호 메모: "(사촌 채무 금거첨부가능)" → 특이사항
- 이미 다른 필드에 들어간 정보 제외

## 출력 JSON (코드블록 없이 순수 JSON만)
{
  "type": "아파트|오피스텔|빌라/다세대|단독/다가구|상가|토지",
  "rank": "1순위|2순위|3순위",
  "loanType": "일반담보|분양담보|후순위|동시설정|대환|매매잔금",
  "name": "", "birth": "", "phone": "", "address": "",
  "job": "", "salary": "", "credit": "",
  "kbLow": null, "kbMid": null, "kbHigh": null,
  "kbApplied": null, "kbAppliedValue": null,
  "housemuch": null, "housemuchGrade": null,
  "actualPrice": null, "actualDate": null,
  "seniorLoans": [],
  "seniorTotal": { "maxAmount": null, "estimatedBalance": null },
  "replacementLoans": [],
  "replacementTotal": { "maxAmount": null, "estimatedBalance": null },
  "amount": "", "purpose": "", "special": "", "note": ""
}
${registryText ? `
## 등기부 추가 필드
- registryAddress, owners: [{ name, birth, role, share }]
- area, totalFloors, unitFloor, landRight
- transferDate, transferCause
- mortgages: [{ holder, maxAmount(만원), date }] (말소 제외)
- risks: [] (기록사항없음이면 빈배열)` : ""}

카톡:
${text.slice(0, 2500)}${registryText ? `\n\n등기부등본:\n${registryText.slice(0, 4000)}` : ""}`;

    // Vercel Hobby 10초 제한 → flash만 사용
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
    let lastErr = "";

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2000 },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);
        if (!res.ok) { lastErr = `${model} ${res.status}`; continue; }

        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!aiText) { lastErr = `${model}: 빈 응답`; continue; }

        const cleaned = aiText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonM = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonM) { lastErr = `${model}: JSON 추출 실패`; continue; }

        const parsed = JSON.parse(jsonM[0]);
        return NextResponse.json({ result: parsed, model });

      } catch (err) {
        lastErr = `${model}: ${err.name === "AbortError" ? "타임아웃" : err.message}`;
        continue;
      }
    }

    return NextResponse.json({ error: lastErr }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
