export const metadata = {
  title: "올웨더파트너스대부 — 물건접수 종합분석기",
  description: "카톡 파싱 + 등기부 분석 + 발송양식 생성",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#141c2e" }}>
        {children}
      </body>
    </html>
  );
}
