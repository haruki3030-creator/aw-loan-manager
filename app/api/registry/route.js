import { NextResponse } from "next/server";

export const maxDuration = 30;

function extractSummary(text) {
  const summaryMatch = text.match(/주요\s*등기\s*사항\s*요약[\s\S]*/);
  if (summaryMatch) return summaryMatch[0];
  return null;
}

function findCancelledNumbers(text) {
  const cancelled = new Set();
  const patterns = [
    /(\d+)번\s*(?:근저당권|가압류|가처분|압류|경매개시결정|강제경매)?\s*말소/g,
    /(\d+)번\s*(?:등기\s*)?말소/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      cancelled.add(m[1]);
    }
  }
  return cancelled;
}

export async function POST(req) {
  try {
    const { text, kb } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const summary = extractSummary(text);
    const cancelledNums = findCancelledNumbers(text);
    const cancelledInfo = cancelledNums.size > 0
      ? `\n참고: 순위번호 ${[...cancelledNums].join(", ")}번은 말소된 항목. 위험에서 제외해.`
      : "";

    const analysisText = summary || text;

    const prompt = `대부업 실무 등기부 분석.

규칙:
1. 텍스트에 있는 내용만. 없는 항목 추가 금지.
2. "기록사항 없음"이면 위험요소 없음.
3. 소유자 본인이 채권자인 가처분은 위험 아님.
4. 금액은 만원 단위. 예: 319,200,000원 → 3억 1,920만원
5. 근저당권자 이름 포함.${cancelledInfo}

LTV 기준:
- 70% 이하 → ✅ 안전
- 70~80% → 🟡 보통
- 80~90% → ⚠️ 주의
- 90% 이상 → 🚨 위험

형식:
📋 등기부 분석 결과
소유자: (이름, 단독/공동)
${kb ? `시세: ${kb}` : ""}
⚠️ 위험/특이사항: (유효 위험만. 없으면 "없음")
🏦 유효 근저당: (근저당권자: 채권최고액)${kb ? ` LTV 포함` : ""}
✅ 종합 판단: 안전/보통/주의/위험 + 사유 + 후순위 가능여부

등기부:
${analysisText.slice(0, 3000)}`;

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let lastErr = "";

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 1500 },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);

        if (!res.ok) {
          lastErr = `${model} ${res.status}`;
          continue;
        }

        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!aiText) { lastErr = `${model}: 빈 응답`; continue; }

        return NextResponse.json({ result: aiText });

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
