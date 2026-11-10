// Games with a page on tracker.gg, as listed on its home page.
// `match` links a game installed on this PC to its stats page.
const on = (slug) => `https://tracker.gg/${slug}`;

export const STATS_GAMES = [
  { name: 'Rainbow Six Siege', url: on('r6siege'), match: /rainbow six siege/i },
  { name: 'Counter-Strike 2', url: on('cs2'), match: /counter-strike 2/i },
  { name: 'Fortnite', url: on('fortnite'), match: /fortnite/i },
  { name: 'Roblox', url: on('roblox'), match: /roblox/i },
  { name: 'Valorant', url: on('valorant'), match: /valorant/i },
  { name: 'Apex Legends', url: 'https://apex.tracker.gg/', match: /apex legends/i },
  { name: 'Marvel Rivals', url: on('marvel-rivals'), match: /marvel rivals/i },
  { name: 'League of Legends', url: on('lol'), match: /league of legends/i },
  { name: 'Rocket League', url: 'https://rocketleague.tracker.network/', match: /rocket league/i },
  { name: 'Overwatch', url: on('overwatch'), match: /overwatch/i },
  { name: 'Deadlock', url: on('deadlock'), match: /deadlock/i },
  { name: 'Battlefield 6', url: on('bf6'), match: /battlefield.*6/i },
  { name: 'Battlefield 2042', url: on('bf2042'), match: /battlefield.*2042/i },
  { name: 'Battlefield V', url: on('bfv'), match: /battlefield.*v$/i },
  { name: 'Battlefield 1', url: on('bf1'), match: /battlefield.*1$/i },
  { name: 'Call of Duty', url: on('call-of-duty'), match: /call of duty(?!.*warzone)/i },
  { name: 'Warzone', url: on('warzone'), match: /warzone/i },
  { name: 'PUBG', url: on('pubg'), match: /pubg/i },
  { name: 'The Division 2', url: on('division-2'), match: /division 2/i },
  { name: 'For Honor', url: on('for-honor'), match: /for honor/i },
  { name: 'Splitgate', url: on('splitgate'), match: /splitgate/i },
  { name: 'SMITE 2', url: on('smite2'), match: /smite 2/i },
  { name: 'Teamfight Tactics', url: on('tft'), match: /teamfight tactics/i },
  { name: 'Brawlhalla', url: on('brawlhalla'), match: /brawlhalla/i },
  { name: 'Bloodhunt', url: on('bloodhunt'), match: /bloodhunt/i },
  { name: 'Off the Grid', url: on('off-the-grid'), match: /off the grid/i },
  { name: 'Rainbow Six Mobile', url: on('r6mobile'), match: /rainbow six mobile/i },
];

export const statsFor = (gameName) => STATS_GAMES.find((g) => g.match.test(gameName)) || null;
