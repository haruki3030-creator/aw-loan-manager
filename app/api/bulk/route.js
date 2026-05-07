import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const { text } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });

    const prompt = `당신은 대부업 물건접수 전문가입니다. 카톡 메시지에서 대출 물건 정보를 추출하세요.
형식은 정형([아파트/2순위] 형태), 자유형(이름+주소+시세 나열), 어떤 형식이든 동일하게 추출합니다.

## 추출 JSON
{
  "type": "아파트|오피스텔|빌라/다세대|주상복합|단독/다가구|상가|토지",
  "rank": "1순위|2순위|3순위|4순위|5순위|불명",
  "name": "",
  "birth": "",
  "job": "",
  "address": "",
  "region": "수도권|충청|대구경북|부산경남울산|호남|강원|제주|기타",
  "kbLow": null,
  "kbMid": null,
  "kbAppliedValue": null,
  "housemuch": null,
  "seniorMaxTotal": 0,
  "seniorEstTotal": 0,
  "replacementMaxTotal": 0,
  "replacementEstTotal": 0,
  "risks": [],
  "flags": [],
  "summary": ""
}

## 규칙
- 시세: 만원 단위 정수. "KB 하 39,500만/일 43,000만(일)" → kbLow:39500, kbMid:43000, kbAppliedValue:43000
- "kb:51000" → kbMid:51000
- "KB 미등재 하우스머치 중 43,600" → housemuch:43600
- "KB AI시세 15,400 15,600 15,700" → kbLow:15400, kbMid:15600
- "매물평균가 4억 8,600만" / "네이버평균 5.2억" / "일사천리 3억9천" → kbAppliedValue로 (만원 단위)
- "X억 Y만" 표기는 X*10000+Y 만원으로. 예: "4억 8,600만"=48600, "1억"=10000, "5.2억"=52000
- 시세가 KB·하우스머치·매물평균가 어디에도 없고 숫자만 3개 나열되면(예: "60,000  65,000  69,000") kbLow/kbMid/kbAppliedValue 순서로 매핑
- "시세 1억" / "시세 1.2억" 같은 단일값은 kbAppliedValue에 (만원 단위)
- 선순위: 총 합계의 채권최고액/추정잔액. 없으면 개별 합산
- 대환/말소대상은 replacementMaxTotal/replacementEstTotal
- risks: ["압류","가압류","경매","신탁","환매특약"] 해당 시
- flags: 급건/매입자금/소득증빙불가/증여/지층/지분대출/공동소유/분양/대환희망/재건축 등 해당 키워드
- region: 주소의 시도 기준. 서울/경기/인천→수도권, 대전/세종/충청→충청, 대구/경북→대구경북 등
- summary: 1줄 요약 (예: "아파트 2순위, 인천 수도권, KB일 4.3억, 선순위 2.6억")
- birth: 6자리만 (뒷자리 제거)
- 코드블록 없이 순수 JSON만 출력

카톡:
${text.slice(0, 2500)}`;

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let lastErr = "";

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
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
