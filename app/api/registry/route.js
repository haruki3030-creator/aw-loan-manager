import { NextResponse } from "next/server";

// 등기부 텍스트에서 "주요 등기사항 요약" 부분만 추출
function extractSummary(text) {
  // "주요 등기사항 요약" 또는 "주요등기사항요약" 이후 부분 추출
  const summaryMatch = text.match(/주요\s*등기\s*사항\s*요약[\s\S]*/);
  if (summaryMatch) return summaryMatch[0];
  return null;
}

// 전부증명서에서 말소 항목 번호 수집
function findCancelledNumbers(text) {
  const cancelled = new Set();
  // "N번 근저당권 말소", "N번 가압류 말소", "N번 말소" 패턴
  const patterns = [
    /(\d+)번\s*(?:근저당권|가압류|가처분|압류|경매개시결정|강제경매)?\s*말소/g,
    /말소\s*.*?(\d+)번/g,
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

    // 주요등기사항요약 자동 추출 시도
    const summary = extractSummary(text);
    const cancelledNums = findCancelledNumbers(text);
    const cancelledInfo = cancelledNums.size > 0
      ? `\n\n참고: 이 등기부에서 순위번호 ${[...cancelledNums].join(", ")}번은 말소된 항목이야. 이 번호에 해당하는 가압류/압류/경매/근저당은 이미 소멸됐으니 위험에서 제외해.`
      : "";

    const analysisText = summary || text;

    const prompt = `너는 대부업 실무 등기부 분석가야.

절대 규칙 (반드시 지켜):
1. 아래 텍스트에 실제로 적혀있는 내용만 분석해
2. 텍스트에 없는 가압류, 압류, 경매 등을 절대 추가하지 마
3. "기록사항 없음"이면 해당 섹션에 위험요소 없음
4. 소유자 본인이 채권자인 가처분 → "자기보호용, 위험 아님"으로 처리
5. "주요 등기사항 요약"은 말소되지 않은 유효 항목만 보여주는 문서야
6. 순위번호가 말소된 항목으로 표시되어 있으면 위험에서 제외해${cancelledInfo}

형식:

📋 등기부 분석 결과

소유자: (이름, 단독/공동)
${kb ? `시세: ${kb}` : ""}

⚠️ 위험/특이사항:
(텍스트에 실제로 나온 유효 위험만. 없으면 "없음")

🏦 유효 근저당:
(말소 안 된 것만)
${kb ? `LTV 계산 포함` : ""}

✅ 종합 판단: 안전 / 주의 / 위험
(한줄 사유 + 후순위 취급 가능 여부)

등기부:
${analysisText}`;

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
