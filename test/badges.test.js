const test = require('node:test');
const assert = require('node:assert');
const { parseBadgesPage, NotLoggedInError } = require('../src/badges');

// 按真实徽章页结构构造（本人登录视角才会显示掉落数）
function row({ appid, name, play, drops }) {
  const href = appid ? `https://steamcommunity.com/profiles/1/gamecards/${appid}/` : 'https://steamcommunity.com/profiles/1/badges/2';
  return `
  <div class="badge_row is_link">
    <a class="badge_row_overlay" href="${href}"></a>
    <div class="badge_row_inner"><div class="badge_title_row">
      <div class="badge_title_stats"><div class="badge_title_stats_content">
        <div class="badge_title_stats_playtime">${play}</div>
        <div class="badge_title_stats_drops">${drops}</div>
      </div></div>
      <div class="badge_title">
        ${name} &nbsp;<span class="badge_view_details">View details</span>
      </div>
    </div></div>
  </div>`;
}

const page = (rows, pager = '') => `<script>g_steamID = "76561190000000000";</script>${rows.join('')}${pager}`;

test('解析可掉卡游戏、时长和掉落数', () => {
  const html = page([
    row({ appid: 570, name: 'Dota 2', play: '1,234.5 hrs on record', drops: '<span class="progress_info_bold">3 card drops remaining</span>' }),
    row({ appid: 440, name: 'Team Fortress 2', play: '&nbsp;', drops: '<span class="progress_info_bold">1 card drop remaining</span>' }),
    row({ appid: 730, name: 'Done Game', play: '5.0 hrs on record', drops: '<span class="progress_info_bold">No card drops remaining</span>' }),
    row({ appid: null, name: 'Community Ambassador', play: '', drops: '' }),
  ], '<div class="pageLinks"><a class="pagelink">2</a><a class="pagelink">3</a><a class="pagebtn">&gt;</a></div>');

  const { games, totalPages } = parseBadgesPage(html);
  assert.deepStrictEqual(games, [
    { appid: 570, name: 'Dota 2', hours: 1234.5, drops: 3 },
    { appid: 440, name: 'Team Fortress 2', hours: 0, drops: 1 },
  ]);
  assert.strictEqual(totalPages, 3);
});

test('未登录页面抛出 NotLoggedInError', () => {
  assert.throws(() => parseBadgesPage('<script>g_steamID = false;</script>'), NotLoggedInError);
});
