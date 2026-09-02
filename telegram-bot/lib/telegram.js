// lib/telegram.js
// 텔레그램 Bot API로 메시지를 보내는 최소 모듈 (외부 의존성 없음, Node 18+ 내장 fetch 사용)

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * 텔레그램 채팅(개인 DM 또는 그룹)으로 메시지 전송.
 * @param {string} text  HTML 서식 허용 (<b>, <a href> 등)
 */
export async function sendMessage(text) {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("환경변수 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 필요합니다.");
  }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`텔레그램 전송 실패: ${data.error_code} ${data.description}`);
  }
  return data.result;
}

/** 빈자리 슬롯들을 보기 좋은 한 통의 메시지로 묶는다 (출조점별 그룹핑) */
export function formatAlert(newSlots) {
  const bySpot = {};
  for (const s of newSlots) (bySpot[s.spot] ??= []).push(s);

  const lines = ["🎣 <b>빈자리 떴어요!</b>", ""];
  for (const [spot, slots] of Object.entries(bySpot)) {
    lines.push(`📍 <b>${spot}</b>`);
    for (const s of slots) {
      const seats = `${s.open}자리`;
      const minGo = s.open < (s.minGo ?? 0) ? ` <i>(최소 ${s.minGo}인)</i>` : "";
      lines.push(`• ${s.boat} · ${s.species} — ${s.date}(${s.dow}) ${s.dep} · ${seats}${minGo}`);
    }
    if (slots[0].url) lines.push(`👉 <a href="${slots[0].url}">예약 현황 보기</a>`);
    lines.push("");
  }
  lines.push("<i>예약·입금은 선사 예약창에서 진행하세요.</i>");
  return lines.join("\n");
}
