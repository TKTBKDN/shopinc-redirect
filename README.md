# 🚀 Cloudflare Workers - Facebook Redirect Optimizer

## Tính năng
- ⚡ **Redirect siêu nhanh**: Non-Facebook users được redirect ngay tại Edge (< 10ms)
- 📦 **KV Caching**: Meta data được cache, giảm 90%+ API calls
- 🔄 **Fallback tự động**: API timeout → Backup JSON
- 💰 **Chi phí thấp**: 100,000 requests/ngày MIỄN PHÍ

## Cách hoạt động

```
User Request
     │
     ▼
┌─────────────────────────┐
│ Check User-Agent        │
│ Is Facebook Crawler?    │
└─────────────────────────┘
     │           │
     │ NO        │ YES
     ▼           ▼
┌─────────┐  ┌──────────────────┐
│ 301     │  │ Check KV Cache   │
│ Redirect│  └──────────────────┘
│ (Fast)  │       │         │
└─────────┘       │ HIT     │ MISS
                  ▼         ▼
             ┌─────────┐ ┌──────────┐
             │ Return  │ │ Fetch    │
             │ Cached  │ │ API      │
             │ Meta    │ └──────────┘
             └─────────┘      │
                              ▼
                         ┌──────────┐
                         │ Save to  │
                         │ KV Cache │
                         └──────────┘
```

## Deploy qua GitHub (Đơn giản nhất)

### Bước 1: Push code lên GitHub
```bash
git add cloudflare-worker/
git commit -m "Add Cloudflare Worker"
git push
```

### Bước 2: Kết nối với Cloudflare
1. Vào **Cloudflare Dashboard** → **Workers & Pages**
2. Click **Create** → **Import a Worker**
3. Chọn **Connect to Git** → Chọn repo GitHub
4. Cấu hình:
   - **Project name**: `topnews-redirect`
   - **Production branch**: `main`
   - **Root directory**: `cloudflare-worker`
   - **Build command**: (bỏ trống)
   - **Build output**: (bỏ trống)
5. Click **Deploy**

### Bước 3: Tạo KV Namespace
1. **Workers & Pages** → **KV** → **Create a namespace**
2. Tên: `META_CACHE` → Save
3. Copy **Namespace ID**

### Bước 4: Bind KV vào Worker
1. **Workers & Pages** → Click **topnews-redirect**
2. **Settings** → **Variables and Secrets**
3. Scroll xuống **KV Namespace Bindings** → **Add binding**
4. Variable name: `META_CACHE`
5. Chọn namespace vừa tạo → **Save**
6. Click **Deployments** → **Retry deployment**

### Bước 5: Thêm Custom Domain (tùy chọn)
1. Tab **Settings** → **Domains & Routes**
2. **Add** → **Custom domain**
3. Nhập domain của bạn

---

## So sánh với Next.js/Vercel

| Tiêu chí | Next.js (Vercel) | Cloudflare Workers |
|----------|------------------|-------------------|
| Cold start | 100-500ms | < 5ms |
| Redirect latency | 50-100ms | < 10ms |
| Free tier | 100GB bandwidth | 100k requests/day |
| Caching | ISR phức tạp | KV đơn giản |
| Chi phí scale | $20/mo+ | Pay as you go |

## Chi phí ước tính

### Free Tier (đủ cho hầu hết projects)
- 100,000 requests/ngày
- 10ms CPU time/request
- 1GB KV storage

### Nếu vượt Free Tier
- Workers: $0.50 / triệu requests
- KV: $0.50 / triệu reads

**Ví dụ**: 5 triệu requests/tháng ≈ $2.50

## Troubleshooting

### KV không cache
- Đảm bảo đã tạo KV namespace trong Dashboard
- Đảm bảo đã bind KV vào Worker (Settings → Variables)
- Variable name phải là `META_CACHE`

### Redirect loop
- Kiểm tra REDIRECT_DOMAIN trong worker.js không trỏ về chính Worker

### Xem logs
- Cloudflare Dashboard → Workers → topnews-redirect → Logs
