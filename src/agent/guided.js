const numberWords = { one: 1, two: 2, three: 3, four: 4, thirty: 30, sixty: 60 };
const number = (value) => numberWords[value] ?? Number(value);

export function spokenCommand(message) {
  return message.normalize('NFKC').trim().toLowerCase().replace(/[.!?。！？、,\s]+$/u, '');
}

// Keep this separate from broader text commands: only an unqualified human
// affirmative can confirm the exact proposal read aloud by the client.
export function isVoiceConfirmation(message) {
  const command = spokenCommand(message).replace(/[,、\s]+/gu, '');
  return /^(yes|yesplease|yesusethisplan|yesapplythesechanges|yesapplyit|はい|はいお願いします|はいお願い|はいそれでお願いします|はいそれでお願い|それでお願い|それでお願いします|うんそれでお願い|うんそれでお願いします)$/.test(command);
}

/** Deliberately small grammar. Unsupported research is never simulated as success. */
export function parseGuided(message) {
  const text = spokenCommand(message);
  if (isVoiceConfirmation(message)) return { action: 'confirm' };
  if (/^(yes|yes please|confirm|apply|apply changes|create this trip|ok|okay|はい|お願い|それでお願い|確定|適用)$/.test(text)) return { action: 'confirm' };
  if (/^(no|no thanks|cancel|keep current plan|decline|いいえ|キャンセル|やめる)[.!。！\s]*$/.test(text)) return { action: 'decline' };
  if (/^(undo|undo last change|go back|元に戻して|元に戻す|取り消し|戻して)[.!。！\s]*$/.test(text)) return { action: 'undo' };
  if (/^(repeat|say that again|もう一度|もう一回|もう一度お願い|もう一度言って)$/.test(text)) return { action: 'repeat' };
  if (/^(?:(?:alexa|アレクサ)[,、\s]*)?(?:open (?:travel folio|my travel journal)|start (?:travel folio|my trip)|plan a trip|旅の手帳(?:を)?(?:開いて|ひらいて|開く)|旅行(?:を)?(?:始めたい|計画したい))$/.test(text)) return { action: 'open' };
  if (/memor|photos|scrapbook|slideshow|思い出|写真|スクラップ/.test(text)) {
    const only = text.match(/day\s*(\d|one|two|three|four)/) || text.match(/(\d)日目/);
    return { action: 'memories', ...(only ? { day: number(only[1]) } : {}) };
  }
  if (/phone|qr\b|スマホ|携帯/.test(text)) return { action: 'handoff' };
  const dayMatch = text.match(/day\s*(\d|one|two|three|four)/) || text.match(/(\d)日目/);
  const day = dayMatch ? number(dayMatch[1]) : 1;
  if (/next|次の予定|次は/.test(text)) return { action: 'next', day };
  if (/indoor|rain.?swap|replace.*rain|swap.*rain|雨.*(変更|変え|屋内)|屋内/.test(text)) return { action: 'rain_swap', day };
  if (/weather|rain|天気|雨/.test(text)) return { action: 'weather', day };
  if (/delay|later|earlier|shift|遅ら|早め|ずら/.test(text)) {
    const amount = text.match(/(\d+|thirty|sixty|one|two)\s*(minutes?|hours?|分|時間)/);
    const minutes = amount ? number(amount[1]) * (/hour|時間/.test(amount[2]) ? 60 : 1) : 30;
    return { action: 'delay', day, minutes: /earlier|早め/.test(text) ? -minutes : minutes };
  }
  if (/(add|another|追加|増や).*(coffee|cafe|café|コーヒー|カフェ)|(coffee|cafe|コーヒー|カフェ).*(追加|増や)/.test(text)) return { action: 'coffee', day };
  const city = /kyoto|京都/.test(text) ? 'kyoto' : /seattle|シアトル/.test(text) ? 'seattle' : null;
  if (city) {
    const cityOnly = /^(?:(?:to|in|go to|let'?s go to)\s+)?(?:kyoto|seattle|京都|シアトル)(?:\s+please)?(?:で|に|へ)?(?:お願い(?:します)?)?$/.test(text);
    return { action: 'create', city, ...tripDetails(text), ...(cityOnly ? { cityOnly: true } : {}) };
  }
  // Speech recognition often mishears place names ("Kyoto" → "killed"). A trip request
  // without a city we know is asked about, never guessed.
  if (/\b(?:days?|trip|weekend|travel|holiday|vacation)\b|日間|旅行/.test(text)) return { action: 'ask_city', ...tripDetails(text) };
  return null;
}

function tripDetails(text) {
  const daysMatch = text.match(/(\d+|one|two|three|four)[ -]*(?:(?:easy|relaxed|slow)[ -]+)?days?/) || text.match(/(\d+)日/);
  const japaneseDays = text.match(/(一|二|三|四)日/);
  const interests = [];
  for (const [id, pattern] of Object.entries({ coffee: /coffee|cafe|café|コーヒー|カフェ/, culture: /culture|art|temples?|shrines?|museums?|文化|寺|神社|美術/, food: /food|食|グルメ/, nature: /nature|自然/, shopping: /shopping|買い物/, views: /views?|景色/, family: /family|家族/ })) {
    if (pattern.test(text)) interests.push(id);
  }
  return {
    days: daysMatch ? number(daysMatch[1]) : japaneseDays ? { 一: 1, 二: 2, 三: 3, 四: 4 }[japaneseDays[1]] : 2,
    pace: /relax|slow|easy|ゆっくり|のんびり/.test(text) ? 'relaxed' : /packed|busy|たくさん/.test(text) ? 'packed' : 'balanced',
    interests: interests.length ? interests : ['coffee', 'culture'],
    ...(text.match(/\d{4}-\d{2}-\d{2}/) ? { startDate: text.match(/\d{4}-\d{2}-\d{2}/)[0] } : {}),
  };
}

export const GUIDED_HELP = 'This guided demo supports Kyoto and Seattle. Try “Plan a relaxed two-day Kyoto trip with coffee and culture”, “Check weather”, “Move day 1 thirty minutes later”, “Show our memories”, or use the buttons. It cannot research bookings, transport, or other destinations.';
