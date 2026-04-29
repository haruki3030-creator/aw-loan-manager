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
    const { text, kb, hint } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const summary = extractSummary(text);
    const cancelledNums = findCancelledNumbers(text);
    const cancelledInfo = cancelledNums.size > 0
      ? `\n말소된 순위번호: ${[...cancelledNums].join(", ")}번. 위험에서 제외.`
      : "";

    let hintBlock = "";
    if (hint) {
      hintBlock = `\n\n정규식 사전 분석 결과 (★최우선 신뢰. 아래 값을 그대로 결과에 반영. "미확인"으로 덮어쓰지 말 것):
- 소유자: ${hint.owners || "미확인"}
- 소유권이전: ${hint.transferDate || "미확인"}${hint.transferCause ? " (" + hint.transferCause + ")" : ""}${hint.tradePrice ? " / 거래가 " + hint.tradePrice : ""}
- 전용면적: ${hint.area || "미확인"}, 총 ${hint.totalFloors || "?"}층 / 해당 ${hint.unitFloor || "?"}층
- 갑구 상태: ${hint.gapgu || "미확인"}
- 을구 상태: ${hint.eulgu || "미확인"}
- 유효 근저당: ${hint.mortgages || "없음"}
- 위험 플래그: ${hint.risks || "없음"}

★ 위 값 중 "미확인"이 아닌 것은 결과의 해당 항목에 그대로 채워라.`;
    }

    const analysisText = summary || text;

    const prompt = `대부업 실무 등기부 분석.

규칙:
1. 텍스트에 있는 내용만. 없는 항목 추가 금지.
2. ★ "주요등기사항 요약"이 있으면 최우선 참조. "기록사항 없음"이면 해당 구의 위험/근저당은 0건.
3. ★ 말소 판단 (핵심): "N번~등기말소" 패턴이 있으면 N번은 이미 말소됨. 말소된 항목은 위험요소/근저당에서 반드시 제외.
   예: "5번강제경매개시결정, 6번압류, 7번임의경매개시결정등기말소" → 5,6,7번 모두 말소.
   예: "9번근저당권설정등기말소" → 을구 9번 말소.
4. 소유자 본인이 채권자인 가처분은 위험 아님.
5. 금액은 만원 단위. 예: 804,000,000원 → 8,040만원
6. 근저당권자 이름 포함.
7. ★ 소유권이전일: 최종 소유자 기준 (가장 마지막 소유권이전 순위번호).
8. ★ 신탁이 "신탁재산의귀속"으로 해제되었거나 이후 매매가 있으면 현재 신탁 아님.${cancelledInfo}${hintBlock}

LTV 기준:
- 70% 이하 → ✅ 안전
- 70~80% → 🟡 보통
- 80~90% → ⚠️ 주의
- 90% 이상 → 🚨 위험

형식:
📋 등기부 분석 결과
소유자: (이름, 단독/공동 + 지분, 취득일 + 원인)
물건정보: (전용면적, 총층수/해당층)
${kb ? `시세: ${kb}` : ""}
⚠️ 위험/특이사항: (현재 유효한 위험만. 말소된 것 제외. 없으면 "없음")
🏦 유효 근저당: (말소 안 된 것만. 없으면 "없음")${kb ? ` LTV 포함` : ""}
✅ 종합 판단: 안전/보통/주의/위험 + 사유 + 후순위 가능여부

등기부:
${analysisText.slice(0, 3500)}`;

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
