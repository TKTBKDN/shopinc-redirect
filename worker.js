/**
 * Cloudflare Workers - Ultra-Fast Edge Redirect & Meta Optimizer (No API)
 * 
 * Flow:
 * - Non-Facebook users -> Instant 301 redirect directly at Edge (< 5ms, 0 API overhead)
 * - Facebook crawlers  -> Serve cached meta from KV or scrape directly from destination URL
 * 
 * Features:
 * - No external API dependencies (super fast, 100% independent)
 * - KV caching for meta tags (24h TTL)
 * - Edge-level redirects (sub-millisecond execution)
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

// Tự động tạo DOMAIN_MAP từ DOMAIN_GROUPS
const DOMAIN_MAP = {};
Object.entries(DOMAIN_GROUPS).forEach(([target, domains]) => {
  domains.forEach(domain => DOMAIN_MAP[domain] = target);
});

// Domain mặc định nếu không tìm thấy trong map
const DEFAULT_REDIRECT = 'https://topnewsus.feji.io';

// ============= CONFIGURATION =============
const CONFIG = {
  // Scrape timeout in milliseconds
  SCRAPE_TIMEOUT: 3000,

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

    const targetDomain = DOMAIN_MAP[url.hostname] || DEFAULT_REDIRECT;
    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();

    // ===== FAST PATH: Người dùng thật -> Chuyển hướng 301 tức thì tại Edge (< 5ms, KHÔNG gọi bất kỳ API nào) =====
    if (!isFacebookCrawler(userAgent)) {
      return Response.redirect(
        `${targetDomain}${url.pathname}${url.search}`,
        301
      );
    }

    // ===== FACEBOOK CRAWLER PATH: Chỉ phục vụ thẻ meta xem trước cho bot Facebook =====
    const targetUrl = `${targetDomain}${url.pathname}${url.search}`;
    const cacheKey = `meta:${url.hostname}:${pathname}`;

    // 1. Kiểm tra KV cache trước (siêu tốc < 5ms)
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

    // 2. Cào meta trực tiếp từ trang web đích (không phụ thuộc API bên ngoài)
    const metaData = await scrapeMetaData(targetUrl);

    // 3. Lưu vào KV cache cho các lần quét sau
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
};

// ============= HELPER FUNCTIONS =============

/**
 * Kiểm tra xem User-Agent có phải là bot của Facebook hay không
 */
function isFacebookCrawler(userAgent) {
  return userAgent.includes('facebook') ||
    userAgent.includes('facebookexternalhit') ||
    userAgent.includes('facebot');
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
 * Tạo HTML phản hồi với các thẻ Open Graph meta cho bot Facebook
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
 * Escape HTML special characters để chống lỗi hiển thị và XSS
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
