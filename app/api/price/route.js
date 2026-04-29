import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { lawdCd, dealYmd } = await req.json();
    const key = process.env.MOLIT_KEY;
    if (!key) return NextResponse.json({ error: "MOLIT_KEY 미설정" }, { status: 500 });

    const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;

    const res = await fetch(url);
    const xml = await res.text();

    // resultCode 체크 (XML 응답 내 에러 처리)
    const resultCode = xml.match(/<resultCode>([\s\S]*?)<\/resultCode>/);
    if (resultCode && resultCode[1].trim() !== "00" && resultCode[1].trim() !== "000") {
      const resultMsg = xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/);
      const errAuth = xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/);
      return NextResponse.json({ error: `MOLIT: ${errAuth ? errAuth[1].trim() : (resultMsg ? resultMsg[1].trim() : 'unknown')}` }, { status: 500 });
    }

    const totalMatch = xml.match(/<totalCount>(\d+)<\/totalCount>/);
    const totalCount = totalMatch ? parseInt(totalMatch[1]) : 0;

    const items = [];
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const block of itemBlocks) {
      const g = (tag) => {
        const m = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
        return m ? m[1].trim() : "";
      };
      const aptNm = g("aptNm") || g("아파트");
      const area = g("excluUseAr") || g("전용면적");
      const floor = g("floor") || g("층");
      const amount = g("dealAmount") || g("거래금액");
      const year = g("dealYear") || g("년");
      const month = g("dealMonth") || g("월");
      const day = g("dealDay") || g("일");
      const gbn = g("dealingGbn") || g("거래유형") || "";
      const cancel = g("cdealType") || g("해제여부") || "";

      if (!aptNm && !amount) continue;
      items.push({
        aptNm,
        area: parseFloat(area) || 0,
        floor,
        amount: amount.replace(/,/g, "").trim(),
        date: `${year}.${month}.${day}`,
        gbn,
        cancel: cancel === "O",
      });
    }

    const areaGroups = {};
    for (const item of items) {
      if (item.cancel) continue;
      const key = Math.round(item.area);
      if (!areaGroups[key]) areaGroups[key] = [];
      areaGroups[key].push(parseInt(item.amount.replace(/,/g, "")) || 0);
    }
    const summary = Object.entries(areaGroups)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([area, prices]) => ({
        area: parseInt(area),
        pyeong: Math.round(parseInt(area) / 3.305),
        count: prices.length,
        max: Math.max(...prices),
        avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      }));

    return NextResponse.json({ totalCount, items: items.slice(0, 50), summary });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
