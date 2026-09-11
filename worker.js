/**
 * Cloudflare Workers - Facebook Redirect Optimizer
 * 
 * Flow:
 * - Non-Facebook users -> Instant 301 redirect (no API calls)
 * - Facebook crawlers -> Serve cached meta tags from KV or fetch from API
 * 
 * Features:
 * - KV caching to minimize API calls (saves costs)
 * - 3-second API timeout with fallback to backup JSON
 * - Cache meta data for 24 hours
 * - Edge-level redirects (ultra fast)
 */

// ============= DOMAIN GROUPS =============
// Chỉ cần sửa domain đích 1 lần cho mỗi nhóm
const GROUP_1_TARGET = 'https://hotnews.daily24.blog';
// Cấu trúc: target -> [danh sách domain nguồn]
// Để thêm domain mới: thêm vào mảng tương ứng
// Để đổi target: sửa key của object

const DOMAIN_GROUPS = {
  // Nhóm 1
  'https://newsustk.cafex.biz': ['newspaperusa24h.com'],
  'https://trendlnk.com': ['toptrendlnk.com'],
  

  // Nhóm 2
 // 'https://loveustk.cafex.biz': ['todaynow24h.com'],
   // Nhóm 2
  'https://lovetk.cfx.bz': ['todaynow24h.com'],

  // Nhóm 3
  'https://vtus.daily24.blog': ['melodyhubs.com', 'groovenations.com', 'songverse.net', 'echobeatz.com', 'noteplay.xyz'],

  // Nhóm 4
  'https://local.daily24.blog': ['lyriczone.net', 'trackloversnews.com', 'basslinehubnews.com', 'songversenews.com', 'vibetunes.org'],

  // Nhóm 5
  'https://hoaus.daily24.blog': ['hoausnews.com', 'lyriczone.org', 'beatstation.net', 'basslinehub.net', 'soundloversnews.com'],

  // Nhóm 6
  'https://anhus.daily24.blog': ['hittracks.net', 'tuneblastnews.com', 'melodywave.org', 'melodywavenews.com', 'tuneblast.org'],

  // Nhóm 7 (đang dùng feji.io)
  'https://nflnews.feji.io': ['echotunes.org', 'grooveplanet.org', 'rhythmworld.org', 'beatstation.org', 'vocalvibes.org'],
  // 'https://nflnews.daily24.blog': [],  // backup - uncomment nếu cần

  // Nhóm 8
  'https://topnews.daily24.blog': ['basslinehub.org', 'tuneblast.net', 'hittracks.org', 'vibetunes.net', 'tracklovers.org'],

  // Nhóm 9 (đang dùng feji.io)
  'https://rapus.feji.io': ['lotteus.org', 'alocus.org', 'hellious.org', 'metizus.org', 'rapperus.com'],
  // 'https://rapus.daily24.blog': [],  // backup - uncomment nếu cần

  // Nhóm 10
  //'https://dailynewsus.fei.io': ['lyriczone.us', 'beatvibes.net', 'tuneflow.net', 'beatvibes.org', 'tuneflow.org'],
  'https://dailynewsus.daily24.blog': ['lyriczonenews.com', 'beatvibes.net', 'tuneflow.net', 'beatvibes.org', 'tuneflow.org'],
};

// Tự động tạo DOMAIN_MAP từ DOMAIN_GROUPS
const DOMAIN_MAP = {};
Object.entries(DOMAIN_GROUPS).forEach(([target, domains]) => {
  domains.forEach(domain => DOMAIN_MAP[domain] = target);
});

// Domain mặc định nếu không tìm thấy trong map
const DEFAULT_REDIRECT = 'https://topnewsus.feji.io';

// ============= CONFIGURATION =============
const CONFIG = {
  // Primary API endpoint
  API_URL: 'https://apinewspaper.vbonews.com/News/news-detailbasic',

  // Backup JSON CDN (R2 hoặc CDN khác)
  BACKUP_URL: 'https://file.lifenews247.com/tktnews/backup',

  // API timeout in milliseconds
  API_TIMEOUT: 3000,

  // Cache TTL in seconds (24 hours)
  CACHE_TTL: 86400,
};

// ============= STATIC ASSETS =============
// Danh sách các path static cần bỏ qua (không redirect, không xử lý)
const STATIC_PATHS = ['/favicon.ico', '/robots.txt', '/sitemap.xml', '/ads.txt', '/app-ads.txt'];

// ============= MAIN HANDLER =============
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    // ===== STATIC ASSETS: Return empty response =====
    if (STATIC_PATHS.includes(pathname)) {
      // Trả về 204 No Content cho các file static không tồn tại
      return new Response(null, { status: 204 });
    }

    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();

    // ===== FAST PATH: Non-Facebook users get instant redirect =====
    if (!isFacebookCrawler(userAgent)) {
      // Lấy domain đích từ DOMAIN_MAP dựa trên hostname đầu vào
      const targetDomain = DOMAIN_MAP[url.hostname] || DEFAULT_REDIRECT;
      return Response.redirect(
        `${targetDomain}${url.pathname}${url.search}`,
        301
      );
    }

    // ===== FACEBOOK CRAWLER PATH: Serve meta tags =====

    // Handle homepage
    if (pathname === '/' || pathname === '') {
      return createMetaResponse('Trang chủ', '');
    }

    // Extract slug and ID from path (format: /p-title-123)
    const slug = pathname.slice(1); // Remove leading /
    const id = extractId(slug);

    if (!id) {
      return createMetaResponse('Không tìm thấy', '');
    }

    // Try to get from KV cache first (fastest)
    let metaData = null;

    if (env.META_CACHE) {
      try {
        const cached = await env.META_CACHE.get(`meta:${id}`, 'json');
        if (cached) {
          return createMetaResponse(cached.name, cached.avatarLink);
        }
      } catch (e) {
        console.log('KV cache miss or error');
      }
    }

    // Not in cache, fetch from API
    metaData = await fetchMetaData(id, userAgent);

    // Save to KV cache for next time
    if (env.META_CACHE && metaData.name) {
      try {
        await env.META_CACHE.put(
          `meta:${id}`,
          JSON.stringify(metaData),
          { expirationTtl: CONFIG.CACHE_TTL }
        );
      } catch (e) {
        console.log('Failed to cache:', e);
      }
    }

    return createMetaResponse(metaData.name, metaData.avatarLink);
  }
};

// ============= HELPER FUNCTIONS =============

/**
 * Check if user agent is Facebook crawler
 */
function isFacebookCrawler(userAgent) {
  return userAgent.includes('facebook') ||
    userAgent.includes('facebookexternalhit') ||
    userAgent.includes('facebot');
}

/**
 * Extract ID from slug
 * Supports: /abc-xyz-03036380f8cd or /03036380f8cd
 * ID must be exactly 12 alphanumeric characters
 */
function extractId(slug) {
  if (!slug) return null;

  // Get the last part after dash, or the whole slug if no dash
  const lastDash = slug.lastIndexOf('-');
  const id = lastDash === -1 ? slug : slug.slice(lastDash + 1);

  // Validate ID is exactly 12 alphanumeric characters
  return /^[a-zA-Z0-9]{12}$/.test(id) ? id : null;
}

/**
 * Fetch meta data from API with fallback to backup JSON
 */
async function fetchMetaData(id, userAgent = '') {
  console.log(`[REQUEST] ID: ${id}, UserAgent: ${userAgent}`);

  // 1. Try primary API with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

    const apiUrl = `${CONFIG.API_URL}?id=${id}`;
    console.log(`[API] Fetching: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      }
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const json = await response.json();
      const data = json.data;

      if (data?.name?.trim()) {
        console.log(`[API SUCCESS] ID: ${id}, Name: ${data.name}`);
        return {
          name: data.name.trim(),
          avatarLink: data.avatarLink || ''
        };
      } else {
        console.log(`[API WARNING] ID: ${id} - No valid name in response`);
      }
    } else {
      console.log(`[API ERROR] ID: ${id} - HTTP ${response.status}`);
    }
  } catch (e) {
    console.log(`[API FAILED] ID: ${id} - ${e.message}`);
  }

  // 2. Fallback to backup JSON from CDN
  try {
    const backupUrl = `${CONFIG.BACKUP_URL}/${id}.json`;
    console.log(`[BACKUP] Fetching: ${backupUrl}`);

    const backupResponse = await fetch(backupUrl);

    if (backupResponse.ok) {
      const backup = await backupResponse.json();

      if (backup?.name?.trim()) {
        console.log(`[BACKUP SUCCESS] ID: ${id}, Name: ${backup.name}`);
        return {
          name: backup.name.trim(),
          avatarLink: backup.avatarLink || ''
        };
      } else {
        console.log(`[BACKUP WARNING] ID: ${id} - No valid name in backup`);
      }
    } else {
      console.log(`[BACKUP ERROR] ID: ${id} - HTTP ${backupResponse.status}`);
    }
  } catch (e) {
    console.log(`[BACKUP FAILED] ID: ${id} - ${e.message}`);
  }

  // 3. Both failed, return empty
  console.log(`[FINAL] ID: ${id} - Both API and Backup failed, returning empty`);
  return { name: '', avatarLink: '' };
}

/**
 * Create HTML response with Open Graph meta tags
 */
function createMetaResponse(name, avatarLink) {
  const safeName = escapeHtml(name);
  const safeImage = escapeHtml(avatarLink);

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
  <meta property="og:title" content="${safeName}" />
  <meta property="og:description" content="${safeName}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:type" content="article" />
  <meta property="fb:app_id" content="" />
</head>
<body></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Robots-Tag': 'noindex, nofollow',
    }
  });
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
