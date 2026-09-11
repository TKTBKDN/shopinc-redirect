/**
 * Cloudflare Workers - Facebook Redirect Optimizer
 * 
 * Flow:
 * - Non-Facebook users -> Instant 301 redirect (no API calls)
 * - Facebook crawlers -> Serve cached meta tags from KV, fetch from API, or scrape directly from target site
 * 
 * Features:
 * - KV caching to minimize API calls (saves costs)
 * - Direct meta scraping for sites without API (e.g. ecommerce, print on demand)
 * - 3-second API timeout with fallback to backup JSON
 * - Cache meta data for 24 hours
 * - Edge-level redirects (ultra fast)
 */

// ============= DOMAIN GROUPS =============
// Cấu trúc: target -> [danh sách domain nguồn]
// Để thêm domain mới: thêm vào mảng tương ứng
// Để đổi target: sửa key của object

const DOMAIN_GROUPS = {
  // Nhóm 1
  'https://newsustk.cafex.biz': ['newspaperusa24h.com'],
  'https://trendlnk.com': ['toptrendlnk.com'],

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

  // Nhóm 8
  'https://topnews.daily24.blog': ['basslinehub.org', 'tuneblast.net', 'hittracks.org', 'vibetunes.net', 'tracklovers.org'],

  // Nhóm 9 (đang dùng feji.io)
  'https://rapus.feji.io': ['lotteus.org', 'alocus.org', 'hellious.org', 'metizus.org', 'rapperus.com'],

  // Nhóm 10
  'https://dailynewsus.daily24.blog': ['lyriczonenews.com', 'beatvibes.net', 'tuneflow.net', 'beatvibes.org', 'tuneflow.org'],
};

// Danh sách target domain KHÔNG dùng News API mà sẽ cào (scrape) thẻ meta trực tiếp từ web đích
const DIRECT_SCRAPE_TARGETS = [
  'https://trendlnk.com',
];

// Tự động tạo DOMAIN_MAP từ DOMAIN_GROUPS
const DOMAIN_MAP = {};
Object.entries(DOMAIN_GROUPS).forEach(([target, domains]) => {
  domains.forEach(domain => DOMAIN_MAP[domain] = target);
});

// Domain mặc định nếu không tìm thấy trong map
const DEFAULT_REDIRECT = 'https://topnewsus.feji.io';

// ============= CONFIGURATION =============
const CONFIG = {
  // Primary API endpoint (dành cho các trang tin tức)
  API_URL: 'https://apinewspaper.vbonews.com/News/news-detailbasic',

  // Backup JSON CDN (R2 hoặc CDN khác)
  BACKUP_URL: 'https://file.lifenews247.com/tktnews/backup',

  // API timeout in milliseconds
  API_TIMEOUT: 3000,

  // Scrape timeout in milliseconds
  SCRAPE_TIMEOUT: 4000,

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
      return new Response(null, { status: 204 });
    }

    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
    const targetDomain = DOMAIN_MAP[url.hostname] || DEFAULT_REDIRECT;

    // ===== FAST PATH: Non-Facebook users get instant redirect =====
    if (!isFacebookCrawler(userAgent)) {
      return Response.redirect(
        `${targetDomain}${url.pathname}${url.search}`,
        301
      );
    }

    // ===== FACEBOOK CRAWLER PATH: Serve meta tags =====

    // Trường hợp 1: Domain nằm trong danh sách cào trực tiếp (như trendlnk.com không có API)
    const isDirectScrape = DIRECT_SCRAPE_TARGETS.includes(targetDomain);
    if (isDirectScrape) {
      const targetUrl = `${targetDomain}${url.pathname}${url.search}`;
      const cacheKey = `meta:scrape:${url.hostname}:${pathname}`;

      // 1. Kiểm tra KV cache
      if (env.META_CACHE) {
        try {
          const cached = await env.META_CACHE.get(cacheKey, 'json');
          if (cached) {
            return createMetaResponse(cached.name, cached.avatarLink, cached.description);
          }
        } catch (e) {
          console.log('KV cache miss or error');
        }
      }

      // 2. Cào meta trực tiếp từ trang web đích
      const metaData = await scrapeMetaData(targetUrl);

      // 3. Lưu vào KV cache
      if (env.META_CACHE && (metaData.name || metaData.avatarLink)) {
        try {
          await env.META_CACHE.put(
            cacheKey,
            JSON.stringify(metaData),
            { expirationTtl: CONFIG.CACHE_TTL }
          );
        } catch (e) {
          console.log('Failed to cache scraped meta:', e);
        }
      }

      return createMetaResponse(metaData.name, metaData.avatarLink, metaData.description);
    }

    // Trường hợp 2: Các trang tin tức thông thường
    // Handle homepage
    if (pathname === '/' || pathname === '') {
      return createMetaResponse('Trang chủ', '');
    }

    // Extract slug and ID from path (format: /p-title-123)
    const slug = pathname.slice(1); // Remove leading /
    const id = extractId(slug);

    if (!id) {
      // Fallback: Thử cào trực tiếp từ URL đích thay vì báo Không tìm thấy
      const targetUrl = `${targetDomain}${url.pathname}${url.search}`;
      const metaData = await scrapeMetaData(targetUrl);
      if (metaData.name || metaData.avatarLink) {
        return createMetaResponse(metaData.name, metaData.avatarLink, metaData.description);
      }
      return createMetaResponse('Không tìm thấy', '');
    }

    // Try to get from KV cache first (fastest)
    let metaData = null;

    if (env.META_CACHE) {
      try {
        const cached = await env.META_CACHE.get(`meta:${id}`, 'json');
        if (cached) {
          return createMetaResponse(cached.name, cached.avatarLink, cached.description);
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

    return createMetaResponse(metaData.name, metaData.avatarLink, metaData.description);
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

  const lastDash = slug.lastIndexOf('-');
  const id = lastDash === -1 ? slug : slug.slice(lastDash + 1);

  return /^[a-zA-Z0-9]{12}$/.test(id) ? id : null;
}

/**
 * Cào dữ liệu meta (og:title, og:image, og:description) trực tiếp từ URL web đích
 */
async function scrapeMetaData(targetUrl) {
  console.log(`[SCRAPE REQUEST] Fetching: ${targetUrl}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCRAPE_TIMEOUT);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`[SCRAPE ERROR] Status ${response.status} for ${targetUrl}`);
      return { name: '', avatarLink: '', description: '' };
    }

    const html = await response.text();
    return extractMetaFromHtml(html);
  } catch (e) {
    console.log(`[SCRAPE FAILED] ${targetUrl}: ${e.message}`);
    return { name: '', avatarLink: '', description: '' };
  }
}

/**
 * Trích xuất title, image, description từ chuỗi HTML
 */
function extractMetaFromHtml(html) {
  if (!html) return { name: '', avatarLink: '', description: '' };

  const getTag = (prop) => {
    const regex1 = new RegExp('<meta[^>]*property=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const m1 = html.match(regex1);
    if (m1 && m1[1]) return m1[1];

    const regex2 = new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*property=["\']' + prop + '["\']', 'i');
    const m2 = html.match(regex2);
    if (m2 && m2[1]) return m2[1];

    const regex3 = new RegExp('<meta[^>]*name=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const m3 = html.match(regex3);
    if (m3 && m3[1]) return m3[1];

    const regex4 = new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']' + prop + '["\']', 'i');
    const m4 = html.match(regex4);
    if (m4 && m4[1]) return m4[1];

    return '';
  };

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = getTag('og:title') || getTag('twitter:title') || (titleMatch ? titleMatch[1] : '');
  const image = getTag('og:image') || getTag('twitter:image');
  const description = getTag('og:description') || getTag('description') || getTag('twitter:description');

  return {
    name: decodeHtmlEntities(title.trim()),
    avatarLink: image.trim(),
    description: decodeHtmlEntities(description.trim())
  };
}

/**
 * Giải mã các ký tự HTML entity cơ bản
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“');
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
          avatarLink: data.avatarLink || '',
          description: data.summary || data.name.trim()
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
          avatarLink: backup.avatarLink || '',
          description: backup.summary || backup.name.trim()
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
  return { name: '', avatarLink: '', description: '' };
}

/**
 * Create HTML response with Open Graph meta tags
 */
function createMetaResponse(name, avatarLink, description = '') {
  const safeName = escapeHtml(name);
  const safeImage = escapeHtml(avatarLink);
  const safeDesc = escapeHtml(description || name);

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
  <meta property="og:title" content="${safeName}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeName}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImage}" />
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
