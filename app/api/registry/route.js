import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { text, kb } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const prompt = `너는 대부업 실무 등기부 분석가야.

절대 규칙:
1. 아래 등기부 텍스트에 실제로 적혀있는 내용만 분석해. 텍스트에 없는 항목은 절대 추가하지 마.
2. "주요 등기사항 요약"은 말소되지 않은 유효한 항목만 표시하는 문서야. 여기 나온 건 현재 유효한 거야.
3. "기록사항 없음"이라고 적혀있으면 해당 섹션에 위험요소 없다는 뜻이야.
4. 소유자 본인이 채권자인 가처분은 자기 보호용이므로 위험이 아니야.
5. 추측하거나 상상하지 마. 텍스트에 "가압류"라는 단어가 없으면 가압류는 없는 거야. "경매"라는 단어가 없으면 경매는 없는 거야.

아래 형식으로 작성해:

📋 등기부 분석 결과

소유자: (텍스트에 나온 소유자 이름, 단독/공동)
${kb ? `시세: ${kb}` : ""}

⚠️ 위험/특이사항:
- (텍스트에 실제로 나온 유효한 위험사항만 나열)
- (각 항목: 채권자, 의미, 실제 영향 한줄)
- 위험사항 없으면: "없음"

🏦 유효 근저당:
- (텍스트에 나온 근저당만. 금융사 — 채권최고액)
- 합계: (총액)
${kb ? `- LTV: (선순위합계 ÷ 시세)` : ""}

✅ 종합 판단: (안전 / 주의 / 위험)
- (한줄 판단 사유)
- (후순위 취급 가능 여부)

등기부:
${text}`;

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
    let lastErr = "";

    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 3000 },
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          lastErr = `${model} ${res.status}: ${errText.slice(0, 200)}`;
          continue;
        }

        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (!aiText) {
          lastErr = `${model}: 빈 응답`;
          continue;
        }

        return NextResponse.json({ result: aiText });

      } catch (err) {
        lastErr = `${model}: ${err.message}`;
        continue;
      }
    }

    return NextResponse.json({ error: lastErr }, { status: 500 });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
