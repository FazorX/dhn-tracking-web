const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

// 🚀 TĂNG DUNG LƯỢNG FILE TẢI LÊN THÀNH 400MB
const MAX_SIZE = 400 * 1024 * 1024; // 400 MB
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE } 
});

app.use(cors());
app.use(express.json({ limit: '400mb' }));
app.use(express.urlencoded({ limit: '400mb', extended: true }));
app.use(express.static('public'));

// ⚠️ CẤU HÌNH SUPABASE
const SUPABASE_URL = 'https://prowunbttjdcqeqmprxr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb3d1bmJ0dGpkY3FlcW1wcnhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNzk0MDUsImV4cCI6MjEwMDk1NTQwNX0.8BaqqhAQZ92T4VlMyrI6baLa6nH2bIuiW9eOUGCbaj4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// API 1: RASPBERRY PI TẢI VIDEO LÊN (TỐI ĐA 400MB)
// ==========================================
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File quá lớn! Dung lượng tối đa là 400MB.' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { qr_code, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const cleanQr = qr_code ? qr_code.trim() : 'UNKNOWN';
    const uniqueSuffix = Math.random().toString(36).substring(2, 7);
    const fileName = `${cleanQr}_${Date.now()}_${uniqueSuffix}.mp4`;

    // 1. Upload file vào Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('packaging-videos')
      .upload(fileName, file.buffer, {
        contentType: 'video/mp4',
        upsert: false
      });

    if (uploadErr) throw uploadErr;

    // 2. Lấy đường dẫn Public URL
    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(fileName);

    const videoUrl = urlData.publicUrl;

    // 3. Ghi dữ liệu vào Database
    const { error: dbErr } = await supabase
      .from('videos')
      .insert([{ qr_code: cleanQr, video_url: videoUrl }]);

    if (dbErr) console.error('Lỗi chèn Database:', dbErr);

    console.log(`[SUCCESS] Đã upload video ${fileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    return res.json({ success: true, url: videoUrl });

  } catch (err) {
    console.error('[UPLOAD ERROR]:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 2: LẤY DANH SÁCH VIDEO
// ==========================================
app.get('/api/videos', async (req, res) => {
  try {
    const { data: dbVideos, error: dbErr } = await supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!dbErr && dbVideos && dbVideos.length > 0) {
      const formattedList = dbVideos.map(item => ({
        name: item.video_url.split('/').pop(),
        filename: item.video_url.split('/').pop(),
        qr_code: item.qr_code,
        video_url: item.video_url,
        created_at: item.created_at
      }));
      return res.json(formattedList);
    }

    const { data: files, error: storageErr } = await supabase.storage
      .from('packaging-videos')
      .list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });

    if (storageErr) throw storageErr;

    const validFiles = (files || []).filter(f => f.name && !f.name.startsWith('.'));
    const videoList = validFiles.map(file => {
      const { data: urlData } = supabase.storage
        .from('packaging-videos')
        .getPublicUrl(file.name);

      return {
        name: file.name,
        filename: file.name,
        qr_code: file.name.split('_')[0],
        video_url: urlData.publicUrl,
        created_at: file.created_at
      };
    });

    return res.json(videoList);
  } catch (err) {
    console.error('List Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 3: TRA CỨU VIDEO THEO MÃ QR
// ==========================================
app.get('/api/search/:qr_code', async (req, res) => {
  try {
    const qr = req.params.qr_code.trim();
    const { data: dbVideos, error } = await supabase
      .from('videos')
      .select('*')
      .ilike('qr_code', `%${qr}%`)
      .order('created_at', { ascending: false });

    if (!error && dbVideos && dbVideos.length > 0) {
      const result = dbVideos.map(item => ({
        name: item.video_url.split('/').pop(),
        filename: item.video_url.split('/').pop(),
        qr_code: item.qr_code,
        video_url: item.video_url,
        created_at: item.created_at
      }));
      return res.json(result);
    }

    return res.status(404).json({ error: 'Không tìm thấy video' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 4: XOÁ 1 VIDEO
// ==========================================
app.delete('/api/videos/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    let fileName = decodeURIComponent(identifier).split('/').pop();
    await supabase.storage.from('packaging-videos').remove([fileName]);
    await supabase.from('videos').delete().ilike('video_url', `%${fileName}%`);
    res.json({ success: true, message: 'Đã xoá thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 5: XOÁ NHIỀU VIDEO
// ==========================================
app.post('/api/videos/delete-multiple', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs' });
    const filePaths = ids.map(i => decodeURIComponent(i.split('/').pop()));
    await supabase.storage.from('packaging-videos').remove(filePaths);
    for (const f of filePaths) {
      await supabase.from('videos').delete().ilike('video_url', `%${f}%`);
    }
    res.json({ success: true, message: `Đã xóa ${filePaths.length} video!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ⏱️ NÂNG TIMEOUT LÊN 10 PHÚT ĐỂ TẢI FILE NẶNG BẰNG RASPBERRY PI KHÔNG BỊ DISCONNECT
server.timeout = 10 * 60 * 1000;
