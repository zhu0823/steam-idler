const cheerio = require('cheerio');

class NotLoggedInError extends Error {}

function parseNumber(text) {
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * 解析徽章页（需 l=english），返回仍有卡片可掉的游戏。
 * @returns {{ games: {appid:number,name:string,hours:number,drops:number}[], totalPages:number }}
 */
function parseBadgesPage(html) {
  const $ = cheerio.load(html);

  if (/g_steamID\s*=\s*false/.test(html)) throw new NotLoggedInError('网页会话未登录');

  const games = [];
  $('.badge_row').each((_, row) => {
    const $row = $(row);
    const href = $row.find('.badge_row_overlay').attr('href') || '';
    const idMatch = href.match(/\/gamecards\/(\d+)/);
    if (!idMatch) return; // 社区徽章等非游戏徽章

    const dropsText = $row.find('.badge_title_stats_drops .progress_info_bold').text().trim();
    if (!/card drops? remaining/i.test(dropsText)) return;
    const drops = parseNumber(dropsText);
    if (drops <= 0) return;

    const playText = $row.find('.badge_title_stats_playtime').text();
    const hours = /hrs? on record/i.test(playText) ? parseNumber(playText) : 0;

    const $title = $row.find('.badge_title').clone();
    $title.find('.badge_view_details').remove();
    const name = $title.text().replace(/\s+/g, ' ').trim();

    games.push({ appid: Number(idMatch[1]), name, hours, drops });
  });

  let totalPages = 1;
  $('.pagelink').each((_, a) => {
    const n = Number($(a).text().trim());
    if (Number.isInteger(n) && n > totalPages) totalPages = n;
  });

  return { games, totalPages };
}

async function fetchPage(steamID, cookies, page) {
  const url = `https://steamcommunity.com/profiles/${steamID}/badges/?l=english&p=${page}`;
  const res = await fetch(url, {
    headers: { Cookie: cookies.join('; '), 'User-Agent': 'Mozilla/5.0 steam-idler' },
    signal: AbortSignal.timeout(30_000),
  });
  if (/\/login\//.test(res.url)) throw new NotLoggedInError('网页会话已过期');
  if (!res.ok) throw new Error(`徽章页请求失败：HTTP ${res.status}`);
  return res.text();
}

async function fetchAllDroppable(steamID, cookies) {
  const first = parseBadgesPage(await fetchPage(steamID, cookies, 1));
  const games = [...first.games];
  for (let p = 2; p <= first.totalPages; p++) {
    games.push(...parseBadgesPage(await fetchPage(steamID, cookies, p)).games);
  }
  return games;
}

module.exports = { parseBadgesPage, fetchAllDroppable, NotLoggedInError };
