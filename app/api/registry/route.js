import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { text, kb } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const prompt = `너는 대부업 실무 등기부 분석가야. 아래 등기부등본을 보고 담보 취급 관점에서 위험사항과 특이사항을 판단해줘.

규칙:
- 이미 말소된 가압류/경매/근저당은 위험이 아니야. "말소 완료"로 처리하고 넘겨
- 현재 유효한 권리만 위험 판단 대상이야
- 소유자 본인이 채권자인 가처분은 위험이 아니야

아래 형식으로 작성해:

📋 등기부 분석 결과

소유자: (이름, 단독/공동 여부)
${kb ? `시세: ${kb}` : ""}

⚠️ 위험/특이사항:
- (유효한 위험사항이 있으면 하나씩 나열)
- (가압류, 가처분, 경매, 신탁, 환매특약, 가등기 등)
- (각 항목마다 채권자, 의미, 실제 영향 한줄 설명)

🏦 유효 근저당:
- (말소 안 된 근저당만. 금융사 — 채권최고액)
- 합계: (총액)
${kb ? `- LTV: (선순위합계 ÷ 시세 = N%)` : ""}

✅ 종합 판단: (안전 / 주의 / 위험)
- (한줄 사유)
- (후순위 취급 가능 여부)

위험사항이 없으면 "⚠️ 위험/특이사항: 없음" 이라고 쓰고, 종합 판단에 "✅ 안전 — 특이사항 없음, 후순위 취급 가능" 이라고 써.

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
              generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
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
