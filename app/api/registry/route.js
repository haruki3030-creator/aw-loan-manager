import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { text, kb } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const prompt = `너는 대부업 등기부등본 권리분석 전문가야. 아래 등기부 텍스트를 분석해서 실무적 리포트를 작성해.

중요: 말소된 항목과 유효한 항목을 정확히 구분해. 말소기준등기 이후 말소된 가압류/경매 등은 "말소됨"으로 표시하고 위험요소에서 제외해.

분석 항목:

1. [갑구] 소유권 현황
   - 현재 소유자 (공동소유면 지분 포함)
   - 소유권 이전 경위 (매매/분양/판결 등)
   - 가압류/가처분/경매/압류 각각: 채권자, 말소 여부, 현재 의미
   - 위험도: ✅ 안전 / ⚠️ 주의 / 🚨 위험

2. [을구] 근저당 현황
   - 근저당권자별: 채권최고액, 설정일
   - 말소된 근저당은 제외
   - 유효 선순위 합계
   ${kb ? `- KB시세 ${kb} 기준 LTV 계산` : ""}

3. [종합 판단]
   - 후순위 담보 취급 가능 여부
   - 주의사항
   - 권고사항 (말소촉탁 필요 여부 등)

간결하고 실무적으로 작성해. 이모지 활용.

등기부등본:
${text}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
      return NextResponse.json({ error: `Gemini API ${res.status}: ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!aiText) {
      return NextResponse.json({ error: "Gemini 빈 응답" }, { status: 500 });
    }

    return NextResponse.json({ result: aiText });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
