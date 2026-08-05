const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ⚠️ CẤU HÌNH SUPABASE
const SUPABASE_URL = 'https://prowunbttjdcqeqmprxr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb3d1bmJ0dGpkY3FlcW1wcnhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNzk0MDUsImV4cCI6MjEwMDk1NTQwNX0.8BaqqhAQZ92T4VlMyrI6baLa6nH2bIuiW9eOUGCbaj4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// API 1: RASPBERRY PI TẢI VIDEO LÊN (STORAGE + DATABASE)
// ==========================================
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { qr_code, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const cleanQr = qr_code ? qr_code.trim() : 'UNKNOWN';
    const fileName = `${cleanQr}_${Date.now()}.mp4`;

    // 1. Upload file vào Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('packaging-videos')
      .upload(fileName, file.buffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    // 2. Lấy đường dẫn Public URL
    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(fileName);

    const videoUrl = urlData.publicUrl;

    // 3. Ghi dữ liệu vào Bảng public.videos
    const { error: dbErr } = await supabase
      .from('videos')
      .insert([{ qr_code: cleanQr, video_url: videoUrl }]);

    if (dbErr) console.error('Lỗi khi chèn dữ liệu vào Database:', dbErr);

    return res.json({ success: true, url: videoUrl });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 2: LẤY DANH SÁCH TOÀN BỘ VIDEO (HỖ TRỢ ĐA DẠNG DỮ LIỆU)
// ==========================================
app.get('/api/videos', async (req, res) => {
  try {
    // Tải danh sách file trực tiếp từ Storage
    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list('', { limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) throw error;

    const validFiles = (files || []).filter(f => f.name && !f.name.startsWith('.'));

    const videoList = validFiles.map(file => {
      const { data: urlData } = supabase.storage
        .from('packaging-videos')
        .getPublicUrl(file.name);

      const qrCode = file.name.split('_')[0];

      return {
        name: file.name,
        filename: file.name,
        qr_code: qrCode,
        video_url: urlData.publicUrl,
        created_at: file.created_at
      };
    });

    // Trả về cả mảng trực tiếp lẫn object chứa key 'videos' để tương thích 100% với giao diện
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

    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list('', { limit: 200, offset: 0 });

    if (error) throw error;

    const matchedFiles = (files || []).filter(f => f.name && f.name.toLowerCase().includes(qr.toLowerCase()));

    if (matchedFiles.length === 0) {
      return res.status(404).json({ error: `Không tìm thấy video nào cho mã đơn: ${qr}` });
    }

    matchedFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const resultList = matchedFiles.map(file => {
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

    return res.json(resultList);
  } catch (err) {
    console.error('Search Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 4: XOÁ 1 VIDEO (Storage + Database)
// ==========================================
app.delete('/api/videos/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    let fileName = decodeURIComponent(identifier);

    if (fileName.includes('/')) {
      fileName = fileName.split('/').pop();
    }

    // 1. Xoá file trên Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('packaging-videos')
      .remove([fileName]);

    if (storageError) console.error('Storage Delete Error:', storageError);

    // 2. Xoá dòng trong Supabase Database
    await supabase.from('videos').delete().ilike('video_url', `%${fileName}%`);

    return res.json({ success: true, message: 'Đã xoá video thành công!' });
  } catch (err) {
    console.error('Delete API Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API 5: XÓA NHIỀU VIDEO CÙNG LÚC
// ==========================================
app.post('/api/videos/delete-multiple', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Danh sách video xóa không hợp lệ' });
    }

    const filePaths = ids.map(item => {
      let fileName = item.includes('/') ? item.split('/').pop() : item;
      return decodeURIComponent(fileName);
    });

    // 1. Xóa trong Storage
    const { data, error: storageError } = await supabase.storage
      .from('packaging-videos')
      .remove(filePaths);

    if (storageError) {
      console.error('[STORAGE-ERROR]', storageError);
      return res.status(500).json({ error: storageError.message });
    }

    // 2. Xóa các dòng trong Database
    for (const fName of filePaths) {
      await supabase.from('videos').delete().ilike('video_url', `%${fName}%`);
    }

    return res.json({
      success: true,
      message: `Đã xóa thành công ${filePaths.length} video!`,
      deletedFiles: data
    });

  } catch (err) {
    console.error('Delete Bulk API Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
